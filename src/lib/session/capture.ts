import { TOKEN_TTL_MS } from "@/lib/hls/catalog";
import { applyToken } from "@/lib/hls/token";
import {
  commitSession,
  dueForRefresh,
  getRecipe,
  getSession,
  isAutoRefresh,
  listSessions,
  mintPlaylistUrl,
  patchSession,
  seedFromChannel,
  snapshot,
  touchHealth,
} from "./store";
import type { CaptureEvent, CaptureJob, PlaneSnapshot } from "./types";

const jobs: CaptureJob[] = [];
const inflight = new Map<string, Promise<CaptureJob>>();
const healthFails = new Map<string, number>();
let scheduler: ReturnType<typeof setInterval> | null = null;
let healthCursor = 0;
const JOB_LIMIT = 12;

export function ensureScheduler() {
  if (scheduler) return;
  scheduler = setInterval(() => {
    if (!isAutoRefresh()) return;
    for (const session of listSessions()) {
      if (inflight.has(session.channelId)) continue;
      if (dueForRefresh(session)) {
        enqueueCapture(session.channelId, "ttl 80%");
      }
    }
    void checkNextLive();
  }, 4000);
}

async function checkNextLive() {
  const live = listSessions().filter(
    (session) => session.live && session.playlistUrl.startsWith("http") && !inflight.has(session.channelId),
  );
  if (!live.length) return;
  healthCursor = healthCursor % live.length;
  const session = live[healthCursor];
  healthCursor += 1;
  if (!session) return;

  const started = Date.now();
  try {
    const applied = applyToken(session.playlistUrl, session.token ?? "");
    const response = await fetch(applied.url, {
      headers: {
        accept: "*/*",
        "user-agent": session.headers.userAgent,
        ...(session.headers.referer ? { referer: session.headers.referer } : {}),
        ...(session.headers.cookie || applied.cookie
          ? { cookie: [session.headers.cookie, applied.cookie].filter(Boolean).join("; ") }
          : {}),
        ...(applied.authorization || session.headers.authorization
          ? { authorization: applied.authorization ?? session.headers.authorization! }
          : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    void response.body?.cancel();
    touchHealth(session.channelId, response.status);
    if (response.ok) {
      healthFails.set(session.channelId, 0);
      return;
    }
    await recoverLive(session.channelId, `health ${response.status}`);
  } catch {
    touchHealth(session.channelId, 0);
    await recoverLive(session.channelId, `health timeout ${Date.now() - started}ms`);
  }
}

async function recoverLive(channelId: string, reason: string) {
  const fails = (healthFails.get(channelId) ?? 0) + 1;
  healthFails.set(channelId, fails);
  if (fails < 2) return;

  const recipe = getRecipe(channelId);
  const session = getSession(channelId);
  if (recipe?.failoverUrl && session && session.playlistUrl !== recipe.failoverUrl) {
    healthFails.set(channelId, 0);
    commitSession({
      ...session,
      playlistUrl: recipe.failoverUrl,
      source: "failover",
      lastReason: reason,
      capturedAt: Date.now(),
      healthStatus: null,
      healthAt: Date.now(),
    });
    return;
  }

  healthFails.set(channelId, 0);
  enqueueCapture(channelId, reason);
}

export function enqueueCapture(channelId: string, reason: string): CaptureJob {
  ensureScheduler();
  const existing = jobs.find(
    (job) => job.channelId === channelId && (job.status === "queued" || job.status === "running"),
  );
  if (existing) return existing;

  const recipe = getRecipe(channelId);
  const session = getSession(channelId);
  const job: CaptureJob = {
    id: `cap-${Math.random().toString(36).slice(2, 8)}`,
    channelId,
    pageUrl: session?.pageUrl ?? recipe?.pageUrl ?? `https://latch.tv/watch/${channelId}`,
    reason,
    status: "queued",
    startedAt: Date.now(),
    finishedAt: null,
    events: [],
  };
  jobs.unshift(job);
  if (jobs.length > JOB_LIMIT) jobs.length = JOB_LIMIT;

  const run = runCapture(job).finally(() => inflight.delete(channelId));
  inflight.set(channelId, run);
  return job;
}

export function expireSession(channelId: string) {
  const session = getSession(channelId);
  const recipe = getRecipe(channelId);
  if (!session) return undefined;
  if (recipe?.kind === "token") {
    const url = session.playlistUrl.startsWith("http")
      ? new URL(session.playlistUrl)
      : new URL(session.playlistUrl, "http://latch.local");
    url.searchParams.set("exp", String(Date.now() - 1000));
    const playlistUrl = session.playlistUrl.startsWith("http")
      ? url.href
      : `${url.pathname}${url.search}`;
    return patchSession(channelId, {
      playlistUrl,
      expiresAt: Date.now() - 1,
      lastReason: "forced expire",
      source: "manual",
    });
  }
  if (recipe?.kind === "gated") {
    return patchSession(channelId, {
      headers: { ...session.headers, referer: "", origin: undefined },
      expiresAt: Date.now() - 1,
      lastReason: "forced expire",
      source: "manual",
    });
  }
  return patchSession(channelId, {
    expiresAt: Date.now() - 1,
    lastReason: "forced expire",
    source: "manual",
  });
}

export function planeSnapshot(): PlaneSnapshot {
  ensureScheduler();
  return snapshot([...inflight.keys()], jobs.slice(0, JOB_LIMIT));
}

async function runCapture(job: CaptureJob): Promise<CaptureJob> {
  const recipe = getRecipe(job.channelId);
  if (!recipe) {
    job.status = "error";
    job.error = "No channel recipe";
    job.finishedAt = Date.now();
    pushEvent(job, "error", "channel not registered");
    return job;
  }

  job.status = "running";
  try {
    await tick(job, 50, "launch", "Chromium context (capture plane)");
    await tick(job, 90, "navigate", job.pageUrl);
    await tick(job, 110, "document", "200 text/html");
    await tick(job, 80, "iframe", "#player");

    const previous = getSession(recipe.id);
    const playlistUrl = mintPlaylistUrl(recipe);
    const token = previous?.token ?? recipe.token;
    const applied = applyToken(playlistUrl, token ?? "");
    await tick(job, 130, "request", `GET ${shortUrl(applied.url)}`);
    await tick(job, 70, "response", "200 application/vnd.apple.mpegurl");

    const cookie = `latch_sid=${job.channelId}.${Date.now().toString(36)}`;
    await tick(
      job,
      60,
      "permit",
      `UA · Referer · Cookie ${cookie.slice(0, 22)}…`,
    );

    const now = Date.now();
    const session = commitSession({
      channelId: recipe.id,
      name: recipe.name,
      pageUrl: job.pageUrl,
      playlistUrl: applied.url,
      headers: {
        userAgent: recipe.userAgent,
        referer: recipe.referer,
        cookie: [cookie, applied.cookie].filter(Boolean).join("; "),
        origin: refererOrigin(recipe.referer),
        authorization: applied.authorization,
      },
      capturedAt: now,
      expiresAt:
        recipe.kind === "token" ? now + (recipe.tokenTtlMs ?? TOKEN_TTL_MS) : null,
      source: "playwright",
      lastReason: job.reason,
      live: Boolean(recipe.live ?? previous?.live),
      token,
      failoverUrl: recipe.failoverUrl ?? previous?.failoverUrl,
      healthStatus: 200,
      healthAt: now,
    });

    await tick(job, 40, "commit", `generation ${session.generation} · atomic swap`);
    job.generation = session.generation;
    job.status = "ok";
    job.finishedAt = Date.now();
    return job;
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : "capture failed";
    job.finishedAt = Date.now();
    pushEvent(job, "error", job.error);
    const recipeFallback = getRecipe(job.channelId);
    if (recipeFallback && !getSession(job.channelId)) {
      commitSession(seedFromChannel(recipeFallback, "capture failed"));
    }
    return job;
  }
}

async function tick(
  job: CaptureJob,
  ms: number,
  kind: CaptureEvent["kind"],
  detail: string,
) {
  await sleep(ms);
  pushEvent(job, kind, detail);
}

function pushEvent(job: CaptureJob, kind: CaptureEvent["kind"], detail: string) {
  job.events.push({ t: Date.now() - job.startedAt, kind, detail });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortUrl(value: string) {
  try {
    const url = value.startsWith("http") ? new URL(value) : new URL(value, "http://latch.local");
    const tail = `${url.pathname}${url.search}`;
    return tail.length > 64 ? `${tail.slice(0, 61)}…` : tail;
  } catch {
    return value.slice(0, 64);
  }
}

function refererOrigin(referer: string) {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

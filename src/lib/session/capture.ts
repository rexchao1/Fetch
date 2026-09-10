import { scoreMirror } from "../../../scripts/sniff-core.mjs";
import { TOKEN_TTL_MS, type Channel } from "@/lib/hls/catalog";
import { applyToken } from "@/lib/hls/token";
import { commitCapture, sniff, sniffAvailable, validPage } from "./sniff";
import type { Mirror } from "./types";
import {
  commitSession,
  dueForRefresh,
  getRecipe,
  getSession,
  isAutoRefresh,
  listRecipes,
  listSessions,
  mintPlaylistUrl,
  patchSession,
  registerChannel,
  seedFromChannel,
  snapshot,
  touchHealth,
} from "./store";
import type { CaptureEvent, CaptureJob, PlaneSnapshot, StreamSession } from "./types";

const SNIFF_TIMEOUT_MS = 30_000;
const EVENT_KINDS = new Set<CaptureEvent["kind"]>([
  "launch",
  "navigate",
  "document",
  "iframe",
  "request",
  "response",
  "permit",
  "commit",
  "error",
]);

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

  if (session.mirrors?.length) {
    await checkMirrors(session as StreamSessionWithMirrors);
    return;
  }

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

/**
 * Ping every mirror of a multi-stream session, record each one's health and
 * latency in place so the dashboard shows which alternates are up, and if the
 * mirror we are playing fails twice, move to the best healthy alternate.
 */
async function checkMirrors(session: StreamSessionWithMirrors) {
  const results = await Promise.all(
    session.mirrors.map(async (mirror) => ({ mirror, ...(await pingMirror(mirror)) })),
  );
  const now = Date.now();
  for (const { mirror, status, ms } of results) {
    mirror.healthStatus = status;
    mirror.latencyMs = ms;
    mirror.healthAt = now;
  }
  const active = session.mirrors.find((m) => m.id === session.activeMirrorId) ?? session.mirrors[0];
  const activeResult = results.find((r) => r.mirror.id === active.id);
  if (activeResult) {
    session.healthStatus = activeResult.status;
    session.healthAt = now;
  }

  const activeOk = activeResult ? activeResult.status >= 200 && activeResult.status < 400 : false;
  if (activeOk) {
    healthFails.set(session.channelId, 0);
    return;
  }
  const fails = (healthFails.get(session.channelId) ?? 0) + 1;
  healthFails.set(session.channelId, fails);
  if (fails < 2) return;

  const best = bestHealthyMirror(session.mirrors, active.id);
  if (best) {
    healthFails.set(session.channelId, 0);
    switchMirror(session.channelId, best.id, `auto: ${active.label} ${activeResult?.status ?? "down"}`);
  }
}

/** The highest-scoring reachable mirror that is not the one given. */
function bestHealthyMirror(mirrors: Mirror[], excludeId: string) {
  return mirrors
    .filter((m) => m.id !== excludeId && m.healthStatus !== null && m.healthStatus >= 200 && m.healthStatus < 400)
    .map((m) => ({ m, score: scoreMirror({ ...m, status: m.healthStatus, ms: m.latencyMs ?? undefined }) }))
    .sort((a, b) => b.score - a.score)[0]?.m;
}

async function pingMirror(mirror: Mirror): Promise<{ status: number; ms: number }> {
  const started = Date.now();
  try {
    const headers: Record<string, string> = { accept: "*/*", "user-agent": mirror.headers.userAgent };
    if (mirror.headers.referer) headers.referer = mirror.headers.referer;
    if (mirror.headers.origin) headers.origin = mirror.headers.origin;
    if (mirror.headers.cookie) headers.cookie = mirror.headers.cookie;
    if (mirror.headers.authorization) headers.authorization = mirror.headers.authorization;
    const response = await fetch(mirror.url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    void response.body?.cancel();
    return { status: response.status, ms: Date.now() - started };
  } catch {
    return { status: 0, ms: Date.now() - started };
  }
}

/**
 * Point a channel at a different mirror — from the dashboard, or from the
 * watchdog when the active one dies. The channel's stable proxy path is
 * unchanged, so the player and Jellyfin just reload onto the new source.
 */
export function switchMirror(channelId: string, mirrorId: string, reason = "manual switch") {
  const session = getSession(channelId);
  if (!session?.mirrors?.length) return undefined;
  const mirror = session.mirrors.find((m) => m.id === mirrorId);
  if (!mirror) return session;

  const recipe = getRecipe(channelId);
  if (recipe) {
    recipe.url = mirror.url;
    recipe.userAgent = mirror.headers.userAgent;
    recipe.referer = mirror.headers.referer;
    recipe.token = mirror.token;
  }
  return commitSession({
    ...session,
    playlistUrl: mirror.url,
    headers: mirror.headers,
    token: mirror.token,
    expiresAt: mirror.expiresAt,
    activeMirrorId: mirror.id,
    healthStatus: mirror.healthStatus,
    healthAt: mirror.healthAt,
    source: "manual",
    lastReason: reason,
    capturedAt: Date.now(),
  });
}

type StreamSessionWithMirrors = StreamSession & { mirrors: Mirror[] };

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

/**
 * Start a capture for a page the user typed (deck form, or the proxy seeing a
 * `page=` request for a channel it no longer holds). Registers a placeholder
 * channel first so the job has a recipe to commit against; the real playlist
 * and headers land when the sniff finishes.
 */
export function enqueueSniff(
  rawPage: string,
  opts: { name?: string; channelId?: string } = {},
): CaptureJob {
  const pageUrl = validPage(rawPage);
  const existing =
    (opts.channelId ? getRecipe(opts.channelId) : undefined) ??
    listRecipes().find((channel) => !channel.builtin && channel.pageUrl === pageUrl);
  if (existing && !existing.builtin) {
    return enqueueCapture(existing.id, "sniff");
  }
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const name = (opts.name?.trim() || host).slice(0, 60);
  const stub: Channel = {
    id: opts.channelId ?? `ch-${Math.random().toString(36).slice(2, 8)}`,
    name,
    group: "Live",
    mark: name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2) || "Sn",
    url: "",
    pageUrl,
    userAgent: "",
    referer: pageUrl,
    kind: "open",
    builtin: false,
    live: true,
    note: `Captured from ${host}.`,
    source: "sniff",
  };
  registerChannel(stub);
  return enqueueCapture(stub.id, "sniff");
}

/**
 * The Guide handing back a sniffed channel this process no longer holds
 * (restart, cold function). Keeps the name and page the user gave it, seeds
 * the last-known playlist so the proxy answers meanwhile, and re-sniffs.
 * A channel the server still knows is left alone: its session is fresher.
 */
export function restoreChannel(channel: Channel) {
  if (!channel?.id || channel.builtin || channel.source !== "sniff" || !channel.pageUrl) return;
  if (getRecipe(channel.id)) return;
  let pageUrl: string;
  try {
    pageUrl = validPage(channel.pageUrl);
  } catch {
    return;
  }
  registerChannel({
    ...channel,
    pageUrl,
    kind: "open",
    builtin: false,
    source: "sniff",
    name: String(channel.name || "").slice(0, 60) || new URL(pageUrl).hostname,
  });
  enqueueCapture(channel.id, "restore");
}

/** A finished job reported by the CLI script, so the deck's log shows it. */
export function recordCaptureJob(input: {
  channelId: string;
  pageUrl: string;
  reason: string;
  events: CaptureEvent[];
  generation: number;
}) {
  const now = Date.now();
  const events = input.events
    .filter((event) => event && EVENT_KINDS.has(event.kind) && typeof event.detail === "string")
    .map((event) => ({ t: Number(event.t) || 0, kind: event.kind, detail: event.detail.slice(0, 200) }));
  const last = events.at(-1)?.t ?? 0;
  events.push({ t: last + 1, kind: "commit", detail: `generation ${input.generation} · atomic swap` });
  const job: CaptureJob = {
    id: `cap-${Math.random().toString(36).slice(2, 8)}`,
    channelId: input.channelId,
    pageUrl: input.pageUrl,
    reason: input.reason,
    status: "ok",
    startedAt: now - last - 1,
    finishedAt: now,
    events,
    generation: input.generation,
  };
  jobs.unshift(job);
  if (jobs.length > JOB_LIMIT) jobs.length = JOB_LIMIT;
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

  if (recipe.source === "sniff" && recipe.pageUrl) {
    return runSniffCapture(job, recipe);
  }

  if (!recipe.builtin) {
    // A pasted link has no page to re-open. The simulated capture below is
    // demo scaffolding for the lab channels; on a real session it would
    // overwrite the working headers with fake ones.
    job.status = "error";
    job.error = "pasted link: nothing to re-open";
    job.finishedAt = Date.now();
    pushEvent(
      job,
      "error",
      `${job.error} · sniff the page it came from on the Capture deck to get auto-refresh`,
    );
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

/**
 * The real capture plane: open the channel's page in Chromium and take the
 * playlist it loads. Needs Playwright on this machine (the homelab dev
 * server has it; Vercel does not). When it is missing, the previous session
 * is kept untouched and the job says which script to run instead.
 */
async function runSniffCapture(job: CaptureJob, recipe: Channel): Promise<CaptureJob> {
  job.status = "running";
  const pageUrl = recipe.pageUrl!;
  if (!(await sniffAvailable())) {
    job.status = "error";
    job.error = "Playwright is not installed on this server";
    job.finishedAt = Date.now();
    pushEvent(job, "error", `${job.error} · run: node scripts/sniff-m3u8.mjs ${pageUrl}`);
    return job;
  }
  try {
    const result = await sniff({
      pageUrl,
      timeoutMs: SNIFF_TIMEOUT_MS,
      onEvent: (event) => {
        const kind = EVENT_KINDS.has(event.kind as CaptureEvent["kind"])
          ? (event.kind as CaptureEvent["kind"])
          : "request";
        pushEvent(job, kind, event.detail);
      },
    });
    if (!result.playlist) {
      throw new Error(`no .m3u8 request seen on ${pageUrl}`);
    }
    const { session } = commitCapture({
      pageUrl,
      channelId: recipe.id,
      title: result.title,
      playlist: result.playlist,
      mirrors: result.mirrors,
      reason: job.reason,
    });
    pushEvent(job, "commit", `generation ${session.generation} · atomic swap`);
    job.generation = session.generation;
    job.status = "ok";
    job.finishedAt = Date.now();
    return job;
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : "sniff failed";
    job.finishedAt = Date.now();
    pushEvent(job, "error", job.error);
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

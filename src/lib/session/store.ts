import {
  BUILTIN_CHANNELS,
  CHROME_UA,
  GATED_REFERER,
  TOKEN_TTL_MS,
  type Channel,
} from "@/lib/hls/catalog";
import { applyToken } from "@/lib/hls/token";
import type { PlaneSnapshot, StreamHit, StreamSession } from "./types";

const sessions = new Map<string, StreamSession>();
const recipes = new Map<string, Channel>();
const hits: StreamHit[] = [];
let generation = 0;
let autoRefresh = true;
let seeded = false;

const HIT_LIMIT = 48;

export function ensureSeed() {
  if (seeded) return;
  seeded = true;
  for (const channel of BUILTIN_CHANNELS) {
    recipes.set(channel.id, channel);
    const existing = sessions.get(channel.id);
    if (!existing) {
      commitSession(seedFromChannel(channel, "startup"));
    } else {
      existing.live = Boolean(channel.live);
      existing.failoverUrl = channel.failoverUrl;
      existing.healthStatus = existing.healthStatus ?? null;
      existing.healthAt = existing.healthAt ?? null;
    }
  }
}

export function registerChannel(channel: Channel) {
  ensureSeed();
  recipes.set(channel.id, channel);
  const existing = sessions.get(channel.id);
  if (!existing) {
    commitSession(seedFromChannel(channel, "register"));
    return;
  }
  if ((channel.token ?? "") !== (existing.token ?? "")) {
    setSessionToken(channel.id, channel.token ?? "");
  }
  const latest = sessions.get(channel.id);
  if (
    latest &&
    (channel.userAgent !== latest.headers.userAgent || channel.referer !== latest.headers.referer)
  ) {
    setSessionHeaders(channel.id, channel.userAgent, channel.referer);
  }
}

export function setSessionHeaders(channelId: string, userAgent: string, referer: string) {
  ensureSeed();
  const recipe = recipes.get(channelId);
  if (recipe) {
    recipe.userAgent = userAgent;
    recipe.referer = referer;
  }
  const current = getSession(channelId);
  if (!current) {
    if (recipe) commitSession(seedFromChannel({ ...recipe, userAgent, referer }, "headers"));
    return;
  }
  return patchSession(channelId, {
    headers: {
      ...current.headers,
      userAgent,
      referer,
      origin: originFromReferer(referer),
    },
    lastReason: "headers applied",
    source: "manual",
  });
}

export function unregisterChannel(channelId: string) {
  ensureSeed();
  if (BUILTIN_CHANNELS.some((channel) => channel.id === channelId)) return;
  recipes.delete(channelId);
  sessions.delete(channelId);
}

export function getRecipe(channelId: string) {
  ensureSeed();
  return recipes.get(channelId);
}

export function listRecipes() {
  ensureSeed();
  return [...recipes.values()];
}

export function getSession(channelId: string) {
  ensureSeed();
  return sessions.get(channelId);
}

export function listSessions() {
  ensureSeed();
  return [...sessions.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function commitSession(
  input: Omit<StreamSession, "generation">,
): StreamSession {
  generation += 1;
  const next: StreamSession = { ...input, generation };
  sessions.set(next.channelId, next);
  return next;
}

export function patchSession(
  channelId: string,
  patch: Partial<Omit<StreamSession, "channelId" | "generation">>,
) {
  const current = getSession(channelId);
  if (!current) return undefined;
  return commitSession({ ...current, ...patch });
}

export function touchHealth(channelId: string, status: number) {
  ensureSeed();
  const current = sessions.get(channelId);
  if (!current) return;
  current.healthStatus = status;
  current.healthAt = Date.now();
}

export function recordHit(hit: StreamHit) {
  hits.unshift(hit);
  if (hits.length > HIT_LIMIT) hits.length = HIT_LIMIT;
}

export function recentHits() {
  return hits.slice(0, HIT_LIMIT);
}

export function setAutoRefresh(value: boolean) {
  autoRefresh = value;
}

export function isAutoRefresh() {
  return autoRefresh;
}

export function dueForRefresh(session: StreamSession, now = Date.now()) {
  if (!autoRefresh || !session.expiresAt) return false;
  const ttl = session.expiresAt - session.capturedAt;
  if (ttl <= 0) return false;
  const age = now - session.capturedAt;
  return age >= ttl * 0.8 && now < session.expiresAt;
}

export function snapshot(inflight: string[], jobs: PlaneSnapshot["jobs"]): PlaneSnapshot {
  ensureSeed();
  return {
    sessions: listSessions(),
    jobs,
    hits: recentHits(),
    inflight: [...inflight],
    autoRefresh,
    now: Date.now(),
  };
}

export function seedFromChannel(channel: Channel, reason: string): Omit<StreamSession, "generation"> {
  const now = Date.now();
  const pageUrl = channel.pageUrl ?? watchPage(channel.id);
  const minted = mintPlaylistUrl(channel);
  const applied = applyToken(minted, channel.token ?? "");
  const expiresAt =
    channel.kind === "token" ? now + (channel.tokenTtlMs ?? TOKEN_TTL_MS) : null;

  return {
    channelId: channel.id,
    name: channel.name,
    pageUrl,
    playlistUrl: applied.url,
    headers: {
      userAgent: channel.userAgent || CHROME_UA,
      referer: channel.referer || (channel.kind === "open" ? "" : GATED_REFERER),
      cookie: joinCookie(`fetch_sid=${channel.id}.seed`, applied.cookie),
      origin: originFromReferer(channel.referer),
      authorization: applied.authorization,
    },
    capturedAt: now,
    expiresAt,
    source: "seed",
    lastReason: reason,
    live: Boolean(channel.live),
    token: channel.token?.trim() || undefined,
    failoverUrl: channel.failoverUrl,
    healthStatus: null,
    healthAt: null,
  };
}

export function setSessionToken(channelId: string, token: string) {
  ensureSeed();
  const recipe = recipes.get(channelId);
  const current = getSession(channelId);
  if (recipe) {
    recipe.token = token.trim() || undefined;
  }
  const base = current
    ? { ...current, token: token.trim() || undefined }
    : recipe
      ? seedFromChannel({ ...recipe, token }, "token")
      : undefined;
  if (!base) return undefined;
  const sourceUrl = recipe ? mintPlaylistUrl({ ...recipe, token }) : stripTokenGuess(base.playlistUrl);
  const applied = applyToken(sourceUrl, token);
  return commitSession({
    ...base,
    playlistUrl: applied.url,
    token: token.trim() || undefined,
    headers: {
      ...base.headers,
      authorization: applied.authorization,
      cookie: joinCookie(base.headers.cookie?.replace(/;\s*$/, ""), applied.cookie),
    },
    lastReason: token.trim() ? "token updated" : "token cleared",
    source: "manual",
    capturedAt: Date.now(),
  });
}

function joinCookie(existing?: string, extra?: string) {
  return [existing, extra].filter(Boolean).join("; ") || undefined;
}

function stripTokenGuess(url: string) {
  try {
    const parsed = new URL(url);
    for (const key of ["token", "exp", "sig", "hdnts", "hash", "wmsAuthSign"]) {
      parsed.searchParams.delete(key);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

export function mintPlaylistUrl(channel: Channel) {
  if (channel.kind !== "token") return channel.url;
  const relative = channel.url.startsWith("/") || channel.url.startsWith("http");
  if (!relative) return channel.url;
  const url = new URL(channel.url, "http://fetch.local");
  url.searchParams.set("exp", String(Date.now() + (channel.tokenTtlMs ?? TOKEN_TTL_MS)));
  if (channel.url.startsWith("http")) return url.href;
  return `${url.pathname}${url.search}`;
}

export function watchPage(channelId: string) {
  return `https://fetch.tv/watch/${channelId}`;
}

function originFromReferer(referer: string) {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

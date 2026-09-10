/**
 * Server half of the page sniff: turn what the browser saw into a channel and
 * a StreamSession. `commitCapture` is shared by `/api/capture` (the CLI
 * script submitting a result) and `runCapture` (the server sniffing itself
 * when Playwright is installed). Both paths pass the playlist URL through the
 * SSRF check before anything is stored.
 */
import {
  sniffAvailable as coreAvailable,
  sniffPage,
  type SniffedMirror,
  type SniffOptions,
  type SniffResult,
  type SniffedPlaylist,
} from "../../../scripts/sniff-core.mjs";
import { CHROME_UA, type Channel } from "@/lib/hls/catalog";
import { assertSafeUpstream } from "@/lib/hls/ssrf";
import { tokenFromPlaylistUrl } from "@/lib/hls/token";
import {
  commitSession,
  getRecipe,
  getSession,
  listRecipes,
  registerChannel,
} from "./store";
import type { Mirror, StreamSession } from "./types";

export type CaptureInput = {
  pageUrl: string;
  name?: string;
  title?: string;
  channelId?: string;
  playlist: SniffedPlaylist;
  mirrors?: SniffedMirror[];
  reason?: string;
};

export function sniffAvailable() {
  return coreAvailable();
}

export function sniff(opts: SniffOptions): Promise<SniffResult> {
  return sniffPage(opts);
}

/**
 * Register (or refresh) the channel for a sniffed page and commit its session
 * in one generation. Re-sniffing the same page keeps the same channel id, so
 * the Guide entry and Jellyfin's M3U line survive a token rotation.
 */
export function commitCapture(input: CaptureInput): { channel: Channel; session: StreamSession } {
  const pageUrl = validPage(input.pageUrl);
  const existing = findByPage(pageUrl, input.channelId);
  const id = existing?.id ?? mintId();
  const previous = getSession(id);
  const now = Date.now();

  // Every mirror the page offered (one for a single-source page). SSRF-checked
  // here; anything that fails the check is dropped, never stored.
  const sniffed = input.mirrors?.length ? input.mirrors : [input.playlist];
  const mirrors: Mirror[] = [];
  for (const m of sniffed) {
    let safe: URL;
    try {
      safe = assertSafeUpstream(m.url);
    } catch {
      continue;
    }
    mirrors.push(toMirror(m, safe.href, now));
  }
  if (!mirrors.length) throw new Error("no usable playlist after safety checks");
  for (let i = 0; i < mirrors.length; i += 1) mirrors[i].id = `m${i + 1}`;

  // On a recapture keep the mirror the user was watching (matched by label);
  // otherwise take the best, which the sniffer already ranked first.
  const keepLabel =
    previous?.mirrors?.find((m) => m.id === previous.activeMirrorId)?.label ?? undefined;
  const active = (keepLabel && mirrors.find((m) => m.label === keepLabel)) || mirrors[0];

  const keptName = existing && existing.name !== hostOf(pageUrl) ? existing.name : "";
  const name = (input.name || keptName || nameFor(input.title, pageUrl)).slice(0, 60);
  const live = active.live ?? existing?.live ?? true;

  const channel: Channel = {
    id,
    name,
    group: existing?.group ?? "Live",
    mark: existing?.mark ?? markFor(name),
    url: active.url,
    pageUrl,
    userAgent: active.headers.userAgent || CHROME_UA,
    referer: active.headers.referer || pageUrl,
    kind: "open",
    builtin: false,
    live,
    note: existing?.note ?? `Captured from ${hostOf(pageUrl)}.`,
    token: active.token || undefined,
    source: "sniff",
  };
  registerChannel(channel);

  const session = commitSession({
    channelId: id,
    name,
    pageUrl,
    playlistUrl: active.url,
    headers: active.headers,
    capturedAt: now,
    expiresAt: active.expiresAt,
    source: "sniff",
    lastReason: input.reason ?? "sniff",
    live,
    token: active.token || undefined,
    healthStatus: active.healthStatus,
    healthAt: active.healthAt,
    mirrors,
    activeMirrorId: active.id,
  });
  return { channel, session };
}

/** Convert a sniffed mirror to a session Mirror, its headers filled in. */
function toMirror(m: SniffedMirror, safeUrl: string, now: number): Mirror {
  return {
    id: m.id,
    label: m.label,
    url: safeUrl,
    headers: {
      userAgent: m.headers.userAgent || CHROME_UA,
      referer: m.headers.referer || "",
      origin: m.headers.origin || originOf(m.headers.referer || ""),
      cookie: m.headers.cookie || undefined,
      authorization: m.headers.authorization || undefined,
    },
    token: tokenFromPlaylistUrl(safeUrl) || undefined,
    kind: m.kind,
    live: m.live,
    bandwidth: m.bandwidth,
    width: m.width,
    height: m.height,
    expiresAt: m.expiresAt ?? null,
    healthStatus: m.status ?? null,
    healthAt: m.status ? now : null,
    latencyMs: typeof m.ms === "number" ? m.ms : null,
  };
}

/** Channels the Guide should adopt: everything the capture plane registered. */
export function listSniffedChannels() {
  return listRecipes().filter((channel) => channel.source === "sniff");
}

function findByPage(pageUrl: string, channelId?: string) {
  if (channelId) {
    const byId = getRecipe(channelId);
    if (byId && !byId.builtin) return byId;
  }
  return listRecipes().find((channel) => !channel.builtin && channel.pageUrl === pageUrl);
}

export function validPage(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("pageUrl must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("pageUrl must be http or https");
  }
  return url.href;
}

function nameFor(title: string | undefined, pageUrl: string) {
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  if (clean && clean.length >= 3) return clean.split(/\s[|·–—-]\s/)[0]!.slice(0, 48);
  return hostOf(pageUrl);
}

function hostOf(pageUrl: string) {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Stream";
  }
}

function markFor(name: string) {
  const letters = name.replace(/[^a-zA-Z0-9]/g, "");
  return (letters.slice(0, 2) || "Sn").replace(/^(.)(.)$/, (_m, a: string, b: string) => a.toUpperCase() + b);
}

function originOf(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function mintId() {
  return `ch-${Math.random().toString(36).slice(2, 8)}`;
}

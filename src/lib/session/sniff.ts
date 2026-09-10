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
import type { StreamSession } from "./types";

export type CaptureInput = {
  pageUrl: string;
  name?: string;
  title?: string;
  channelId?: string;
  playlist: SniffedPlaylist;
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
  const upstream = assertSafeUpstream(input.playlist.url);
  const existing = findByPage(pageUrl, input.channelId);
  const id = existing?.id ?? mintId();
  // A placeholder registered from a bare `page=` request only knows the host;
  // the page title is a better name than that once we have it.
  const keptName = existing && existing.name !== hostOf(pageUrl) ? existing.name : "";
  const name = (input.name || keptName || nameFor(input.title, pageUrl)).slice(0, 60);
  const headers = input.playlist.headers;
  const token = tokenFromPlaylistUrl(upstream.href);
  const live = input.playlist.live ?? existing?.live ?? true;

  const channel: Channel = {
    id,
    name,
    group: existing?.group ?? "Live",
    mark: existing?.mark ?? markFor(name),
    url: upstream.href,
    pageUrl,
    failoverUrl: existing?.failoverUrl,
    userAgent: headers.userAgent || CHROME_UA,
    referer: headers.referer || pageUrl,
    kind: "open",
    builtin: false,
    live,
    note: existing?.note ?? `Captured from ${hostOf(pageUrl)}.`,
    token: token || undefined,
    source: "sniff",
  };
  registerChannel(channel);

  const now = Date.now();
  const previous = getSession(id);
  const session = commitSession({
    channelId: id,
    name,
    pageUrl,
    playlistUrl: upstream.href,
    headers: {
      userAgent: channel.userAgent,
      referer: channel.referer,
      origin: headers.origin || originOf(channel.referer),
      cookie: headers.cookie || undefined,
      authorization: headers.authorization || undefined,
    },
    capturedAt: now,
    expiresAt: input.playlist.expiresAt ?? null,
    source: "sniff",
    lastReason: input.reason ?? "sniff",
    live,
    token: token || undefined,
    failoverUrl: previous?.failoverUrl,
    healthStatus: input.playlist.status ?? null,
    healthAt: input.playlist.status ? now : null,
  });
  return { channel, session };
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

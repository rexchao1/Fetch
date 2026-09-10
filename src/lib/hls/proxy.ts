import { GATED_REFERER, BBB_PLAYLIST, CHROME_UA, JELLYFIN_UA } from "./catalog";
import { CORS_HEADERS, jsonResponse, textResponse } from "./http";
import {
  buildProxyPath,
  firstMediaUrl,
  isPlaylistBody,
  rewriteM3U8,
  summarizePlaylist,
} from "./rewrite";
import { enqueueCapture, enqueueSniff, ensureScheduler } from "@/lib/session/capture";
import {
  ensureSeed,
  getSession,
  recordHit,
  registerChannel,
} from "@/lib/session/store";
import type { SessionHeaders } from "@/lib/session/types";
import { resolveUpstream } from "./ssrf";
import { isLiveMediaPlaylist, urlLooksLive } from "./live";
import { applyToken } from "./token";
import type { ProbeCell } from "./types";

const FETCH_TIMEOUT_MS = 15000;
const PLAYLIST_LIMIT = 1_500_000;

const PASS_HEADERS = new Set(["content-type", "content-length", "content-range", "accept-ranges"]);

export function gateAllows(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  const referer = request.headers.get("referer") ?? request.headers.get("referrer") ?? "";
  if (!ua || /jellyfin/i.test(ua) || ua === JELLYFIN_UA) {
    return { ok: false as const, reason: "user-agent rejected" };
  }
  if (!/mozilla|vlc|latchproxy/i.test(ua)) {
    return { ok: false as const, reason: "user-agent rejected" };
  }
  if (!referer.startsWith(GATED_REFERER)) {
    return { ok: false as const, reason: "referer rejected" };
  }
  return { ok: true as const };
}

export function tokenAllows(url: URL) {
  const exp = Number(url.searchParams.get("exp") ?? "0");
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    return { ok: false as const, reason: "token expired", exp };
  }
  return { ok: true as const, exp };
}

export async function handleHlsProxy(request: Request) {
  ensureSeed();
  ensureScheduler();
  const reqUrl = new URL(request.url);
  const channelId = reqUrl.searchParams.get("ch") ?? "";
  const raw = reqUrl.searchParams.get("u");
  const queryUa = reqUrl.searchParams.get("ua") ?? CHROME_UA;
  const queryRf = reqUrl.searchParams.get("rf") ?? "";
  const page = reqUrl.searchParams.get("page");

  if (channelId && !raw && page && !getSession(channelId)) {
    // A sniffed channel this process has forgotten (restart, cold function):
    // the M3U/Guide only know the page, so the capture plane re-sniffs it and
    // the player's retry lands on the fresh session.
    try {
      enqueueSniff(page, { channelId });
    } catch (error) {
      return textResponse(error instanceof Error ? error.message : "Bad page URL", 400);
    }
  }

  if (channelId && raw && !getSession(channelId)) {
    registerChannel({
      id: channelId,
      name: channelId,
      group: "Custom",
      mark: channelId.slice(0, 2),
      url: raw,
      userAgent: queryUa,
      referer: queryRf,
      kind: "open",
      builtin: false,
      note: "Registered from proxy request.",
    });
  }

  const session = channelId ? getSession(channelId) : undefined;
  const targetRaw = raw || session?.playlistUrl;
  if (!targetRaw) {
    if (session?.source === "sniff" || (session && page)) {
      return textResponse("503 capture pending — the page is being sniffed", 503);
    }
    return textResponse("Missing u", 400);
  }

  let upstream: URL;
  try {
    upstream = resolveUpstream(targetRaw, request.url);
  } catch (error) {
    return textResponse(error instanceof Error ? error.message : "Bad URL", 400);
  }

  const applied = applyToken(upstream.href, session?.token ?? "");
  try {
    upstream = resolveUpstream(applied.url, request.url);
  } catch (error) {
    return textResponse(error instanceof Error ? error.message : "Bad URL", 400);
  }

  const headers: SessionHeaders = {
    ...(session?.headers ?? {
      userAgent: queryUa,
      referer: queryRf,
    }),
    authorization: applied.authorization ?? session?.headers.authorization,
    cookie: [session?.headers.cookie, applied.cookie].filter(Boolean).join("; ") || session?.headers.cookie,
  };

  const started = Date.now();
  const rewriteOpts = {
    channelId: channelId || undefined,
    userAgent: headers.userAgent,
    referer: headers.referer,
  };

  let response: Response;
  if (isSelfPath(upstream, reqUrl, "/api/gate")) {
    response = await handleGate(
      new Request(upstream, { headers: sessionHeaders(headers) }),
      rewriteOpts,
    );
  } else if (isSelfPath(upstream, reqUrl, "/api/token")) {
    response = await handleToken(
      new Request(upstream, { headers: sessionHeaders(headers) }),
      rewriteOpts,
    );
  } else {
    response = await proxyFetch(upstream.href, {
      headers,
      range: request.headers.get("range"),
      toProxy: (abs) => buildProxyPath(abs, rewriteOpts),
    });
  }

  if (channelId) {
    recordHit({
      at: Date.now(),
      channelId,
      status: response.status,
      ms: Date.now() - started,
      path: raw ? "segment" : "master",
    });
    if (response.status === 401 || response.status === 403 || response.status === 410) {
      enqueueCapture(channelId, `upstream ${response.status}`);
    }
  }

  return response;
}

export async function handleGate(
  request: Request,
  rewriteOpts?: { channelId?: string; userAgent?: string; referer?: string },
) {
  const allowed = gateAllows(request);
  if (!allowed.ok) {
    return textResponse(`403 ${allowed.reason}`, 403);
  }

  const reqUrl = new URL(request.url);
  const nested = reqUrl.searchParams.get("u");
  const target = nested || BBB_PLAYLIST;
  let upstream: URL;
  try {
    upstream = resolveUpstream(target, request.url);
  } catch (error) {
    return textResponse(error instanceof Error ? error.message : "Bad URL", 400);
  }

  const ua = rewriteOpts?.userAgent ?? request.headers.get("user-agent") ?? CHROME_UA;
  const referer = rewriteOpts?.referer ?? request.headers.get("referer") ?? GATED_REFERER;

  return proxyFetch(upstream.href, {
    headers: { userAgent: ua, referer },
    range: request.headers.get("range"),
    toProxy: (abs) =>
      rewriteOpts?.channelId
        ? buildProxyPath(abs, rewriteOpts)
        : gatePath(reqUrl.origin, abs),
  });
}

export async function handleToken(
  request: Request,
  rewriteOpts?: { channelId?: string; userAgent?: string; referer?: string },
) {
  const reqUrl = new URL(request.url);
  const allowed = tokenAllows(reqUrl);
  if (!allowed.ok) {
    return textResponse("410 token expired", 410);
  }

  const nested = reqUrl.searchParams.get("u");
  const target = nested || BBB_PLAYLIST;
  let upstream: URL;
  try {
    upstream = resolveUpstream(target, request.url);
  } catch (error) {
    return textResponse(error instanceof Error ? error.message : "Bad URL", 400);
  }

  const ua = rewriteOpts?.userAgent ?? request.headers.get("user-agent") ?? CHROME_UA;
  const referer = rewriteOpts?.referer ?? request.headers.get("referer") ?? GATED_REFERER;

  return proxyFetch(upstream.href, {
    headers: { userAgent: ua, referer },
    range: request.headers.get("range"),
    toProxy: (abs) => {
      if (rewriteOpts?.channelId) return buildProxyPath(abs, rewriteOpts);
      const inner = new URL("/api/token", reqUrl.origin);
      inner.searchParams.set("u", abs);
      inner.searchParams.set("exp", String(allowed.exp));
      return inner.pathname + inner.search;
    },
  });
}

export async function handleInspect(request: Request) {
  const reqUrl = new URL(request.url);
  const channelId = reqUrl.searchParams.get("ch") ?? "";
  const session = channelId ? getSession(channelId) : undefined;
  const raw = reqUrl.searchParams.get("u") || session?.playlistUrl;
  if (!raw) return jsonResponse({ error: "Missing u" }, 400);

  let upstream: URL;
  try {
    upstream = resolveUpstream(raw, request.url);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Bad URL" }, 400);
  }

  const applied = applyToken(upstream.href, session?.token ?? "");
  try {
    upstream = new URL(applied.url);
  } catch {
    /* keep resolved upstream */
  }

  const userAgent = session?.headers.userAgent ?? reqUrl.searchParams.get("ua") ?? "";
  const referer = session?.headers.referer ?? reqUrl.searchParams.get("rf") ?? "";

  const result = await fetchPlaylistPreview(
    upstream.href,
    userAgent,
    referer,
    request.url,
    channelId,
    {
      authorization: applied.authorization ?? session?.headers.authorization,
      cookie: [session?.headers.cookie, applied.cookie].filter(Boolean).join("; ") || session?.headers.cookie,
    },
  );
  return jsonResponse(
    {
      ...result,
      session: session
        ? {
            generation: session.generation,
            source: session.source,
            expiresAt: session.expiresAt,
            capturedAt: session.capturedAt,
            pageUrl: session.pageUrl,
          }
        : null,
    },
    result.ok ? 200 : result.status || 502,
  );
}

export type { ProbeCell } from "./types";

export async function handleProbe(request: Request) {
  const body = (await request.json()) as {
    url?: string;
    userAgents?: { id: string; value: string }[];
    referers?: { id: string; value: string }[];
  };
  const target = body.url?.trim();
  if (!target) return jsonResponse({ error: "Missing url" }, 400);

  let upstream: URL;
  try {
    upstream = resolveUpstream(target, request.url);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Bad URL" }, 400);
  }

  const userAgents = (body.userAgents ?? []).slice(0, 5);
  const referers = (body.referers ?? []).slice(0, 4);
  const jobs: Promise<ProbeCell>[] = [];

  for (const ua of userAgents) {
    for (const rf of referers) {
      jobs.push(probeCombo(upstream.href, ua, rf));
    }
  }

  const cells = await Promise.all(jobs);
  return jsonResponse({ url: upstream.href, cells });
}

async function probeCombo(
  url: string,
  ua: { id: string; value: string },
  rf: { id: string; value: string },
): Promise<ProbeCell> {
  const started = Date.now();
  try {
    const playlist = await fetch(url, {
      headers: sessionHeaders({ userAgent: ua.value, referer: rf.value }),
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    const playlistStatus = playlist.status;
    let segmentStatus: number | null = null;
    if (playlist.ok) {
      const text = await playlist.text();
      if (isPlaylistBody(text)) {
        const next = firstMediaUrl(text, playlist.url || url);
        if (next) {
          const segment = await fetch(next, {
            method: "GET",
            headers: sessionHeaders({ userAgent: ua.value, referer: rf.value }),
            redirect: "follow",
            signal: AbortSignal.timeout(8000),
          });
          segmentStatus = segment.status;
          void segment.body?.cancel();
        }
      }
    } else {
      void playlist.body?.cancel();
    }
    return {
      uaId: ua.id,
      refererId: rf.id,
      playlistStatus,
      segmentStatus,
      playlistMs: Date.now() - started,
    };
  } catch (error) {
    return {
      uaId: ua.id,
      refererId: rf.id,
      playlistStatus: null,
      segmentStatus: null,
      playlistMs: Date.now() - started,
      error: error instanceof Error ? error.message : "failed",
    };
  }
}

async function fetchPlaylistPreview(
  url: string,
  userAgent: string,
  referer: string,
  requestUrl: string,
  channelId?: string,
  extra?: Pick<SessionHeaders, "authorization" | "cookie">,
) {
  const started = Date.now();
  const rewriteOpts = { channelId: channelId || undefined, userAgent, referer };
  const headers: SessionHeaders = {
    userAgent,
    referer,
    authorization: extra?.authorization,
    cookie: extra?.cookie,
  };
  try {
    const reqUrl = new URL(requestUrl);
    const upstream = new URL(url);
    let response: Response;
    let alreadyRewritten = false;
    if (isSelfPath(upstream, reqUrl, "/api/gate")) {
      response = await handleGate(
        new Request(upstream, { headers: sessionHeaders(headers) }),
        rewriteOpts,
      );
      alreadyRewritten = true;
    } else if (isSelfPath(upstream, reqUrl, "/api/token")) {
      response = await handleToken(
        new Request(upstream, { headers: sessionHeaders(headers) }),
        rewriteOpts,
      );
      alreadyRewritten = true;
    } else {
      response = await fetch(url, {
        headers: sessionHeaders(headers),
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    }

    const status = response.status;
    const contentType = response.headers.get("content-type") ?? "";
    const original = (await response.text()).slice(0, PLAYLIST_LIMIT);
    const playlist = isPlaylistBody(original);
    const rewritten =
      playlist && !alreadyRewritten
        ? rewriteM3U8(original, response.url || url, (abs) => buildProxyPath(abs, rewriteOpts))
        : {
            text: original,
            rewrites: playlist ? (original.match(/\/api\/hls\?/g) ?? []).length : 0,
          };
    const summary = playlist ? summarizePlaylist(original) : null;
    let live = false;
    if (playlist && !alreadyRewritten) {
      if (isLiveMediaPlaylist(original)) live = true;
      else if (summary?.isMaster) {
        const next = firstMediaUrl(original, response.url || url);
        if (next) {
          try {
            const media = await fetch(next, {
              headers: sessionHeaders(headers),
              redirect: "follow",
              signal: AbortSignal.timeout(8000),
            });
            const mediaText = await media.text();
            live = isLiveMediaPlaylist(mediaText);
          } catch {
            live = urlLooksLive(url);
          }
        }
      }
      if (!live) live = urlLooksLive(url) && !/#EXT-X-ENDLIST/im.test(original);
    }

    return {
      ok: response.ok,
      status,
      contentType,
      ms: Date.now() - started,
      playlist,
      original,
      rewritten: rewritten.text,
      rewrites: rewritten.rewrites,
      summary,
      live,
      finalUrl: response.url || url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      ms: Date.now() - started,
      playlist: false,
      original: "",
      rewritten: "",
      rewrites: 0,
      summary: null,
      live: false,
      finalUrl: url,
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

type ProxyOpts = {
  headers: SessionHeaders;
  range: string | null;
  toProxy: (absoluteUrl: string) => string;
};

async function proxyFetch(url: string, opts: ProxyOpts) {
  const headers = sessionHeaders(opts.headers);
  if (opts.range) headers.set("range", opts.range);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return textResponse(error instanceof Error ? error.message : "Upstream failed", 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const maybePlaylist =
    contentType.includes("mpegurl") ||
    contentType.includes("text/") ||
    /\.m3u8?(\?|$)/i.test(url);

  if (maybePlaylist) {
    const text = await upstream.text();
    if (isPlaylistBody(text)) {
      const rewritten = rewriteM3U8(text, upstream.url || url, opts.toProxy);
      return new Response(rewritten.text, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        "content-type": contentType || "application/octet-stream",
      },
    });
  }

  const outHeaders = new Headers(CORS_HEADERS);
  for (const [key, value] of upstream.headers.entries()) {
    if (PASS_HEADERS.has(key.toLowerCase())) outHeaders.set(key, value);
  }
  if (!outHeaders.has("content-type") || outHeaders.get("content-type") === "application/octet-stream") {
    const guessed = guessMediaType(url);
    if (guessed !== "application/octet-stream") outHeaders.set("content-type", guessed);
  }
  outHeaders.set("cache-control", "public, max-age=30");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

function sessionHeaders(input: SessionHeaders) {
  const headers = new Headers();
  if (input.userAgent) headers.set("user-agent", input.userAgent);
  if (input.referer) {
    headers.set("referer", input.referer);
    try {
      headers.set("origin", input.origin || new URL(input.referer).origin);
    } catch {
      if (input.origin) headers.set("origin", input.origin);
    }
  } else if (input.origin) {
    headers.set("origin", input.origin);
  }
  if (input.cookie) headers.set("cookie", input.cookie);
  if (input.authorization) headers.set("authorization", input.authorization);
  headers.set("accept", "*/*");
  return headers;
}

function gatePath(origin: string, abs: string) {
  const inner = new URL("/api/gate", origin);
  inner.searchParams.set("u", abs);
  return inner.pathname + inner.search;
}

function isSelfPath(upstream: URL, request: URL, path: string) {
  return upstream.origin === request.origin && upstream.pathname === path;
}

function guessMediaType(url: string) {
  if (/\.ts(\?|$)/i.test(url)) return "video/mp2t";
  if (/\.m4s(\?|$)/i.test(url)) return "video/iso.segment";
  if (/\.mp4(\?|$)/i.test(url)) return "video/mp4";
  if (/\.key(\?|$)/i.test(url)) return "application/octet-stream";
  if (/\.aac(\?|$)/i.test(url)) return "audio/aac";
  return "application/octet-stream";
}

export function handleLogo(request: Request) {
  const mark = new URL(request.url).searchParams.get("m") ?? "Lv";
  const safe = mark.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3) || "Lv";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14161a"/><rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#eceae4" stroke-opacity="0.12"/><text x="32" y="40" text-anchor="middle" font-size="20" font-family="Times New Roman, serif" fill="#eceae4">${escapeXml(safe)}</text></svg>`;
  return new Response(svg, {
    headers: {
      ...CORS_HEADERS,
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&").replaceAll("<", "<").replaceAll(">", ">");
}

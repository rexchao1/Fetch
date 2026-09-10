/**
 * Watch a page's network traffic for HLS playlists.
 *
 * `sniffPage` opens the page in headless Chromium, records every request whose
 * URL or response looks like an `.m3u8` playlist, nudges the page's video
 * elements to play, and returns the best candidate with the exact headers and
 * cookies the page sent for it. It is the one place Playwright is imported,
 * and it imports it lazily with a non-literal specifier so the Vercel server
 * bundle never traces the package; `sniffAvailable` says whether it loaded.
 *
 * The pure helpers (`pickPlaylist`, `expiryFromUrl`, `cookieHeader`,
 * `classifyPlaylist`) are exported for `sniff-core.test.mjs`.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;
export const SETTLE_MS = 4_000;
const BODY_LIMIT = 200_000;

export const SNIFF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const PLAYLIST_URL = /\.m3u8?(\?|#|$)/i;
const PLAYLIST_TYPE = /mpegurl|application\/x-mpegurl|audio\/x-mpegurl|vnd\.apple\.mpegurl/i;

const PLAY_SELECTORS = [
  ".vjs-big-play-button",
  ".jw-display-icon-container",
  ".plyr__control--overlaid",
  "button[aria-label*='play' i]",
  "[class*='play-button' i]",
  "[class*='playbutton' i]",
  "[id*='play' i][role='button']",
  "video",
];

/** @typedef {{ t: number, kind: string, detail: string }} SniffEvent */
/**
 * @typedef {object} Candidate
 * @property {string} url
 * @property {number} at ms since sniff start
 * @property {string} frameUrl
 * @property {"master"|"media"|"unknown"} kind
 * @property {boolean|null} live
 * @property {number|null} status
 * @property {Record<string,string>} headers request headers, lower-cased keys
 */

let playwrightModule = null;
let playwrightError = null;

async function loadPlaywright() {
  if (playwrightModule) return playwrightModule;
  if (playwrightError) throw playwrightError;
  try {
    // Non-literal specifier: bundlers (nitro/rollup for Vercel) cannot trace
    // it, so the server build stays small and this throws at call time where
    // Playwright is not installed instead of failing the build.
    const spec = "playwright";
    playwrightModule = await import(/* @vite-ignore */ spec);
    return playwrightModule;
  } catch (error) {
    playwrightError = error instanceof Error ? error : new Error(String(error));
    throw playwrightError;
  }
}

export async function sniffAvailable() {
  try {
    await loadPlaywright();
    return true;
  } catch {
    return false;
  }
}

/** master (has variants), media (has segments), or unknown (no body). */
export function classifyPlaylist(text) {
  if (!text) return { kind: "unknown", live: null };
  const head = text.trimStart();
  if (!head.startsWith("#EXTM3U") && !head.startsWith("#EXT-X-")) {
    return { kind: "unknown", live: null };
  }
  if (/^#EXT-X-STREAM-INF/m.test(text)) return { kind: "master", live: null };
  const live =
    !/#EXT-X-ENDLIST/m.test(text) &&
    !/#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(text) &&
    (/#EXT-X-TARGETDURATION/i.test(text) || /#EXT-X-MEDIA-SEQUENCE/i.test(text));
  return { kind: "media", live };
}

/**
 * The playlist worth keeping: the first master, else the first media
 * playlist, else the first URL that merely looked like one. `live` is taken
 * from any media playlist seen, since a master says nothing about it.
 * @param {Candidate[]} candidates
 */
export function pickPlaylist(candidates) {
  if (!candidates.length) return null;
  const ordered = [...candidates].sort((a, b) => a.at - b.at);
  const chosen =
    ordered.find((c) => c.kind === "master") ??
    ordered.find((c) => c.kind === "media") ??
    ordered[0];
  const media = ordered.find((c) => c.kind === "media" && c.live !== null);
  return { ...chosen, live: chosen.live ?? media?.live ?? null };
}

const EXPIRY_KEYS = ["exp", "expires", "expire", "expiry", "e", "et", "validto", "valid_to"];

/**
 * Expiry (epoch ms) encoded in a signed playlist URL, or null. Understands
 * plain `exp=` style params in seconds or ms, Akamai `hdnts=exp=…~acl=…`,
 * and JWT tokens carrying an `exp` claim. Anything in the past or more than
 * 30 days out is ignored as noise.
 */
export function expiryFromUrl(raw, now = Date.now()) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const found = [];
  for (const [key, value] of url.searchParams) {
    const lower = key.toLowerCase();
    if (EXPIRY_KEYS.includes(lower)) found.push(toEpochMs(value));
    const inline = value.match(/(?:^|[~&;,])exp(?:ires)?=(\d{9,13})/i);
    if (inline) found.push(toEpochMs(inline[1]));
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(value)) found.push(jwtExpiry(value));
  }
  const inPath = url.pathname.match(/(?:^|[/~])exp(?:ires)?=(\d{9,13})/i);
  if (inPath) found.push(toEpochMs(inPath[1]));

  const valid = found.filter((ms) => ms !== null && ms > now && ms - now < 30 * 86_400_000);
  return valid.length ? Math.min(...valid) : null;
}

function toEpochMs(value) {
  if (!/^\d{9,13}$/.test(String(value))) return null;
  const n = Number(value);
  return n < 1e11 ? n * 1000 : n;
}

function jwtExpiry(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const exp = JSON.parse(json).exp;
    return typeof exp === "number" ? toEpochMs(String(Math.floor(exp))) : null;
  } catch {
    return null;
  }
}

/** `name=value; name2=value2` from Playwright cookie objects. */
export function cookieHeader(cookies) {
  const seen = new Set();
  const parts = [];
  for (const cookie of cookies ?? []) {
    if (!cookie?.name || seen.has(cookie.name)) continue;
    seen.add(cookie.name);
    parts.push(`${cookie.name}=${cookie.value ?? ""}`);
  }
  return parts.join("; ");
}

/** Merge a request's own Cookie header with the context jar for the URL. */
export function mergeCookies(headerValue, jar) {
  const out = [];
  const seen = new Set();
  for (const chunk of [headerValue, jar]) {
    for (const pair of String(chunk ?? "").split(/;\s*/)) {
      const name = pair.split("=")[0]?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(pair.trim());
    }
  }
  return out.join("; ");
}

/**
 * @param {object} opts
 * @param {string} opts.pageUrl
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.settleMs]
 * @param {boolean} [opts.headed]
 * @param {string} [opts.userAgent]
 * @param {(event: SniffEvent) => void} [opts.onEvent]
 */
export async function sniffPage(opts) {
  const { chromium } = await loadPlaywright();
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settleMs = opts.settleMs ?? SETTLE_MS;
  const events = [];
  const emit = (kind, detail) => {
    const event = { t: Date.now() - started, kind, detail };
    events.push(event);
    opts.onEvent?.(event);
  };

  /** @type {Candidate[]} */
  const candidates = [];
  const seen = new Set();
  let firstSeenAt = null;
  let resolveSettled;
  const settled = new Promise((resolve) => {
    resolveSettled = resolve;
  });

  emit("launch", `Chromium ${opts.headed ? "headed" : "headless"} (capture plane)`);
  const browser = await chromium.launch({
    headless: !opts.headed,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });

  try {
    const context = await browser.newContext({
      userAgent: opts.userAgent ?? SNIFF_UA,
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Ad-heavy stream pages open popup tabs on every click and some try to
    // navigate this tab to an ad. Close popups the moment they open, and
    // block this page from being replaced, so the sniff survives long enough
    // to see the playlist.
    context.on("page", (extra) => {
      if (extra !== page) {
        emit("request", `blocked popup ${shortUrl(extra.url() || "about:blank")}`);
        extra.close().catch(() => {});
      }
    });
    await page
      .addInitScript(() => {
        try {
          window.open = () => null;
        } catch {
          /* sandboxed frame */
        }
      })
      .catch(() => {});

    const consider = async (request, response) => {
      const url = request.url();
      const contentType = response?.headers()?.["content-type"] ?? "";
      // Path only: a page whose *query* names a playlist (player demos,
      // `?src=…m3u8`) is not itself one. HTML never is.
      const byUrl = PLAYLIST_URL.test(pathOf(url));
      const byType = PLAYLIST_TYPE.test(contentType);
      if ((!byUrl && !byType) || /text\/html/i.test(contentType)) return;
      if (seen.has(url)) return;
      seen.add(url);

      let headers = {};
      try {
        headers = await request.allHeaders();
      } catch {
        headers = request.headers();
      }
      let body = "";
      if (response) {
        try {
          body = (await response.text()).slice(0, BODY_LIMIT);
        } catch {
          body = "";
        }
      }
      const cls = classifyPlaylist(body);
      const candidate = {
        url,
        at: Date.now() - started,
        frameUrl: request.frame()?.url() ?? "",
        kind: cls.kind,
        live: cls.live,
        status: response?.status() ?? null,
        headers: lowerKeys(headers),
      };
      candidates.push(candidate);
      if (firstSeenAt === null) {
        firstSeenAt = Date.now();
        setTimeout(resolveSettled, settleMs);
      }
      emit("response", `${candidate.status ?? "…"} ${cls.kind} ${shortUrl(url)}`);
    };

    page.on("response", (response) => {
      void consider(response.request(), response).catch(() => {});
    });
    page.on("requestfailed", (request) => {
      if (PLAYLIST_URL.test(pathOf(request.url()))) {
        void consider(request, null).catch(() => {});
      }
    });

    emit("navigate", opts.pageUrl);
    const nav = await page.goto(opts.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeoutMs, 20_000),
    });
    emit("document", `${nav?.status() ?? "?"} ${nav?.headers()?.["content-type"] ?? ""}`.trim());

    const title = (await page.title().catch(() => "")).trim();
    const frames = page.frames().length - 1;
    if (frames > 0) emit("iframe", `${frames} frame${frames === 1 ? "" : "s"}`);

    // Nudge playback a couple of times; many players only fetch the playlist
    // after a play gesture. Stops as soon as something is captured.
    const nudge = async (label) => {
      if (firstSeenAt !== null) return;
      const clicked = await tryPlay(page).catch(() => null);
      if (clicked) emit("request", `${label}: ${clicked}`);
    };
    // Several rounds: nested-iframe players (JW Player behind an ad wall) often
    // need the overlay clicked more than once, and the frame may not exist yet
    // on the first pass.
    const timers = [1_500, 5_000, 9_000, 14_000, 20_000].map((ms, i) =>
      setTimeout(() => void nudge(`nudge play ${i + 1}`), ms),
    );

    const deadline = delay(timeoutMs - (Date.now() - started));
    await Promise.race([settled, deadline]);
    for (const timer of timers) clearTimeout(timer);

    // Many stream pages (a JW/Video.js embed behind an ad wall) never fetch
    // the playlist headless — the player stays idle — but the URL is sitting
    // in its config or a <video>/<source>. Harvest it and confirm it really
    // is a playlist by fetching it in-context (shares the page's cookies).
    if (!candidates.length) {
      for (const harvested of await harvestPlaylists(page)) {
        if (seen.has(harvested.url)) continue;
        seen.add(harvested.url);
        emit("request", `config: ${shortUrl(harvested.url)} (${harvested.via})`);
        let body = "";
        let status = null;
        try {
          const res = await context.request.get(harvested.url, {
            headers: { "user-agent": opts.userAgent ?? SNIFF_UA, referer: harvested.frameUrl, accept: "*/*" },
            timeout: 8_000,
            failOnStatusCode: false,
          });
          status = res.status();
          const ct = res.headers()["content-type"] ?? "";
          if (PLAYLIST_TYPE.test(ct) || PLAYLIST_URL.test(pathOf(harvested.url))) {
            body = (await res.text()).slice(0, BODY_LIMIT);
          }
        } catch {
          /* unreachable or blocked; keep it as a bare candidate anyway */
        }
        const cls = classifyPlaylist(body);
        candidates.push({
          url: harvested.url,
          at: Date.now() - started,
          frameUrl: harvested.frameUrl,
          kind: cls.kind,
          live: cls.live,
          status,
          headers: {
            "user-agent": opts.userAgent ?? SNIFF_UA,
            referer: harvested.frameUrl,
            origin: originOf(harvested.frameUrl),
          },
        });
        emit("response", `${status ?? "…"} ${cls.kind} ${shortUrl(harvested.url)} (from player config)`);
      }
    }

    const finalUrl = page.url();
    const picked = pickPlaylist(candidates);
    let cookie = "";
    if (picked) {
      try {
        const jar = await context.cookies([picked.url, finalUrl]);
        cookie = mergeCookies(picked.headers.cookie, cookieHeader(jar));
      } catch {
        cookie = picked.headers.cookie ?? "";
      }
    }

    if (!picked) {
      emit("error", `no .m3u8 seen in ${Math.round((Date.now() - started) / 1000)}s`);
    } else {
      const summary = [
        "UA",
        picked.headers.referer ? "Referer" : null,
        picked.headers.origin ? "Origin" : null,
        cookie ? `Cookie ${cookie.slice(0, 18)}…` : null,
        picked.headers.authorization ? "Authorization" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      emit("permit", summary);
    }

    return {
      pageUrl: opts.pageUrl,
      finalUrl,
      title,
      playlist: picked
        ? {
            url: picked.url,
            kind: picked.kind,
            live: picked.live,
            status: picked.status,
            expiresAt: expiryFromUrl(picked.url),
            headers: {
              userAgent: picked.headers["user-agent"] ?? opts.userAgent ?? SNIFF_UA,
              referer: picked.headers.referer ?? finalUrl,
              origin: picked.headers.origin || originOf(picked.headers.referer ?? finalUrl),
              cookie: cookie || undefined,
              authorization: picked.headers.authorization || undefined,
            },
          }
        : null,
      candidates: candidates.map((c) => ({ url: c.url, kind: c.kind, status: c.status, at: c.at })),
      events,
      ms: Date.now() - started,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Read playlist URLs out of the players on the page without waiting for
 * playback: JW Player and Video.js configs, `<video>`/`<source>` src, and a
 * regex sweep of each frame's HTML for an `.m3u8`. Player frames first.
 * @returns {Promise<Array<{url: string, frameUrl: string, via: string}>>}
 */
async function harvestPlaylists(page) {
  const out = [];
  const seen = new Set();
  const frames = page.frames();
  const ordered = [
    ...frames.filter((f) => looksLikePlayerFrame(f.url())),
    ...frames.filter((f) => !looksLikePlayerFrame(f.url())),
  ];
  for (const frame of ordered) {
    let found;
    try {
      found = await frame.evaluate(() => {
        const hits = [];
        const add = (url, via) => {
          if (typeof url === "string" && /\.m3u8?(\?|#|$)/i.test(url.split(/[?#]/)[0])) hits.push({ url, via });
        };
        try {
          if (window.jwplayer) {
            const p = window.jwplayer();
            add(p?.getConfig?.()?.file, "jwplayer.config");
            for (const item of p?.getPlaylist?.() ?? []) {
              add(item?.file, "jwplayer.playlist");
              for (const s of item?.sources ?? []) add(s?.file, "jwplayer.source");
            }
          }
        } catch {
          /* player not ready */
        }
        for (const v of document.querySelectorAll("video")) add(v.currentSrc || v.src, "video.src");
        for (const s of document.querySelectorAll("source")) add(s.src || s.getAttribute("src"), "source");
        const html = document.documentElement?.outerHTML ?? "";
        for (const m of html.match(/https?:\/\/[^"'\s<>\\]+?\.m3u8[^"'\s<>\\]*/gi) ?? []) {
          add(m.replace(/\\\//g, "/"), "html");
        }
        return hits;
      });
    } catch {
      found = [];
    }
    for (const hit of found ?? []) {
      let abs = hit.url;
      try {
        abs = new URL(hit.url, frame.url()).href;
      } catch {
        /* keep as-is */
      }
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ url: abs, frameUrl: frame.url(), via: hit.via });
    }
  }
  return out;
}

async function tryPlay(page) {
  // Player frames first (a JW/Video.js embed nested in the page), then the
  // main document. Ad iframes are skipped so a click does not just open them.
  const frames = page.frames();
  const ordered = [
    ...frames.filter((f) => f !== page.mainFrame() && looksLikePlayerFrame(f.url())),
    ...frames.filter((f) => f !== page.mainFrame() && !looksLikePlayerFrame(f.url())),
    page.mainFrame(),
  ];
  const done = [];
  for (const frame of ordered) {
    const tag = frame === page.mainFrame() ? "" : " (iframe)";
    // A real overlay click is a trusted gesture — the thing JW Player and
    // friends wait for — so try the play controls before falling back to
    // video.play(), and do not stop at the first hit: the control may be an
    // ad's, and the true player often needs both.
    for (const selector of PLAY_SELECTORS) {
      if (selector === "video") continue;
      try {
        const locator = frame.locator(selector).first();
        if ((await locator.count()) === 0) continue;
        await locator.click({ timeout: 700, force: true });
        done.push(`${selector}${tag}`);
        break;
      } catch {
        /* next selector */
      }
    }
    try {
      const played = await frame.evaluate(() => {
        const videos = Array.from(document.querySelectorAll("video"));
        for (const video of videos) {
          video.muted = true;
          void video.play?.().catch(() => {});
        }
        return videos.length;
      });
      if (played > 0) done.push(`video.play()×${played}${tag}`);
    } catch {
      /* cross-origin or detached */
    }
  }
  return done.length ? done.slice(0, 2).join(" + ") : null;
}

const PLAYER_FRAME_HINT = /player|embed|stream|live|hls|jwp|video|watch|iframe|\.php/i;
const AD_FRAME_HINT = /doubleclick|googlesyndication|adservice|chatango|histats|dtscout|amung|rtmark|skout|rocks|adblock/i;

function looksLikePlayerFrame(url) {
  if (!url || url === "about:blank") return false;
  if (AD_FRAME_HINT.test(url)) return false;
  return PLAYER_FRAME_HINT.test(url);
}

function pathOf(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return String(value).split(/[?#]/)[0] ?? "";
  }
}

function lowerKeys(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) out[key.toLowerCase()] = value;
  return out;
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function shortUrl(value) {
  try {
    const url = new URL(value);
    const tail = `${url.host}${url.pathname}${url.search}`;
    return tail.length > 72 ? `${tail.slice(0, 69)}…` : tail;
  } catch {
    return String(value).slice(0, 72);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

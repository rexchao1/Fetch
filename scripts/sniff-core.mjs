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
const MAX_SWITCHES = 6; // stream-switch buttons to click through per page
const SWITCH_WAIT_MS = 3_000; // settle after clicking a switch before harvesting
const MAX_MIRRORS = 8; // distinct playlists kept for one channel

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
      if (!isPlaylistCandidate(url, contentType)) return;
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

    // Absorb URLs sitting in a player's config or a <video>/<source> that were
    // never fetched headless (the player stays idle behind an ad wall). Confirm
    // each is a real playlist in-context. Labeled by the variant it belongs to.
    const absorbHarvest = async (label) => {
      for (const harvested of await harvestPlaylists(page)) {
        if (seen.has(harvested.url)) continue;
        seen.add(harvested.url);
        candidates.push({
          url: harvested.url,
          at: Date.now() - started,
          frameUrl: harvested.frameUrl,
          kind: "unknown",
          live: null,
          status: null,
          label,
          headers: {
            "user-agent": opts.userAgent ?? SNIFF_UA,
            referer: harvested.frameUrl,
            origin: originOf(harvested.frameUrl),
          },
        });
        emit("response", `config ${shortUrl(harvested.url)} (${harvested.via})`);
      }
    };
    await absorbHarvest(undefined);

    // Multi-stream pages carry "Stream 1 / Server 2 / …" buttons that each swap
    // the player to a mirror of the same event. Click through them so every
    // mirror is captured, then rank them. Time-window labelling ties each
    // playlist to the button that was clicked just before it appeared.
    const marks = [{ at: 0, label: undefined }];
    const switches = await tagSwitches(page);
    if (switches.length) {
      emit("iframe", `${switches.length} stream button${switches.length === 1 ? "" : "s"}`);
      for (const sw of switches.slice(0, MAX_SWITCHES)) {
        try {
          await sw.frame.locator(sw.sel).first().click({ timeout: 1_500, force: true });
          marks.push({ at: Date.now() - started, label: sw.label });
          emit("request", `switch → ${sw.label}`);
          await delay(SWITCH_WAIT_MS);
          await absorbHarvest(sw.label);
        } catch {
          emit("error", `could not click ${sw.label}`);
        }
      }
    }

    const finalUrl = page.url();
    // Label any network-captured playlist by the switch active when it arrived.
    for (const c of candidates) {
      if (c.label) continue;
      let label;
      for (const mark of marks) if (mark.at <= c.at) label = mark.label;
      c.label = label;
    }

    const mirrors = await buildMirrors(context, candidates, finalUrl, opts, emit);
    const best = mirrors[0] ?? null;

    if (!best) {
      emit("error", `no .m3u8 seen in ${Math.round((Date.now() - started) / 1000)}s`);
    } else {
      emit(
        "permit",
        mirrors.length > 1
          ? `${mirrors.length} mirrors · best ${best.label} (${describeMirror(best)})`
          : describeMirror(best),
      );
    }

    return {
      pageUrl: opts.pageUrl,
      finalUrl,
      title,
      playlist: best,
      mirrors,
      candidates: candidates.map((c) => ({ url: c.url, kind: c.kind, status: c.status, at: c.at })),
      events,
      ms: Date.now() - started,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Turn raw playlist sightings into ranked mirrors: dedupe by URL, probe each
 * in-context for reachability, latency and (from a master) bandwidth and
 * resolution, then sort best-first with `scoreMirror`. Every entry is a
 * self-contained way to play the stream, headers and token included.
 */
export async function buildMirrors(context, candidates, finalUrl, opts, emit = () => {}) {
  const byUrl = new Map();
  for (const c of candidates) {
    const existing = byUrl.get(c.url);
    // Prefer a sighting that carried real request headers (referer/cookie)
    // over a bare config harvest of the same URL.
    if (!existing || (!existing.headers.referer && c.headers.referer)) byUrl.set(c.url, c);
  }
  const distinct = [...byUrl.values()].slice(0, MAX_MIRRORS);

  const built = await Promise.all(
    distinct.map(async (c) => {
      let cookie = "";
      try {
        const jar = await context.cookies([c.url, c.frameUrl || finalUrl]);
        cookie = mergeCookies(c.headers.cookie, cookieHeader(jar));
      } catch {
        cookie = c.headers.cookie ?? "";
      }
      const headers = {
        userAgent: c.headers["user-agent"] ?? opts.userAgent ?? SNIFF_UA,
        referer: c.headers.referer ?? c.frameUrl ?? finalUrl,
        origin: c.headers.origin || originOf(c.headers.referer ?? c.frameUrl ?? finalUrl),
        cookie: cookie || undefined,
        authorization: c.headers.authorization || undefined,
      };
      const probe = await probeMirror(context, c.url, headers);
      return {
        // Raw label from the switch button (or empty); display name assigned
        // after grouping so child playlists collapse under their parent.
        rawLabel: (c.label || "").trim(),
        url: c.url,
        kind: probe.kind !== "unknown" ? probe.kind : c.kind,
        live: probe.live ?? c.live,
        status: probe.status ?? c.status,
        ms: probe.ms,
        bandwidth: probe.bandwidth,
        width: probe.width,
        height: probe.height,
        expiresAt: expiryFromUrl(c.url),
        headers,
      };
    }),
  );

  // One mirror per switch button. A master playlist drags its child media
  // playlists along as separate captures under the same label; keep only the
  // best-scoring playlist per raw label so each Stream button is one mirror.
  // All unlabelled captures (a single-stream page and its children) collapse
  // into one group.
  const groups = new Map();
  for (const m of built) {
    const key = m.rawLabel || " default";
    const winner = groups.get(key);
    if (!winner || scoreMirror(m) > scoreMirror(winner)) groups.set(key, m);
  }
  const ranked = [...groups.values()].sort(
    (a, b) => scoreMirror(b) - scoreMirror(a) || (a.ms ?? 9e9) - (b.ms ?? 9e9),
  );
  // Assign display names in ranked order (m1 = best). Keep a button's own name;
  // fall back to "Stream N" only where the page gave none.
  const out = ranked.map((m, i) => {
    const { rawLabel, ...rest } = m;
    return { ...rest, id: `m${i + 1}`, label: rawLabel || (ranked.length > 1 ? `Stream ${i + 1}` : "Stream 1") };
  });
  for (const m of out) emit("response", `mirror ${m.label}: ${describeMirror(m)}`);
  return out;
}

/** Fetch a playlist in-context: reachability, latency, and master ladder info. */
async function probeMirror(context, url, headers) {
  const started = Date.now();
  try {
    const res = await context.request.get(url, {
      headers: {
        "user-agent": headers.userAgent,
        accept: "*/*",
        ...(headers.referer ? { referer: headers.referer } : {}),
        ...(headers.origin ? { origin: headers.origin } : {}),
        ...(headers.cookie ? { cookie: headers.cookie } : {}),
        ...(headers.authorization ? { authorization: headers.authorization } : {}),
      },
      timeout: 8_000,
      failOnStatusCode: false,
    });
    const ms = Date.now() - started;
    const ct = res.headers()["content-type"] ?? "";
    let body = "";
    if (PLAYLIST_TYPE.test(ct) || PLAYLIST_URL.test(pathOf(url))) {
      body = (await res.text()).slice(0, BODY_LIMIT);
    } else {
      await res.body().catch(() => {});
    }
    const cls = classifyPlaylist(body);
    const master = parseMasterInfo(body);
    return {
      status: res.status(),
      ms,
      kind: cls.kind,
      live: cls.live,
      bandwidth: master.bandwidth,
      width: master.width,
      height: master.height,
    };
  } catch {
    return { status: null, ms: Date.now() - started, kind: "unknown", live: null };
  }
}

/** Highest BANDWIDTH and its RESOLUTION from a master playlist, if any. */
export function parseMasterInfo(text) {
  if (!text) return {};
  let bandwidth = 0;
  let width;
  let height;
  for (const line of text.split(/\r?\n/)) {
    if (!/^#EXT-X-STREAM-INF/i.test(line)) continue;
    const bw = Number(line.match(/[,:]BANDWIDTH=(\d+)/i)?.[1] ?? 0);
    if (bw > bandwidth) {
      bandwidth = bw;
      const res = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      if (res) {
        width = Number(res[1]);
        height = Number(res[2]);
      }
    }
  }
  return bandwidth ? { bandwidth, width, height } : {};
}

/**
 * Rank a mirror. Reachable and adaptive is best; higher bandwidth and
 * resolution help; latency hurts; a 4xx/5xx is effectively out. Higher wins.
 * @param {{status: number|null, live: boolean|null, bandwidth?: number, width?: number, kind: string, ms?: number}} m
 */
export function scoreMirror(m) {
  let s = 0;
  if (m.status === 200) s += 100;
  else if (m.status == null) s += 45; // harvested, never confirmed — worth a try
  else if (m.status >= 400) s -= 50;
  else s += 20;
  if (m.live) s += 8;
  if (m.kind === "master") s += 6;
  if (m.bandwidth) s += Math.min(m.bandwidth / 1_000_000, 25);
  if (m.width) s += Math.min(m.width / 160, 12);
  if (typeof m.ms === "number") s -= Math.min(m.ms / 120, 18);
  return s;
}

function describeMirror(m) {
  const bits = [];
  if (m.status) bits.push(String(m.status));
  if (m.width) bits.push(`${m.width}p`.replace(/^\d+/, () => `${m.height ?? m.width}`));
  else if (m.bandwidth) bits.push(`${Math.round(m.bandwidth / 1000)}kbps`);
  if (typeof m.ms === "number") bits.push(`${m.ms}ms`);
  if (m.live) bits.push("live");
  return bits.join(" · ") || "unconfirmed";
}

const SWITCH_TEXT =
  /^\s*(stream|server|link|mirror|source|player|option|channel|feed|hd|sd|cdn)\s*[-#:]?\s*\d+\s*$/i;
const SWITCH_TEXT_LOOSE = /\b(stream|server|mirror|link)\s*#?\s*\d+\b/i;

/**
 * Tag likely stream-switch controls across all frames and return a locator for
 * each. Marks the elements with a data attribute so a stable selector survives
 * the click. Skips big containers so we click the button, not its wrapper.
 */
async function tagSwitches(page) {
  const out = [];
  for (const frame of page.frames()) {
    let labels;
    try {
      labels = await frame.evaluate(
        ([strict, loose]) => {
          const rxStrict = new RegExp(strict, "i");
          const rxLoose = new RegExp(loose, "i");
          const nodes = Array.from(
            document.querySelectorAll("a,button,li,span,div,[role='button'],[onclick]"),
          );
          const found = [];
          let i = 0;
          for (const el of nodes) {
            const text = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (!text || text.length > 18) continue;
            if (!rxStrict.test(text) && !rxLoose.test(text)) continue;
            if (el.querySelectorAll("a,button,[role='button']").length > 1) continue;
            const box = el.getBoundingClientRect();
            if (box.width < 8 || box.height < 8) continue;
            el.setAttribute("data-latch-switch", String(i));
            found.push({ i, label: text });
            i += 1;
            if (i >= 10) break;
          }
          return found;
        },
        [SWITCH_TEXT.source, SWITCH_TEXT_LOOSE.source],
      );
    } catch {
      labels = [];
    }
    for (const l of labels ?? []) {
      out.push({ frame, sel: `[data-latch-switch="${l.i}"]`, label: l.label });
    }
  }
  return out;
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

// Path only: a page whose *query* names a playlist (player demos,
// `?src=…m3u8`) is not itself one — that one only survives on content type,
// and HTML never is a real one. But a URL whose *path* ends in `.m3u8` is
// trusted on its own, token/query string and all: some origins serve the
// real playlist mislabeled as `text/html` (deliberately, to defeat naive
// scrapers), and `classifyPlaylist` on the body still rejects it downstream
// if it turns out to actually be an HTML page.
export function isPlaylistCandidate(url, contentType) {
  const byUrl = PLAYLIST_URL.test(pathOf(url));
  const byType = PLAYLIST_TYPE.test(contentType ?? "");
  if (byUrl) return true;
  return byType && !/text\/html/i.test(contentType ?? "");
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

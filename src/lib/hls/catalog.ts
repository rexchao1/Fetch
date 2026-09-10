export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
export const VLC_UA = "VLC/3.0.21 LibVLC/3.0.21";
export const JELLYFIN_UA = "Mozilla/5.0 (Linux) Jellyfin-FFmpeg";
export const LATCH_UA = "LatchProxy/1.0";

export const GATED_REFERER = "https://latch.tv/";
export const TOKEN_TTL_MS = 15 * 60 * 1000;

export const BBB_PLAYLIST = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
export const BIPBOP_PLAYLIST =
  "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8";
export const CASTR_LIVE =
  "https://stream-akamai.castr.com/5b9352dbda7b8c769937e459/live_2361c920455111ea85db6911fe397b9e/index.fmp4.m3u8";
export const UNIFIED_LIVE =
  "https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8";

export type ChannelKind = "open" | "gated" | "token";

export type Channel = {
  id: string;
  name: string;
  group: string;
  mark: string;
  url: string;
  pageUrl?: string;
  failoverUrl?: string;
  userAgent: string;
  referer: string;
  kind: ChannelKind;
  builtin: boolean;
  live?: boolean;
  note: string;
  token?: string;
  tokenTtlMs?: number;
  tokenExpiresAt?: number;
  /**
   * "sniff": the playlist was captured from `pageUrl` by the capture plane
   * (`scripts/sniff-m3u8.mjs` or the in-app sniff). The server session is
   * authoritative for the URL and headers, so the proxy path carries the page
   * instead of pinning a playlist URL that rotates.
   */
  source?: "sniff";
};

export const BUILTIN_CHANNELS: Channel[] = [
  {
    id: "castr-live",
    name: "Castr Live",
    group: "Live",
    mark: "Lv",
    url: CASTR_LIVE,
    failoverUrl: UNIFIED_LIVE,
    pageUrl: "https://latch.tv/watch/castr-live",
    userAgent: CHROME_UA,
    referer: "https://castr.com/",
    kind: "open",
    builtin: true,
    live: true,
    note: "Public live HLS. Watchdog pings the master; failover swaps to Unified if this dies.",
  },
  {
    id: "unified-live",
    name: "Unified Live",
    group: "Live",
    mark: "Un",
    url: UNIFIED_LIVE,
    failoverUrl: CASTR_LIVE,
    pageUrl: "https://latch.tv/watch/unified-live",
    userAgent: CHROME_UA,
    referer: "https://demo.unified-streaming.com/",
    kind: "open",
    builtin: true,
    live: true,
    note: "Public sliding-window live HLS. Same ingest path as a match feed you already have.",
  },
  {
    id: "bbb",
    name: "Big Buck Bunny",
    group: "Cinema",
    mark: "Bb",
    url: BBB_PLAYLIST,
    pageUrl: "https://latch.tv/watch/bbb",
    userAgent: CHROME_UA,
    referer: "https://test-streams.mux.dev/",
    kind: "open",
    builtin: true,
    note: "Open Mux VOD. Headers still sent so picky CDNs stay happy.",
  },
  {
    id: "bipbop",
    name: "Apple BipBop",
    group: "Cinema",
    mark: "Bp",
    url: BIPBOP_PLAYLIST,
    pageUrl: "https://latch.tv/watch/bipbop",
    userAgent: CHROME_UA,
    referer: "https://developer.apple.com/",
    kind: "open",
    builtin: true,
    note: "fMP4 ladder — rewrite has to catch EXT-X-MAP URI.",
  },
  {
    id: "header-lock",
    name: "Header Lock",
    group: "Lab",
    mark: "Hl",
    url: "/api/gate",
    pageUrl: "https://latch.tv/watch/header-lock",
    userAgent: CHROME_UA,
    referer: GATED_REFERER,
    kind: "gated",
    builtin: true,
    note: "Rejects empty UA, Jellyfin-FFmpeg, and a missing Referer — the 403 Jellyfin hits.",
  },
  {
    id: "night-token",
    name: "Night Token",
    group: "Lab",
    mark: "Nt",
    url: "/api/token",
    pageUrl: "https://latch.tv/watch/night-token",
    userAgent: CHROME_UA,
    referer: GATED_REFERER,
    kind: "token",
    builtin: true,
    tokenTtlMs: TOKEN_TTL_MS,
    tokenExpiresAt: Date.now() + TOKEN_TTL_MS,
    note: "Playlist URL dies every 15 minutes. Capture plane mints a new exp before Jellyfin 403s.",
  },
];

export const PROBE_USER_AGENTS = [
  { id: "none", label: "None", value: "" },
  { id: "jellyfin", label: "Jellyfin", value: JELLYFIN_UA },
  { id: "chrome", label: "Chrome", value: CHROME_UA },
  { id: "vlc", label: "VLC", value: VLC_UA },
] as const;

export function headerRecipe(userAgent: string, referer: string) {
  const ua =
    /Jellyfin/i.test(userAgent)
      ? "Jellyfin"
      : /VLC/i.test(userAgent)
        ? "VLC"
        : /LatchProxy/i.test(userAgent)
          ? "Latch"
          : userAgent
            ? "Chrome"
            : "no UA";
  const rf = referer ? shortHost(referer) : "no Referer";
  return `${ua} · ${rf}`;
}

export function shortHost(value: string) {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/$/, "") || "referer";
  }
}

export function channelUpstream(channel: Channel, origin: string): string {
  const base = channel.url.startsWith("/") ? new URL(channel.url, origin).href : channel.url;
  if (channel.kind !== "token") return base;
  const url = new URL(base);
  const exp = channel.tokenExpiresAt ?? Date.now() + (channel.tokenTtlMs ?? TOKEN_TTL_MS);
  url.searchParams.set("exp", String(exp));
  return url.href;
}

export function channelProxyPath(channel: Channel, opts?: { mirrorId?: string }) {
  const params = new URLSearchParams();
  params.set("ch", channel.id);
  if (channel.source === "sniff") {
    // The session holds the (rotating) playlist; the page is what re-sniffs it
    // if the server has forgotten the channel. A mirror id pins which source
    // to play — the dashboard sets it when you switch.
    if (channel.pageUrl) params.set("page", channel.pageUrl);
    if (opts?.mirrorId) params.set("m", opts.mirrorId);
  } else if (!channel.builtin) {
    params.set("u", channel.url);
    if (channel.userAgent) params.set("ua", channel.userAgent);
    if (channel.referer) params.set("rf", channel.referer);
  }
  return `/api/hls?${params.toString()}`;
}

const GROUP_RANK: Record<string, number> = { Live: 0, Cinema: 1, Lab: 2 };

export function groupChannels(channels: Channel[]) {
  const order: string[] = [];
  const map = new Map<string, Channel[]>();
  for (const channel of channels) {
    if (!map.has(channel.group)) {
      map.set(channel.group, []);
      order.push(channel.group);
    }
    map.get(channel.group)!.push(channel);
  }
  order.sort((a, b) => (GROUP_RANK[a] ?? 8) - (GROUP_RANK[b] ?? 8) || a.localeCompare(b));
  return order.map((name) => ({ name, channels: map.get(name)! }));
}

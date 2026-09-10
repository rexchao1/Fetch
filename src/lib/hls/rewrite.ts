const URI_ATTR = /URI=("[^"]*"|'[^']*'|[^\s,]+)/gi;

export function isPlaylistBody(text: string) {
  const start = text.trimStart();
  return start.startsWith("#EXTM3U") || start.startsWith("#EXT-X-");
}

export function rewriteM3U8(
  body: string,
  playlistUrl: string,
  toProxy: (absoluteUrl: string) => string,
): { text: string; rewrites: number } {
  let rewrites = 0;
  const lines = body.split(/\r?\n/);
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith("#")) {
      return trimmed.replace(URI_ATTR, (match, raw: string) => {
        const uri = raw.replace(/^["']|["']$/g, "");
        if (!uri || uri.startsWith("skd:") || uri.startsWith("data:")) return match;
        try {
          const abs = new URL(uri, playlistUrl).href;
          const wrapped = toProxy(abs);
          rewrites += 1;
          const quote = raw.startsWith("'") ? "'" : '"';
          return `URI=${quote}${wrapped}${quote}`;
        } catch {
          return match;
        }
      });
    }

    try {
      const abs = new URL(trimmed, playlistUrl).href;
      rewrites += 1;
      return toProxy(abs);
    } catch {
      return line;
    }
  });

  return { text: out.join("\n"), rewrites };
}

export function summarizePlaylist(text: string) {
  const lines = text.split(/\r?\n/);
  let variants = 0;
  let segments = 0;
  let keys = 0;
  let maps = 0;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF")) variants += 1;
    else if (line.startsWith("#EXTINF")) segments += 1;
    else if (line.startsWith("#EXT-X-KEY")) keys += 1;
    else if (line.startsWith("#EXT-X-MAP")) maps += 1;
  }
  return {
    isMaster: variants > 0,
    variants,
    segments,
    keys,
    maps,
    lines: lines.filter((l) => l.trim()).length,
  };
}

export function firstMediaUrl(text: string, playlistUrl: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      return new URL(trimmed, playlistUrl).href;
    } catch {
      continue;
    }
  }
  const uri = text.match(/URI=("([^"]+)"|'([^']+)')/);
  if (uri) {
    const value = uri[2] || uri[3];
    if (value) {
      try {
        return new URL(value, playlistUrl).href;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function buildProxyPath(
  upstream: string,
  opts: { channelId?: string; userAgent?: string; referer?: string; mirrorId?: string },
) {
  const params = new URLSearchParams();
  if (opts.channelId) params.set("ch", opts.channelId);
  params.set("u", upstream);
  if (opts.channelId) {
    if (opts.mirrorId) params.set("m", opts.mirrorId);
  } else {
    if (opts.userAgent) params.set("ua", opts.userAgent);
    if (opts.referer) params.set("rf", opts.referer);
  }
  return `/api/hls?${params.toString()}`;
}

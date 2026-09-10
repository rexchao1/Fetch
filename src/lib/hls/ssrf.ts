const BLOCKED_HOST =
  /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|0:0:0:0:0:0:0:1|metadata\.google\.internal|metadata\.goog)$/i;

export function assertSafeUpstream(raw: string, requestOrigin?: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid upstream URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) upstreams are allowed");
  }

  if (requestOrigin) {
    try {
      if (url.origin === new URL(requestOrigin).origin) return url;
    } catch {
      /* ignore */
    }
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private or local hosts are not allowed");
  }

  return url;
}

export function resolveUpstream(raw: string, requestUrl: string): URL {
  const request = new URL(requestUrl);
  const absolute = new URL(raw, request.origin);
  return assertSafeUpstream(absolute.href, request.origin);
}

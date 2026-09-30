export function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function textResponse(
  body: string,
  status = 200,
  contentType = "text/plain; charset=utf-8",
) {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

/**
 * Names a public DNS server can't hand out, so a web page can't point one at
 * Fetch (DNS rebinding) and read the API as same-origin: IP literals,
 * single-label names, and the local-only suffixes (`host.docker.internal`
 * included, for Jellyfin in Docker Desktop).
 */
const LOCAL_NAME = /^(localhost|[^.]+|.+\.(localhost|local|internal|lan|home\.arpa))$/i;

function hostnameOf(host: string) {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/, "");
}

function isLocalHostname(hostname: string) {
  return /^[\d.]+$/.test(hostname) || hostname.includes(":") || LOCAL_NAME.test(hostname);
}

/**
 * Who may call the API. Fetch has no login, so it relies on only being
 * reachable from this Mac and refuses anything a browser marks as coming from
 * another site: a web page open in any tab could otherwise read saved cookies
 * and tokens from `/api/session`, register channels, or start sniffs.
 * Jellyfin, VLC and the sniff script send none of the browser headers checked
 * here, and the app's own window is same-origin.
 */
export function rejectRequest(request: Request): Response | null {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!isLocalHostname(hostnameOf(host))) {
    return textResponse("403 unknown host", 403);
  }

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return textResponse("403 cross-site request", 403);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === host;
    } catch {
      /* "null" or garbage */
    }
    if (!sameOrigin) return textResponse("403 cross-origin request", 403);
  }

  // A JSON content type can't be sent cross-site without a preflight, which
  // this server never approves.
  if (request.method === "POST") {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return textResponse("415 send application/json", 415);
    }
  }

  return null;
}

type Handler = (ctx: { request: Request }) => Response | Promise<Response>;

/** Wrap every method of an API route in `rejectRequest`. */
export function withApiGuard<T extends Record<string, Handler>>(handlers: T): T {
  const guarded: Record<string, Handler> = {};
  for (const [method, handler] of Object.entries(handlers)) {
    guarded[method] = (ctx) => rejectRequest(ctx.request) ?? handler(ctx);
  }
  return guarded as T;
}

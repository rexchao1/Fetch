import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Addresses Fetch never proxies to: loopback, the LAN, link-local (cloud
 * metadata lives there), CGNAT, multicast and reserved space, in both
 * families. IPv4-mapped IPv6 (`::ffff:192.168.1.1`) matches the IPv4 rules.
 */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv6");
}

const BLOCKED_NAME = /(^|\.)(localhost|local|internal|home\.arpa|lan)$|^metadata\.goog$/i;

export function isPrivateAddress(ip: string) {
  const family = isIP(ip);
  if (family === 4) return PRIVATE.check(ip, "ipv4");
  if (family === 6) return PRIVATE.check(ip, "ipv6");
  return false;
}

/**
 * Parse an upstream URL and refuse anything that is not public http(s). The
 * URL parser already folds `127.1`, `0x7f000001` and friends into dotted
 * quads, so an IP literal is checked as an address. A name is checked here
 * for the obvious local suffixes and again after DNS by `safeFetch`.
 */
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

  // The demo gate/token routes are served in-process by the proxy; their
  // same-origin URL is the one local address allowed through.
  if (requestOrigin) {
    try {
      if (url.origin === new URL(requestOrigin).origin) return url;
    } catch {
      /* ignore */
    }
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? isPrivateAddress(host) : BLOCKED_NAME.test(host.replace(/\.$/, ""))) {
    throw new Error("Private or local hosts are not allowed");
  }

  return url;
}

export function resolveUpstream(raw: string, requestUrl: string): URL {
  const request = new URL(requestUrl);
  const absolute = new URL(raw, request.origin);
  return assertSafeUpstream(absolute.href, request.origin);
}

const DNS_TTL_MS = 60_000;
const dnsCache = new Map<string, { ok: boolean; at: number }>();

/** Resolve a hostname and refuse it if any address it points at is private. */
async function assertResolvesPublic(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  const cached = dnsCache.get(host);
  if (cached && Date.now() - cached.at < DNS_TTL_MS) {
    if (!cached.ok) throw new Error("Private or local hosts are not allowed");
    return;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  const ok = addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  if (dnsCache.size > 500) dnsCache.clear();
  dnsCache.set(host, { ok, at: Date.now() });
  if (!ok) throw new Error("Private or local hosts are not allowed");
}

const MAX_REDIRECTS = 5;

/**
 * `fetch` for anything the proxy or capture plane sends upstream. Every hop is
 * checked, including each redirect target and the addresses its name resolves
 * to, so a public URL that bounces to the LAN is refused. Cookies and
 * authorization are dropped when a redirect leaves the original origin.
 * Returns the final URL alongside the response, since a manual-redirect
 * response does not carry it.
 */
export async function safeFetch(
  raw: string,
  init: Omit<RequestInit, "redirect"> = {},
): Promise<{ response: Response; url: string }> {
  let url = assertSafeUpstream(raw);
  let headers = new Headers(init.headers);
  for (let hop = 0; ; hop += 1) {
    await assertResolvesPublic(url.hostname);
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, url: url.href };
    }
    void response.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const next = assertSafeUpstream(new URL(location, url).href);
    if (next.origin !== url.origin) {
      headers = new Headers(headers);
      headers.delete("cookie");
      headers.delete("authorization");
    }
    url = next;
  }
}

const TWO_PART_SUFFIX = /^(co|com|net|org|gov|edu|ac|ne|or|go)$/;

/**
 * The registrable part of a hostname, near enough: the last two labels, or
 * three under a country code's `co.`/`com.`-style second level. Used to keep
 * a session's cookies and tokens on the site that issued them.
 */
export function siteOf(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host)) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const tld = labels.at(-1)!;
  const second = labels.at(-2)!;
  const take = tld.length === 2 && TWO_PART_SUFFIX.test(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function sameSite(a: string, b: string) {
  try {
    return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname);
  } catch {
    return false;
  }
}

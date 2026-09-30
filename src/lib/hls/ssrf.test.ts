import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSafeUpstream, safeFetch, sameSite, siteOf } from "./ssrf.ts";

describe("assertSafeUpstream", () => {
  const blocked = [
    "http://127.0.0.1:47821/api/session",
    "http://127.1/",
    "http://0x7f000001/",
    "http://2130706433/",
    "http://0/",
    "http://10.0.0.5/",
    "http://172.20.1.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.100.100.100/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:192.168.1.1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://nas.local/",
    "http://metadata.google.internal/",
    "http://router.lan/",
  ];
  for (const url of blocked) {
    it(`refuses ${url}`, () => {
      assert.throws(() => assertSafeUpstream(url), /Private or local/);
    });
  }

  const allowed = [
    "https://cdn.example.com/live.m3u8",
    "http://93.184.215.14/a.m3u8",
    "http://172.32.0.1/",
    "http://[2606:4700::1111]/",
  ];
  for (const url of allowed) {
    it(`allows ${url}`, () => {
      assert.equal(assertSafeUpstream(url).href, new URL(url).href);
    });
  }

  it("refuses non-http schemes", () => {
    assert.throws(() => assertSafeUpstream("file:///etc/passwd"), /http/);
  });

  it("allows the server's own origin for the demo routes", () => {
    const url = assertSafeUpstream("http://127.0.0.1:47821/api/gate", "http://127.0.0.1:47821");
    assert.equal(url.pathname, "/api/gate");
  });
});

describe("safeFetch", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("refuses a redirect into the LAN", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response(null, { status: 302, headers: { location: "http://192.168.1.1/admin" } });
    }) as typeof fetch;
    await assert.rejects(safeFetch("http://93.184.215.14/a.m3u8"), /Private or local/);
    assert.deepEqual(seen, ["http://93.184.215.14/a.m3u8"]);
  });

  it("follows a public redirect, drops credentials across origins, and reports the final URL", async () => {
    const calls: { url: string; cookie: string | null; auth: string | null }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), cookie: headers.get("cookie"), auth: headers.get("authorization") });
      if (calls.length === 1) {
        return new Response(null, { status: 301, headers: { location: "http://93.184.215.15/b.m3u8" } });
      }
      return new Response("#EXTM3U", { status: 200 });
    }) as typeof fetch;
    const { response, url } = await safeFetch("http://93.184.215.14/a.m3u8", {
      headers: { cookie: "sid=1", authorization: "Bearer x" },
    });
    assert.equal(response.status, 200);
    assert.equal(url, "http://93.184.215.15/b.m3u8");
    assert.equal(calls[0]?.cookie, "sid=1");
    assert.equal(calls[1]?.cookie, null);
    assert.equal(calls[1]?.auth, null);
  });

  it("gives up after too many redirects", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      return new Response(null, { status: 302, headers: { location: `/hop${n}` } });
    }) as typeof fetch;
    await assert.rejects(safeFetch("http://93.184.215.14/a"), /Too many redirects/);
  });
});

describe("siteOf / sameSite", () => {
  it("groups subdomains of one site", () => {
    assert.equal(siteOf("edge-3.cdn.example.com"), "example.com");
    assert.ok(sameSite("https://a.example.com/x.m3u8", "https://b.example.com/seg.ts"));
  });

  it("keeps country-code second levels apart", () => {
    assert.equal(siteOf("video.bbc.co.uk"), "bbc.co.uk");
    assert.ok(!sameSite("https://a.bbc.co.uk/", "https://evil.co.uk/"));
  });

  it("treats different sites as different", () => {
    assert.ok(!sameSite("https://cdn.example.com/", "https://tracker.other.net/"));
  });
});

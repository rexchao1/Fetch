import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeUpstream, resolveUpstream } from "./ssrf.ts";

const privateUpstreams = [
  "http://127.0.0.1/health",
  "http://10.0.0.5/private",
  "http://169.254.169.254/latest/meta-data/",
  "http://172.16.0.1/internal",
  "http://192.168.1.1/admin",
  "http://metadata.google.internal/computeMetadata/v1/",
];

describe("assertSafeUpstream", () => {
  for (const upstream of privateUpstreams) {
    it(`rejects ${new URL(upstream).hostname}`, () => {
      assert.throws(() => assertSafeUpstream(upstream), /Private or local hosts are not allowed/);
    });
  }

  it("accepts a public HTTPS upstream", () => {
    assert.equal(assertSafeUpstream("https://cdn.example.com/live.m3u8").href, "https://cdn.example.com/live.m3u8");
  });
});

describe("resolveUpstream", () => {
  it("rejects a private absolute upstream", () => {
    assert.throws(
      () => resolveUpstream("http://127.0.0.1/health", "https://fetch.example/api/hls"),
      /Private or local hosts are not allowed/,
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRefererCandidates } from "./referer.ts";

describe("buildRefererCandidates", () => {
  it("always offers the empty referer first", () => {
    const out = buildRefererCandidates("https://cdn.example/live.m3u8");
    assert.equal(out[0]?.id, "none");
    assert.equal(out[0]?.value, "");
  });

  it("adds the playlist origin as the target referer", () => {
    const out = buildRefererCandidates("https://cdn.example/path/live.m3u8");
    assert.deepEqual(
      out.find((c) => c.id === "target"),
      { id: "target", value: "https://cdn.example/" },
    );
  });

  it("adds the page and its origin when a page is given", () => {
    const out = buildRefererCandidates(
      "https://cdn.example/live.m3u8",
      "https://site.example/watch/42",
    );
    assert.deepEqual(
      out.find((c) => c.id === "page"),
      { id: "page", value: "https://site.example/watch/42" },
    );
    assert.deepEqual(
      out.find((c) => c.id === "page-origin"),
      { id: "page-origin", value: "https://site.example/" },
    );
  });

  it("does not duplicate when the page origin equals the playlist origin", () => {
    const out = buildRefererCandidates(
      "https://site.example/live.m3u8",
      "https://site.example/",
    );
    const values = out.map((c) => c.value);
    assert.equal(new Set(values).size, values.length);
    // "page" (the exact page URL) collides with the target origin here and is dropped.
    assert.ok(!out.some((c) => c.id === "page-origin"));
  });

  it("ignores a malformed or non-http page URL", () => {
    const out = buildRefererCandidates("https://cdn.example/live.m3u8", "not a url");
    assert.ok(!out.some((c) => c.id === "page"));
    const ftp = buildRefererCandidates("https://cdn.example/live.m3u8", "ftp://site.example/x");
    assert.ok(!ftp.some((c) => c.id === "page"));
  });

  it("trims whitespace and treats a blank page as absent", () => {
    const out = buildRefererCandidates("https://cdn.example/live.m3u8", "   ");
    assert.ok(!out.some((c) => c.id === "page"));
  });
});

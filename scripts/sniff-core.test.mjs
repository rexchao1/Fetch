import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyPlaylist,
  cookieHeader,
  expiryFromUrl,
  mergeCookies,
  parseMasterInfo,
  pickPlaylist,
  scoreMirror,
} from "./sniff-core.mjs";

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720p/index.m3u8
`;
const LIVE_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:1042
#EXTINF:6.0,
seg1042.ts
`;
const VOD_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
seg0.ts
#EXT-X-ENDLIST
`;

test("classifyPlaylist tells master, live media, vod media, and junk apart", () => {
  assert.deepEqual(classifyPlaylist(MASTER), { kind: "master", live: null });
  assert.deepEqual(classifyPlaylist(LIVE_MEDIA), { kind: "media", live: true });
  assert.deepEqual(classifyPlaylist(VOD_MEDIA), { kind: "media", live: false });
  assert.deepEqual(classifyPlaylist("<html>nope</html>"), { kind: "unknown", live: null });
  assert.deepEqual(classifyPlaylist(""), { kind: "unknown", live: null });
});

test("pickPlaylist prefers the earliest master and borrows live from a media playlist", () => {
  const picked = pickPlaylist([
    { url: "a", at: 300, kind: "media", live: true },
    { url: "b", at: 900, kind: "master", live: null },
    { url: "c", at: 100, kind: "unknown", live: null },
    { url: "d", at: 1200, kind: "master", live: null },
  ]);
  assert.equal(picked?.url, "b");
  assert.equal(picked?.live, true);
});

test("pickPlaylist falls back to media, then to a bare URL match", () => {
  assert.equal(
    pickPlaylist([
      { url: "x", at: 5, kind: "unknown", live: null },
      { url: "y", at: 9, kind: "media", live: false },
    ])?.url,
    "y",
  );
  assert.equal(pickPlaylist([{ url: "only", at: 1, kind: "unknown", live: null }])?.url, "only");
  assert.equal(pickPlaylist([]), null);
});

test("expiryFromUrl reads seconds, milliseconds, hdnts, jwt, and ignores stale values", () => {
  const now = 1_800_000_000_000;
  const inTenMin = Math.floor(now / 1000) + 600;
  assert.equal(expiryFromUrl(`https://cdn.example/a.m3u8?token=abc&exp=${inTenMin}`, now), inTenMin * 1000);
  assert.equal(expiryFromUrl(`https://cdn.example/a.m3u8?expires=${inTenMin * 1000}`, now), inTenMin * 1000);
  assert.equal(
    expiryFromUrl(`https://cdn.example/a.m3u8?hdnts=exp=${inTenMin}~acl=/*~hmac=deadbeef`, now),
    inTenMin * 1000,
  );
  const payload = Buffer.from(JSON.stringify({ exp: inTenMin })).toString("base64url");
  assert.equal(expiryFromUrl(`https://cdn.example/a.m3u8?token=eyJhbGciOiJIUzI1NiJ9.${payload}.sig`, now), inTenMin * 1000);
  assert.equal(expiryFromUrl(`https://cdn.example/a.m3u8?exp=${Math.floor(now / 1000) - 5}`, now), null);
  assert.equal(expiryFromUrl("https://cdn.example/plain.m3u8", now), null);
  assert.equal(expiryFromUrl("not a url", now), null);
});

test("parseMasterInfo takes the top bandwidth and its resolution", () => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
mid.m3u8
`;
  assert.deepEqual(parseMasterInfo(master), { bandwidth: 5000000, width: 1920, height: 1080 });
  assert.deepEqual(parseMasterInfo("#EXTM3U\n#EXT-X-TARGETDURATION:6\nseg.ts\n"), {});
  assert.deepEqual(parseMasterInfo(""), {});
});

test("scoreMirror ranks reachable HD above SD, and dead mirrors last", () => {
  const hd = { status: 200, live: true, kind: "master", bandwidth: 5_000_000, width: 1920, ms: 200 };
  const sd = { status: 200, live: true, kind: "master", bandwidth: 800_000, width: 640, ms: 200 };
  const slow = { status: 200, live: true, kind: "media", ms: 1800 };
  const dead = { status: 403, live: null, kind: "unknown", ms: 150 };
  const unknown = { status: null, live: null, kind: "unknown", ms: 300 };
  assert.ok(scoreMirror(hd) > scoreMirror(sd), "HD beats SD");
  assert.ok(scoreMirror(sd) > scoreMirror(slow), "SD beats a slow bare media playlist");
  assert.ok(scoreMirror(slow) > scoreMirror(unknown), "confirmed beats unconfirmed");
  assert.ok(scoreMirror(unknown) > scoreMirror(dead), "unconfirmed beats a 403");
  assert.ok(scoreMirror(dead) < 0, "a dead mirror scores negative");
});

test("cookie helpers build and merge a Cookie header without duplicates", () => {
  const jar = cookieHeader([
    { name: "sid", value: "1" },
    { name: "cf", value: "x" },
    { name: "sid", value: "dup" },
  ]);
  assert.equal(jar, "sid=1; cf=x");
  assert.equal(mergeCookies("sid=fromreq; auth=t", jar), "sid=fromreq; auth=t; cf=x");
  assert.equal(mergeCookies(undefined, jar), "sid=1; cf=x");
  assert.equal(mergeCookies("", ""), "");
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { peekBody } from "./peek.ts";
import { rewriteM3U8 } from "./rewrite.ts";

const wrap = (abs: string) => `/p?u=${encodeURIComponent(abs)}`;

describe("rewriteM3U8", () => {
  it("resolves segment paths against the final playlist URL", () => {
    const body = "#EXTM3U\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\n../other/seg2.ts?st=abc\n";
    const out = rewriteM3U8(body, "https://cdn.example.com/live/hi/index.m3u8", wrap);
    assert.equal(out.rewrites, 2);
    assert.match(out.text, new RegExp(encodeURIComponent("https://cdn.example.com/live/hi/seg1.ts")));
    assert.match(out.text, new RegExp(encodeURIComponent("https://cdn.example.com/live/other/seg2.ts?st=abc")));
  });

  it("rewrites KEY, MAP and MEDIA URIs and keeps other attributes", () => {
    const body = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
      '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/en.m3u8"',
    ].join("\n");
    const out = rewriteM3U8(body, "https://cdn.example.com/v/index.m3u8", wrap);
    assert.equal(out.rewrites, 3);
    assert.match(out.text, /METHOD=AES-128,URI="\/p\?u=https%3A%2F%2Fcdn\.example\.com%2Fv%2Fkey\.bin",IV=0x1/);
    assert.match(out.text, /BYTERANGE="720@0"/);
    assert.match(out.text, /GROUP-ID="a",URI="\/p\?u=https%3A%2F%2Fcdn\.example\.com%2Fv%2Faudio%2Fen\.m3u8"/);
  });

  it("leaves FairPlay and data URIs alone", () => {
    const body = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc"\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"';
    const out = rewriteM3U8(body, "https://cdn.example.com/index.m3u8", wrap);
    assert.equal(out.rewrites, 0);
    assert.match(out.text, /skd:\/\/abc/);
  });
});

function streamOf(parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(enc.encode(part));
      controller.close();
    },
  });
}

describe("peekBody", () => {
  it("sees a playlist head and still yields the whole body", async () => {
    const { head, body } = await peekBody(streamOf(["﻿#EXTM3U\n", "#EXTINF:6,\n", "a.ts\n"]));
    assert.ok(head.startsWith("#EXTM3U"));
    const bytes = await new Response(body).arrayBuffer();
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    assert.equal(text, "﻿#EXTM3U\n#EXTINF:6,\na.ts\n");
  });

  it("passes binary bytes through untouched", async () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 37) % 256);
    bytes[0] = 0x47; // MPEG-TS sync byte
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    const { head, body } = await peekBody(source);
    assert.ok(!head.startsWith("#EXT"));
    const out = new Uint8Array(await new Response(body).arrayBuffer());
    assert.deepEqual(out, bytes);
  });
});

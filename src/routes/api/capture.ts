import { createFileRoute } from "@tanstack/react-router";
import type { SniffedMirror } from "../../../scripts/sniff-core.mjs";
import { channelProxyPath } from "@/lib/hls/catalog";
import { jsonResponse, withCorsHandlers } from "@/lib/hls/http";
import { recordCaptureJob } from "@/lib/session/capture";
import { commitCapture, listSniffedChannels, type CaptureInput } from "@/lib/session/sniff";
import type { CaptureEvent } from "@/lib/session/types";

type CaptureBody = Partial<CaptureInput> & {
  events?: CaptureEvent[];
  candidates?: { url: string }[];
};

/** Fill any missing fields on a mirror the script sent, so bad input is safe. */
function normalizeMirror(m: Partial<SniffedMirror> & { url: string }): SniffedMirror {
  return {
    id: m.id ?? "m1",
    label: typeof m.label === "string" ? m.label.slice(0, 40) : "Stream 1",
    url: m.url,
    kind: m.kind ?? "unknown",
    live: m.live ?? null,
    status: m.status ?? null,
    ms: typeof m.ms === "number" ? m.ms : undefined,
    bandwidth: typeof m.bandwidth === "number" ? m.bandwidth : undefined,
    width: typeof m.width === "number" ? m.width : undefined,
    height: typeof m.height === "number" ? m.height : undefined,
    expiresAt: m.expiresAt ?? null,
    headers: m.headers ?? { userAgent: "", referer: "" },
  };
}

/**
 * The capture plane's drop box. `scripts/sniff-m3u8.mjs` POSTs what it saw on
 * a page; the Guide GETs the channels the plane has registered so they show
 * up without a paste. In-memory like the rest of the session plane.
 */
export const Route = createFileRoute("/api/capture")({
  server: {
    handlers: withCorsHandlers({
      GET: async () => jsonResponse({ channels: listSniffedChannels(), now: Date.now() }),
      POST: async ({ request }: { request: Request }) => {
        let body: CaptureBody;
        try {
          body = (await request.json()) as CaptureBody;
        } catch {
          return jsonResponse({ error: "Body must be JSON" }, 400);
        }
        if (!body.pageUrl || !body.playlist?.url) {
          return jsonResponse({ error: "Need pageUrl and playlist.url" }, 400);
        }
        try {
          const { channel, session } = commitCapture({
            pageUrl: body.pageUrl,
            name: body.name,
            title: body.title,
            channelId: body.channelId,
            playlist: normalizeMirror({ ...body.playlist, url: body.playlist.url }),
            mirrors: Array.isArray(body.mirrors)
              ? body.mirrors.filter((m) => m?.url).map((m) => normalizeMirror(m))
              : undefined,
            reason: "sniff script",
          });
          recordCaptureJob({
            channelId: channel.id,
            pageUrl: channel.pageUrl ?? body.pageUrl,
            reason: "sniff script",
            events: Array.isArray(body.events) ? body.events.slice(0, 80) : [],
            generation: session.generation,
          });
          return jsonResponse({
            channel,
            proxyPath: channelProxyPath(channel),
            session: {
              generation: session.generation,
              expiresAt: session.expiresAt,
              capturedAt: session.capturedAt,
            },
          });
        } catch (error) {
          return jsonResponse({ error: error instanceof Error ? error.message : "capture rejected" }, 400);
        }
      },
    }),
  },
});

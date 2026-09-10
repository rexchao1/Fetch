import { createFileRoute } from "@tanstack/react-router";
import { withCorsHandlers, jsonResponse } from "@/lib/hls/http";
import { enqueueCapture, expireSession, planeSnapshot } from "@/lib/session/capture";
import { registerChannel, setAutoRefresh, setSessionHeaders, setSessionToken, unregisterChannel } from "@/lib/session/store";
import type { Channel } from "@/lib/hls/catalog";

export const Route = createFileRoute("/api/session")({
  server: {
    handlers: withCorsHandlers({
      GET: async () => jsonResponse(planeSnapshot()),
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as {
          action?: "capture" | "expire" | "auto" | "register" | "unregister" | "token" | "headers";
          channelId?: string;
          autoRefresh?: boolean;
          channel?: Channel;
          token?: string;
          userAgent?: string;
          referer?: string;
        };

        if (body.action === "auto") {
          setAutoRefresh(Boolean(body.autoRefresh));
          return jsonResponse(planeSnapshot());
        }

        if (body.action === "register" && body.channel) {
          registerChannel(body.channel);
          return jsonResponse(planeSnapshot());
        }

        if (!body.channelId) return jsonResponse({ error: "Missing channelId" }, 400);

        if (body.action === "unregister") {
          unregisterChannel(body.channelId);
          return jsonResponse(planeSnapshot());
        }

        if (body.action === "token") {
          setSessionToken(body.channelId, body.token ?? "");
          return jsonResponse(planeSnapshot());
        }

        if (body.action === "headers") {
          setSessionHeaders(body.channelId, body.userAgent ?? "", body.referer ?? "");
          return jsonResponse(planeSnapshot());
        }

        if (body.action === "expire") {
          expireSession(body.channelId);
          return jsonResponse(planeSnapshot());
        }

        enqueueCapture(body.channelId, body.action === "capture" ? "manual" : "api");
        return jsonResponse(planeSnapshot());
      },
    }),
  },
});

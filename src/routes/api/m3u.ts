import { createFileRoute } from "@tanstack/react-router";
import { textResponse, withApiGuard } from "@/lib/hls/http";
import { buildM3U } from "@/lib/hls/m3u";
import { getLineup } from "@/lib/session/lineup";

/**
 * The live playlist for Jellyfin's M3U tuner. Jellyfin re-reads it on every
 * guide refresh, so new captures show up without a re-download. URLs use
 * whatever address the caller reached Fetch on.
 */
export const Route = createFileRoute("/api/m3u")({
  server: {
    handlers: withApiGuard({
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const text = buildM3U(getLineup(), url.origin, {
          includeLogos: url.searchParams.get("logos") !== "0",
          viaProxy: url.searchParams.get("direct") !== "1",
        });
        return textResponse(text, 200, "audio/x-mpegurl; charset=utf-8");
      },
    }),
  },
});

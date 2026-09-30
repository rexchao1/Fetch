import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, withApiGuard } from "@/lib/hls/http";

/**
 * The desktop shell waits for this before opening the window. The instance
 * id it passed in proves the server answering is the one it just started,
 * not a leftover from an older launch holding the port.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: withApiGuard({
      GET: async () => jsonResponse({ ok: true, instance: process.env.FETCH_INSTANCE ?? null }),
    }),
  },
});

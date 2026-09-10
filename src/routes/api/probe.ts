import { createFileRoute } from "@tanstack/react-router";
import { withCorsHandlers } from "@/lib/hls/http";
import { handleProbe } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/probe")({
  server: {
    handlers: withCorsHandlers({
      POST: async ({ request }: { request: Request }) => handleProbe(request),
    }),
  },
});

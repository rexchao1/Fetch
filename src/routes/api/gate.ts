import { createFileRoute } from "@tanstack/react-router";
import { withCorsHandlers } from "@/lib/hls/http";
import { handleGate } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/gate")({
  server: {
    handlers: withCorsHandlers({
      GET: async ({ request }: { request: Request }) => handleGate(request),
      HEAD: async ({ request }: { request: Request }) => handleGate(request),
    }),
  },
});

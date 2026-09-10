import { createFileRoute } from "@tanstack/react-router";
import { withCorsHandlers } from "@/lib/hls/http";
import { handleToken } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/token")({
  server: {
    handlers: withCorsHandlers({
      GET: async ({ request }: { request: Request }) => handleToken(request),
      HEAD: async ({ request }: { request: Request }) => handleToken(request),
    }),
  },
});

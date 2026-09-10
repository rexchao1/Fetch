import { createFileRoute } from "@tanstack/react-router";
import { withCorsHandlers } from "@/lib/hls/http";
import { handleHlsProxy } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/hls")({
  server: {
    handlers: withCorsHandlers({
      GET: async ({ request }: { request: Request }) => handleHlsProxy(request),
      HEAD: async ({ request }: { request: Request }) => handleHlsProxy(request),
    }),
  },
});

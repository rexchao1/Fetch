import { createFileRoute } from "@tanstack/react-router";
import { withApiGuard } from "@/lib/hls/http";
import { handleHlsProxy } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/hls")({
  server: {
    handlers: withApiGuard({
      GET: async ({ request }: { request: Request }) => handleHlsProxy(request),
      HEAD: async ({ request }: { request: Request }) => handleHlsProxy(request),
    }),
  },
});

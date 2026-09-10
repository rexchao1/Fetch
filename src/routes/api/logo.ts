import { createFileRoute } from "@tanstack/react-router";
import { withCorsHandlers } from "@/lib/hls/http";
import { handleLogo } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/logo")({
  server: {
    handlers: withCorsHandlers({
      GET: async ({ request }: { request: Request }) => handleLogo(request),
    }),
  },
});

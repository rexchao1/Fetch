import { createFileRoute } from "@tanstack/react-router";
import { withApiGuard } from "@/lib/hls/http";
import { handleLogo } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/logo")({
  server: {
    handlers: withApiGuard({
      GET: async ({ request }: { request: Request }) => handleLogo(request),
    }),
  },
});

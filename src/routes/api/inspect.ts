import { createFileRoute } from "@tanstack/react-router";
import { withApiGuard } from "@/lib/hls/http";
import { handleInspect } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/inspect")({
  server: {
    handlers: withApiGuard({
      GET: async ({ request }: { request: Request }) => handleInspect(request),
    }),
  },
});

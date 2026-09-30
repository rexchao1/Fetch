import { createFileRoute } from "@tanstack/react-router";
import { withApiGuard } from "@/lib/hls/http";
import { handleProbe } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/probe")({
  server: {
    handlers: withApiGuard({
      POST: async ({ request }: { request: Request }) => handleProbe(request),
    }),
  },
});

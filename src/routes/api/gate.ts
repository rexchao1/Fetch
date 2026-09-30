import { createFileRoute } from "@tanstack/react-router";
import { withApiGuard } from "@/lib/hls/http";
import { handleGate } from "@/lib/hls/proxy";

export const Route = createFileRoute("/api/gate")({
  server: {
    handlers: withApiGuard({
      GET: async ({ request }: { request: Request }) => handleGate(request),
      HEAD: async ({ request }: { request: Request }) => handleGate(request),
    }),
  },
});

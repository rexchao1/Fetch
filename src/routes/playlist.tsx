import { createFileRoute } from "@tanstack/react-router";
import { M3uExport } from "@/components/playlist/m3u-export";
import { useOrigin } from "@/hooks/use-origin";
import { useChannelList } from "@/lib/store";

export const Route = createFileRoute("/playlist")({ component: PlaylistPage });

function PlaylistPage() {
  const origin = useOrigin();
  const channels = useChannelList();
  if (!origin) {
    return <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">Preparing playlist…</div>;
  }
  return <M3uExport channels={channels} origin={origin} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AddChannelDialog } from "@/components/guide/add-channel-dialog";
import { ChannelList } from "@/components/guide/channel-list";
import { HlsPlayer } from "@/components/player/hls-player";
import { Inspector } from "@/components/player/inspector";
import { useOrigin } from "@/hooks/use-origin";
import { useServerChannels } from "@/hooks/use-server-channels";
import { useChannelList, useLatchStore, useSelectedChannel } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const origin = useOrigin();
  useServerChannels();
  const channels = useChannelList();
  const selected = useSelectedChannel();
  const select = useLatchStore((s) => s.select);
  const removeChannel = useLatchStore((s) => s.removeChannel);
  const [adding, setAdding] = useState(false);

  return (
    <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)_minmax(18rem,22rem)] lg:items-start sm:px-6 sm:py-6">
      <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
        {origin && selected ? (
          <HlsPlayer channel={selected} origin={origin} />
        ) : (
          <EmptyPlayer />
        )}
        <p className="hidden text-sm leading-relaxed text-muted lg:block">
          Paste a live playlist you already have, or sniff one off a page from the Capture
          deck. Latch keeps the StreamSession warm — headers, failover, recapture — so
          Jellyfin only ever hits a stable URL.
        </p>
      </div>
      <div className="order-2 min-h-0 min-w-0 lg:order-1 lg:sticky lg:top-20 lg:h-[calc(100dvh-7rem)]">
        <ChannelList
          channels={channels}
          selectedId={selected?.id}
          onSelect={select}
          onAdd={() => setAdding(true)}
          onRemove={removeChannel}
        />
      </div>
      <div className="order-3 min-h-0 lg:sticky lg:top-20">
        {origin && selected ? (
          <Inspector channel={selected} origin={origin} />
        ) : (
          <InspectorSkeleton />
        )}
      </div>
      <AddChannelDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function EmptyPlayer() {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl bg-surface px-6 text-center text-sm text-muted shadow-[var(--shadow-border)]">
      Add a playlist to start, or restore the demo channels.
    </div>
  );
}

function InspectorSkeleton() {
  return <div className="h-80 rounded-xl bg-surface shadow-[var(--shadow-border)]" />;
}

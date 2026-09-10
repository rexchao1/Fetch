import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AddChannelDialog } from "@/components/guide/add-channel-dialog";
import { ChannelList } from "@/components/guide/channel-list";
import { HlsPlayer } from "@/components/player/hls-player";
import { Inspector } from "@/components/player/inspector";
import { MirrorBar } from "@/components/player/mirror-bar";
import { useOrigin } from "@/hooks/use-origin";
import { usePlane } from "@/hooks/use-plane";
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

  const plane = usePlane();
  const session = selected
    ? plane.data?.sessions.find((s) => s.channelId === selected.id)
    : undefined;
  const mirrors = session?.mirrors ?? [];
  const activeMirrorId = session?.activeMirrorId;

  return (
    <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)_minmax(17rem,20rem)] lg:items-start sm:px-6">
      <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
        {origin && selected ? (
          <HlsPlayer channel={selected} origin={origin} mirrorId={activeMirrorId} />
        ) : (
          <EmptyPlayer />
        )}
        {selected && mirrors.length > 1 ? (
          <MirrorBar
            channelId={selected.id}
            mirrors={mirrors}
            activeMirrorId={activeMirrorId}
          />
        ) : null}
      </div>
      <div className="order-2 min-h-0 min-w-0 lg:order-1 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]">
        <ChannelList
          channels={channels}
          selectedId={selected?.id}
          onSelect={select}
          onAdd={() => setAdding(true)}
          onRemove={removeChannel}
        />
      </div>
      <div className="order-3 min-h-0 lg:sticky lg:top-20">
        {origin && selected ? <Inspector channel={selected} origin={origin} /> : null}
      </div>
      <AddChannelDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function EmptyPlayer() {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl bg-surface text-sm text-subtle">
      No channel selected
    </div>
  );
}

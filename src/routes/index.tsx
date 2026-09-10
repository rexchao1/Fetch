import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const origin = useOrigin();
  useServerChannels();
  const channels = useChannelList();
  const selected = useSelectedChannel();
  const select = useLatchStore((s) => s.select);
  const removeChannel = useLatchStore((s) => s.removeChannel);
  const [adding, setAdding] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const plane = usePlane();
  const session = selected
    ? plane.data?.sessions.find((s) => s.channelId === selected.id)
    : undefined;
  const mirrors = session?.mirrors ?? [];
  const activeMirrorId = session?.activeMirrorId;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-4 sm:px-6">
      {origin && selected ? (
        <HlsPlayer channel={selected} origin={origin} mirrorId={activeMirrorId} />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-xl bg-surface text-sm text-subtle">
          No channel selected
        </div>
      )}
      {selected && mirrors.length > 1 ? (
        <MirrorBar channelId={selected.id} mirrors={mirrors} activeMirrorId={activeMirrorId} />
      ) : null}

      <ChannelList
        channels={channels}
        selectedId={selected?.id}
        onSelect={select}
        onAdd={() => setAdding(true)}
        onRemove={removeChannel}
      />

      {origin && selected ? (
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="flex h-9 items-center gap-1.5 self-start text-xs font-medium tracking-wide text-subtle uppercase hover:text-fg"
          >
            Details
            <ChevronDown
              className={cn("size-4 transition-transform", detailsOpen && "rotate-180")}
            />
          </button>
          {detailsOpen ? <Inspector channel={selected} origin={origin} /> : null}
        </section>
      ) : null}

      <AddChannelDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

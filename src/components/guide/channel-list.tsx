import { Plus, X } from "lucide-react";
import { useState } from "react";
import { groupChannels, type Channel } from "@/lib/hls/catalog";
import { ChannelMark } from "@/components/guide/channel-mark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePlane } from "@/hooks/use-plane";
import { cn } from "@/lib/utils";

export function ChannelList({
  channels,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
}: {
  channels: Channel[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const groups = groupChannels(channels.filter((channel) => channel.group !== "Lab"));
  const plane = usePlane(3000);
  const sessions = plane.data?.sessions ?? [];
  const [pending, setPending] = useState<Channel | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">Channels</h2>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus />
          Add
        </Button>
      </div>
      {groups.length === 0 ? <p className="text-sm text-subtle">No channels yet</p> : null}
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col gap-2">
          <h3 className="text-xs text-subtle">{group.name}</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {group.channels.map((channel) => {
              const active = channel.id === selectedId;
              const session = sessions.find((item) => item.channelId === channel.id);
              const status = statusOf(channel, session?.healthStatus, session?.healthAt);
              return (
                <li key={channel.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(channel.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors duration-150",
                      active ? "bg-surface-2" : "bg-surface hover:bg-surface-2/60",
                    )}
                  >
                    <ChannelMark mark={channel.mark} active={active} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {channel.name}
                      </span>
                      {status ? (
                        <span className={cn("block truncate text-xs", status.tone)}>
                          {status.label}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${channel.name}`}
                    onClick={() => setPending(channel)}
                    className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-md text-subtle opacity-0 transition-opacity hover:bg-bg hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {pending?.name}?</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (pending) onRemove(pending.id);
                setPending(null);
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function statusOf(
  channel: Channel,
  healthStatus: number | null | undefined,
  healthAt: number | null | undefined,
): { label: string; tone: string } | null {
  if (channel.kind === "token" && (channel.tokenExpiresAt ?? 0) < Date.now()) {
    return { label: "Expired", tone: "text-danger" };
  }
  if (channel.live && !healthStatus && healthAt) return { label: "Down", tone: "text-danger" };
  return null;
}

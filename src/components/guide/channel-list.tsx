import { Plus, X } from "lucide-react";
import { useState } from "react";
import { groupChannels, type Channel } from "@/lib/hls/catalog";
import { ChannelMark } from "@/components/guide/channel-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <aside className="flex min-h-0 min-w-0 flex-col rounded-xl bg-surface p-3 lg:max-h-full">
      <div className="mb-1 flex items-center justify-between gap-2 pl-2">
        <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">Channels</h2>
        <Button variant="ghost" size="icon" onClick={onAdd} aria-label="Add a stream" className="size-9">
          <Plus />
        </Button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-1 lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-sm text-subtle">No channels yet</p>
        ) : null}
        {groups.map((group) => (
          <section key={group.name} className="shrink-0 lg:shrink">
            <h3 className="mb-1 px-2 text-xs text-subtle">{group.name}</h3>
            <ul className="flex gap-1 lg:flex-col">
              {group.channels.map((channel) => {
                const active = channel.id === selectedId;
                const session = sessions.find((item) => item.channelId === channel.id);
                const status = statusOf(channel, session?.healthStatus, session?.healthAt);
                return (
                  <li key={channel.id} className="group min-w-56 lg:min-w-0">
                    <div
                      className={cn(
                        "flex items-center gap-1 rounded-lg pr-1 transition-colors duration-150",
                        active ? "bg-surface-2" : "hover:bg-surface-2/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(channel.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left"
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
                        className="flex size-9 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

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
    </aside>
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

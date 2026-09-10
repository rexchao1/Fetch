import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { headerRecipe, groupChannels, type Channel } from "@/lib/hls/catalog";
import { ChannelMark } from "@/components/guide/channel-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePlane } from "@/hooks/use-plane";
import { ingestPlaylist } from "@/lib/hls/ingest";
import { useLatchStore } from "@/lib/store";
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
  const hidden = useLatchStore((s) => s.hidden);
  const restoreHidden = useLatchStore((s) => s.restoreHidden);
  const [pending, setPending] = useState<Channel | null>(null);
  const [paste, setPaste] = useState("");
  const [adding, setAdding] = useState(false);

  async function addPaste(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    try {
      await ingestPlaylist(paste);
      toast.success("Added to Guide");
      setPaste("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add that playlist");
    } finally {
      setAdding(false);
    }
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] lg:h-full">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Lineup</h2>
        <div className="flex items-center">
          {hidden.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={restoreHidden} className="h-11 px-2">
              <RotateCcw className="size-4" />
              Restore
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onAdd} className="h-11 px-2">
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </div>
      <form onSubmit={addPaste} className="mb-3 flex gap-2 px-1">
        <Input
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="https://…/playlist.m3u8?token=…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Playlist URL"
        />
        <Button type="submit" size="sm" disabled={adding || !paste.trim()} className="shrink-0">
          {adding ? "Adding…" : "Add"}
        </Button>
      </form>
      <div className="flex gap-4 overflow-x-auto pb-1 lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted">
            Lineup is empty. Add a playlist, or restore the demo channels.
          </p>
        ) : null}
        {groups.map((group) => (
          <section key={group.name} className="shrink-0 lg:shrink">
            <h3 className="mb-1.5 px-2 text-xs font-medium text-subtle">{group.name}</h3>
            <ul className="flex gap-1 lg:flex-col">
              {group.channels.map((channel) => {
                const active = channel.id === selectedId;
                const expired =
                  channel.kind === "token" &&
                  (channel.tokenExpiresAt ?? 0) < Date.now();
                const session = sessions.find((item) => item.channelId === channel.id);
                const onAir = Boolean(channel.live) && session?.healthStatus !== 0;
                return (
                  <li key={channel.id} className="min-w-60 lg:min-w-0">
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-lg p-1.5 transition-colors duration-150",
                        active ? "bg-surface-2" : "hover:bg-surface-2/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(channel.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left"
                      >
                        <ChannelMark mark={channel.mark} active={active} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="block truncate text-sm font-medium text-fg">
                              {channel.name}
                            </span>
                            {channel.live ? (
                              <span
                                className={cn(
                                  "shrink-0 text-xs font-medium tracking-wide uppercase",
                                  onAir ? "text-live" : "text-danger",
                                )}
                              >
                                {onAir ? "Live" : "Down"}
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-subtle">
                            {expired
                              ? "token expired"
                              : channel.live
                                ? session?.healthStatus
                                  ? `on air · ${session.healthStatus}`
                                  : session?.healthAt
                                    ? "unreachable — check Capture deck"
                                    : "waiting on watchdog"
                                : headerRecipe(channel.userAgent, channel.referer)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${channel.name}`}
                        onClick={() => setPending(channel)}
                        className="flex h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-subtle hover:text-danger"
                      >
                        <Trash2 className="size-4" />
                        Remove
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
            <DialogDescription>
              {pending?.builtin
                ? "This hides the demo channel. Restore brings it back."
                : "This deletes the source from the lineup. You can add the playlist again later."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPending(null)}>
              Keep
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

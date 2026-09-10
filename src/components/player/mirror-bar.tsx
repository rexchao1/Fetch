import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Mirror, PlaneSnapshot } from "@/lib/session/types";
import { cn } from "@/lib/utils";

/**
 * The Stream 1 / Stream 2 / … strip under the player for a channel captured
 * from a multi-stream page. Each chip shows how healthy that mirror is right
 * now — resolution, latency, up or down — so you can switch off a lagging one
 * in a click. The active mirror is highlighted; clicking another asks the
 * server to swap, which the player follows.
 */
export function MirrorBar({
  channelId,
  mirrors,
  activeMirrorId,
}: {
  channelId: string;
  mirrors: Mirror[];
  activeMirrorId?: string;
}) {
  const client = useQueryClient();
  const switchTo = useMutation({
    mutationFn: async (mirrorId: string) => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "switch", channelId, mirrorId }),
      });
      const data = (await res.json()) as PlaneSnapshot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `switch ${res.status}`);
      return data;
    },
    onSuccess: (data) => client.setQueryData(["plane"], data),
    onError: (error) => toast.error(error.message),
  });

  if (mirrors.length < 2) return null;

  return (
    <section aria-label="Stream mirrors">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">Streams</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {mirrors.map((mirror) => {
          const active = mirror.id === activeMirrorId;
          const pending = switchTo.isPending && switchTo.variables === mirror.id;
          return (
            <button
              key={mirror.id}
              type="button"
              disabled={active || switchTo.isPending}
              onClick={() => switchTo.mutate(mirror.id)}
              aria-pressed={active}
              className={cn(
                "flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors duration-150",
                active
                  ? "border-live/60 bg-live/10"
                  : "border-transparent bg-surface hover:bg-surface-2 disabled:opacity-60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg">{mirror.label}</span>
                {pending ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" />
                ) : (
                  <HealthDot mirror={mirror} />
                )}
              </div>
              <span className="truncate font-mono text-xs text-subtle">{quality(mirror)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HealthDot({ mirror }: { mirror: Mirror }) {
  const state = healthOf(mirror);
  return (
    <span
      aria-label={state === "up" ? "up" : state === "down" ? "down" : "checking"}
      className={cn(
        "size-2 shrink-0 rounded-full",
        state === "up" && "bg-live",
        state === "down" && "bg-danger",
        state === "unknown" && "bg-subtle",
      )}
    />
  );
}

function healthOf(mirror: Mirror): "up" | "down" | "unknown" {
  if (mirror.healthStatus === null) return "unknown";
  if (mirror.healthStatus >= 200 && mirror.healthStatus < 400) return "up";
  return "down";
}

function quality(mirror: Mirror) {
  const bits: string[] = [];
  if (mirror.height) bits.push(`${mirror.height}p`);
  else if (mirror.bandwidth) bits.push(`${Math.round(mirror.bandwidth / 1000)}k`);
  const state = healthOf(mirror);
  if (state === "down") bits.push("down");
  else if (mirror.latencyMs != null) bits.push(`${mirror.latencyMs}ms`);
  return bits.join(" · ");
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, RefreshCw, TimerOff } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CaptureJob, PlaneSnapshot, StreamSession } from "@/lib/session/types";
import { cn } from "@/lib/utils";

export function CaptureDeck() {
  const client = useQueryClient();
  const plane = useQuery({
    queryKey: ["plane"],
    queryFn: async () => {
      const res = await fetch("/api/session");
      return (await res.json()) as PlaneSnapshot;
    },
    refetchInterval: 1000,
  });

  const act = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await res.json()) as PlaneSnapshot;
    },
    onSuccess: (data) => client.setQueryData(["plane"], data),
  });

  const data = plane.data;
  const activeJob =
    data?.jobs.find((job) => job.status === "running" || job.status === "queued") ?? data?.jobs[0];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="max-w-2xl">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">Architecture</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight italic">Two planes, one atomic swap</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Playwright never sits on the video path. It writes a StreamSession. Jellyfin only ever
          hits Latch. Expire a lab channel, then play it — the 403 is a backstop, not the engine.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlaneCard
          kicker="Capture plane"
          title="page → Playwright → session"
          live={Boolean(data?.inflight.length)}
        >
          <NetworkLog job={activeJob} />
        </PlaneCard>
        <PlaneCard
          kicker="Streaming plane"
          title="Jellyfin → Latch → origin"
          live={Boolean(data?.hits[0] && data.now - data.hits[0].at < 4000)}
        >
          <HitLog hits={data?.hits ?? []} now={data?.now ?? Date.now()} />
        </PlaneCard>
      </div>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Sessions</h2>
            <p className="mt-1 text-sm text-muted">
              TTL refresh recaptures a signed URL at 80% of its life, before Jellyfin 403s.
              Capture runs now. Expire is a lab switch — it does not delete the channel.
            </p>
          </div>
          <div className="flex h-11 items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={data?.autoRefresh ?? true}
              onCheckedChange={(checked) =>
                act.mutate({ action: "auto", autoRefresh: checked })
              }
            />
            <Label htmlFor="auto-refresh" className="text-sm">
              TTL refresh
            </Label>
          </div>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {(data?.sessions ?? []).map((session) => (
            <li key={session.channelId}>
              <SessionCard
                session={session}
                now={data?.now ?? Date.now()}
                capturing={data?.inflight.includes(session.channelId) ?? false}
                onCapture={() =>
                  act.mutate({ action: "capture", channelId: session.channelId })
                }
                onExpire={() =>
                  act.mutate({ action: "expire", channelId: session.channelId })
                }
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PlaneCard({
  kicker,
  title,
  live,
  children,
}: {
  kicker: string;
  title: string;
  live: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-80 flex-col rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">{kicker}</p>
          <h2 className="mt-1 font-display text-xl tracking-tight italic">{title}</h2>
        </div>
        <Badge variant={live ? "live" : "default"}>{live ? "live" : "idle"}</Badge>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function NetworkLog({ job }: { job?: CaptureJob }) {
  if (!job) {
    return <p className="text-sm text-muted">No capture yet. Run one on a session below.</p>;
  }
  return (
    <div className="flex h-full min-h-56 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono">
          {job.channelId} · {job.reason}
        </span>
        <span className="uppercase">{job.status}</span>
      </div>
      <ScrollArea className="h-56 rounded-md bg-bg">
        <ol className="p-3 font-mono text-xs leading-relaxed">
          {job.events.map((event, index) => (
            <li key={`${job.id}-${index}`} className="flex gap-3">
              <span className="w-12 shrink-0 text-subtle tabular-nums">
                {(event.t / 1000).toFixed(2)}
              </span>
              <span
                className={cn(
                  "w-16 shrink-0",
                  event.kind === "commit" && "text-live",
                  event.kind === "error" && "text-danger",
                  event.kind === "permit" && "text-warn",
                )}
              >
                {event.kind}
              </span>
              <span className="min-w-0 break-all text-fg">{event.detail}</span>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </div>
  );
}

function HitLog({ hits, now }: { hits: PlaneSnapshot["hits"]; now: number }) {
  if (!hits.length) {
    return (
      <p className="text-sm text-muted">
        Play a channel on Guide. Hits land here without waiting on Playwright.
      </p>
    );
  }
  return (
    <ScrollArea className="h-56 rounded-md bg-bg">
      <ol className="p-3 font-mono text-xs leading-relaxed">
        {hits.slice(0, 18).map((hit, index) => (
          <li key={`${hit.at}-${index}`} className="flex gap-3">
            <span className="w-12 shrink-0 text-subtle tabular-nums">
              {Math.max(0, Math.round((now - hit.at) / 1000))}s
            </span>
            <span
              className={cn(
                "w-10 shrink-0",
                hit.status >= 400 ? "text-danger" : "text-live",
              )}
            >
              {hit.status}
            </span>
            <span className="text-muted">{hit.path}</span>
            <span className="min-w-0 truncate text-fg">{hit.channelId}</span>
            <span className="ml-auto text-subtle tabular-nums">{hit.ms}ms</span>
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}

function SessionCard({
  session,
  now,
  capturing,
  onCapture,
  onExpire,
}: {
  session: StreamSession;
  now: number;
  capturing: boolean;
  onCapture: () => void;
  onExpire: () => void;
}) {
  const expired = Boolean(session.expiresAt && session.expiresAt <= now);
  const remaining = session.expiresAt ? Math.max(0, session.expiresAt - now) : null;
  return (
    <article className="flex flex-col gap-3 rounded-lg bg-bg p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-fg">{session.name}</h3>
          <p className="mt-0.5 font-mono text-xs text-subtle">
            gen {session.generation} · {session.source} · {session.lastReason}
            {session.live
              ? ` · health ${session.healthStatus ?? "…"}`
              : ""}
          </p>
        </div>
        <Badge variant={capturing ? "warn" : expired ? "danger" : "live"}>
          {capturing ? "capturing" : expired ? "expired" : "fresh"}
        </Badge>
      </div>
      <p className="truncate font-mono text-xs text-muted">{session.pageUrl}</p>
      {remaining !== null ? (
        <div>
          <div className="mb-1 flex justify-between text-xs text-subtle">
            <span>TTL</span>
            <span className="font-mono tabular-nums">{formatMs(remaining)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full", expired ? "bg-danger" : "bg-live")}
              style={{
                width: ttlWidth(session, now),
              }}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-subtle">No expiry — recapture is manual or on 403.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onCapture} disabled={capturing}>
          {capturing ? <Radio className="size-4" /> : <RefreshCw className="size-4" />}
          Capture
        </Button>
        <Button size="sm" variant="outline" onClick={onExpire}>
          <TimerOff className="size-4" />
          Expire
        </Button>
      </div>
    </article>
  );
}

function ttlWidth(session: StreamSession, now: number) {
  if (!session.expiresAt) return "100%";
  const ttl = session.expiresAt - session.capturedAt;
  if (ttl <= 0) return "0%";
  const left = Math.max(0, session.expiresAt - now);
  return `${Math.min(100, (left / ttl) * 100)}%`;
}

function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, RefreshCw, TimerOff } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      const data = (await res.json()) as PlaneSnapshot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `session ${res.status}`);
      return data;
    },
    onSuccess: (data) => client.setQueryData(["plane"], data),
    onError: (error) => toast.error(error.message),
  });

  const data = plane.data;
  const activeJob =
    data?.jobs.find((job) => job.status === "running" || job.status === "queued") ?? data?.jobs[0];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
      <SniffForm
        busy={act.isPending}
        onSubmit={(pageUrl, name) => act.mutate({ action: "sniff", pageUrl, name })}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Capture" live={Boolean(data?.inflight.length)}>
          <NetworkLog job={activeJob} />
        </Panel>
        <Panel title="Requests" live={Boolean(data?.hits[0] && data.now - data.hits[0].at < 4000)}>
          <HitLog hits={data?.hits ?? []} now={data?.now ?? Date.now()} />
        </Panel>
      </div>

      <section className="rounded-xl bg-surface p-4">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-subtle uppercase">Sessions</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {(data?.sessions ?? []).map((session) => (
            <li key={session.channelId}>
              <SessionCard
                session={session}
                now={data?.now ?? Date.now()}
                capturing={data?.inflight.includes(session.channelId) ?? false}
                onCapture={() => act.mutate({ action: "capture", channelId: session.channelId })}
                onExpire={() => act.mutate({ action: "expire", channelId: session.channelId })}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SniffForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (pageUrl: string, name: string) => void;
}) {
  const [pageUrl, setPageUrl] = useState("");
  const [name, setName] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(pageUrl.trim(), name.trim());
    setPageUrl("");
    setName("");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        value={pageUrl}
        onChange={(e) => setPageUrl(e.target.value)}
        placeholder="Page URL to sniff"
        aria-label="Page URL"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        required
        className="min-w-0 sm:flex-1"
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (optional)"
        aria-label="Channel name"
        autoComplete="off"
        className="sm:w-48"
      />
      <Button type="submit" disabled={busy || !pageUrl.trim()} className="shrink-0">
        Sniff
      </Button>
    </form>
  );
}

function Panel({ title, live, children }: { title: string; live: boolean; children: ReactNode }) {
  return (
    <section className="flex min-h-72 flex-col rounded-xl bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">{title}</h2>
        <Badge variant={live ? "live" : "default"}>{live ? "live" : "idle"}</Badge>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function NetworkLog({ job }: { job?: CaptureJob }) {
  if (!job) return <p className="text-sm text-subtle">No captures yet</p>;
  return (
    <div className="flex h-full min-h-56 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 font-mono text-xs text-subtle">
        <span>
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
  if (!hits.length) return <p className="text-sm text-subtle">No requests yet</p>;
  return (
    <ScrollArea className="h-56 rounded-md bg-bg">
      <ol className="p-3 font-mono text-xs leading-relaxed">
        {hits.slice(0, 18).map((hit, index) => (
          <li key={`${hit.at}-${index}`} className="flex gap-3">
            <span className="w-12 shrink-0 text-subtle tabular-nums">
              {Math.max(0, Math.round((now - hit.at) / 1000))}s
            </span>
            <span className={cn("w-10 shrink-0", hit.status >= 400 ? "text-danger" : "text-live")}>
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
        <div className="min-w-0">
          <h3 className="truncate font-medium text-fg">{session.name}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-subtle">
            gen {session.generation} · {session.source}
            {session.live ? ` · ${session.healthStatus ?? "…"}` : ""}
          </p>
        </div>
        <Badge variant={capturing ? "warn" : expired ? "danger" : "live"}>
          {capturing ? "capturing" : expired ? "expired" : "fresh"}
        </Badge>
      </div>
      {remaining !== null ? (
        <div>
          <div className="mb-1 flex justify-between text-xs text-subtle">
            <span>Expires</span>
            <span className="font-mono tabular-nums">{formatMs(remaining)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full", expired ? "bg-danger" : "bg-live")}
              style={{ width: ttlWidth(session, now) }}
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onCapture} disabled={capturing}>
          {capturing ? <Radio /> : <RefreshCw />}
          Recapture
        </Button>
        <Button size="sm" variant="ghost" onClick={onExpire}>
          <TimerOff />
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

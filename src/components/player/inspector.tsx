import { useQuery } from "@tanstack/react-query";
import { Copy, RefreshCw, TimerOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Channel } from "@/lib/hls/catalog";
import { channelProxyPath } from "@/lib/hls/catalog";
import { classifyToken, maskToken, tokenKindLabel } from "@/lib/hls/token";
import { useLatchStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type InspectPayload = {
  ok: boolean;
  status: number;
  ms: number;
  playlist: boolean;
  live?: boolean;
  original: string;
  rewritten: string;
  rewrites: number;
  summary: {
    isMaster: boolean;
    variants: number;
    segments: number;
    keys: number;
    maps: number;
    lines: number;
  } | null;
  error?: string;
  session?: {
    generation: number;
    source: string;
    expiresAt: number | null;
    capturedAt: number;
    pageUrl: string;
  } | null;
};

export function Inspector({ channel, origin }: { channel: Channel; origin: string }) {
  const refreshToken = useLatchStore((s) => s.refreshToken);
  const expireToken = useLatchStore((s) => s.expireToken);
  const proxyPath = channelProxyPath(channel, origin);
  const inspectUrl = channel.builtin
    ? `/api/inspect?ch=${encodeURIComponent(channel.id)}`
    : `/api/inspect?ch=${encodeURIComponent(channel.id)}&u=${encodeURIComponent(channel.url)}&ua=${encodeURIComponent(channel.userAgent)}&rf=${encodeURIComponent(channel.referer)}`;

  const inspect = useQuery({
    queryKey: ["inspect", channel.id],
    queryFn: async () => {
      const res = await fetch(inspectUrl);
      return (await res.json()) as InspectPayload;
    },
    refetchInterval: channel.kind === "token" ? 2000 : false,
  });

  return (
    <aside className="flex min-h-0 flex-col rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Inspector</h2>
        {inspect.data?.ok ? (
          <Badge variant={inspect.data.live || channel.live ? "live" : "default"}>
            {inspect.data.live || channel.live ? "live" : inspect.data.status}
          </Badge>
        ) : inspect.data ? (
          <Badge variant="danger">{inspect.data.status || "err"}</Badge>
        ) : (
          <Badge>idle</Badge>
        )}
      </div>
      <Tabs defaultValue="headers">
        <TabsList className="w-full">
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="playlist">Rewrite</TabsTrigger>
          <TabsTrigger value="token">Token</TabsTrigger>
        </TabsList>
        <TabsContent value="headers" className="flex flex-col gap-3 pt-1">
          <Meta label="User-Agent" value={channel.userAgent || "—"} mono />
          <Meta label="Referer" value={channel.referer || "—"} mono />
          <Meta label="Proxy" value={`${origin}${proxyPath}`} mono />
          {inspect.data?.session ? (
            <Meta
              label="Session"
              value={`gen ${inspect.data.session.generation} · ${inspect.data.session.source}`}
              mono
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <CopyBtn label="Proxy URL" value={`${origin}${proxyPath}`} />
            <CopyBtn label="M3U line" value={`${origin}${proxyPath}`} />
          </div>
          <p className="text-xs leading-relaxed text-subtle">{channel.note}</p>
        </TabsContent>
        <TabsContent value="playlist" className="pt-1">
          {inspect.isLoading ? (
            <p className="text-sm text-muted">Fetching playlist…</p>
          ) : inspect.data?.error && !inspect.data.original ? (
            <p className="text-sm text-danger">{inspect.data.error}</p>
          ) : inspect.data ? (
            <RewriteView data={inspect.data} />
          ) : (
            <p className="text-sm text-muted">No playlist yet.</p>
          )}
        </TabsContent>
        <TabsContent value="token" className="flex flex-col gap-3 pt-1">
          <TokenEditor channel={channel} onSaved={() => void inspect.refetch()} />
          {channel.kind === "token" ? (
            <>
              <TokenClock
                expiresAt={
                  inspect.data?.session?.expiresAt ?? channel.tokenExpiresAt ?? 0
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await fetch("/api/session", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "capture", channelId: channel.id }),
                    });
                    refreshToken(channel.id);
                    window.setTimeout(() => void inspect.refetch(), 800);
                  }}
                >
                  <RefreshCw className="size-4" />
                  Capture session
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await fetch("/api/session", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "expire", channelId: channel.id }),
                    });
                    expireToken(channel.id);
                    void inspect.refetch();
                  }}
                >
                  <TimerOff className="size-4" />
                  Force expire
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-subtle">
                Lab channel: capture mints a new exp. Jellyfin still holds `/api/hls?ch=night-token`.
              </p>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-subtle">
              Query tokens go on the upstream URL. Bearer and Cookie go as headers. The M3U
              Jellyfin holds never includes this value.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function RewriteView({ data }: { data: InspectPayload }) {
  const summary = data.summary;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Kind" value={summary?.isMaster ? "master" : "media"} />
        <Stat label="Rewrites" value={String(data.rewrites)} />
        <Stat label="Variants" value={String(summary?.variants ?? 0)} />
        <Stat label="Segments" value={String(summary?.segments ?? 0)} />
        <Stat label="Keys" value={String(summary?.keys ?? 0)} />
        <Stat label="Maps" value={String(summary?.maps ?? 0)} />
      </dl>
      <PlaylistBlock label="Rewritten" text={data.rewritten} highlight />
    </div>
  );
}

function PlaylistBlock({
  label,
  text,
  highlight,
}: {
  label: string;
  text: string;
  highlight?: boolean;
}) {
  const preview = text.split(/\r?\n/).slice(0, 28).join("\n");
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md bg-bg p-3 font-mono text-xs leading-relaxed text-muted">
        {preview.split("\n").map((line, i) => (
          <span
            key={`${i}-${line.slice(0, 24)}`}
            className={cn(
              "block whitespace-pre-wrap break-all",
              highlight && (line.startsWith("/api/hls") || line.includes("URI="))
                ? "text-fg"
                : undefined,
            )}
          >
            {line || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-0.5 break-all text-sm text-fg", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bg px-2.5 py-2">
      <dt className="text-subtle">{label}</dt>
      <dd className="font-mono text-sm text-fg tabular-nums">{value}</dd>
    </div>
  );
}

function CopyBtn({ label, value }: { label: string; value: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        toast.success(`Copied ${label.toLowerCase()}`);
      }}
    >
      <Copy className="size-4" />
      {label}
    </Button>
  );
}

function TokenEditor({ channel, onSaved }: { channel: Channel; onSaved: () => void }) {
  const setToken = useLatchStore((s) => s.setToken);
  const [value, setValue] = useState(channel.token ?? "");

  useEffect(() => {
    setValue(channel.token ?? "");
  }, [channel.id, channel.token]);

  const kind = classifyToken(value);
  const dirty = value.trim() !== (channel.token ?? "").trim();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">Session token</p>
        <Badge variant={kind === "empty" ? "default" : "live"}>{tokenKindLabel(kind)}</Badge>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="token=…  ·  Bearer eyJ…  ·  Cookie: sid=…  ·  signed URL"
        spellCheck={false}
        aria-label="Stream token"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!dirty}
          onClick={() => {
            setToken(channel.id, value);
            toast.success(value.trim() ? "Token saved on the session" : "Token cleared");
            onSaved();
          }}
        >
          Save token
        </Button>
        {channel.token ? (
          <p className="font-mono text-xs text-subtle">{maskToken(channel.token)}</p>
        ) : null}
      </div>
    </div>
  );
}

function TokenClock({ expiresAt }: { expiresAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = expiresAt - Date.now();
  const expired = remaining <= 0;
  return (
    <div className="rounded-md bg-bg px-3 py-3">
      <p className="text-xs font-medium text-muted">Time to expiry</p>
      <p
        className={cn(
          "mt-1 font-mono text-2xl tracking-tight tabular-nums",
          expired ? "text-danger" : "text-fg",
        )}
      >
        {expired ? "00:00" : formatMs(remaining)}
      </p>
    </div>
  );
}

function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
  const proxyUrl = `${origin}${channelProxyPath(channel)}`;
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
    <aside className="flex min-h-0 flex-col rounded-xl bg-surface p-3">
      <Tabs defaultValue="stream">
        <TabsList className="w-full">
          <TabsTrigger value="stream">Stream</TabsTrigger>
          <TabsTrigger value="playlist">Playlist</TabsTrigger>
          <TabsTrigger value="token">Token</TabsTrigger>
        </TabsList>
        <TabsContent value="stream" className="flex flex-col gap-3 px-1 pb-1">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-subtle">Proxy URL</p>
              <button
                type="button"
                aria-label="Copy proxy URL"
                className="flex size-8 items-center justify-center rounded-md text-subtle hover:text-fg"
                onClick={async () => {
                  await navigator.clipboard.writeText(proxyUrl);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-4" />
              </button>
            </div>
            <p className="break-all font-mono text-xs text-fg">{proxyUrl}</p>
          </div>
          <Meta label="Referer" value={channel.referer || "—"} />
          <Meta label="User-Agent" value={channel.userAgent || "—"} />
        </TabsContent>
        <TabsContent value="playlist" className="px-1 pb-1">
          {inspect.isLoading ? (
            <p className="text-sm text-subtle">Loading…</p>
          ) : inspect.data?.error && !inspect.data.original ? (
            <p className="text-sm text-danger">{inspect.data.error}</p>
          ) : inspect.data ? (
            <RewriteView data={inspect.data} />
          ) : (
            <p className="text-sm text-subtle">No playlist yet</p>
          )}
        </TabsContent>
        <TabsContent value="token" className="flex flex-col gap-3 px-1 pb-1">
          <TokenEditor channel={channel} onSaved={() => void inspect.refetch()} />
          {channel.kind === "token" ? (
            <>
              <TokenClock
                expiresAt={inspect.data?.session?.expiresAt ?? channel.tokenExpiresAt ?? 0}
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
                  <RefreshCw />
                  Recapture
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
                  <TimerOff />
                  Expire
                </Button>
              </div>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function RewriteView({ data }: { data: InspectPayload }) {
  const summary = data.summary;
  const preview = data.rewritten.split(/\r?\n/).slice(0, 28);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Stat label={summary?.isMaster ? "Master" : "Media"} value={String(data.rewrites)} sub="rewrites" />
        <Stat label="Variants" value={String(summary?.variants ?? 0)} />
        <Stat label="Segments" value={String(summary?.segments ?? 0)} />
      </dl>
      <pre className="max-h-64 overflow-auto rounded-md bg-bg p-3 font-mono text-xs leading-relaxed text-subtle">
        {preview.map((line, i) => (
          <span
            key={`${i}-${line.slice(0, 24)}`}
            className={cn(
              "block whitespace-pre-wrap break-all",
              line.startsWith("/api/hls") || line.includes("URI=") ? "text-fg" : undefined,
            )}
          >
            {line || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-0.5 break-all font-mono text-xs text-fg">{value}</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-bg px-2.5 py-2">
      <dt className="text-subtle">{label}</dt>
      <dd className="font-mono text-sm text-fg tabular-nums">
        {value}
        {sub ? <span className="ml-1 text-xs text-subtle">{sub}</span> : null}
      </dd>
    </div>
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
        <p className="text-xs text-subtle">Token</p>
        <Badge variant={kind === "empty" ? "default" : "live"}>{tokenKindLabel(kind)}</Badge>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="token=…, Bearer …, Cookie: …, or a signed URL"
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
            toast.success(value.trim() ? "Token saved" : "Token cleared");
            onSaved();
          }}
        >
          Save
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
    <div className="rounded-md bg-bg px-3 py-2">
      <p className="text-xs text-subtle">Expires in</p>
      <p
        className={cn(
          "mt-0.5 font-mono text-xl tracking-tight tabular-nums",
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

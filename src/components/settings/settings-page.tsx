import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePlane } from "@/hooks/use-plane";
import { buildM3U } from "@/lib/hls/m3u";
import type { Channel } from "@/lib/hls/catalog";
import type { PlaneSnapshot } from "@/lib/session/types";
import { useFetchStore } from "@/lib/store";

export function SettingsPage({ channels, origin }: { channels: Channel[]; origin: string }) {
  const [viaProxy, setViaProxy] = useSavedToggle("fetch.m3u.viaProxy", true);
  const [includeLogos, setIncludeLogos] = useSavedToggle("fetch.m3u.logos", true);
  const [copied, setCopied] = useState<"m3u" | "link" | null>(null);
  const hidden = useFetchStore((s) => s.hidden);
  const restoreHidden = useFetchStore((s) => s.restoreHidden);

  const client = useQueryClient();
  const plane = usePlane(5000);
  const setAuto = useMutation({
    mutationFn: async (autoRefresh: boolean) => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "auto", autoRefresh }),
      });
      const data = (await res.json()) as PlaneSnapshot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `session ${res.status}`);
      return data;
    },
    onSuccess: (data) => client.setQueryData(["plane"], data),
    onError: (error) => toast.error(error.message),
  });

  const text = useMemo(() => {
    const lineup = channels.filter((channel) => channel.group !== "Lab");
    return buildM3U(lineup, origin, { includeLogos, viaProxy });
  }, [channels, origin, includeLogos, viaProxy]);

  // The live playlist: Jellyfin re-reads it, so new channels show up there
  // without copying the M3U again.
  const liveUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (!viaProxy) params.set("direct", "1");
    if (!includeLogos) params.set("logos", "0");
    const query = params.toString();
    return `${origin}/api/m3u${query ? `?${query}` : ""}`;
  }, [origin, viaProxy, includeLogos]);

  async function copy(what: "m3u" | "link") {
    try {
      await navigator.clipboard.writeText(what === "m3u" ? text : liveUrl);
    } catch {
      toast.error("Couldn't copy");
      return;
    }
    setCopied(what);
    toast.success("Copied");
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-4 sm:px-6">
      <Section title="Jellyfin playlist">
        <p className="text-sm text-muted">
          In Jellyfin, add an M3U tuner with this link. It stays up to date as you add channels,
          as long as Fetch is running on this Mac.
        </p>
        <code className="rounded-md bg-bg px-3 py-2 font-mono text-xs break-all text-fg">{liveUrl}</code>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void copy("link")}>
            {copied === "link" ? <Check /> : <Link />}
            Copy link
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void copy("m3u")}>
            {copied === "m3u" ? <Check /> : <Copy />}
            Copy M3U
          </Button>
        </div>
        <ToggleRow id="via-proxy" label="Route through Fetch" checked={viaProxy} onChange={setViaProxy} />
        <ToggleRow id="logos" label="Channel logos" checked={includeLogos} onChange={setIncludeLogos} />
        <pre className="max-h-72 overflow-auto rounded-md bg-bg p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-subtle">
          {text}
        </pre>
      </Section>

      <Section title="Sessions">
        <ToggleRow
          id="auto-refresh"
          label="Refresh before a token expires"
          checked={plane.data?.autoRefresh ?? true}
          onChange={(checked) => setAuto.mutate(checked)}
        />
      </Section>

      {hidden.length > 0 ? (
        <Section title="Channels">
          <div>
            <Button size="sm" variant="secondary" onClick={restoreHidden}>
              Restore removed demo channels
            </Button>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

/** A switch whose position survives a relaunch. */
function useSavedToggle(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initial;
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? initial : saved === "1";
    } catch {
      return initial;
    }
  });
  const update = (next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* not remembered, still applied */
    }
  };
  return [value, update] as const;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">{title}</h2>
      {children}
    </section>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="text-sm text-fg">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

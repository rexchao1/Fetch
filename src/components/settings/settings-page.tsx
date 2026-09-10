import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePlane } from "@/hooks/use-plane";
import { buildM3U } from "@/lib/hls/m3u";
import type { Channel } from "@/lib/hls/catalog";
import type { PlaneSnapshot } from "@/lib/session/types";
import { useLatchStore } from "@/lib/store";

export function SettingsPage({ channels, origin }: { channels: Channel[]; origin: string }) {
  const [viaProxy, setViaProxy] = useState(true);
  const [includeLogos, setIncludeLogos] = useState(true);
  const [copied, setCopied] = useState(false);
  const hidden = useLatchStore((s) => s.hidden);
  const restoreHidden = useLatchStore((s) => s.restoreHidden);

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

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied");
    window.setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const blob = new Blob([text], { type: "audio/x-mpegurl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "latch.m3u";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-4 sm:px-6">
      <Section title="Jellyfin playlist">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            Copy M3U
          </Button>
          <Button size="sm" variant="secondary" onClick={download}>
            <Download />
            Download
          </Button>
        </div>
        <ToggleRow id="via-proxy" label="Route through Latch" checked={viaProxy} onChange={setViaProxy} />
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

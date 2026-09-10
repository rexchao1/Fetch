import { Check, Copy, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { buildM3U } from "@/lib/hls/m3u";
import type { Channel } from "@/lib/hls/catalog";
import { groupChannels } from "@/lib/hls/catalog";

export function M3uExport({ channels, origin }: { channels: Channel[]; origin: string }) {
  const [viaProxy, setViaProxy] = useState(true);
  const [includeLogos, setIncludeLogos] = useState(true);
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    const lineup = channels.filter((channel) => channel.group !== "Lab");
    return buildM3U(lineup, origin, { includeLogos, viaProxy });
  }, [channels, origin, includeLogos, viaProxy]);

  const groups = groupChannels(channels.filter((channel) => channel.group !== "Lab"));

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Playlist copied");
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
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:px-6">
      <div className="flex flex-col gap-5">
        <header>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Jellyfin</p>
          <h1 className="mt-1 font-display text-4xl tracking-tight italic">A lineup it can actually play</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Live TV wants an M3U. Each URL is a stable Latch path (`/api/hls?ch=`). Token
            refresh, failover, and recapture happen in the capture plane, so this file does
            not change when a live session rotates.
          </p>
        </header>
        <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <ToggleRow
            id="via-proxy"
            label="Rewrite through proxy"
            hint="M3U URLs point at Latch. Leave on — Jellyfin cannot send Referer itself."
            checked={viaProxy}
            onChange={setViaProxy}
          />
          <ToggleRow
            id="logos"
            label="Include logos"
            hint="tvg-logo in the M3U so the Jellyfin guide shows channel marks."
            checked={includeLogos}
            onChange={setIncludeLogos}
          />
        </div>
        <ul className="flex flex-col gap-3 text-sm">
          {groups.map((group) => (
            <li key={group.name}>
              <p className="text-xs font-medium text-subtle">{group.name}</p>
              <p className="text-fg">
                {group.channels.map((c) => c.name).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-h-0 flex-col rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy M3U
          </Button>
          <Button size="sm" variant="secondary" onClick={download}>
            <Download className="size-4" />
            Download
          </Button>
        </div>
        <pre className="max-h-[32rem] flex-1 overflow-auto rounded-md bg-bg p-4 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-muted">
          {text}
        </pre>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id} className="text-sm text-fg">
          {label}
        </Label>
        <p className="text-xs text-subtle">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ingestPlaylist } from "@/lib/hls/ingest";

export function ProbeLab(_props: { origin: string }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);

  async function addToGuide(event: FormEvent) {
    event.preventDefault();
    setRunning(true);
    try {
      await ingestPlaylist(url);
      toast.success("Added to Guide");
      await navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add that playlist");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <p className="text-xs font-medium tracking-wide text-muted uppercase">Add a stream</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight italic">Paste a playlist</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          One URL. If it already has `?token=…` on the end, leave it there — Latch copies that
          onto every segment so you do not split it out.
        </p>
      </header>

      <form
        onSubmit={addToGuide}
        className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="probe-url">Playlist URL</Label>
          <Input
            id="probe-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/playlist.m3u8?token=…"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            required
          />
        </div>
        <Button type="submit" disabled={running || !url.trim()}>
          {running ? "Adding…" : "Add to Guide"}
        </Button>
      </form>
    </div>
  );
}

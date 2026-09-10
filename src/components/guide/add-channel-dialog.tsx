import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ingestPlaylist } from "@/lib/hls/ingest";

export function AddChannelDialog({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: { url?: string };
}) {
  const [url, setUrl] = useState(preset?.url ?? "");
  const [running, setRunning] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setRunning(true);
    try {
      await ingestPlaylist(url);
      toast.success("Added to Guide");
      onOpenChange(false);
      setUrl("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add that playlist");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a playlist</DialogTitle>
          <DialogDescription>
            Paste the full `.m3u8` URL, including `?token=` if it has one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ch-url">Playlist URL</Label>
            <Input
              id="ch-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/playlist.m3u8?token=…"
              required
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" className="mt-2" disabled={running || !url.trim()}>
            {running ? "Adding…" : "Add to lineup"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

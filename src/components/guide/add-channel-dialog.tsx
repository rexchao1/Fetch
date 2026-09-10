import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ingestPlaylist } from "@/lib/hls/ingest";

export function AddChannelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [page, setPage] = useState("");
  const [running, setRunning] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setRunning(true);
    try {
      await ingestPlaylist(url, page);
      toast.success("Added");
      onOpenChange(false);
      setUrl("");
      setPage("");
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
          <DialogTitle>Add a stream</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ch-url">Playlist URL</Label>
            <Input
              id="ch-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/playlist.m3u8"
              required
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ch-page">Page URL (optional)</Label>
            <Input
              id="ch-page"
              value={page}
              onChange={(e) => setPage(e.target.value)}
              placeholder="https://…/watch/…"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
          </div>
          <Button type="submit" className="mt-1" disabled={running || !url.trim()}>
            {running ? "Adding…" : "Add"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

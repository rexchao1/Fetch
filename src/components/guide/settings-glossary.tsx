import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ITEMS = [
  {
    name: "Playlist URL",
    text: "The .m3u8 address of the stream. Paste the playlist, not a website. This is the only required field.",
  },
  {
    name: "Name",
    text: "Label in the lineup and in Jellyfin Live TV.",
  },
  {
    name: "Group",
    text: "Folder in the lineup. Jellyfin uses this as group-title (Live, Cinema, or your own).",
  },
  {
    name: "Failover URL",
    text: "Backup playlist. After two failed health checks, Latch swaps to this. Jellyfin still uses the same proxy URL.",
  },
  {
    name: "User-Agent",
    text: "Browser identity sent to the origin. Some CDNs reject Jellyfin’s default UA. Chrome is the safe default.",
  },
  {
    name: "Referer",
    text: "The “I came from this page” header. A picky CDN returns 403 without it.",
  },
  {
    name: "Token",
    text: "Optional signed access. Query (token= / hdnts= / CloudFront Policy), Bearer JWT, Cookie, or a full signed URL. Latch attaches it to playlist and segment requests. It never appears in the Jellyfin M3U.",
  },
  {
    name: "TTL refresh",
    text: "On Capture: recapture a session at 80% of its lifetime, before the signed URL dies. Off means wait for a 401.",
  },
  {
    name: "Capture",
    text: "Run the capture worker now. Refreshes headers and playlist. Never sits on the video path.",
  },
  {
    name: "Expire",
    text: "Lab control. Pretend the session died so you can watch recapture. Does not delete the channel.",
  },
  {
    name: "Rewrite through proxy",
    text: "On Playlist: M3U URLs point at Latch instead of the origin. Leave this on for Jellyfin.",
  },
  {
    name: "Include logos",
    text: "Adds tvg-logo marks to the M3U for the Jellyfin guide.",
  },
  {
    name: "Remove",
    text: "Drops a channel from the lineup. Your own sources are deleted. Demo channels can be restored.",
  },
] as const;

export function SettingsGlossary({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What the settings mean</DialogTitle>
          <DialogDescription>
            Latch injects headers and rewrites playlists. These controls only change how that
            happens — not the video itself.
          </DialogDescription>
        </DialogHeader>
        <dl className="mt-4 flex flex-col gap-4">
          {ITEMS.map((item) => (
            <div key={item.name}>
              <dt className="text-sm font-medium text-fg">{item.name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted">{item.text}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export function GlossaryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      Keys
    </Button>
  );
}

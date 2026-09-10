import { useEffect, useRef, useState } from "react";
import type { Channel } from "@/lib/hls/catalog";
import { channelProxyPath } from "@/lib/hls/catalog";

type Props = {
  channel: Channel;
  origin: string;
  mirrorId?: string;
};

/**
 * The video surface. Playback controls are the browser's own (play, volume,
 * seek, fullscreen, picture-in-picture, and the live badge for live streams)
 * so they behave the way every other player does. Autoplay starts muted;
 * the viewer unmutes from the control bar.
 */
export function HlsPlayer({ channel, origin, mirrorId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const src = `${origin}${channelProxyPath(channel, { mirrorId })}`;
  const expired = channel.kind === "token" && (channel.tokenExpiresAt ?? 0) < Date.now();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: { destroy: () => void } | undefined;
    setError(null);
    setReady(false);
    video.muted = true;

    async function attach() {
      try {
        const { default: Hls } = await import("hls.js");
        if (cancelled || !video) return;

        const tryPlay = () => {
          if (cancelled || expired) return;
          video.play().catch(() => {
            /* autoplay can be blocked; the native controls take over */
          });
        };

        if (Hls.isSupported()) {
          const instance = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            ...(channel.live
              ? { liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8 }
              : {}),
          });
          hls = instance;
          let retried = false;
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return;
            if (!retried) {
              retried = true;
              setError("Reconnecting…");
              window.setTimeout(() => {
                if (cancelled) return;
                setError(null);
                instance.loadSource(src);
              }, 1400);
              return;
            }
            setError(data.details || "Stream error");
          });
          instance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            setReady(true);
            tryPlay();
          });
          instance.loadSource(src);
          instance.attachMedia(video);
          return;
        }

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
          video.addEventListener(
            "loadedmetadata",
            () => {
              setReady(true);
              tryPlay();
            },
            { once: true },
          );
          return;
        }

        setError("HLS is not supported in this browser");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Player failed");
      }
    }

    void attach();
    return () => {
      cancelled = true;
      hls?.destroy();
      if (video) {
        video.pause();
        video.removeAttribute("src");
      }
    };
  }, [src, expired, channel.live]);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          className="size-full object-contain"
          controls
          playsInline
          muted
          controlsList="nodownload"
        />
        {expired ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/80">
            <p className="text-sm text-muted">Token expired</p>
          </div>
        ) : null}
        {!ready && !error && !expired ? (
          <p className="pointer-events-none absolute top-3 left-4 text-xs text-muted">Loading…</p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="min-w-0 truncate font-display text-xl tracking-tight italic">{channel.name}</p>
        {error ? <p className="shrink-0 text-xs text-danger">{error}</p> : null}
      </div>
    </section>
  );
}

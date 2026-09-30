import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
/** Waits before each reconnect, in ms. The last one repeats. */
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];
/** Give up and show Retry after this many failed reconnects in a row. */
const MAX_RETRIES = 8;

export function HlsPlayer({ channel, origin, mirrorId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const src = `${origin}${channelProxyPath(channel, { mirrorId })}`;
  const expired = channel.kind === "token" && (channel.tokenExpiresAt ?? 0) < Date.now();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: { destroy: () => void } | undefined;
    let retryTimer: number | undefined;
    const cleanups: (() => void)[] = [];
    setError(null);
    setReconnecting(false);
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
          // Failures in a row. A live stream can drop many times over an
          // evening; any fragment that loads resets the count.
          let failures = 0;
          let mediaRecoveries = 0;
          instance.on(Hls.Events.FRAG_LOADED, () => {
            if (failures || mediaRecoveries) {
              failures = 0;
              mediaRecoveries = 0;
              setReconnecting(false);
              setError(null);
            }
          });
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return;
            // A decode hiccup: hls.js can rebuild the media pipeline without
            // re-requesting anything. Twice, then treat it like a network drop.
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
              mediaRecoveries += 1;
              instance.recoverMediaError();
              return;
            }
            if (failures >= MAX_RETRIES) {
              setReconnecting(false);
              setError(data.details || "Stream error");
              return;
            }
            const delay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)];
            failures += 1;
            setReconnecting(true);
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => {
              if (cancelled) return;
              instance.loadSource(src);
              instance.startLoad();
            }, delay);
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
          const onMeta = () => {
            setReady(true);
            tryPlay();
          };
          const onError = () => {
            if (cancelled) return;
            setError(video.error?.message || "Stream error");
          };
          video.addEventListener("loadedmetadata", onMeta, { once: true });
          video.addEventListener("error", onError);
          cleanups.push(() => {
            video.removeEventListener("loadedmetadata", onMeta);
            video.removeEventListener("error", onError);
          });
          video.src = src;
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
      window.clearTimeout(retryTimer);
      for (const cleanup of cleanups) cleanup();
      hls?.destroy();
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [src, expired, channel.live, attempt]);

  const status = expired
    ? null
    : error
      ? null
      : reconnecting
        ? "Reconnecting…"
        : !ready
          ? "Loading…"
          : null;

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
        <p
          role="status"
          className="pointer-events-none absolute top-3 left-4 text-xs text-muted"
        >
          {status}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="min-w-0 truncate font-display text-xl tracking-tight italic">{channel.name}</p>
        {error ? (
          <div role="alert" className="flex shrink-0 items-center gap-3">
            <p className="text-xs text-danger">{error}</p>
            <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw />
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

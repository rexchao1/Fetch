import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/hls/catalog";
import { headerRecipe, channelProxyPath } from "@/lib/hls/catalog";
import { cn } from "@/lib/utils";

type Props = {
  channel: Channel;
  origin: string;
};

export function HlsPlayer({ channel, origin }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const src = `${origin}${channelProxyPath(channel, origin)}`;
  const expired = channel.kind === "token" && (channel.tokenExpiresAt ?? 0) < Date.now();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: { destroy: () => void } | undefined;
    setError(null);
    setReady(false);
    setPlaying(false);
    video.muted = true;
    setMuted(true);

    async function attach() {
      try {
        const { default: Hls } = await import("hls.js");
        if (cancelled || !video) return;

        const tryPlay = () => {
          if (cancelled || expired) return;
          video.play()
            .then(() => {
              if (!cancelled) setPlaying(true);
            })
            .catch(() => {
              /* autoplay can be blocked; overlay stays */
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
              setError("Waiting on capture plane…");
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
          video.addEventListener("loadedmetadata", () => {
            setReady(true);
            tryPlay();
          }, { once: true });
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

  async function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setPlaying(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Playback blocked");
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
        <div className="relative aspect-video bg-bg">
          <video
            ref={videoRef}
            className="size-full object-contain"
            playsInline
            muted
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-bg/40 transition-opacity duration-200",
              playing ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          >
            <Button
              type="button"
              onClick={togglePlay}
              className="size-14 rounded-full"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
            </Button>
          </div>
          {expired ? (
            <div className="absolute inset-0 flex items-center justify-center bg-bg/80">
              <p className="max-w-xs px-6 text-center text-sm text-muted">
                Token expired. Refresh it in the inspector, then play again.
              </p>
            </div>
          ) : null}
          {channel.live ? (
            <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-bg/80 px-2.5 py-1 text-xs font-medium tracking-wide text-live uppercase">
              <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
              Live
            </span>
          ) : null}
          {!ready && !error && !expired ? (
            <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-muted">
              Loading playlist…
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-lg tracking-tight italic">{channel.name}</p>
            <p className="truncate text-xs text-subtle">
              {channel.group} · {headerRecipe(channel.userAgent, channel.referer)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
    </section>
  );
}

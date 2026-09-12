import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Channel } from "@/lib/hls/catalog";
import { useFetchStore } from "@/lib/store";

/**
 * Keep the lineup in step with what the capture plane has registered: a page
 * sniffed by `scripts/sniff-m3u8.mjs` or the deck shows up here, and a
 * re-sniff that rotated the playlist URL updates the local copy.
 */
export function useServerChannels(interval = 3000) {
  const hydrated = useFetchStore((s) => s.hydrated);
  const adopt = useFetchStore((s) => s.adoptServerChannels);
  const query = useQuery({
    queryKey: ["captured-channels"],
    queryFn: async () => {
      const res = await fetch("/api/capture");
      if (!res.ok) throw new Error(`capture list ${res.status}`);
      return (await res.json()) as { channels: Channel[]; now: number };
    },
    refetchInterval: interval,
    enabled: hydrated,
  });

  useEffect(() => {
    if (query.data?.channels) adopt(query.data.channels);
  }, [query.data, adopt]);

  return query;
}

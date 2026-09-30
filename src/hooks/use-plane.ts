import { useQuery } from "@tanstack/react-query";
import type { PlaneSnapshot } from "@/lib/session/types";

export function usePlane(interval = 2000) {
  return useQuery({
    queryKey: ["plane"],
    queryFn: async () => {
      const res = await fetch("/api/session");
      if (!res.ok) throw new Error(`session ${res.status}`);
      return (await res.json()) as PlaneSnapshot;
    },
    refetchInterval: interval,
  });
}

export type ProbeCell = {
  uaId: string;
  refererId: string;
  playlistStatus: number | null;
  segmentStatus: number | null;
  playlistMs: number;
  error?: string;
};

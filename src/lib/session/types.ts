export type SessionHeaders = {
  userAgent: string;
  referer: string;
  cookie?: string;
  origin?: string;
  authorization?: string;
};

export type StreamSession = {
  channelId: string;
  name: string;
  pageUrl: string;
  playlistUrl: string;
  headers: SessionHeaders;
  capturedAt: number;
  expiresAt: number | null;
  generation: number;
  source: "seed" | "playwright" | "manual" | "failover" | "sniff";
  lastReason: string;
  live: boolean;
  token?: string;
  failoverUrl?: string;
  healthStatus: number | null;
  healthAt: number | null;
};

export type CaptureEvent = {
  t: number;
  kind: "launch" | "navigate" | "document" | "iframe" | "request" | "response" | "permit" | "commit" | "error";
  detail: string;
};

export type CaptureJob = {
  id: string;
  channelId: string;
  pageUrl: string;
  reason: string;
  status: "queued" | "running" | "ok" | "error";
  startedAt: number;
  finishedAt: number | null;
  events: CaptureEvent[];
  error?: string;
  generation?: number;
};

export type StreamHit = {
  at: number;
  channelId: string | null;
  status: number;
  ms: number;
  path: string;
};

export type PlaneSnapshot = {
  sessions: StreamSession[];
  jobs: CaptureJob[];
  hits: StreamHit[];
  inflight: string[];
  autoRefresh: boolean;
  now: number;
};

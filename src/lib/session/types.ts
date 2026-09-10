export type SessionHeaders = {
  userAgent: string;
  referer: string;
  cookie?: string;
  origin?: string;
  authorization?: string;
};

/**
 * One playable source for a channel. A page with "Stream 1 / Server 2 / …"
 * buttons yields several of these, all mirrors of the same event. The session
 * plays one (its `activeMirrorId`) and the watchdog keeps a live health read
 * on every mirror so the dashboard can show which alternates are up and the
 * app can fail over to the best one.
 */
export type Mirror = {
  id: string;
  label: string;
  url: string;
  headers: SessionHeaders;
  token?: string;
  kind: "master" | "media" | "unknown";
  live: boolean | null;
  bandwidth?: number;
  width?: number;
  height?: number;
  expiresAt: number | null;
  healthStatus: number | null;
  healthAt: number | null;
  latencyMs: number | null;
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
  // Set when the channel was captured from a multi-stream page. The top-level
  // playlistUrl/headers/token always mirror the active entry, so the proxy and
  // the single-source health path keep working unchanged.
  mirrors?: Mirror[];
  activeMirrorId?: string;
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

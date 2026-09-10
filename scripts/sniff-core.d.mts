export declare const DEFAULT_TIMEOUT_MS: number;
export declare const SETTLE_MS: number;
export declare const SNIFF_UA: string;

export type SniffEvent = { t: number; kind: string; detail: string };
export type PlaylistKind = "master" | "media" | "unknown";

export type SniffedPlaylist = {
  url: string;
  kind: PlaylistKind;
  live: boolean | null;
  status: number | null;
  expiresAt: number | null;
  headers: {
    userAgent: string;
    referer: string;
    origin?: string;
    cookie?: string;
    authorization?: string;
  };
};

export type SniffResult = {
  pageUrl: string;
  finalUrl: string;
  title: string;
  playlist: SniffedPlaylist | null;
  candidates: Array<{ url: string; kind: PlaylistKind; status: number | null; at: number }>;
  events: SniffEvent[];
  ms: number;
};

export type SniffOptions = {
  pageUrl: string;
  timeoutMs?: number;
  settleMs?: number;
  headed?: boolean;
  userAgent?: string;
  onEvent?: (event: SniffEvent) => void;
};

export declare function sniffAvailable(): Promise<boolean>;
export declare function sniffPage(opts: SniffOptions): Promise<SniffResult>;
export declare function classifyPlaylist(text: string): { kind: PlaylistKind; live: boolean | null };
export declare function pickPlaylist<T extends { at: number; kind: PlaylistKind; live: boolean | null }>(
  candidates: T[],
): T | null;
export declare function expiryFromUrl(raw: string, now?: number): number | null;
export declare function cookieHeader(cookies: Array<{ name: string; value: string }>): string;
export declare function mergeCookies(headerValue: string | undefined, jar: string): string;
export declare function shortUrl(value: string): string;

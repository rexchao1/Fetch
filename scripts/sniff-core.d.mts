export declare const DEFAULT_TIMEOUT_MS: number;
export declare const SETTLE_MS: number;
export declare const SNIFF_UA: string;

export type SniffEvent = { t: number; kind: string; detail: string };
export type PlaylistKind = "master" | "media" | "unknown";

export type MirrorHeaders = {
  userAgent: string;
  referer: string;
  origin?: string;
  cookie?: string;
  authorization?: string;
};

export type SniffedMirror = {
  id: string;
  label: string;
  url: string;
  kind: PlaylistKind;
  live: boolean | null;
  status: number | null;
  ms?: number;
  bandwidth?: number;
  width?: number;
  height?: number;
  expiresAt: number | null;
  headers: MirrorHeaders;
};

// A single-mirror sniff still returns one of these as `playlist`.
export type SniffedPlaylist = SniffedMirror;

export type SniffResult = {
  pageUrl: string;
  finalUrl: string;
  title: string;
  playlist: SniffedMirror | null;
  mirrors: SniffedMirror[];
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
export declare function parseMasterInfo(text: string): {
  bandwidth?: number;
  width?: number;
  height?: number;
};
export declare function scoreMirror(m: {
  status: number | null;
  live?: boolean | null;
  bandwidth?: number;
  width?: number;
  kind: string;
  ms?: number;
}): number;

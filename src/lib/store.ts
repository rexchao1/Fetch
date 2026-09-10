import { useMemo } from "react";
import { create } from "zustand";
import {
  BUILTIN_CHANNELS,
  TOKEN_TTL_MS,
  type Channel,
} from "@/lib/hls/catalog";

const STORAGE_KEY = "latch.v1";

type LatchState = {
  custom: Channel[];
  hidden: string[];
  selectedId: string;
  hydrated: boolean;
  hydrate: () => void;
  select: (id: string) => void;
  addCustom: (channel: Omit<Channel, "id" | "builtin" | "kind" | "mark"> & { mark?: string }) => string;
  removeChannel: (id: string) => void;
  restoreHidden: () => void;
  refreshToken: (id: string) => void;
  expireToken: (id: string) => void;
  applyHeaders: (id: string, userAgent: string, referer: string) => Promise<void>;
  setToken: (id: string, token: string) => void;
  /** Pull channels the capture plane registered on the server into the lineup. */
  adoptServerChannels: (channels: Channel[]) => void;
};

function mintId() {
  return `ch-${Math.random().toString(36).slice(2, 8)}`;
}

function withFreshTokens(channels: Channel[]): Channel[] {
  return channels.map((channel) => {
    if (channel.kind !== "token") return channel;
    if (!channel.tokenExpiresAt) {
      return { ...channel, tokenExpiresAt: Date.now() + (channel.tokenTtlMs ?? TOKEN_TTL_MS) };
    }
    return channel;
  });
}

function loadState(): { custom: Channel[]; hidden: string[] } {
  if (typeof window === "undefined") return { custom: [], hidden: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { custom: [], hidden: [] };
    const parsed = JSON.parse(raw) as { custom?: Channel[]; hidden?: string[] };
    return {
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch {
    return { custom: [], hidden: [] };
  }
}

function persist(custom: Channel[], hidden: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ custom, hidden }));
}

export function allChannels(custom: Channel[], hidden: string[] = []) {
  const builtins = withFreshTokens(BUILTIN_CHANNELS).map((builtin) => {
    const overlay = custom.find((c) => c.id === builtin.id);
    return overlay
      ? { ...builtin, ...overlay, builtin: true, live: overlay.live ?? builtin.live }
      : builtin;
  });
  const extras = custom.filter((c) => !BUILTIN_CHANNELS.some((b) => b.id === c.id));
  return [...builtins, ...extras].filter((channel) => !hidden.includes(channel.id));
}

export const useLatchStore = create<LatchState>((set, get) => ({
  custom: [],
  hidden: [],
  selectedId: "castr-live",
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const loaded = loadState();
    const custom = withFreshTokens(loaded.custom);
    persist(custom, loaded.hidden);
    set({ custom, hidden: loaded.hidden, hydrated: true });
    queueMicrotask(() => {
      for (const channel of allChannels(custom, loaded.hidden)) {
        // Sniffed channels are the server's to refresh; re-registering the
        // local copy would push a stale URL/token over a fresher session.
        // After a server restart, though, this copy is all that remembers the
        // name and page, so hand it back and let the plane re-sniff.
        if (channel.source === "sniff") {
          restoreSession(channel);
          continue;
        }
        if (!channel.builtin || channel.token) syncSession(channel);
      }
    });
  },
  select: (id) => set({ selectedId: id }),
  addCustom: (input) => {
    const id = mintId();
    const channel: Channel = {
      id,
      builtin: false,
      kind: "open",
      mark: input.mark ?? input.name.slice(0, 2),
      name: input.name,
      group: input.group || "Custom",
      url: input.url,
      failoverUrl: input.failoverUrl,
      userAgent: input.userAgent,
      referer: input.referer,
      note: input.note || "Custom HLS source.",
      live: input.live,
      pageUrl: input.pageUrl ?? input.url,
      token: input.token,
    };
    const hidden = get().hidden.filter((item) => item !== id);
    const custom = [...get().custom, channel];
    persist(custom, hidden);
    set({ custom, hidden, selectedId: id });
    return id;
  },
  removeChannel: (id) => {
    const isBuiltin = BUILTIN_CHANNELS.some((channel) => channel.id === id);
    const custom = isBuiltin ? get().custom : get().custom.filter((c) => c.id !== id);
    const hidden = isBuiltin
      ? [...new Set([...get().hidden, id])]
      : get().hidden.filter((item) => item !== id);
    persist(custom, hidden);
    const remaining = allChannels(custom, hidden);
    const selectedId =
      get().selectedId === id ? (remaining[0]?.id ?? "castr-live") : get().selectedId;
    set({ custom, hidden, selectedId });
    if (!isBuiltin) {
      void fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unregister", channelId: id }),
      });
    }
  },
  restoreHidden: () => {
    persist(get().custom, []);
    set({ hidden: [] });
  },
  refreshToken: (id) => {
    const ttl =
      allChannels(get().custom, get().hidden).find((c) => c.id === id)?.tokenTtlMs ?? TOKEN_TTL_MS;
    const nextExp = Date.now() + ttl;
    const custom = upsertExpiry(get().custom, id, nextExp, ttl);
    persist(custom, get().hidden);
    set({ custom });
  },
  expireToken: (id) => {
    const custom = upsertExpiry(get().custom, id, Date.now() - 1000, TOKEN_TTL_MS);
    persist(custom, get().hidden);
    set({ custom });
  },
  applyHeaders: (id, userAgent, referer) => {
    const builtin = BUILTIN_CHANNELS.find((c) => c.id === id);
    const existing = get().custom.find((c) => c.id === id);
    const base = existing ?? builtin;
    if (!base) return Promise.resolve();
    const next: Channel = { ...base, userAgent, referer };
    const custom = [...get().custom.filter((c) => c.id !== id), next];
    const hidden = get().hidden.filter((item) => item !== id);
    persist(custom, hidden);
    set({ custom, hidden, selectedId: id });
    return fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "headers",
        channelId: id,
        userAgent,
        referer,
      }),
    }).then(() => undefined);
  },
  setToken: (id, token) => {
    const existing = get().custom.find((c) => c.id === id);
    const base = allChannels(get().custom, get().hidden).find((c) => c.id === id);
    if (!base) return;
    const next: Channel = { ...(existing ?? base), token: token.trim() || undefined };
    const custom = [...get().custom.filter((c) => c.id !== id), next];
    persist(custom, get().hidden);
    set({ custom });
    void fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "token", channelId: id, token: token.trim() }),
    });
  },
  adoptServerChannels: (incoming) => {
    const { custom, hidden } = get();
    let next = custom;
    let changed = false;
    let newest: string | undefined;
    for (const channel of incoming) {
      if (!channel?.id || channel.builtin) continue;
      const local = next.find((c) => c.id === channel.id);
      if (!local) {
        next = [...next, channel];
        changed = true;
        if (channel.url) newest = channel.id;
        continue;
      }
      const stale =
        local.url !== channel.url ||
        (local.token ?? "") !== (channel.token ?? "") ||
        local.name !== channel.name ||
        local.userAgent !== channel.userAgent ||
        local.referer !== channel.referer ||
        Boolean(local.live) !== Boolean(channel.live);
      if (stale) {
        next = next.map((c) => (c.id === channel.id ? { ...c, ...channel } : c));
        changed = true;
      }
    }
    if (!changed) return;
    persist(next, hidden);
    set({ custom: next, ...(newest ? { selectedId: newest } : {}) });
  },
}));

function restoreSession(channel: Channel) {
  void fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "restore", channel }),
  });
}

function syncSession(channel: Channel) {
  void fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "register", channel }),
  });
}

function upsertExpiry(custom: Channel[], id: string, tokenExpiresAt: number, tokenTtlMs: number) {
  const base = BUILTIN_CHANNELS.find((c) => c.id === id);
  const existing = custom.find((c) => c.id === id);
  const next: Channel = {
    ...(existing ?? base!),
    tokenExpiresAt,
    tokenTtlMs,
  };
  return [...custom.filter((c) => c.id !== id), next];
}

export function useSelectedChannel() {
  const custom = useLatchStore((s) => s.custom);
  const hidden = useLatchStore((s) => s.hidden);
  const selectedId = useLatchStore((s) => s.selectedId);
  const list = useMemo(() => allChannels(custom, hidden), [custom, hidden]);
  return list.find((c) => c.id === selectedId) ?? list[0];
}

export function useChannelList() {
  const custom = useLatchStore((s) => s.custom);
  const hidden = useLatchStore((s) => s.hidden);
  return useMemo(() => allChannels(custom, hidden), [custom, hidden]);
}

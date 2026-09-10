import { CHROME_UA, PROBE_USER_AGENTS } from "./catalog";
import { tokenFromPlaylistUrl } from "./token";
import { useLatchStore } from "@/lib/store";
import type { ProbeCell } from "./types";

export async function ingestPlaylist(raw: string) {
  const target = raw.trim();
  const parsed = new URL(target);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Need an http(s) playlist URL");
  }

  const token = tokenFromPlaylistUrl(target);
  let userAgent = CHROME_UA;
  let referer = `${parsed.origin}/`;

  try {
    const res = await fetch("/api/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: target,
        userAgents: PROBE_USER_AGENTS.map((item) => ({ id: item.id, value: item.value })),
        referers: [
          { id: "none", value: "" },
          { id: "target", value: referer },
        ],
      }),
    });
    const data = (await res.json()) as { cells?: ProbeCell[] };
    const winner = data.cells?.find(
      (cell) => cell.playlistStatus === 200 && (cell.segmentStatus === 200 || cell.segmentStatus === null),
    );
    if (winner) {
      userAgent = PROBE_USER_AGENTS.find((item) => item.id === winner.uaId)?.value ?? CHROME_UA;
      referer = winner.refererId === "target" ? referer : "";
    }
  } catch {
    /* play it anyway */
  }

  const state = useLatchStore.getState();
  const existing = state.custom.find((channel) => channel.url === target);
  const name = parsed.hostname.replace(/^www\./, "") || "Stream";

  if (existing) {
    await state.applyHeaders(existing.id, userAgent, referer);
    if (token) state.setToken(existing.id, token);
    state.select(existing.id);
    return existing.id;
  }

  const id = state.addCustom({
    name,
    group: "Live",
    url: target,
    userAgent,
    referer,
    token: token || undefined,
    note: "Added from playlist URL.",
    live: true,
    pageUrl: target,
  });

  await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "register",
      channel: {
        id,
        name,
        group: "Live",
        url: target,
        pageUrl: target,
        userAgent,
        referer,
        token: token || undefined,
        mark: name.slice(0, 2),
        kind: "open",
        builtin: false,
        live: true,
        note: "Added from playlist URL.",
      },
    }),
  });

  return id;
}

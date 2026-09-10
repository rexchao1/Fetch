export type RefererCandidate = { id: string; value: string };

/**
 * The referer values the probe should try for a pasted playlist.
 *
 * A hotlink gate that checks Referer usually wants the *page* the stream plays
 * on, not the playlist's own host — the playlist commonly sits on a separate
 * CDN. So when the caller knows the page, we try it (and its origin) alongside
 * the empty and playlist-origin referers. Duplicates and unparseable URLs are
 * dropped, and the list order is the probe's preference order.
 *
 * Kept dependency-free so it can be unit-tested under Node's type stripping.
 */
export function buildRefererCandidates(playlistUrl: string, pageUrl?: string): RefererCandidate[] {
  const candidates: RefererCandidate[] = [{ id: "none", value: "" }];
  const seen = new Set<string>([""]);
  const push = (id: string, value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push({ id, value });
  };

  try {
    push("target", `${new URL(playlistUrl).origin}/`);
  } catch {
    /* playlist origin unavailable */
  }

  const page = pageUrl?.trim();
  if (page) {
    try {
      const parsed = new URL(page);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        push("page", page);
        push("page-origin", `${parsed.origin}/`);
      }
    } catch {
      /* ignore a malformed page URL */
    }
  }

  return candidates;
}

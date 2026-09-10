export type TokenKind = "empty" | "query" | "bearer" | "cookie" | "url";

export type AppliedToken = {
  url: string;
  kind: TokenKind;
  authorization?: string;
  cookie?: string;
};

export function classifyToken(raw: string): TokenKind {
  const token = raw.trim();
  if (!token) return "empty";
  if (/^https?:\/\//i.test(token)) return "url";
  if (/^bearer\s+/i.test(token) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(token)) {
    return "bearer";
  }
  if (/^cookie\s*:/i.test(token)) return "cookie";
  return "query";
}

/**
 * Put a session token on a URL. `mode` matters for query tokens: "overwrite"
 * (default) replaces params already on the URL, which is right when the user
 * pastes a new token for the same playlist. "fill" only adds params the URL
 * lacks, which is what segments need: many CDNs sign every segment with its
 * own `st=`/`sig=`, and stamping the master's value over it is a sure 403.
 */
export function applyToken(
  url: string,
  raw: string,
  mode: "overwrite" | "fill" = "overwrite",
): AppliedToken {
  const token = raw.trim();
  const kind = classifyToken(token);
  if (kind === "empty") return { url, kind };
  const put = (target: URL, key: string, value: string) => {
    if (mode === "fill" && target.searchParams.has(key)) return;
    target.searchParams.set(key, value);
  };

  if (kind === "bearer") {
    const value = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    return { url, kind, authorization: value };
  }

  if (kind === "cookie") {
    return { url, kind, cookie: token.replace(/^cookie\s*:\s*/i, "") };
  }

  try {
    const target = new URL(url);
    if (kind === "url") {
      const signed = new URL(token);
      signed.searchParams.forEach((value, key) => put(target, key, value));
      return { url: target.href, kind };
    }

    const query = token.startsWith("?") ? token.slice(1) : token;
    if (query.includes("=")) {
      const params = new URLSearchParams(query);
      params.forEach((value, key) => put(target, key, value));
    } else {
      put(target, "token", query);
    }
    return { url: target.href, kind: "query" };
  } catch {
    return { url, kind };
  }
}

export function tokenFromPlaylistUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    return parsed.searchParams.toString();
  } catch {
    return "";
  }
}

export function maskToken(raw: string) {
  const token = raw.trim();
  if (!token) return "none";
  if (token.length <= 10) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function tokenKindLabel(kind: TokenKind) {
  if (kind === "bearer") return "Bearer";
  if (kind === "cookie") return "Cookie";
  if (kind === "url") return "Signed URL";
  if (kind === "query") return "Query";
  return "None";
}

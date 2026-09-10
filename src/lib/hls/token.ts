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

export function applyToken(url: string, raw: string): AppliedToken {
  const token = raw.trim();
  const kind = classifyToken(token);
  if (kind === "empty") return { url, kind };

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
      signed.searchParams.forEach((value, key) => target.searchParams.set(key, value));
      return { url: target.href, kind };
    }

    const query = token.startsWith("?") ? token.slice(1) : token;
    if (query.includes("=")) {
      const params = new URLSearchParams(query);
      params.forEach((value, key) => target.searchParams.set(key, value));
    } else {
      target.searchParams.set("token", query);
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

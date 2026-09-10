export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-type, content-length",
};

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store" },
  });
}

export function textResponse(
  body: string,
  status = 200,
  contentType = "text/plain; charset=utf-8",
) {
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

export function withCorsHandlers<T extends Record<string, unknown>>(handlers: T) {
  return {
    OPTIONS: async () => optionsResponse(),
    ...handlers,
  };
}

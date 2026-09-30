import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rejectRequest } from "./http.ts";

function req(headers: Record<string, string>, method = "GET") {
  return new Request("http://127.0.0.1:47821/api/session", { method, headers });
}

describe("rejectRequest", () => {
  it("lets the app's own window through", () => {
    const ok = req({
      host: "127.0.0.1:47821",
      origin: "http://127.0.0.1:47821",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    }, "POST");
    assert.equal(rejectRequest(ok), null);
  });

  it("lets Jellyfin, VLC and the sniff script through", () => {
    assert.equal(rejectRequest(req({ host: "127.0.0.1:47821", "user-agent": "Lavf/60" })), null);
    assert.equal(rejectRequest(req({ host: "host.docker.internal:47821" })), null);
    assert.equal(rejectRequest(req({ host: "[::1]:47821" })), null);
  });

  it("refuses a request sent from another website", () => {
    const res = rejectRequest(req({ host: "127.0.0.1:47821", "sec-fetch-site": "cross-site" }));
    assert.equal(res?.status, 403);
  });

  it("refuses a foreign Origin even without fetch metadata", () => {
    const res = rejectRequest(req({ host: "127.0.0.1:47821", origin: "https://evil.example" }));
    assert.equal(res?.status, 403);
  });

  it("refuses a public host name (DNS rebinding)", () => {
    const res = rejectRequest(req({ host: "rebind.evil.example:47821" }));
    assert.equal(res?.status, 403);
  });

  it("refuses a POST that is not JSON", () => {
    const res = rejectRequest(req({ host: "127.0.0.1:47821", "content-type": "text/plain" }, "POST"));
    assert.equal(res?.status, 415);
  });
});

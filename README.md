# Fetch

A homelab HLS bridge for Jellyfin. You give Fetch a live `.m3u8` playlist;
it keeps a `StreamSession` warm behind a stable proxy URL — header
injection, playlist rewrite, failover to a backup playlist after two failed
health checks, M3U export — so Jellyfin only ever talks to Fetch and never
scrapes the origin directly.

## Run it

```
npm ci
npm run dev         # http://localhost:8080
npm run build       # builds the Node server the desktop app bundles
npm run typecheck
npm run lint
npm test
```

## Sniff a playlist off a page

You have a page that plays video but no `.m3u8` URL. Fetch can watch the
page's network tab and take the playlist it loads, token and all:

```
npm run sniff -- https://example.com/watch/123
npm run sniff -- <page> --name "Cup Final" --server http://homelab:8080
npm run sniff -- <page> --dry-run      # print what it found, submit nothing
npm run sniff -- <page> --headed       # watch the browser do it
```

The script opens the page in headless Chromium (`npx playwright install
chromium` once), nudges any player to start, records every `.m3u8` request
with the User-Agent, Referer, Origin, cookies and Authorization the page sent,
prefers the master playlist, and POSTs the result to `/api/capture`. The
channel appears on the Guide within a few seconds, selected and playing, and
Jellyfin gets a stable `/api/hls?ch=<id>&page=<page>` line.

The same sniff runs inside the server when Playwright is installed next to
it (the dev server has it once `npx playwright install chromium` has run;
the packaged desktop app does not): the Capture page has a sniff form, and
TTL refresh / a 403 from the origin / a restart re-sniff the page
automatically. Without Playwright the capture log tells you to run the
script instead. Signed URLs with `exp=`, Akamai `hdnts`, or a JWT
`exp` set the session's expiry so the 80% refresh fires before the token dies.

Node 20+.

## Desktop app

Fetch runs as a native window, so it's only using resources while you have
it open — no server left running in the background. This is the only build
target; there is no web deploy.

```
npm run desktop:dev      # Tauri window over the live dev server
npm run desktop:build    # packaged .app / installer under src-tauri/target
```

The window loads `npm run dev`'s server directly in dev. A packaged build
instead bundles a standalone Node server (`npm run build`, Nitro's
`node-server` preset) and `src-tauri/src/main.rs` spawns it on
`127.0.0.1:47821` when the window opens, killing it when the window closes.
Because the server is copied into the app at build time, the packaged app
does not pick up code changes until you run `npm run desktop:build` again
and then quit and reopen Fetch. Jellyfin can only reach a channel's
`/api/hls` URL while the desktop app is open, so it fits "open Fetch, then
watch," not walk-up-and-stream with the app closed. Requires Rust
(`brew install rust`) to build; not needed just to run `npm run dev`.

## Layout

| Path | Holds |
| --- | --- |
| `src/routes/index.tsx` | Guide: channel list, player, inspector, and the "add a stream" dialog. |
| `src/routes/settings.tsx` | Settings: M3U export for Jellyfin, session auto-refresh, restore demo channels. |
| `src/routes/capture.tsx` | Capture: sniff a page, watch jobs, expire/recapture sessions. |
| `src/routes/api/` | Server routes: `hls` (the proxy itself), `capture` (sniff drop box + list), `probe`, `inspect`, `session`, `token`, `logo`, `gate`. |
| `src/lib/store.ts` | The channel/session client store (`useFetchStore`). |
| `src/lib/session/` | Server-side session plane: in-memory sessions, capture jobs, `sniff.ts` commits a sniffed page. |
| `src/lib/hls/` | Playlist ingest and rewrite, the `FetchProxy` user agent. |
| `scripts/sniff-core.mjs` | The Playwright network watcher, shared by `scripts/sniff-m3u8.mjs` (CLI) and the server. |
| `src-tauri/` | Desktop shell (Tauri + Rust) — see § Desktop app. |

## Deploy

There is no web deploy. The desktop app is the product: `npm run
desktop:build` produces the `.app` and `.dmg` under `src-tauri/target`.

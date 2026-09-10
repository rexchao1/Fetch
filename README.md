# Latch

A homelab HLS bridge for Jellyfin. You give Latch a live `.m3u8` playlist;
it keeps a `StreamSession` warm behind a stable proxy URL — header
injection, playlist rewrite, failover to a backup playlist after two failed
health checks, M3U export — so Jellyfin only ever talks to Latch and never
scrapes the origin directly.

## Run it

```
npm ci
npm run dev         # http://localhost:8080
npm run build       # production build, then runs pending migrations
npm run typecheck
npm run lint
npm test
```

## Sniff a playlist off a page

You have a page that plays video but no `.m3u8` URL. Latch can watch the
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
it (the homelab dev server has it; Vercel does not): the Capture deck has a
"Sniff a page" form, and TTL refresh / a 403 from the origin / a restart
re-sniff the page automatically. Without Playwright the deck's log tells you
to run the script instead. Signed URLs with `exp=`, Akamai `hdnts`, or a JWT
`exp` set the session's expiry so the 80% refresh fires before the token dies.

Node 20+. `npm run dev` / `build` / `preview` all resolve `VITE_AUTH_ENABLED`
through `scripts/with-app-env.mjs`, so a dev server must be started with one
of those scripts, never bare `vite dev` — `npm run check:auth` catches the
case where it wasn't.

## Desktop app

Latch can run as a native window instead of a browser tab, so it's only
using resources while you have it open — no server left running in the
background:

```
npm run desktop:dev      # Tauri window over the live dev server
npm run desktop:build    # packaged .app / installer under src-tauri/target
```

The window loads `npm run dev`'s server directly in dev. A packaged build
instead bundles a standalone Node server (`npm run build:desktop`, Nitro's
`node-server` preset — see `NITRO_PRESET` in `vite.config.ts`, distinct from
the `vercel` preset the Vercel deploy uses) and `src-tauri/src/main.rs`
spawns it on `127.0.0.1:47821` when the window opens, killing it when the
window closes. No `DATABASE_URL` is set locally, so it runs on PGLite same
as dev/preview — nothing to configure. The one thing this doesn't do:
Jellyfin can only reach a channel's `/api/hls` URL while the desktop app is
open, so it fits "open Latch, then watch," not walk-up-and-stream with the
app closed. Requires Rust (`brew install rust`) to build; not needed just to
run `npm run dev`.

## Layout

| Path | Holds |
| --- | --- |
| `src/routes/index.tsx` | Guide: channel list, player, inspector, and the "add a stream" dialog. |
| `src/routes/settings.tsx` | Settings: M3U export for Jellyfin, session auto-refresh, restore demo channels. |
| `src/routes/capture.tsx` | Capture: sniff a page, watch jobs, expire/recapture sessions. |
| `src/routes/api/` | Server routes: `hls` (the proxy itself), `capture` (sniff drop box + list), `probe`, `inspect`, `session`, `token`, `logo`, `gate`. |
| `src/lib/store.ts` | The channel/session client store (`useLatchStore`). |
| `src/lib/session/` | Server-side session plane: in-memory sessions, capture jobs, `sniff.ts` commits a sniffed page. |
| `src/lib/hls/` | Playlist ingest and rewrite, the `LatchProxy` user agent. |
| `scripts/sniff-core.mjs` | The Playwright network watcher, shared by `scripts/sniff-m3u8.mjs` (CLI) and the server. |
| `src/lib/auth/` | Better Auth wiring — own email/password plus the shared Grok auth broker for Google/X. Off by default (`VITE_AUTH_ENABLED`). |
| `src/lib/app-data/` | Server-only connector/AppData client. Never imported from client code. |
| `src/lib/db.ts` | Postgres in production, PGLite fallback locally — see `migrations/`. |
| `server/middleware/` | The deployed-app half of PWA chrome; `scripts/grok-pwa-plugin.mjs` is its dev/preview counterpart. |
| `migrations/` | Schema, applied to Neon on deploy and to PGLite on preview startup. `migrations/auth/` is the Better Auth schema; do not edit it by hand. |
| `scripts/` | Build tooling and its tests (`*.test.mjs`, run with `node --test`). |
| `src-tauri/` | Desktop shell (Tauri + Rust) — see § Desktop app. |

This app was scaffolded by the Grok app builder; `.grok/` is that platform's
own instruction and skills bundle, not project documentation, and is not
version-controlled here — it's regenerated by the platform.

## Deploy

Deployed to Vercel. `npm run build` must succeed under Vercel's process; the
platform injects `DATABASE_URL` and auth credentials at deploy time. Local
dev and the live preview need neither — PGLite and a baked shared preview
auth client cover both.

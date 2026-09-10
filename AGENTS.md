# Latch

Read `README.md` first: what Latch does, how to run it, and where each part
lives.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at `http://localhost:8080`, via `scripts/with-app-env.mjs` |
| `npm run build` | Builds `.output/` with Nitro's `node-server` preset: the server the desktop app bundles |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | `scripts/**/*.test.mjs` plus the `src/lib` unit tests |
| `npm run check:auth` | Fails if a live dev server and the next build disagree about `VITE_AUTH_ENABLED` |
| `npm run sniff -- <page-url>` | Headless Chromium watches the page for an `.m3u8`, submits it to `/api/capture` |
| `npm run desktop:dev` | Tauri window over the live `npm run dev` server |
| `npm run desktop:build` | `npm run build`, then packages `Latch.app` and a `.dmg` under `src-tauri/target/release/bundle` — the only way a change reaches the packaged app |

## Rules

- Never start Vite outside `npm run dev` / `build` / `preview`. Those scripts
  resolve `VITE_AUTH_ENABLED` through `scripts/with-app-env.mjs`; a bare
  `vite dev` skips that and desyncs the running preview from the next build.
  `npm run check:auth` is what catches it if it happens anyway.
- Auth is Better Auth: this app's own email/password plus the shared Grok
  broker for Google/X. No other providers. Never rewrite
  `src/lib/auth/server.ts`. Every server function that needs the caller
  authorizes with `authMiddleware` and scopes its query by the resulting
  `context.userId` — never a client-sent id.
- `migrations/*.sql` is the schema, applied to PGLite automatically on
  startup and to a real Postgres by `npm run db:migrate` when `DATABASE_URL`
  is set. Add tables as new ordered files; don't edit an existing one.
  `migrations/auth/` is the Better Auth schema and is out of scope for both —
  don't touch it by hand.
- Playwright is imported only in `scripts/sniff-core.mjs`, lazily and through
  a non-literal specifier, so the server bundle never traces it and a server
  without it (the packaged desktop app) degrades to "run the script". Keep it
  that way: no top-level or literal `import("playwright")` anywhere under
  `src/`.
- A channel with `source: "sniff"` is owned by the server session: its proxy
  path carries `page=` instead of `u=`, the client never re-registers its
  local copy over a live session (it sends `restore` only when the server has
  forgotten the id), and every playlist URL the capture plane stores passes
  `assertSafeUpstream` first.
- Connector/AppData calls (Drive, Gmail, calendar) are backend-only: a
  `createServerFn` handler dynamic-imports `@/lib/app-data/client.server`.
  Never call it, or fetch the connectors host, from a route component,
  `useEffect`, or any other client code.
- `.grok/` is the app-builder platform's own instruction and skills bundle.
  It isn't version-controlled here — the platform regenerates it — so don't
  treat it as project documentation and don't hand-edit around it expecting
  the edit to persist.
- The desktop app is the only build target. `vite.config.ts` pins Nitro to
  `node-server` because `src-tauri/src/main.rs` spawns
  `.output/server/index.mjs` as a child process; a serverless preset would
  not be runnable. There is no web deploy — don't add one back.

## Git

Work on `main`, commit when a change is done and checked, push to `origin`
when the user says to. No agent attribution, session link, or machine name
in a commit message. No secret and no `.env` value: `.gitignore` keeps them
out, but check what you `git add` before committing anyway.

## Verify

- A copy or styling change ships after reading your own diff.
- A behavior change to routing, the proxy, or auth gets `npm run typecheck`
  and the relevant test file; a change that could desync the auth flag also
  gets `npm run check:auth` against a running dev server.
- `npm run build` before anything that touches `vite.config.ts`, a server
  route, or a migration — dev-only success doesn't mean the bundled server
  builds.
- Report what ran and what did not. A check that did not run did not pass.

## Desktop app

The user runs Latch as the packaged app at
`src-tauri/target/release/bundle/macos/Latch.app`, not in a browser. That
app copies the built server into itself at build time, so no code change is
visible there until the app is rebuilt and relaunched.

- After any change the user should see in the app, run
  `npm run desktop:build` (needs Rust), then tell them to quit Latch and open
  it again. Screenshots from a dev server prove the code, not the app.
- To tell whether the packaged app is open, look for a `node …/Latch.app/…/
  output/server/index.mjs` process. It keeps serving the old build until the
  window is closed.
- `npm run desktop:dev` is the alternative: a Tauri window over the live dev
  server, which follows edits without a rebuild.

## Where knowledge goes

| What | Where |
| --- | --- |
| A rule about the proxy, auth, or migrations | This file, and the code it constrains |
| Why a build-vs-deploy quirk exists | A comment on the code it explains, or `.grok/references/` if it's platform-level |
| Ordinary completed work | The commit message |

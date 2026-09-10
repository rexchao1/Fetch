# Latch

Read `README.md` first: what Latch does, how to run it, and where each part
lives.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at `http://localhost:8080`, via `scripts/with-app-env.mjs` |
| `npm run build` | Production build, then `npm run db:migrate` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | `scripts/**/*.test.mjs` plus the `src/lib` unit tests |
| `npm run check:auth` | Fails if a live dev server and the next build disagree about `VITE_AUTH_ENABLED` |

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
- `migrations/*.sql` is the schema, applied to Neon on deploy and to PGLite
  on preview startup automatically. Add tables as new ordered files; don't
  edit an existing one. `migrations/auth/` is the Better Auth schema and is
  out of scope for both — don't touch it by hand.
- Connector/AppData calls (Drive, Gmail, calendar) are backend-only: a
  `createServerFn` handler dynamic-imports `@/lib/app-data/client.server`.
  Never call it, or fetch the connectors host, from a route component,
  `useEffect`, or any other client code.
- `.grok/` is the app-builder platform's own instruction and skills bundle.
  It isn't version-controlled here — the platform regenerates it — so don't
  treat it as project documentation and don't hand-edit around it expecting
  the edit to persist.

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
  route, or a migration — dev-only success doesn't mean the Vercel build
  succeeds.
- Report what ran and what did not. A check that did not run did not pass.

## Where knowledge goes

| What | Where |
| --- | --- |
| A rule about the proxy, auth, or migrations | This file, and the code it constrains |
| Why a build-vs-deploy quirk exists | A comment on the code it explains, or `.grok/references/` if it's platform-level |
| Ordinary completed work | The commit message |

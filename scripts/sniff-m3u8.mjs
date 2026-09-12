#!/usr/bin/env node
/**
 * Open a page in headless Chromium, watch its network tab for an `.m3u8`
 * playlist (signed or not), and hand it to a running Fetch server so the
 * channel shows up on the Guide with the headers the page actually used.
 *
 *   node scripts/sniff-m3u8.mjs https://example.com/watch/123
 *   node scripts/sniff-m3u8.mjs <page> --server http://homelab:8080 --name "Cup Final"
 *   node scripts/sniff-m3u8.mjs <page> --dry-run       # print, do not submit
 *   node scripts/sniff-m3u8.mjs <page> --headed        # watch the browser
 *
 * Exit 0 on a committed channel, 2 when no playlist was seen, 1 on a bad
 * argument, browser failure, or server refusal.
 */
import { shortUrl, sniffPage } from "./sniff-core.mjs";

export function parseSniffArgs(argv, env = {}) {
  const out = {
    pageUrl: "",
    server: env.FETCH_SERVER || "http://localhost:8080",
    name: "",
    timeoutMs: 30_000,
    headed: false,
    dryRun: false,
    json: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) out.error = `${arg} needs a value`;
      return argv[i];
    };
    if (arg === "--server") out.server = next();
    else if (arg === "--name") out.name = next();
    else if (arg === "--timeout") out.timeoutMs = Number(next());
    else if (arg === "--headed") out.headed = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "-h" || arg === "--help") out.error = "help";
    else if (arg.startsWith("--")) out.error = `unknown flag ${arg}`;
    else if (!out.pageUrl) out.pageUrl = arg;
    else out.error = `unexpected argument ${arg}`;
    if (out.error) break;
  }
  if (out.error) return out;
  if (!out.pageUrl) out.error = "missing page URL";
  else {
    try {
      const parsed = new URL(out.pageUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        out.error = `only http/https pages, got ${parsed.protocol}`;
      }
    } catch {
      out.error = `not a valid URL: ${out.pageUrl}`;
    }
  }
  if (!out.error && (!Number.isFinite(out.timeoutMs) || out.timeoutMs < 3000)) {
    out.error = "--timeout must be at least 3000 (ms)";
  }
  if (!out.error) {
    try {
      out.server = new URL(out.server).origin;
    } catch {
      out.error = `--server is not a URL: ${out.server}`;
    }
  }
  return out;
}

const USAGE = `usage: node scripts/sniff-m3u8.mjs <page-url> [--server http://localhost:8080] [--name "Channel"] [--timeout 30000] [--headed] [--dry-run] [--json]`;

async function main() {
  const args = parseSniffArgs(process.argv.slice(2), process.env);
  if (args.error) {
    console.error(args.error === "help" ? USAGE : `${args.error}\n${USAGE}`);
    process.exit(args.error === "help" ? 0 : 1);
  }
  const log = args.json ? () => {} : (line) => console.error(line);

  log(`sniffing ${args.pageUrl}`);
  let result;
  try {
    result = await sniffPage({
      pageUrl: args.pageUrl,
      timeoutMs: args.timeoutMs,
      headed: args.headed,
      onEvent: (event) => log(`  ${(event.t / 1000).toFixed(2).padStart(6)}  ${event.kind.padEnd(9)} ${event.detail}`),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot find (package|module)/.test(message)) {
      console.error("Playwright is not installed here. Run `npm ci` then `npx playwright install chromium`.");
    } else if (/Executable doesn't exist/.test(message)) {
      console.error("Chromium is missing. Run `npx playwright install chromium`.");
    } else {
      console.error(`browser failed: ${message}`);
    }
    process.exit(1);
  }

  if (!result.playlist) {
    if (args.json) console.log(JSON.stringify({ ok: false, reason: "no playlist", result }, null, 2));
    else {
      console.error(`no .m3u8 request seen on ${args.pageUrl} within ${args.timeoutMs}ms`);
      if (result.candidates.length) {
        console.error("saw:");
        for (const c of result.candidates) console.error(`  ${c.status ?? "…"} ${c.kind} ${shortUrl(c.url)}`);
      }
    }
    process.exit(2);
  }

  log("");
  log(`playlist  ${result.playlist.url}`);
  log(`kind      ${result.playlist.kind}${result.playlist.live === null ? "" : result.playlist.live ? " · live" : " · vod"}`);
  if (result.playlist.expiresAt) {
    log(`expires   ${new Date(result.playlist.expiresAt).toISOString()}`);
  }
  if (result.mirrors.length > 1) {
    log(`mirrors   ${result.mirrors.length} found:`);
    for (const m of result.mirrors) {
      const res = m.width ? `${m.height}p` : m.bandwidth ? `${Math.round(m.bandwidth / 1000)}k` : "";
      log(`   ${m.id} ${m.label.padEnd(10)} ${String(m.status ?? "…").padEnd(4)} ${res.padEnd(6)} ${m.ms ?? "?"}ms`);
    }
  }

  // The page you typed is the channel's identity (re-sniffs find it by this);
  // any redirect target already rides along as the Referer header.
  const payload = {
    pageUrl: result.pageUrl,
    name: args.name || undefined,
    title: result.title,
    playlist: result.playlist,
    mirrors: result.mirrors,
    candidates: result.candidates,
    events: result.events,
  };

  if (args.dryRun) {
    if (args.json) console.log(JSON.stringify({ ok: true, dryRun: true, ...payload }, null, 2));
    else log("dry run: not submitted");
    return;
  }

  let response;
  try {
    response = await fetch(`${args.server}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error(`could not reach ${args.server}: ${error instanceof Error ? error.message : error}`);
    console.error("Start Fetch with `npm run dev`, or pass --server.");
    process.exit(1);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`server refused (${response.status}): ${body.error ?? "unknown error"}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: true, ...body }, null, 2));
    return;
  }
  log("");
  console.log(`channel   ${body.channel.name} (${body.channel.id})`);
  console.log(`guide     ${args.server}/`);
  console.log(`proxy     ${args.server}${body.proxyPath}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  await main();
}

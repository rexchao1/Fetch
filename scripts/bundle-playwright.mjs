// Copy playwright-core next to the built server so the packaged app can
// sniff pages. The server imports it by a non-literal name (see
// scripts/sniff-core.mjs), so Nitro never traces it; this puts it where
// Node's resolver finds it: .output/server/node_modules/playwright-core.
// It has no dependencies and no browser; it drives the Chrome already on
// the Mac.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const source = dirname(require.resolve("playwright-core/package.json"));
const target = join(root, ".output", "server", "node_modules", "playwright-core");

if (!existsSync(join(root, ".output", "server"))) {
  console.error("bundle-playwright: .output/server is missing; run vite build first");
  process.exit(1);
}
cpSync(source, target, { recursive: true, dereference: true });
console.log(`bundle-playwright: copied ${source} -> ${target}`);

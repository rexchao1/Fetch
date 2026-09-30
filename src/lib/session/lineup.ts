/**
 * The Guide's visible lineup, as the live M3U at `/api/m3u` serves it. The
 * Guide sends it whenever channels are added, removed or renamed; it is saved
 * in the app's data folder so Jellyfin gets the same list after a relaunch,
 * before the window has loaded.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Channel } from "@/lib/hls/catalog";
import { listRecipes } from "./store";

const LIMIT = 500;
let lineup: Channel[] | null = null;
let loaded = false;

function lineupPath() {
  const dir = process.env.FETCH_DATA_DIR;
  return dir ? join(dir, "lineup.json") : null;
}

function clean(input: unknown): Channel[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (c): c is Channel =>
        Boolean(c) &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.group === "string" &&
        typeof c.mark === "string" &&
        typeof c.url === "string",
    )
    .slice(0, LIMIT);
}

export function setLineup(channels: unknown) {
  lineup = clean(channels);
  loaded = true;
  const path = lineupPath();
  if (!path) return;
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(lineup));
  } catch {
    /* the in-memory copy still serves */
  }
}

export function getLineup(): Channel[] {
  if (!loaded) {
    loaded = true;
    const path = lineupPath();
    if (path) {
      try {
        lineup = clean(JSON.parse(readFileSync(path, "utf8")));
      } catch {
        /* nothing saved yet */
      }
    }
  }
  return lineup ?? listRecipes().filter((channel) => channel.group !== "Lab");
}

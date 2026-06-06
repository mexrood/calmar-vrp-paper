/**
 * VRP PAPER — always-on server. Ticks the book every 15 min (the live bot's
 * rehedge-monitoring cadence) AND serves the dashboard + state over HTTP.
 * Designed for Fly.io: state lives on a persistent volume at /data.
 */
import { createServer } from "node:http";
import { readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { tick, load } from "./vrp-engine.ts";

const PORT = Number(process.env.PORT ?? 8080);
const TICK_MS = Number(process.env.TICK_MS ?? 15 * 60 * 1000); // 15 min
const STATE = process.env.VRP_STATE ?? "./data/vrp-paper.json";
const SEED = "./data/vrp-paper.json"; // bundled in the image
const ROOT = process.cwd();
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

async function ensureState() {
  // On a fresh volume, seed the state from the image's bundled snapshot.
  await mkdir(dirname(STATE), { recursive: true });
  if (STATE !== SEED && !existsSync(STATE) && existsSync(SEED)) {
    await copyFile(SEED, STATE);
    console.log(`[seed] copied ${SEED} → ${STATE}`);
  }
}

async function doTick(reason: string) {
  try {
    const r = await tick();
    if (!r) { console.log(`[tick:${reason}] no position`); return; }
    const h = r.row;
    console.log(`[tick:${reason}] ${h.ts} spot $${Math.round(h.spot)} eq $${h.equity.toFixed(0)} Δ ${h.netDeltaBTC.toFixed(3)} dte ${h.dte.toFixed(1)}`);
  } catch (e) { console.error(`[tick:${reason}] failed:`, (e as Error).message); }
}

async function main() {
  await ensureState();
  if (!load()) { console.error("No position state found. Bundle data/vrp-paper.json into the image."); process.exit(1); }

  createServer(async (req, res) => {
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/") path = "/index.html";
    if (path === "/health") { res.writeHead(200).end("ok"); return; }
    try {
      // serve the live state file for the dashboard's data request
      if (path === "/data/vrp-paper.json") {
        const buf = await readFile(STATE);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(buf); return;
      }
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
      const buf = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(buf);
    } catch { res.writeHead(404).end("not found"); }
  }).listen(PORT, () => console.log(`VRP paper server on :${PORT} | tick every ${(TICK_MS / 60000).toFixed(0)} min`));

  await doTick("boot");                     // mark immediately on start
  setInterval(() => doTick("interval"), TICK_MS);
}
main().catch((e) => { console.error("server failed:", e); process.exit(1); });

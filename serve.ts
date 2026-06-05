/** Minimal static server for the dashboard. `npm run dash` → http://localhost:4321 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = 4321;
const ROOT = process.cwd();
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path === "/") path = "/index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`\n  VRP dashboard → http://localhost:${PORT}\n  (Ctrl+C to stop)\n`));

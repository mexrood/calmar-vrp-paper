/** Multi-asset VRP tick CLI. `tsx vrp-multi-cli.ts tick` — open/mark/roll all books. */
import { tickAll, load, ASSETS, CAPITAL } from "./vrp-multi.ts";

async function main() {
  const cmd = process.argv[2] ?? "tick";
  let s;
  if (cmd === "status") { s = load(); if (!s) { console.log("no state"); process.exit(0); } }
  else s = await tickAll();
  const h = s.history.at(-1)!;
  const start = CAPITAL * ASSETS.length;
  console.log(`[${h.ts}] portfolio $${h.total.toFixed(0)} / $${start} (${(h.total - start >= 0 ? "+" : "") + (h.total - start).toFixed(0)})`);
  for (const a of ASSETS) {
    const eq = h.per[a.sym]; const b = s.books[a.sym];
    if (eq == null) continue;
    console.log(`  ${a.sym.padEnd(5)} $${eq.toFixed(0)} (${(eq - CAPITAL >= 0 ? "+" : "") + (eq - CAPITAL).toFixed(0)}) | cycles ${b?.cycles ?? 0} | dte ${b ? ((b.expiry - Date.now()) / 864e5).toFixed(1) : "?"}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error("multi-cli failed:", e.message); process.exit(1); });

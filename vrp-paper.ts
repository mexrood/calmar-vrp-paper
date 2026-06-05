/**
 * VRP PAPER CLI
 *   tsx vrp-paper.ts open     # open the position at live prices
 *   tsx vrp-paper.ts tick      # mark to market + re-hedge, log a row
 *   tsx vrp-paper.ts status    # show current state without changing it
 */
import { open, tick, load, fmtUSD, CAPITAL, SIZE_BTC } from "./vrp-engine.ts";

function printState(s: NonNullable<ReturnType<typeof load>>) {
  console.log(`\nOpened: ${s.openedAt.slice(0, 16)} | expiry ${s.expiryDate} | spot@open $${s.spotAtOpen.toLocaleString()}`);
  console.log(`Legs (size ${SIZE_BTC} BTC each):`);
  for (const l of s.legs)
    console.log(`  ${l.side.toUpperCase().padEnd(5)} ${l.type.toUpperCase()} $${l.strike.toLocaleString().padEnd(7)} | entry ${l.entryFillBTC.toFixed(4)} BTC | IV ${l.entryIV?.toFixed(0)}%`);
  console.log(`Premium collected at open: ${fmtUSD(s.premiumCollectedUSD)}`);
  if (s.history.length) {
    const h = s.history[s.history.length - 1];
    const pnl = h.equity - CAPITAL;
    console.log(`\nLatest mark (${h.ts.slice(0, 16)}):`);
    console.log(`  spot $${h.spot.toLocaleString()} | ${h.dte.toFixed(1)}d to expiry`);
    console.log(`  option P&L ${fmtUSD(h.optionPnlUSD)} | hedge P&L ${fmtUSD(h.hedgePnlUSD)} | net delta ${h.netDeltaBTC.toFixed(3)} BTC`);
    console.log(`  EQUITY ${fmtUSD(h.equity).replace("+$", "$")}  (${pnl >= 0 ? "+" : ""}${(pnl / CAPITAL * 100).toFixed(2)}% on $${CAPITAL.toLocaleString()})`);
    if (s.history.length > 1) {
      console.log(`\n  history (${s.history.length} ticks):`);
      for (const r of s.history.slice(-12))
        console.log(`   ${r.ts.slice(5, 16)} | spot $${Math.round(r.spot).toLocaleString().padStart(7)} | eq ${fmtUSD(r.equity - CAPITAL).padStart(8)} | dte ${r.dte.toFixed(1)}`);
    }
  } else console.log("\n(no ticks yet — run `tick`)");
}

async function main() {
  const cmd = process.argv[2] ?? "status";
  if (cmd === "open") {
    if (load()) { console.log("⚠️  A position already exists. Delete data/vrp-paper.json to re-open."); process.exit(1); }
    const s = await open();
    printState(s);
  } else if (cmd === "tick") {
    const r = await tick();
    if (!r) { console.log("No position. Run `open` first."); process.exit(1); }
    printState(r.state);
  } else {
    const s = load();
    if (!s) { console.log("No position. Run open first."); process.exit(1); }
    printState(s);
  }
  process.exit(0);
}
main().catch((e) => { console.error("vrp-paper failed:", e); process.exit(1); });

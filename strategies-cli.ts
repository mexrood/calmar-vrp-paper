/** Strategies tick CLI. `tsx strategies-cli.ts tick` — mark carry + lending books. */
import { tick, load } from "./strategies.ts";
async function main() {
  const cmd = process.argv[2] ?? "tick";
  const s = cmd === "status" ? load() : await tick();
  if (!s) { console.log("no state"); process.exit(0); }
  const h = s.history.at(-1)!;
  console.log(`[${h.ts}]`);
  console.log(`  CARRY   $${s.carry.equity.toFixed(0)} (${(s.carry.equity - 10000 >= 0 ? "+" : "") + (s.carry.equity - 10000).toFixed(0)}) | funding ${h.fundingAnn}% ann | funding $${s.carry.meta.cumFunding.toFixed(0)} staking $${s.carry.meta.cumStaking.toFixed(0)} depeg $${s.carry.meta.cumDepeg.toFixed(0)}`);
  console.log(`  LENDING $${s.lending.equity.toFixed(0)} (${(s.lending.equity - 10000 >= 0 ? "+" : "") + (s.lending.equity - 10000).toFixed(0)}) | apy ${h.lendApy}%`);
  process.exit(0);
}
main().catch((e) => { console.error("strategies-cli failed:", e.message); process.exit(1); });

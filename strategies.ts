/**
 * STRATEGIES PAPER ENGINE — live paper books for the non-VRP streams, so the
 * Portfolio basket becomes FORWARD-measured (not just backtested):
 *
 *   CARRY  : delta-neutral Ethena-style — long stETH (staking yield) + short ETH
 *            perp (funding). P&L = funding (live) + staking − cost ± stETH depeg.
 *            Funding can be NEGATIVE (you pay) — that's the regime risk, shown live.
 *   LENDING: the honest anchor — a blue-chip stablecoin lending rate (live apyBase).
 *            If "smart" strategies don't beat this net of risk, they're not worth it.
 *
 * $10k each, net of a small cost. No real money.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STATE = process.env.STRAT_STATE ?? "./data/strategies.json";
const CAPITAL = 10_000;
const STAKING_ANN = 0.03;        // stETH staking yield (~current)
const CARRY_COST_ANN = 0.015;    // perp rehedge + spot/borrow drag
const LEND_FALLBACK = 0.036;     // if DefiLlama fetch fails
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function getJSON(u: string) { for (let a = 0; a < 4; a++) { try { const r = await fetch(u); if (r.ok) return await r.json(); await sleep(300); } catch { await sleep(400); } } return null; }

interface Book { equity: number; lastTickMs: number; meta: Record<string, number> }
interface StratState { startedAt: string; carry: Book; lending: Book; history: Array<{ ts: string; carry: number; lending: number; fundingAnn: number; lendApy: number }> }

function save(s: StratState) { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2)); }
export function load(): StratState | null { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null; }

async function liveFundingAnn(): Promise<number> {
  const j = await getJSON("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT");
  return j?.lastFundingRate != null ? parseFloat(j.lastFundingRate) * 3 * 365 : 0; // short receives +rate
}
async function stEthRatio(): Promise<number> {
  const j = await getJSON("https://api.coingecko.com/api/v3/simple/price?ids=staked-ether&vs_currencies=eth");
  return j?.["staked-ether"]?.eth ?? 1;
}
async function lendingApy(): Promise<number> {
  const j = await getJSON("https://yields.llama.fi/pools");
  if (!j?.data) return LEND_FALLBACK;
  const safe = j.data.filter((p: any) => p.stablecoin && p.ilRisk === "no" && p.tvlUsd > 5e8 && p.apyBase > 0 &&
    ["sky-lending", "aave-v3", "spark", "morpho-blue"].some((b) => p.project.includes(b)));
  if (!safe.length) return LEND_FALLBACK;
  safe.sort((a: any, b: any) => b.tvlUsd - a.tvlUsd);
  return safe[0].apyBase / 100;
}

export async function tick(): Promise<StratState> {
  let s = load();
  const now = Date.now(), nowISO = new Date().toISOString();
  const [fundingAnn, ratio, lendApy] = await Promise.all([liveFundingAnn(), stEthRatio(), lendingApy()]);

  if (!s) {
    s = { startedAt: nowISO,
      carry: { equity: CAPITAL, lastTickMs: now, meta: { lastRatio: ratio, cumFunding: 0, cumStaking: 0, cumDepeg: 0, cumCost: 0 } },
      lending: { equity: CAPITAL, lastTickMs: now, meta: {} },
      history: [] };
  }

  // CARRY: funding + staking − cost ± depeg, accrued over elapsed time
  const cDays = Math.min(2, (now - s.carry.lastTickMs) / 864e5);
  const fundingPnl = CAPITAL * fundingAnn / 365 * cDays;
  const stakingPnl = CAPITAL * STAKING_ANN / 365 * cDays;
  const costPnl = -CAPITAL * CARRY_COST_ANN / 365 * cDays;
  const depegPnl = CAPITAL * (ratio - (s.carry.meta.lastRatio ?? ratio)); // collateral discount change
  s.carry.equity += fundingPnl + stakingPnl + costPnl + depegPnl;
  s.carry.meta.cumFunding += fundingPnl; s.carry.meta.cumStaking += stakingPnl;
  s.carry.meta.cumDepeg += depegPnl; s.carry.meta.cumCost += costPnl;
  s.carry.meta.lastRatio = ratio; s.carry.lastTickMs = now;

  // LENDING: accrue current apyBase over elapsed time
  const lDays = Math.min(2, (now - s.lending.lastTickMs) / 864e5);
  s.lending.equity += s.lending.equity * lendApy / 365 * lDays;
  s.lending.lastTickMs = now;

  s.history.push({ ts: nowISO, carry: +s.carry.equity.toFixed(2), lending: +s.lending.equity.toFixed(2), fundingAnn: +(fundingAnn * 100).toFixed(1), lendApy: +(lendApy * 100).toFixed(2) });
  if (s.history.length > 400) s.history = s.history.slice(-400);
  save(s);
  return s;
}

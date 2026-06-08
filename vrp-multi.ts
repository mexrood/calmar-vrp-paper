/**
 * VRP MULTI-ASSET PAPER — runs the short-vol book on every Deribit-optionable
 * asset (BTC, ETH, SOL, XRP, AVAX, TRX), $10k each, auto-rolling every ~30d, to
 * measure which harvests best over 6 months AND whether a diversified portfolio
 * is smoother than any single book.
 *
 * Two settlement modes:
 *   coin   (BTC, ETH)  — option price quoted in the coin; USD value = price × spot
 *   linear (USDC alts) — option price quoted in USDC = USD directly
 * Everything normalized to USD per contract so the math is unified.
 *
 * No real money. Paper marks from live Deribit quotes; alt books are thinner so
 * marks/spreads are noisier (the engine skips a leg if its quote is missing).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STATE = process.env.VRP_STATE ?? "./data/vrp-multi.json";
const CAPITAL = 10_000;          // per asset
const NOTIONAL_FRAC = 0.6;       // straddle notional ≈ 0.6 × capital
const TARGET_DTE = 30, HEDGE_OTM = 0.75, ROLL_DTE = 1.0;
const PERP_COST = 0.0006, OPT_FEE_RATE = 0.0003, OPT_FEE_CAP = 0.125;
const FUNDING_ANN = 0.10;        // conservative perp-leg funding drag (annualized)
const SPREAD_FB = 0.04;          // assumed half-spread when a thin alt has no live bid/ask
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const ASSETS = [
  { sym: "BTC",  index: "btc_usd",  mode: "coin",   currency: "BTC",  prefix: "BTC-" },
  { sym: "ETH",  index: "eth_usd",  mode: "coin",   currency: "ETH",  prefix: "ETH-" },
  { sym: "SOL",  index: "sol_usd",  mode: "linear", currency: "USDC", prefix: "SOL_USDC" },
  { sym: "XRP",  index: "xrp_usd",  mode: "linear", currency: "USDC", prefix: "XRP_USDC" },
  { sym: "AVAX", index: "avax_usd", mode: "linear", currency: "USDC", prefix: "AVAX_USDC" },
  { sym: "TRX",  index: "trx_usd",  mode: "linear", currency: "USDC", prefix: "TRX_USDC" },
] as const;
type Asset = typeof ASSETS[number];

const api = async (p: string): Promise<any> => { for (let a = 0; a < 4; a++) { try { const r = await fetch(`https://www.deribit.com/api/v2/public/${p}`); if (r.ok) return (await r.json()).result; await sleep(300); } catch { await sleep(400); } } return null; };
const spotOf = async (a: Asset) => (await api(`get_index_price?index_name=${a.index}`))?.index_price ?? 0;
async function tickerOf(name: string) { return await api(`ticker?instrument_name=${name}`); }

interface Leg { name: string; type: "call" | "put"; strike: number; side: "short" | "long"; entryUsd: number; entryIV: number; }
interface Book {
  sym: string; qty: number; openedAt: string; expiry: number; expiryDate: string; spotAtOpen: number;
  legs: Leg[]; perpQty: number; perpEntry: number; realizedHedgePnlUSD: number; premiumCollectedUSD: number;
  feesUSD: number; realizedPnlUSD: number; cycles: number; lastSpot: number; lastTickMs: number;
}
export interface MultiState { startedAt: string; books: Record<string, Book>; history: Array<{ ts: string; total: number; per: Record<string, number> }>; }

function save(s: MultiState) { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2)); }
export function load(): MultiState | null { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null; }

const usdPrice = (a: Asset, mark: number, spot: number) => a.mode === "coin" ? mark * spot : mark;
const optFeeUsd = (a: Asset, legUsd: number, spot: number, qty: number) => {
  // 0.03% of underlying notional/contract, capped at 12.5% of premium, ×2 (open+settle)
  const perContract = a.mode === "coin" ? OPT_FEE_RATE * spot : OPT_FEE_RATE * spot;
  return 2 * Math.min(perContract, OPT_FEE_CAP * legUsd) * qty;
};

async function openBook(a: Asset): Promise<Book | null> {
  const spot = await spotOf(a); if (!spot) return null;
  const insts: any[] = await api(`get_instruments?currency=${a.currency}&kind=option&expired=false`);
  if (!insts) return null;
  const chain = insts.filter((i) => i.instrument_name.startsWith(a.prefix));
  if (!chain.length) return null;
  const now = Date.now(), target = now + TARGET_DTE * 864e5;
  const expiry = [...new Set(chain.map((i) => i.expiration_timestamp))].sort((x, y) => Math.abs(x - target) - Math.abs(y - target))[0];
  const ce = chain.filter((i) => i.expiration_timestamp === expiry);
  const strikes = [...new Set(ce.map((i) => i.strike))].sort((a2, b2) => a2 - b2);
  const atmK = strikes.reduce((b, s) => Math.abs(s - spot) < Math.abs(b - spot) ? s : b, strikes[0]);
  const hedgeK = strikes.reduce((b, s) => Math.abs(s - spot * HEDGE_OTM) < Math.abs(b - spot * HEDGE_OTM) ? s : b, strikes[0]);
  const find = (k: number, t: "call" | "put") => ce.find((i) => i.strike === k && i.option_type === t);
  const insC = find(atmK, "call"), insP = find(atmK, "put"), insH = find(hedgeK, "put");
  if (!insC || !insP || !insH) return null;
  const [tc, tp, th] = await Promise.all([tickerOf(insC.instrument_name), tickerOf(insP.instrument_name), tickerOf(insH.instrument_name)]);
  if (!tc || !tp || !th) return null;
  const qty = +(NOTIONAL_FRAC * CAPITAL / spot).toPrecision(3);
  // sell at bid, buy hedge at ask; if no live quote (thin alt) assume a SPREAD_FB haircut
  const bidOf = (t: any) => t.best_bid_price || t.mark_price * (1 - SPREAD_FB);
  const askOf = (t: any) => t.best_ask_price || t.mark_price * (1 + SPREAD_FB);
  const cBid = usdPrice(a, bidOf(tc), spot), pBid = usdPrice(a, bidOf(tp), spot), hAsk = usdPrice(a, askOf(th), spot);
  const legs: Leg[] = [
    { name: insC.instrument_name, type: "call", strike: atmK, side: "short", entryUsd: cBid, entryIV: tc.mark_iv },
    { name: insP.instrument_name, type: "put",  strike: atmK, side: "short", entryUsd: pBid, entryIV: tp.mark_iv },
    { name: insH.instrument_name, type: "put",  strike: hedgeK, side: "long", entryUsd: hAsk, entryIV: th.mark_iv },
  ];
  const premiumUSD = (cBid + pBid - hAsk) * qty;
  const netDelta = (-(tc.greeks?.delta ?? 0.5) - (tp.greeks?.delta ?? -0.5) + (th.greeks?.delta ?? -0.05)) * qty;
  const fees = legs.reduce((acc, l) => acc + optFeeUsd(a, l.entryUsd, spot, qty), 0) + Math.abs(netDelta) * spot * PERP_COST;
  return { sym: a.sym, qty, openedAt: new Date().toISOString(), expiry, expiryDate: new Date(expiry).toISOString().slice(0, 10), spotAtOpen: spot,
    legs, perpQty: -netDelta, perpEntry: spot, realizedHedgePnlUSD: 0, premiumCollectedUSD: premiumUSD, feesUSD: fees, realizedPnlUSD: 0, cycles: 0, lastSpot: spot, lastTickMs: Date.now() };
}

// mark a book; roll if expired. returns equity (USD) for the book.
async function markBook(a: Asset, b: Book): Promise<number> {
  const spot = await spotOf(a) || b.lastSpot;
  const dte = (b.expiry - Date.now()) / 864e5;

  let optPnl = 0, netDelta = 0, gotQuote = false;
  for (const leg of b.legs) {
    let markUsd: number, delta: number;
    if (dte <= ROLL_DTE) { // settle at intrinsic
      const intr = leg.type === "call" ? Math.max(spot - leg.strike, 0) : Math.max(leg.strike - spot, 0);
      markUsd = intr; delta = leg.type === "call" ? (spot > leg.strike ? 1 : 0) : (spot < leg.strike ? -1 : 0);
    } else {
      const t = await tickerOf(leg.name); if (!t || t.mark_price == null) continue; gotQuote = true;
      markUsd = usdPrice(a, t.mark_price, spot); delta = t.greeks?.delta ?? 0;
    }
    const dir = leg.side === "short" ? 1 : -1;
    optPnl += dir * (leg.entryUsd - markUsd) * b.qty;
    netDelta += (leg.side === "short" ? -1 : 1) * delta * b.qty;
  }

  // funding drag on the perp notional held since the last tick (conservative, always a cost)
  const nowMs = Date.now();
  const daysElapsed = b.lastTickMs ? Math.max(0, Math.min(2, (nowMs - b.lastTickMs) / 864e5)) : 0;
  b.feesUSD += Math.abs(b.perpQty) * spot * (FUNDING_ANN / 365) * daysElapsed;
  b.lastTickMs = nowMs;

  b.realizedHedgePnlUSD += b.perpQty * (spot - b.perpEntry);
  const newPerp = -netDelta;
  b.feesUSD += Math.abs(newPerp - b.perpQty) * spot * PERP_COST;
  b.perpQty = newPerp; b.perpEntry = spot; b.lastSpot = spot;

  const openEquity = CAPITAL + b.realizedPnlUSD + optPnl + b.realizedHedgePnlUSD - b.feesUSD;

  if (dte <= ROLL_DTE) { // crystallize this cycle (NET of fees) and roll into a fresh one
    b.realizedPnlUSD += optPnl + b.realizedHedgePnlUSD - b.feesUSD;
    b.cycles += 1;
    const fresh = await openBook(a);
    if (fresh) { fresh.realizedPnlUSD = b.realizedPnlUSD; fresh.cycles = b.cycles; b.books_replace = fresh as any; }
    return CAPITAL + b.realizedPnlUSD;
  }
  return openEquity;
}

export async function tickAll(): Promise<MultiState> {
  let s = load();
  if (!s) { s = { startedAt: new Date().toISOString(), books: {}, history: [] }; }
  const per: Record<string, number> = {};
  for (const a of ASSETS) {
    if (!s.books[a.sym]) { const b = await openBook(a); if (b) s.books[a.sym] = b; }
    const b = s.books[a.sym]; if (!b) { per[a.sym] = CAPITAL; continue; }
    const eq = await markBook(a, b);
    if ((b as any).books_replace) { s.books[a.sym] = (b as any).books_replace; }
    per[a.sym] = +eq.toFixed(2);
  }
  const total = +Object.values(per).reduce((x, y) => x + y, 0).toFixed(2);
  s.history.push({ ts: new Date().toISOString(), total, per });
  if (s.history.length > 400) s.history = s.history.slice(-400);
  save(s);
  return s;
}

export { CAPITAL };

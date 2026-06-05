/**
 * VRP PAPER ENGINE — virtual short-vol book on LIVE Deribit quotes.
 * No real money, no auth. State persisted to JSON (./data/vrp-paper.json).
 *
 * The book (sized conservatively, s≈0.01):
 *   • SELL an ATM straddle (call + put), ~30d expiry  → collect the premium
 *   • BUY an OTM put hedge (~25% OTM)                  → cap the crash tail
 *   • DELTA-HEDGE with a BTC perp each tick            → strip directional risk
 *
 * Fills are conservative: SELL at bid, BUY at ask (we cross the spread).
 * P&L is a coin-margined USD approximation (option price in BTC × spot).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "https://www.deribit.com/api/v2/public";
const STATE = process.env.VRP_STATE ?? "./data/vrp-paper.json";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const CAPITAL = 10_000;
export const SIZE_BTC = 0.1;
export const TARGET_DTE = 30;
export const HEDGE_OTM = 0.75;

async function api<T>(path: string): Promise<T | null> {
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(`${BASE}/${path}`); if (!r.ok) { await sleep(400); continue; }
      const j = (await r.json()) as { result?: T }; return j.result ?? null;
    } catch { await sleep(500 * (a + 1)); }
  }
  return null;
}

interface Instrument { instrument_name: string; strike: number; option_type: "call" | "put"; expiration_timestamp: number; }
interface Ticker {
  best_bid_price: number; best_ask_price: number; mark_price: number; mark_iv: number;
  open_interest: number; underlying_price: number; index_price: number; greeks?: { delta: number };
}
async function ticker(name: string) { const t = await api<Ticker>(`ticker?instrument_name=${name}`); await sleep(100); return t; }
async function spot(): Promise<number> { return (await api<{ index_price: number }>("get_index_price?index_name=btc_usd"))?.index_price ?? 0; }

export interface Leg {
  name: string; type: "call" | "put"; strike: number; side: "short" | "long";
  qty: number; entryFillBTC: number; entryIV: number;
}
export interface PaperState {
  openedAt: string; expiry: number; expiryDate: string; spotAtOpen: number;
  legs: Leg[];
  perpQtyBTC: number; perpEntry: number; realizedHedgePnlUSD: number;
  premiumCollectedUSD: number;
  history: Array<{ ts: string; spot: number; optionPnlUSD: number; hedgePnlUSD: number; equity: number; netDeltaBTC: number; dte: number }>;
}

function save(s: PaperState) { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2)); }
export function load(): PaperState | null { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null; }

export async function open(): Promise<PaperState> {
  const px = await spot();
  if (!px) throw new Error("no spot");
  const all = await api<Instrument[]>("get_instruments?currency=BTC&kind=option&expired=false");
  if (!all) throw new Error("no instruments");

  const now = Date.now();
  const expiries = [...new Set(all.map((i) => i.expiration_timestamp))].sort((a, b) => a - b);
  const target = now + TARGET_DTE * 864e5;
  const expiry = expiries.reduce((b, e) => Math.abs(e - target) < Math.abs(b - target) ? e : b, expiries[0]);
  const chain = all.filter((i) => i.expiration_timestamp === expiry);
  const strikes = [...new Set(chain.map((i) => i.strike))].sort((a, b) => a - b);
  const nearest = (t: number) => strikes.reduce((b, s) => Math.abs(s - t) < Math.abs(b - t) ? s : b, strikes[0]);

  const atmK = nearest(px), hedgeK = nearest(px * HEDGE_OTM);
  const find = (k: number, t: "call" | "put") => chain.find((i) => i.strike === k && i.option_type === t)!;
  const inst = { call: find(atmK, "call"), put: find(atmK, "put"), hedge: find(hedgeK, "put") };
  const [tc, tp, th] = await Promise.all([ticker(inst.call.instrument_name), ticker(inst.put.instrument_name), ticker(inst.hedge.instrument_name)]);
  if (!tc || !tp || !th) throw new Error("no quotes");

  const legs: Leg[] = [
    { name: inst.call.instrument_name, type: "call", strike: atmK, side: "short", qty: SIZE_BTC, entryFillBTC: tc.best_bid_price || tc.mark_price, entryIV: tc.mark_iv },
    { name: inst.put.instrument_name,  type: "put",  strike: atmK, side: "short", qty: SIZE_BTC, entryFillBTC: tp.best_bid_price || tp.mark_price, entryIV: tp.mark_iv },
    { name: inst.hedge.instrument_name, type: "put", strike: hedgeK, side: "long", qty: SIZE_BTC, entryFillBTC: th.best_ask_price || th.mark_price, entryIV: th.mark_iv },
  ];
  const premiumCollectedUSD = (legs[0].entryFillBTC + legs[1].entryFillBTC - legs[2].entryFillBTC) * SIZE_BTC * px;

  const netDelta = -(tc.greeks?.delta ?? 0.5) * SIZE_BTC - (tp.greeks?.delta ?? -0.5) * SIZE_BTC + (th.greeks?.delta ?? -0.04) * SIZE_BTC;
  const state: PaperState = {
    openedAt: new Date().toISOString(), expiry, expiryDate: new Date(expiry).toISOString().slice(0, 10), spotAtOpen: px,
    legs, perpQtyBTC: -netDelta, perpEntry: px, realizedHedgePnlUSD: 0, premiumCollectedUSD,
    history: [],
  };
  save(state);
  return state;
}

export async function tick(): Promise<{ state: PaperState; row: PaperState["history"][number] } | null> {
  const state = load();
  if (!state) return null;
  const px = await spot();
  const dte = (state.expiry - Date.now()) / 864e5;

  let optionPnlUSD = 0, netDeltaBTC = 0;
  for (const leg of state.legs) {
    const t = await ticker(leg.name);
    if (!t) continue;
    const mark = t.mark_price;
    const dir = leg.side === "short" ? 1 : -1;
    optionPnlUSD += dir * (leg.entryFillBTC - mark) * leg.qty * px;
    const d = t.greeks?.delta ?? 0;
    netDeltaBTC += (leg.side === "short" ? -1 : 1) * d * leg.qty;
  }

  const perpPnl = state.perpQtyBTC * (px - state.perpEntry);
  state.realizedHedgePnlUSD += perpPnl;
  state.perpQtyBTC = -netDeltaBTC;
  state.perpEntry = px;

  const hedgePnlUSD = state.realizedHedgePnlUSD;
  const equity = CAPITAL + optionPnlUSD + hedgePnlUSD;
  const row = { ts: new Date().toISOString(), spot: px, optionPnlUSD, hedgePnlUSD, equity, netDeltaBTC, dte };
  state.history.push(row);
  save(state);
  return { state, row };
}

export function fmtUSD(n: number) { return (n >= 0 ? "+$" : "-$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); }

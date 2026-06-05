# calmar-vrp-paper

Virtual **short-volatility (VRP) book** on **live Deribit quotes**. No real money, no auth.

## The book (sized conservatively, s≈0.01 on $10k)

- **SELL** an ATM BTC straddle (call + put), ~30d expiry → collect the premium
- **BUY** a deep OTM put hedge (~25% OTM) → cap the crash tail
- **DELTA-HEDGE** with a BTC perp each tick → strip directional risk

Fills are conservative: sell at bid, buy at ask (we cross the spread).

## How it runs

`.github/workflows/tick.yml` marks the book to market **every hour** and commits the
updated `data/vrp-paper.json` back to the repo. The history accumulates there.

## Local

```bash
npm install
npm run open     # open a fresh position at live prices
npm run tick     # mark to market + re-hedge, append a row
npm run status   # show current state
```

## Why

This is the live demo of the one strategy that survived full falsification:
the Volatility Risk Premium is structural (IV > RV), survives the 2021–2022 crashes
when tail-hedged, and the hedge is real and cheap on the live Deribit book.
The paper account is the proof-before-money step.

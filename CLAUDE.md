# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains two applications:

1. **Original Prototype** (`xrp-dashboard-v9-mtf.html`) - Single-file XRP trading dashboard with multi-timeframe analysis
2. **SmartBeatCrypto** (`kraken-tax/`) - Full Next.js application with trading dashboard AND tax reporting for Estonian tax compliance

## Important Instructions

**DO NOT run `npm run dev` yourself** - The user manages the dev server. Just make code changes and the user will test them.

## Running the Applications

### Original Prototype
Open `xrp-dashboard-v9-mtf.html` directly in a browser. No server required.

### SmartBeatCrypto (Next.js)
```bash
cd kraken-tax
npm run dev
```
Runs on http://localhost:4000 by default.

## SmartBeatCrypto Architecture

### Trading Section (`/trading`)
Multi-timeframe XRP trading analysis migrated from the prototype.

**Key Files:**
- `src/app/trading/page.tsx` - Trading dashboard UI
- `src/lib/trading/indicators.ts` - Technical indicator calculations (RSI, MACD, BB, ATR, Volume)
- `src/lib/trading/recommendation.ts` - Signal generation logic

**Trading Logic (same as prototype):**
- 4H timeframe determines trend (40% weight)
- 1H confirms setup (30% weight)
- 15m times entry (20% weight)
- 5m detects volume spikes (10% weight)
- Requires 5/6 conditions for entry signal

### Tax Section (`/tax`)
Estonian tax compliance for Kraken trading data.

**Key Files:**
- `src/app/tax/page.tsx` - Tax overview with summary
- `src/app/tax/transactions/page.tsx` - Transaction views (Raw, Positions, Ledger)
- `src/app/api/tax/summary/route.ts` - Tax calculation API
- `src/lib/tax/estonia-rules.ts` - Estonian tax rules (24% rate, losses not deductible)

**Important Tax Logic:**
- Margin P&L must be grouped by `krakenOrderId` to avoid double-counting fills
- Only count P&L from trades where `posstatus='closed'`
- Estonian law: Gains taxed at 24%, losses NOT deductible

### API Structure
- `/api/kraken/public/*` - Kraken public API proxies (ticker, OHLC)
- `/api/kraken/private/*` - Kraken private API (balance, trades, ledgers)
- `/api/transactions/*` - Transaction queries and aggregations
- `/api/tax/*` - Tax calculations
- `/api/status` - Connection status check

### Database
SQLite with Prisma ORM. Schema at `prisma/schema.prisma`.

## External Dependencies

**Trading:**
- Kraken Public API for market data

**Tax:**
- Kraken Private API (requires API keys in `.env`)
- SQLite for transaction storage

## Environment Variables

```
KRAKEN_API_KEY=your_api_key
KRAKEN_PRIVATE_KEY=your_private_key
DATABASE_URL="file:./data/smartbeat-crypto.db"
```

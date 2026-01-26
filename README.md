# SmartBeatCrypto

Trading Assistant & Tax Reporting Engine for Estonian Crypto Traders

A Next.js application that combines real-time trading analysis with Estonian tax compliance reporting for Kraken exchange users.

## Features

### Trading Assistant
- **Multi-Timeframe Analysis** - 4H, 1H, 15m, 5m timeframe monitoring
- **Technical Indicators** - RSI, MACD, Bollinger Bands, ATR, Volume analysis
- **Trading Signals** - LONG/SHORT/WAIT recommendations with confidence scores
- **Entry Checklist** - 6-point verification before trades
- **Position Calculator** - Size, TP/SL, and DCA levels

### Tax Reporting
- **Annual Data Import** - Sync trades by tax year (2024, 2025, etc.)
- **Spot & Margin Support** - Both trade types properly categorized
- **FIFO Cost Basis** - First In, First Out calculation (Estonian standard)
- **Table 8.3 Export** - Estonian tax declaration format
- **Estonian Tax Rules** - 24% rate, no loss deduction compliance

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Kraken account with API access

### Installation

```bash
# Clone/navigate to the project
cd smartbeat-crypto

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Add your Kraken API keys to .env.local
# KRAKEN_API_KEY=your_key
# KRAKEN_PRIVATE_KEY=your_private_key

# Initialize database
npm run db:push

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Configuration

### Environment Variables

Create `.env.local` with:

```bash
# Kraken API (required)
KRAKEN_API_KEY=your_api_key
KRAKEN_PRIVATE_KEY=your_private_key

# Database (auto-created)
DATABASE_URL="file:./data/smartbeat-crypto.db"

# Optional
OPENAI_API_KEY=sk-...  # For AI analysis features
```

### Kraken API Setup

1. Go to [Kraken API Settings](https://pro.kraken.com/app/settings/api)
2. Create new API key with permissions:
   - **Query Funds** - Account balance
   - **Query Open Orders & Trades** - Trading history
   - **Query Closed Orders & Trades** - Historical trades
   - **Query Ledger Entries** - Deposits, withdrawals, staking
   - **Export Data** - Bulk data export
3. For trading features, also enable:
   - **Create & Modify Orders**
   - **Cancel/Close Orders**

> **Note:** The same API key works for both spot and margin trading data. Margin features require Intermediate or Pro verification on Kraken.

## Usage

### Import Trading Data

1. Go to **Import** tab
2. Select tax year (e.g., 2024)
3. Choose trade types (Spot, Margin, or both)
4. Click "Sync All Data"

Data is stored locally in SQLite - nothing leaves your machine.

### View Tax Summary

1. Go to **Tax Reports** tab
2. Select tax year
3. View breakdown:
   - Trading gains (spot)
   - Margin trading gains
   - Staking rewards
   - **Total taxable amount** (gains only - losses NOT deductible in Estonia)

### Generate Reports

1. Go to **Reports** page
2. Export options:
   - **Table 8.3 (Text)** - For manual entry in e-MTA
   - **Full Report (CSV)** - For accountant review

### Trading Dashboard

1. Go to **Trading** tab
2. Real-time XRP/EUR analysis
3. Wait for 5/6 checklist conditions
4. Use position calculator for sizing
5. LONG/SHORT buttons open Kraken Pro

## Estonian Tax Rules

| Rule | Details |
|------|---------|
| **Tax Rate** | 24% income tax (from 2026, was 22%) |
| **Loss Deduction** | ❌ NOT allowed in Estonia |
| **Cost Basis** | FIFO (First In, First Out) |
| **Reporting** | Table 8.3 (foreign income - Kraken is US company) |
| **Taxable Events** | Trade profits, margin gains, staking rewards |
| **Non-Taxable** | Holding, deposits, withdrawals, transfers |

### Important Notes

- **Only gains are taxed** - If you have €1000 gains and €500 losses, you pay tax on €1000
- **Kraken = Foreign Income** - Report on Table 8.3, not Table 8.1
- **Keep Records** - Store exports for 7 years minimum
- **DAC8/CARF** - From 2026, exchanges report to Estonian Tax Authority

## Project Structure

```
smartbeat-crypto/
├── src/
│   ├── app/                    # Next.js pages
│   │   ├── trading/           # Trading dashboard
│   │   ├── tax/               # Tax reports
│   │   └── api/               # API routes
│   ├── lib/
│   │   ├── kraken/            # Kraken API client
│   │   ├── tax/               # Tax calculations
│   │   └── trading/           # Indicators
│   └── components/            # React components
├── prisma/
│   └── schema.prisma          # Database schema
└── .env.local                 # Configuration
```

## Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run db:push      # Push schema to database
npm run db:studio    # Open Prisma Studio
```

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: SQLite via Prisma
- **Charts**: Chart.js + react-chartjs-2
- **State**: React hooks + SWR

## Disclaimer

This software is for informational purposes only. It is not financial or tax advice. Always consult a qualified tax professional for your specific situation. The developers are not responsible for any errors in tax calculations or reporting.

## License

MIT

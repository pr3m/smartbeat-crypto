import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import * as XLSX from 'xlsx';

/**
 * GET /api/tax/report/business - Generate Excel report for business accounting
 *
 * Produces a multi-sheet Excel workbook with:
 * 1. Summary - P&L overview
 * 2. Positions - Grouped trading positions (using same logic as Positions tab)
 * 3. Fees - Rollover fees and trading costs
 * 4. Balance - Asset holdings at period end with EUR values
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    // Fetch positions using the SAME logic as the frontend Positions tab
    const positionsResponse = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:4000'}/api/transactions/positions?year=${year}`,
      { cache: 'no-store' }
    );
    const positionsData = await positionsResponse.json();

    // Fetch all transactions for fees breakdown
    const transactions = await prisma.transaction.findMany({
      where: {
        timestamp: { gte: yearStart, lte: yearEnd },
      },
      orderBy: { timestamp: 'asc' },
    });

    // === SHEET 1: POSITIONS (from API - same as frontend) ===
    const positions = buildPositionsSheetFromApi(positionsData.positions || [], year);

    // === SHEET 2: FEES (Rollovers, Trading Fees) ===
    const fees = buildFeesSheet(transactions);

    // === SHEET 3: BALANCE (Asset Holdings with EUR values) ===
    const balance = await buildBalanceSheet(yearEnd);

    // === SHEET 4: SUMMARY ===
    const summary = buildSummarySheet(positions, fees, positionsData.summary, year);

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Add sheets in logical order
    XLSX.utils.book_append_sheet(workbook, summary.sheet, 'Summary');
    XLSX.utils.book_append_sheet(workbook, positions.sheet, 'Positions');
    XLSX.utils.book_append_sheet(workbook, fees.sheet, 'Fees');
    XLSX.utils.book_append_sheet(workbook, balance.sheet, 'Balance');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="crypto-report-${year}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Generate business report error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate report' },
      { status: 500 }
    );
  }
}

// API Position interface (matches /api/transactions/positions response)
interface ApiPosition {
  id: string;
  pair: string;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED' | 'PARTIAL';
  entryTime: string;
  entryTrades: number;
  avgEntryPrice: number;
  totalEntryVolume: number;
  totalEntryCost: number;
  exitTime: string | null;
  exitTrades: number;
  avgExitPrice: number | null;
  totalExitVolume: number;
  totalExitProceeds: number;
  entryFees: number;
  exitFees: number;
  marginFees: number;
  totalFees: number;
  realizedPnL: number | null;
  pnlSource: 'kraken' | 'calculated';
}

interface PositionsResult {
  sheet: XLSX.WorkSheet;
  positions: ApiPosition[];
  totalPnL: number;
  totalFees: number;
}

function buildPositionsSheetFromApi(
  apiPositions: ApiPosition[],
  year: number
): PositionsResult {
  let totalPnL = 0;
  let totalFees = 0;

  // Calculate totals from API positions
  for (const pos of apiPositions) {
    if (pos.status === 'CLOSED' && pos.realizedPnL !== null) {
      totalPnL += pos.realizedPnL;
    }
    totalFees += pos.totalFees;
  }

  // Sort by entry time (most recent first for display)
  const sortedPositions = [...apiPositions].sort(
    (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
  );

  // Build sheet data - using (string | number)[][] for mixed content
  const sheetData: (string | number)[][] = [
    ['TRADING POSITIONS', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [`Tax Year: ${year}`, '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [
      'Entry Date',
      'Exit Date',
      'Pair',
      'Direction',
      'Status',
      'Volume',
      'Avg Entry (EUR)',
      'Avg Exit (EUR)',
      'Entry Cost (EUR)',
      'Exit Proceeds (EUR)',
      'Entry Fees',
      'Exit Fees',
      'Margin Fees',
      'Total Fees',
      'P&L (EUR)',
    ],
  ];

  for (const pos of sortedPositions) {
    sheetData.push([
      formatDate(new Date(pos.entryTime)),
      pos.exitTime ? formatDate(new Date(pos.exitTime)) : '',
      pos.pair,
      pos.direction,
      pos.status,
      pos.totalEntryVolume,
      pos.avgEntryPrice,
      pos.avgExitPrice ?? '',
      pos.totalEntryCost,
      pos.totalExitProceeds,
      pos.entryFees,
      pos.exitFees,
      pos.marginFees,
      pos.totalFees,
      pos.realizedPnL ?? '',
    ]);
  }

  // Add totals row
  const closedCount = sortedPositions.filter(p => p.status === 'CLOSED').length;
  const openCount = sortedPositions.filter(p => p.status === 'OPEN').length;
  sheetData.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  sheetData.push([
    'TOTALS',
    `${closedCount} closed, ${openCount} open`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    totalFees,
    totalPnL,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(sheetData);

  // Set column widths (15 columns to match header)
  sheet['!cols'] = [
    { wch: 12 }, // Entry Date
    { wch: 12 }, // Exit Date
    { wch: 12 }, // Pair
    { wch: 8 },  // Direction
    { wch: 8 },  // Status
    { wch: 14 }, // Volume
    { wch: 14 }, // Avg Entry (EUR)
    { wch: 14 }, // Avg Exit (EUR)
    { wch: 14 }, // Entry Cost (EUR)
    { wch: 14 }, // Exit Proceeds (EUR)
    { wch: 12 }, // Entry Fees
    { wch: 12 }, // Exit Fees
    { wch: 12 }, // Margin Fees
    { wch: 12 }, // Total Fees
    { wch: 14 }, // P&L (EUR)
  ];

  return { sheet, positions: apiPositions, totalPnL, totalFees };
}

interface FeesResult {
  sheet: XLSX.WorkSheet;
  totalRolloverFees: number;
  totalTradingFees: number;
}

function buildFeesSheet(
  transactions: Awaited<ReturnType<typeof prisma.transaction.findMany>>
): FeesResult {
  let totalRolloverFees = 0;
  let totalTradingFees = 0;

  const rolloverFees: Array<{ date: Date; pair: string; amount: number }> = [];
  const tradingFees: Array<{ date: Date; pair: string; type: string; amount: number }> = [];

  for (const tx of transactions) {
    if (tx.type === 'ROLLOVER') {
      const amount = Math.abs(tx.fee || tx.amount || 0);
      rolloverFees.push({
        date: tx.timestamp,
        pair: tx.pair || tx.asset,
        amount,
      });
      totalRolloverFees += amount;
    } else if (tx.fee && tx.fee > 0) {
      tradingFees.push({
        date: tx.timestamp,
        pair: tx.pair || tx.asset,
        type: tx.type,
        amount: tx.fee,
      });
      totalTradingFees += tx.fee;
    }
  }

  const sheetData: (string | number)[][] = [
    ['FEES & COSTS', '', '', ''],
    ['', '', '', ''],
    ['ROLLOVER FEES (Margin Interest)', '', '', ''],
    ['Date', 'Pair', 'Amount (EUR)', ''],
  ];

  for (const fee of rolloverFees) {
    sheetData.push([formatDate(fee.date), fee.pair, fee.amount, '']);
  }

  sheetData.push(['', '', '', '']);
  sheetData.push(['Rollover Total', '', totalRolloverFees, '']);
  sheetData.push(['', '', '', '']);
  sheetData.push(['TRADING FEES', '', '', '']);
  sheetData.push(['Date', 'Pair', 'Type', 'Amount (EUR)']);

  for (const fee of tradingFees) {
    sheetData.push([formatDate(fee.date), fee.pair, fee.type, fee.amount]);
  }

  sheetData.push(['', '', '', '']);
  sheetData.push(['Trading Fees Total', '', '', totalTradingFees]);
  sheetData.push(['', '', '', '']);
  sheetData.push(['TOTAL ALL FEES', '', '', totalRolloverFees + totalTradingFees]);

  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 12 }];

  return { sheet, totalRolloverFees, totalTradingFees };
}

interface BalanceResult {
  sheet: XLSX.WorkSheet;
  holdings: Array<{ asset: string; balance: number; eurValue: number; price: number }>;
  totalEurValue: number;
}

// Fetch EUR prices from Kraken for given assets
async function fetchEurPrices(assets: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  // Normalize asset names for Kraken pairs
  const assetMapping: Record<string, string> = {
    'XBT': 'XXBTZEUR',
    'BTC': 'XXBTZEUR',
    'XXBT': 'XXBTZEUR',
    'ETH': 'XETHZEUR',
    'XETH': 'XETHZEUR',
    'XRP': 'XXRPZEUR',
    'XXRP': 'XXRPZEUR',
    'SOL': 'SOLEUR',
    'DOT': 'DOTEUR',
    'ADA': 'ADAEUR',
    'LINK': 'LINKEUR',
    'MATIC': 'MATICEUR',
    'AVAX': 'AVAXEUR',
    'ATOM': 'ATOMEUR',
    'UNI': 'UNIEUR',
    'LTC': 'XLTCZEUR',
    'XLTC': 'XLTCZEUR',
    'BCH': 'BCHEUR',
    'DOGE': 'XDGEUR',
    'XDG': 'XDGEUR',
    'SHIB': 'SHIBEUR',
  };

  // Build list of pairs to fetch
  const pairs: string[] = [];
  for (const asset of assets) {
    const normalizedAsset = asset.replace(/^[XZ]/, '');
    const pair = assetMapping[asset] || assetMapping[normalizedAsset] || `${normalizedAsset}EUR`;
    if (!pairs.includes(pair)) {
      pairs.push(pair);
    }
  }

  if (pairs.length === 0) return prices;

  try {
    // Fetch from Kraken public ticker
    const response = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`,
      { cache: 'no-store' }
    );
    const data = await response.json();

    if (data.result) {
      // Map results back to original assets
      for (const asset of assets) {
        const normalizedAsset = asset.replace(/^[XZ]/, '');
        const pair = assetMapping[asset] || assetMapping[normalizedAsset] || `${normalizedAsset}EUR`;

        // Kraken returns pairs with different key formats, try variations
        const tickerData = data.result[pair] ||
          data.result[pair.replace('Z', '')] ||
          Object.values(data.result).find((v: unknown) =>
            typeof v === 'object' && v !== null && 'a' in v
          );

        if (tickerData && typeof tickerData === 'object' && 'a' in tickerData) {
          const ticker = tickerData as { a: string[] };
          // 'a' is the ask price array, first element is current price
          const price = parseFloat(ticker.a[0]);
          if (!isNaN(price)) {
            prices.set(asset, price);
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch EUR prices:', error);
  }

  return prices;
}

async function buildBalanceSheet(asOfDate: Date): Promise<BalanceResult> {
  // Calculate holdings by summing all transactions up to asOfDate
  const transactions = await prisma.transaction.findMany({
    where: {
      timestamp: { lte: asOfDate },
    },
    orderBy: { timestamp: 'asc' },
  });

  const balances = new Map<string, number>();

  for (const tx of transactions) {
    // Skip EUR - we only want crypto assets
    if (tx.asset === 'EUR' || tx.asset === 'ZEUR') continue;

    const current = balances.get(tx.asset) || 0;
    balances.set(tx.asset, current + tx.amount);
  }

  // Filter out zero/negligible balances
  const nonZeroAssets: string[] = [];
  for (const [asset, balance] of balances) {
    if (Math.abs(balance) >= 0.00000001) {
      nonZeroAssets.push(asset);
    }
  }

  // Fetch EUR prices for all assets
  const eurPrices = await fetchEurPrices(nonZeroAssets);

  // Build holdings with EUR values
  const holdings: Array<{ asset: string; balance: number; eurValue: number; price: number }> = [];
  let totalEurValue = 0;

  for (const [asset, balance] of balances) {
    if (Math.abs(balance) < 0.00000001) continue;

    const price = eurPrices.get(asset) || 0;
    const eurValue = balance * price;

    holdings.push({ asset, balance, eurValue, price });
    totalEurValue += eurValue;
  }

  // Sort by EUR value (largest first)
  holdings.sort((a, b) => Math.abs(b.eurValue) - Math.abs(a.eurValue));

  const sheetData: (string | number | string)[][] = [
    ['BALANCE SHEET', '', '', '', ''],
    [`As of: ${formatDate(asOfDate)}`, '', '', '', ''],
    ['', '', '', '', ''],
    ['Asset', 'Balance', 'Price (EUR)', 'EUR Value', 'Notes'],
  ];

  for (const holding of holdings) {
    sheetData.push([
      holding.asset,
      holding.balance,
      holding.price || 'N/A',
      holding.price ? holding.eurValue : 'N/A',
      holding.balance < 0 ? 'SHORT POSITION' : '',
    ]);
  }

  sheetData.push(['', '', '', '', '']);
  sheetData.push(['TOTAL EUR VALUE', '', '', totalEurValue || 'N/A', '']);
  sheetData.push(['', '', '', '', '']);
  sheetData.push(['Note: Prices are current market rates from Kraken', '', '', '', '']);
  sheetData.push(['For year-end accounting, verify prices match your records', '', '', '', '']);

  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet['!cols'] = [{ wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];

  return { sheet, holdings, totalEurValue };
}

interface SummaryResult {
  sheet: XLSX.WorkSheet;
}

interface ApiSummary {
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  totalRealizedPnL: number;
  totalFees: number;
  profitablePositions: number;
  losingPositions: number;
}

function buildSummarySheet(
  positions: PositionsResult,
  fees: FeesResult,
  apiSummary: ApiSummary | undefined,
  year: number
): SummaryResult {
  const closedPositions = positions.positions.filter(p => p.status === 'CLOSED');
  const openPositions = positions.positions.filter(p => p.status === 'OPEN');

  // Calculate gains/losses from positions with realizedPnL
  const totalGains = closedPositions
    .filter(p => p.realizedPnL !== null && p.realizedPnL > 0)
    .reduce((sum, p) => sum + (p.realizedPnL || 0), 0);
  const totalLosses = closedPositions
    .filter(p => p.realizedPnL !== null && p.realizedPnL < 0)
    .reduce((sum, p) => sum + Math.abs(p.realizedPnL || 0), 0);

  // Use API summary if available, otherwise fall back to calculated
  const netPnL = apiSummary?.totalRealizedPnL ?? positions.totalPnL;
  const totalFees = fees.totalRolloverFees + fees.totalTradingFees;
  const netResult = netPnL - totalFees;

  const sheetData: (string | number)[][] = [
    ['CRYPTO TRADING REPORT', ''],
    [`Tax Year: ${year}`, ''],
    [`Generated: ${formatDate(new Date())}`, ''],
    ['', ''],
    ['TRADING ACTIVITY', ''],
    ['Total Positions', positions.positions.length],
    ['Closed Positions', closedPositions.length],
    ['Open Positions', openPositions.length],
    ['', ''],
    ['PROFIT & LOSS', ''],
    ['Gross Gains', totalGains],
    ['Gross Losses', -totalLosses],
    ['Net Trading P&L', netPnL],
    ['', ''],
    ['FEES & COSTS', ''],
    ['Rollover Fees (Margin Interest)', -fees.totalRolloverFees],
    ['Trading Fees', -fees.totalTradingFees],
    ['Total Fees', -totalFees],
    ['', ''],
    ['NET RESULT', netResult],
    ['', ''],
    ['ESTONIAN TAX NOTES (Business/OÜ)', ''],
    ['Tax on Retained Profits', '0% (no immediate tax)'],
    ['Tax on Distribution', '~28% effective (22/78)'],
    ['', ''],
    ['All amounts in EUR', ''],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet['!cols'] = [{ wch: 35 }, { wch: 20 }];

  return { sheet };
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

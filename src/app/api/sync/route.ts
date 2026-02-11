import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncYear, isMarginTrade, type TradeInfoWithId } from '@/lib/kraken/sync';
import { categorizeTransaction, getTaxRate } from '@/lib/tax/estonia-rules';
import { syncManager } from '@/lib/sync/sync-manager';
import { cancelSync } from '@/lib/sync/global-sync';
import type { LedgerEntry, TransactionType } from '@/lib/kraken/types';

interface SyncRequest {
  mode?: 'year' | 'full' | 'incremental';  // New modes for global sync
  year?: number;                            // Required only for mode='year'
  includeSpot?: boolean;
  includeMargin?: boolean;
  fullResync?: boolean;                     // If true, delete and reimport all data for the year
  cancel?: boolean;                         // If true, cancel the current sync
}

/**
 * POST /api/sync - Sync data from Kraken
 *
 * Supports three modes:
 * - year: Sync specific year (legacy, requires year param)
 * - full: Full historical sync of all data
 * - incremental: Sync only new data since last sync
 */
export async function POST(request: NextRequest) {
  let syncLogId: string | null = null;

  try {
    const body: SyncRequest = await request.json();
    const {
      mode = 'year',
      year,
      includeSpot = true,
      includeMargin = true,
      fullResync = false,
      cancel = false,
    } = body;

    // Handle cancel request
    if (cancel) {
      await cancelSync();
      return NextResponse.json({ success: true, message: 'Sync cancelled' });
    }

    // Handle global sync modes (full or incremental)
    if (mode === 'full' || mode === 'incremental') {
      try {
        const result = await syncManager.triggerSync(mode);
        return NextResponse.json({
          success: result.success,
          mode: result.mode,
          summary: {
            tradesImported: result.tradesImported,
            tradesSkipped: result.tradesSkipped,
            ledgersImported: result.ledgersImported,
            ledgersSkipped: result.ledgersSkipped,
            totalImported: result.tradesImported + result.ledgersImported,
            totalSkipped: result.tradesSkipped + result.ledgersSkipped,
          },
          duration: result.duration,
          errors: result.errors.length > 0 ? result.errors : undefined,
        });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Sync failed' },
          { status: 500 }
        );
      }
    }

    // Legacy year-based sync
    if (!year || year < 2010 || year > new Date().getFullYear() + 1) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    // Create sync log entry
    const syncLog = await prisma.syncLog.create({
      data: {
        syncType: 'full',
        status: 'started',
      },
    });
    syncLogId = syncLog.id;

    // If full resync, delete existing data for this year
    if (fullResync) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59);

      // Delete tax events for this year first (due to foreign key)
      await prisma.taxEvent.deleteMany({
        where: { taxYear: year },
      });

      // Delete transactions for this year
      await prisma.transaction.deleteMany({
        where: {
          timestamp: {
            gte: yearStart,
            lte: yearEnd,
          },
        },
      });

      // Delete asset holdings from this year
      await prisma.assetHolding.deleteMany({
        where: {
          acquisitionDate: {
            gte: yearStart,
            lte: yearEnd,
          },
        },
      });
    }

    // Sync data from Kraken
    const syncResult = await syncYear(year, {
      includeSpot,
      includeMargin,
    });

    let recordsImported = 0;
    let recordsSkipped = 0;
    const errors: string[] = [...syncResult.errors];

    // Process trades
    const allTrades = [...syncResult.trades.spot, ...syncResult.trades.margin];
    for (const trade of allTrades) {
      try {
        const result = await upsertTrade(trade, year);
        if (result.created) {
          recordsImported++;
        } else {
          recordsSkipped++;
        }
      } catch (err) {
        errors.push(`Failed to import trade ${trade.ordertxid}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Process ledger entries
    for (const ledger of syncResult.ledgers.entries) {
      try {
        const result = await upsertLedgerEntry(ledger, year);
        if (result.created) {
          recordsImported++;
        } else {
          recordsSkipped++;
        }
      } catch (err) {
        errors.push(`Failed to import ledger ${ledger.refid}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Calculate tax events for the year
    await calculateTaxEventsForYear(year);

    // Update sync log
    await prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        recordsFound: allTrades.length + syncResult.ledgers.entries.length,
        recordsImported,
        recordsSkipped,
        completedAt: new Date(),
        error: errors.length > 0 ? errors.join('; ') : null,
      },
    });

    // Update settings with last sync time
    await prisma.settings.upsert({
      where: { id: 'default' },
      update: { lastSyncAt: new Date() },
      create: { id: 'default', lastSyncAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      year,
      summary: {
        tradesFound: allTrades.length,
        spotTrades: syncResult.trades.spot.length,
        marginTrades: syncResult.trades.margin.length,
        ledgerEntries: syncResult.ledgers.entries.length,
        recordsImported,
        recordsSkipped,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    // Update sync log with error
    if (syncLogId) {
      await prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    console.error('Sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sync - Get sync status and history
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');

    // Get recent sync logs
    const syncLogs = await prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
    });

    // Get transaction counts by year
    const transactionCounts = await prisma.transaction.groupBy({
      by: ['type'],
      _count: { id: true },
      where: year
        ? {
            timestamp: {
              gte: new Date(parseInt(year), 0, 1),
              lte: new Date(parseInt(year), 11, 31, 23, 59, 59),
            },
          }
        : undefined,
    });

    // Get settings
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    // Get years with data
    const yearsWithData = await getYearsWithData();

    return NextResponse.json({
      lastSyncAt: settings?.lastSyncAt,
      yearsWithData,
      transactionCounts,
      recentSyncs: syncLogs,
    });
  } catch (error) {
    console.error('Get sync status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get sync status' },
      { status: 500 }
    );
  }
}

/**
 * Upsert a trade into the database
 * Uses txid as the unique identifier (not ordertxid which can be shared by multiple fills)
 */
async function upsertTrade(trade: TradeInfoWithId, year: number): Promise<{ created: boolean }> {
  // Use the txid as the unique identifier - this is the trade's actual ID
  const krakenRefId = trade.txid;
  const isMargin = isMarginTrade(trade);

  // Check if already exists
  const existing = await prisma.transaction.findUnique({
    where: { krakenRefId },
  });

  if (existing) {
    // Update existing margin trades when close data becomes available
    // (trade synced while open, now closed with P&L data)
    if (isMargin && trade.posstatus === 'closed' && existing.posstatus !== 'closed') {
      const hasCloseDataUpdate = trade.cprice && parseFloat(trade.cprice) > 0;
      const netPnlUpdate = trade.net ? parseFloat(trade.net) : null;
      const closingTradeIdUpdate = trade.trades && trade.trades.length > 0 ? trade.trades[0] : null;

      await prisma.transaction.update({
        where: { krakenRefId },
        data: {
          posstatus: 'closed',
          closePrice: hasCloseDataUpdate ? parseFloat(trade.cprice!) : null,
          closeCost: trade.ccost ? parseFloat(trade.ccost) : null,
          closeFee: trade.cfee ? parseFloat(trade.cfee) : null,
          closeVolume: trade.cvol ? parseFloat(trade.cvol) : null,
          closeMargin: trade.cmargin ? parseFloat(trade.cmargin) : null,
          netPnl: netPnlUpdate,
          gain: netPnlUpdate,
          closingTradeId: closingTradeIdUpdate,
        },
      });
    }
    return { created: false };
  }

  const type = isMargin ? 'MARGIN_TRADE' : 'TRADE';
  const category = categorizeTransaction(type, parseFloat(trade.cost || '0'));
  const timestamp = new Date(trade.time * 1000);

  // Only import if within the target year
  if (timestamp.getFullYear() !== year) {
    return { created: false };
  }

  // Parse close data (present on opening trades when position is closed)
  const hasCloseData = trade.cprice && parseFloat(trade.cprice) > 0;

  // Parse net P&L from Kraken (this is the authoritative P&L)
  const netPnl = trade.net ? parseFloat(trade.net) : null;

  // Determine closing trade reference (from trades array)
  const closingTradeId = trade.trades && trade.trades.length > 0 ? trade.trades[0] : null;

  // Check if this is a closing trade (has "closing" in misc)
  const isClosingTrade = trade.misc?.includes('closing');

  await prisma.transaction.create({
    data: {
      krakenRefId,
      krakenOrderId: trade.ordertxid,
      type,
      category,
      asset: trade.pair?.replace(/EUR$|USD$|GBP$/, '') || 'UNKNOWN',
      amount: parseFloat(trade.vol) * (trade.type === 'sell' ? -1 : 1),
      pair: trade.pair,
      side: trade.type,
      price: parseFloat(trade.price),
      cost: parseFloat(trade.cost),
      fee: parseFloat(trade.fee),
      feeAsset: 'EUR',
      leverage: null,
      margin: trade.margin ? parseFloat(trade.margin) : null,

      // Position status and linking
      posstatus: trade.posstatus || null,
      positionTxId: trade.postxid || null,
      openingTradeId: isClosingTrade ? trade.postxid : null, // Closing trade references opening via postxid
      closingTradeId: closingTradeId,

      // Close data (from Kraken - only on opening trades)
      closePrice: hasCloseData ? parseFloat(trade.cprice!) : null,
      closeCost: trade.ccost ? parseFloat(trade.ccost) : null,
      closeFee: trade.cfee ? parseFloat(trade.cfee) : null,
      closeVolume: trade.cvol ? parseFloat(trade.cvol) : null,
      closeMargin: trade.cmargin ? parseFloat(trade.cmargin) : null,
      netPnl: netPnl, // Kraken's authoritative P&L!

      // Use Kraken's net P&L as the gain if available
      gain: netPnl,

      timestamp,
    },
  });

  // Create asset holding for buys (for FIFO tracking) - only for spot trades
  if (trade.type === 'buy' && !isMargin) {
    const asset = trade.pair?.replace(/EUR$|USD$|GBP$/, '') || 'UNKNOWN';
    const amount = parseFloat(trade.vol);
    const cost = parseFloat(trade.cost) + parseFloat(trade.fee);

    await prisma.assetHolding.create({
      data: {
        asset,
        amount,
        acquisitionDate: timestamp,
        acquisitionCost: cost,
        costPerUnit: cost / amount,
        remainingAmount: amount,
        transactionId: krakenRefId,
      },
    });
  }

  return { created: true };
}

/**
 * Upsert a ledger entry into the database
 */
async function upsertLedgerEntry(ledger: LedgerEntry, year: number): Promise<{ created: boolean }> {
  const krakenRefId = ledger.refid;

  // Skip if already exists
  const existing = await prisma.transaction.findUnique({
    where: { krakenRefId },
  });

  if (existing) {
    return { created: false };
  }

  const timestamp = new Date(ledger.time * 1000);

  // Only import if within the target year
  if (timestamp.getFullYear() !== year) {
    return { created: false };
  }

  // Map ledger type to our transaction type
  const typeMap: Record<string, TransactionType> = {
    deposit: 'DEPOSIT',
    withdrawal: 'WITHDRAWAL',
    trade: 'TRADE', // Already handled by trades import
    margin: 'MARGIN_TRADE',
    staking: 'STAKING_REWARD',
    dividend: 'STAKING_REWARD',
    transfer: 'TRANSFER',
    rollover: 'ROLLOVER',
    settled: 'MARGIN_SETTLEMENT',
    adjustment: 'ADJUSTMENT',
    // Kraken Earn and additional types
    earn: 'EARN_REWARD',        // Interest from Kraken Earn
    creator: 'EARN_ALLOCATION', // Earn allocation/lock/unlock
    credit: 'CREDIT',           // Credits/bonuses
    reward: 'STAKING_REWARD',   // Generic rewards
    nfttrade: 'NFT_TRADE',      // NFT transactions
    spend: 'SPEND',             // Spending crypto
    receive: 'RECEIVE',         // Receiving crypto
  };

  const type: TransactionType = typeMap[ledger.type] || 'ADJUSTMENT';

  // Skip trade ledger entries (we already have them from TradesHistory)
  if (ledger.type === 'trade' || ledger.type === 'margin') {
    return { created: false };
  }

  const amount = parseFloat(ledger.amount);
  const category = categorizeTransaction(type, amount);

  await prisma.transaction.create({
    data: {
      krakenRefId,
      type,
      category,
      asset: ledger.asset,
      amount,
      fee: parseFloat(ledger.fee),
      feeAsset: ledger.asset,
      timestamp,
    },
  });

  // Create asset holding for deposits and staking rewards
  if ((type === 'DEPOSIT' || type === 'STAKING_REWARD') && amount > 0 && ledger.asset !== 'EUR') {
    // For deposits, we need to estimate cost (assume 0 for now, user can adjust)
    // For staking rewards, this is income - the value at time of receipt
    await prisma.assetHolding.create({
      data: {
        asset: ledger.asset,
        amount,
        acquisitionDate: timestamp,
        acquisitionCost: 0, // User should update this
        costPerUnit: 0,
        remainingAmount: amount,
        transactionId: krakenRefId,
      },
    });
  }

  return { created: true };
}

/**
 * Calculate tax events for all disposals in a year using FIFO
 */
async function calculateTaxEventsForYear(year: number): Promise<void> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  const taxRate = getTaxRate(year);

  // Get all sell transactions for the year
  const sells = await prisma.transaction.findMany({
    where: {
      timestamp: { gte: yearStart, lte: yearEnd },
      side: 'sell',
      type: { in: ['TRADE', 'MARGIN_TRADE'] },
    },
    orderBy: { timestamp: 'asc' },
  });

  // Delete existing tax events for this year (recalculate fresh)
  await prisma.taxEvent.deleteMany({
    where: { taxYear: year },
  });

  for (const sell of sells) {
    const asset = sell.asset;
    let remainingToSell = Math.abs(sell.amount);
    const proceeds = sell.cost || 0;
    let totalCostBasis = 0;

    // Get available holdings for this asset (FIFO - oldest first)
    const holdings = await prisma.assetHolding.findMany({
      where: {
        asset,
        remainingAmount: { gt: 0 },
        acquisitionDate: { lt: sell.timestamp },
      },
      orderBy: { acquisitionDate: 'asc' },
    });

    for (const holding of holdings) {
      if (remainingToSell <= 0) break;

      const amountFromThisHolding = Math.min(remainingToSell, holding.remainingAmount);
      const costBasisPortion = amountFromThisHolding * holding.costPerUnit;
      totalCostBasis += costBasisPortion;

      // Update holding
      await prisma.assetHolding.update({
        where: { id: holding.id },
        data: {
          remainingAmount: holding.remainingAmount - amountFromThisHolding,
          isFullyDisposed: holding.remainingAmount - amountFromThisHolding <= 0.00000001,
        },
      });

      remainingToSell -= amountFromThisHolding;
    }

    // Calculate gain
    const gain = proceeds - totalCostBasis - (sell.fee || 0);
    const taxableAmount = gain > 0 ? gain : 0; // Estonia: only gains are taxable
    const taxDue = taxableAmount * taxRate;

    // Create tax event
    await prisma.taxEvent.create({
      data: {
        transactionId: sell.id,
        taxYear: year,
        acquisitionDate: holdings[0]?.acquisitionDate || sell.timestamp,
        acquisitionCost: totalCostBasis,
        disposalDate: sell.timestamp,
        disposalProceeds: proceeds,
        gain,
        taxableAmount,
        taxRate,
        taxDue,
        costBasisMethod: 'FIFO',
      },
    });

    // Update transaction with calculated values
    await prisma.transaction.update({
      where: { id: sell.id },
      data: {
        costBasis: totalCostBasis,
        proceeds,
        gain,
      },
    });
  }
}

/**
 * Get list of years that have transaction data
 */
async function getYearsWithData(): Promise<number[]> {
  const transactions = await prisma.transaction.findMany({
    select: { timestamp: true },
    orderBy: { timestamp: 'asc' },
  });

  if (transactions.length === 0) {
    return [new Date().getFullYear()];
  }

  const years = new Set<number>();
  for (const tx of transactions) {
    years.add(tx.timestamp.getFullYear());
  }

  return Array.from(years).sort((a, b) => b - a);
}

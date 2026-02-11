/**
 * Global Sync Service
 *
 * Handles global and incremental syncing of Kraken data.
 * Automatically determines what needs to be synced based on stored timestamps.
 * Uses Export API for large datasets (500+ records) for faster sync.
 */

import { prisma } from '@/lib/db';
import { krakenClient } from '@/lib/kraken/client';
import { krakenRateLimiter } from '@/lib/kraken/rate-limiter';
import { isMarginTrade, type TradeInfoWithId } from '@/lib/kraken/sync';
import { categorizeTransaction } from '@/lib/tax/estonia-rules';
import { fetchViaExport, shouldUseExport, EXPORT_THRESHOLD } from './export-sync';
import type { LedgerEntry, TransactionType, TradeInfo } from '@/lib/kraken/types';

export interface SyncProgress {
  phase: 'initializing' | 'trades' | 'ledgers' | 'processing' | 'complete' | 'error';
  current: number;
  total: number;
  message: string;
}

export interface GlobalSyncOptions {
  mode: 'full' | 'incremental';
  onProgress?: (progress: SyncProgress) => void;
  signal?: AbortSignal;
}

export interface SyncResult {
  success: boolean;
  mode: 'full' | 'incremental';
  tradesImported: number;
  tradesSkipped: number;
  ledgersImported: number;
  ledgersSkipped: number;
  errors: string[];
  duration: number;
  fromTimestamp?: Date;
  toTimestamp?: Date;
}

/**
 * Get last synced timestamps from settings
 */
export async function getLastSyncedTimestamps(): Promise<{
  trade: Date | null;
  ledger: Date | null;
  lastSyncAt: Date | null;
}> {
  const settings = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: {
      lastTradeTimestamp: true,
      lastLedgerTimestamp: true,
      lastSyncAt: true,
    },
  });

  return {
    trade: settings?.lastTradeTimestamp || null,
    ledger: settings?.lastLedgerTimestamp || null,
    lastSyncAt: settings?.lastSyncAt || null,
  };
}

/**
 * Check if a sync is currently in progress
 */
export async function isSyncInProgress(): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: { syncInProgress: true },
  });

  return settings?.syncInProgress || false;
}

/**
 * Perform global sync - either full historical sync or incremental
 */
export async function performGlobalSync(
  options: GlobalSyncOptions = { mode: 'incremental' }
): Promise<SyncResult> {
  const { mode, onProgress, signal } = options;
  const startTime = Date.now();
  const errors: string[] = [];

  let syncLogId: string | null = null;
  let tradesImported = 0;
  let tradesSkipped = 0;
  let ledgersImported = 0;
  let ledgersSkipped = 0;
  let fromTimestamp: Date | undefined;
  let toTimestamp: Date | undefined;

  const updateProgress = (progress: SyncProgress) => {
    onProgress?.(progress);

    // Update sync log progress in DB (fire and forget)
    if (syncLogId) {
      prisma.syncLog.update({
        where: { id: syncLogId },
        data: { progress: JSON.stringify(progress) },
      }).catch(() => {/* ignore errors */});
    }
  };

  try {
    // Check if sync is already in progress
    if (await isSyncInProgress()) {
      throw new Error('A sync is already in progress');
    }

    // Create sync log and mark sync as in progress
    const syncLog = await prisma.syncLog.create({
      data: {
        syncType: 'global',
        syncMode: mode,
        status: 'started',
      },
    });
    syncLogId = syncLog.id;

    await prisma.settings.upsert({
      where: { id: 'default' },
      update: {
        syncInProgress: true,
        currentSyncId: syncLogId,
      },
      create: {
        id: 'default',
        syncInProgress: true,
        currentSyncId: syncLogId,
      },
    });

    updateProgress({
      phase: 'initializing',
      current: 0,
      total: 100,
      message: 'Preparing sync...',
    });

    // Determine time range based on mode
    const { trade: lastTradeTs, ledger: lastLedgerTs } = await getLastSyncedTimestamps();

    if (mode === 'full') {
      // Full sync: from epoch to now
      fromTimestamp = undefined;
      toTimestamp = new Date();
    } else {
      // Incremental: from last synced timestamp to now
      // Use the older of the two timestamps to ensure we don't miss anything
      const lastTs = lastTradeTs && lastLedgerTs
        ? new Date(Math.min(lastTradeTs.getTime(), lastLedgerTs.getTime()))
        : lastTradeTs || lastLedgerTs;

      if (lastTs) {
        // Go back 1 hour to account for any delayed records
        fromTimestamp = new Date(lastTs.getTime() - 60 * 60 * 1000);
      }
      toTimestamp = new Date();
    }

    // Convert to Unix timestamps for Kraken API
    const startUnix = fromTimestamp ? Math.floor(fromTimestamp.getTime() / 1000) : undefined;
    const endUnix = Math.floor((toTimestamp?.getTime() || Date.now()) / 1000);

    // Check for abort
    if (signal?.aborted) {
      throw new Error('Sync cancelled');
    }

    // === SYNC TRADES ===
    updateProgress({
      phase: 'trades',
      current: 0,
      total: 100,
      message: 'Checking trades count...',
    });

    let allTrades: Record<string, TradeInfo> = {};

    // Check if we should use Export API (for large datasets)
    const useTradeExport = mode === 'full' || await shouldUseExport('trades', startUnix, endUnix);

    if (useTradeExport) {
      // Use Export API for faster bulk fetch
      updateProgress({
        phase: 'trades',
        current: 0,
        total: 100,
        message: `Using bulk export (>${EXPORT_THRESHOLD} trades)...`,
      });

      try {
        allTrades = await fetchViaExport({
          type: 'trades',
          startTime: startUnix,
          endTime: endUnix,
          signal,
          onProgress: (exportProgress) => {
            updateProgress({
              phase: 'trades',
              current: exportProgress.phase === 'complete' ? 100 : 50,
              total: 100,
              message: exportProgress.message,
            });
          },
        });
      } catch (exportErr) {
        console.warn('[GlobalSync] Export failed, falling back to pagination:', exportErr);
        // Fall back to pagination if export fails
        allTrades = await fetchTradesPaginated(startUnix, endUnix, signal, updateProgress);
      }
    } else {
      // Use paginated API for smaller datasets
      allTrades = await fetchTradesPaginated(startUnix, endUnix, signal, updateProgress);
    }

    // Check for abort
    if (signal?.aborted) {
      throw new Error('Sync cancelled');
    }

    // === SYNC LEDGERS ===
    updateProgress({
      phase: 'ledgers',
      current: 0,
      total: 100,
      message: 'Checking ledger count...',
    });

    let allLedgers: Record<string, LedgerEntry> = {};

    // Check if we should use Export API (for large datasets)
    const useLedgerExport = mode === 'full' || await shouldUseExport('ledgers', startUnix, endUnix);

    if (useLedgerExport) {
      // Use Export API for faster bulk fetch
      updateProgress({
        phase: 'ledgers',
        current: 0,
        total: 100,
        message: `Using bulk export (>${EXPORT_THRESHOLD} ledgers)...`,
      });

      try {
        allLedgers = await fetchViaExport({
          type: 'ledgers',
          startTime: startUnix,
          endTime: endUnix,
          signal,
          onProgress: (exportProgress) => {
            updateProgress({
              phase: 'ledgers',
              current: exportProgress.phase === 'complete' ? 100 : 50,
              total: 100,
              message: exportProgress.message,
            });
          },
        });
      } catch (exportErr) {
        console.warn('[GlobalSync] Export failed, falling back to pagination:', exportErr);
        // Fall back to pagination if export fails
        allLedgers = await fetchLedgersPaginated(startUnix, endUnix, signal, updateProgress);
      }
    } else {
      // Use paginated API for smaller datasets
      allLedgers = await fetchLedgersPaginated(startUnix, endUnix, signal, updateProgress);
    }

    updateProgress({
      phase: 'ledgers',
      current: Object.keys(allLedgers).length,
      total: Object.keys(allLedgers).length,
      message: `Fetched ${Object.keys(allLedgers).length} ledger entries`,
    });

    // Check for abort
    if (signal?.aborted) {
      throw new Error('Sync cancelled');
    }

    // === PROCESS TRADES ===
    updateProgress({
      phase: 'processing',
      current: 0,
      total: Object.keys(allTrades).length + Object.keys(allLedgers).length,
      message: 'Processing trades...',
    });

    let newestTradeTs: Date | null = null;
    let processedCount = 0;

    for (const [txid, trade] of Object.entries(allTrades)) {
      if (signal?.aborted) {
        throw new Error('Sync cancelled');
      }

      try {
        const tradeWithId: TradeInfoWithId = { ...trade, txid };
        const result = await upsertTrade(tradeWithId);

        if (result.created) {
          tradesImported++;
        } else {
          tradesSkipped++;
        }

        // Track newest trade timestamp
        const tradeTime = new Date(trade.time * 1000);
        if (!newestTradeTs || tradeTime > newestTradeTs) {
          newestTradeTs = tradeTime;
        }
      } catch (err) {
        errors.push(`Trade ${txid}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      processedCount++;
      if (processedCount % 50 === 0) {
        updateProgress({
          phase: 'processing',
          current: processedCount,
          total: Object.keys(allTrades).length + Object.keys(allLedgers).length,
          message: `Processed ${processedCount} records...`,
        });
      }
    }

    // === PROCESS LEDGERS ===
    let newestLedgerTs: Date | null = null;

    for (const [, ledger] of Object.entries(allLedgers)) {
      if (signal?.aborted) {
        throw new Error('Sync cancelled');
      }

      try {
        const result = await upsertLedgerEntry(ledger);

        if (result.created) {
          ledgersImported++;
        } else {
          ledgersSkipped++;
        }

        // Track newest ledger timestamp
        const ledgerTime = new Date(ledger.time * 1000);
        if (!newestLedgerTs || ledgerTime > newestLedgerTs) {
          newestLedgerTs = ledgerTime;
        }
      } catch (err) {
        errors.push(`Ledger ${ledger.refid}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      processedCount++;
      if (processedCount % 50 === 0) {
        updateProgress({
          phase: 'processing',
          current: processedCount,
          total: Object.keys(allTrades).length + Object.keys(allLedgers).length,
          message: `Processed ${processedCount} records...`,
        });
      }
    }

    // === UPDATE TIMESTAMPS ===
    await prisma.settings.update({
      where: { id: 'default' },
      data: {
        lastSyncAt: new Date(),
        lastTradeTimestamp: newestTradeTs || undefined,
        lastLedgerTimestamp: newestLedgerTs || undefined,
        syncInProgress: false,
        currentSyncId: null,
      },
    });

    // Update sync log
    await prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        completedAt: new Date(),
        recordsFound: Object.keys(allTrades).length + Object.keys(allLedgers).length,
        recordsImported: tradesImported + ledgersImported,
        recordsSkipped: tradesSkipped + ledgersSkipped,
        tradesProcessed: tradesImported + tradesSkipped,
        ledgersProcessed: ledgersImported + ledgersSkipped,
        fromTimestamp: fromTimestamp || undefined,
        toTimestamp: toTimestamp || undefined,
        error: errors.length > 0 ? errors.slice(0, 10).join('; ') : null,
        progress: JSON.stringify({
          phase: 'complete',
          current: processedCount,
          total: processedCount,
          message: 'Sync completed',
        }),
      },
    });

    updateProgress({
      phase: 'complete',
      current: 100,
      total: 100,
      message: `Sync complete. Imported ${tradesImported} trades and ${ledgersImported} ledger entries.`,
    });

    return {
      success: true,
      mode,
      tradesImported,
      tradesSkipped,
      ledgersImported,
      ledgersSkipped,
      errors,
      duration: Date.now() - startTime,
      fromTimestamp,
      toTimestamp,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update settings to clear sync flag
    await prisma.settings.update({
      where: { id: 'default' },
      data: {
        syncInProgress: false,
        currentSyncId: null,
      },
    }).catch(() => {/* ignore */});

    // Update sync log with error
    if (syncLogId) {
      await prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          error: errorMessage,
          progress: JSON.stringify({
            phase: 'error',
            current: 0,
            total: 0,
            message: errorMessage,
          }),
        },
      }).catch(() => {/* ignore */});
    }

    updateProgress({
      phase: 'error',
      current: 0,
      total: 0,
      message: errorMessage,
    });

    return {
      success: false,
      mode,
      tradesImported,
      tradesSkipped,
      ledgersImported,
      ledgersSkipped,
      errors: [...errors, errorMessage],
      duration: Date.now() - startTime,
      fromTimestamp,
      toTimestamp,
    };
  }
}

/**
 * Cancel an in-progress sync
 */
export async function cancelSync(): Promise<void> {
  const settings = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: { currentSyncId: true },
  });

  if (settings?.currentSyncId) {
    await prisma.syncLog.update({
      where: { id: settings.currentSyncId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        error: 'Sync was cancelled by user',
      },
    }).catch(() => {/* ignore if log doesn't exist */});
  }

  await prisma.settings.update({
    where: { id: 'default' },
    data: {
      syncInProgress: false,
      currentSyncId: null,
    },
  });
}

/**
 * Recover from interrupted syncs (call on startup)
 */
export async function recoverFromInterruptedSync(): Promise<void> {
  const settings = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: { syncInProgress: true, currentSyncId: true },
  });

  if (settings?.syncInProgress) {
    console.log('Recovering from interrupted sync...');

    // Mark the interrupted sync as failed
    if (settings.currentSyncId) {
      await prisma.syncLog.update({
        where: { id: settings.currentSyncId },
        data: {
          status: 'interrupted',
          completedAt: new Date(),
          error: 'Sync was interrupted (app restart)',
        },
      }).catch(() => {/* ignore if log doesn't exist */});
    }

    // Clear the sync flag
    await prisma.settings.update({
      where: { id: 'default' },
      data: {
        syncInProgress: false,
        currentSyncId: null,
      },
    });
  }
}

// ==================== PRIVATE HELPERS ====================

/**
 * Upsert a trade into the database
 */
async function upsertTrade(trade: TradeInfoWithId): Promise<{ created: boolean }> {
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
      const hasCloseData = trade.cprice && parseFloat(trade.cprice) > 0;
      const netPnl = trade.net ? parseFloat(trade.net) : null;
      const closingTradeId = trade.trades && trade.trades.length > 0 ? trade.trades[0] : null;

      await prisma.transaction.update({
        where: { krakenRefId },
        data: {
          posstatus: 'closed',
          closePrice: hasCloseData ? parseFloat(trade.cprice!) : null,
          closeCost: trade.ccost ? parseFloat(trade.ccost) : null,
          closeFee: trade.cfee ? parseFloat(trade.cfee) : null,
          closeVolume: trade.cvol ? parseFloat(trade.cvol) : null,
          closeMargin: trade.cmargin ? parseFloat(trade.cmargin) : null,
          netPnl,
          gain: netPnl,
          closingTradeId,
        },
      });
    }
    return { created: false };
  }

  const type = isMargin ? 'MARGIN_TRADE' : 'TRADE';
  const category = categorizeTransaction(type, parseFloat(trade.cost || '0'));
  const timestamp = new Date(trade.time * 1000);

  // Parse close data
  const hasCloseData = trade.cprice && parseFloat(trade.cprice) > 0;
  const netPnl = trade.net ? parseFloat(trade.net) : null;
  const closingTradeId = trade.trades && trade.trades.length > 0 ? trade.trades[0] : null;
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
      posstatus: trade.posstatus || null,
      positionTxId: trade.postxid || null,
      openingTradeId: isClosingTrade ? trade.postxid : null,
      closingTradeId: closingTradeId,
      closePrice: hasCloseData ? parseFloat(trade.cprice!) : null,
      closeCost: trade.ccost ? parseFloat(trade.ccost) : null,
      closeFee: trade.cfee ? parseFloat(trade.cfee) : null,
      closeVolume: trade.cvol ? parseFloat(trade.cvol) : null,
      closeMargin: trade.cmargin ? parseFloat(trade.cmargin) : null,
      netPnl: netPnl,
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
async function upsertLedgerEntry(ledger: LedgerEntry): Promise<{ created: boolean }> {
  const krakenRefId = ledger.refid;

  // Skip if already exists
  const existing = await prisma.transaction.findUnique({
    where: { krakenRefId },
  });

  if (existing) {
    return { created: false };
  }

  const timestamp = new Date(ledger.time * 1000);

  // Map ledger type to transaction type
  const typeMap: Record<string, TransactionType> = {
    deposit: 'DEPOSIT',
    withdrawal: 'WITHDRAWAL',
    trade: 'TRADE',
    margin: 'MARGIN_TRADE',
    staking: 'STAKING_REWARD',
    dividend: 'STAKING_REWARD',
    transfer: 'TRANSFER',
    rollover: 'ROLLOVER',
    settled: 'MARGIN_SETTLEMENT',
    adjustment: 'ADJUSTMENT',
    earn: 'EARN_REWARD',
    creator: 'EARN_ALLOCATION',
    credit: 'CREDIT',
    reward: 'STAKING_REWARD',
    nfttrade: 'NFT_TRADE',
    spend: 'SPEND',
    receive: 'RECEIVE',
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
    await prisma.assetHolding.create({
      data: {
        asset: ledger.asset,
        amount,
        acquisitionDate: timestamp,
        acquisitionCost: 0,
        costPerUnit: 0,
        remainingAmount: amount,
        transactionId: krakenRefId,
      },
    });
  }

  return { created: true };
}

// ==================== PAGINATED FETCH HELPERS ====================

/**
 * Fetch trades using paginated API (for smaller datasets)
 */
async function fetchTradesPaginated(
  startUnix: number | undefined,
  endUnix: number,
  signal: AbortSignal | undefined,
  updateProgress: (progress: SyncProgress) => void
): Promise<Record<string, TradeInfo>> {
  let allTrades: Record<string, TradeInfo> = {};
  let tradeOffset = 0;
  let tradeTotalCount = 0;

  do {
    if (signal?.aborted) {
      throw new Error('Sync cancelled');
    }

    const result = await krakenRateLimiter.executeWithRetry(
      () => krakenClient.getTradesHistory('all', true, startUnix, endUnix, tradeOffset),
      signal
    );

    allTrades = { ...allTrades, ...result.trades };
    tradeTotalCount = result.count;
    tradeOffset = Object.keys(allTrades).length;

    updateProgress({
      phase: 'trades',
      current: tradeOffset,
      total: tradeTotalCount || tradeOffset,
      message: `Fetched ${tradeOffset} of ${tradeTotalCount} trades...`,
    });
  } while (tradeOffset < tradeTotalCount);

  return allTrades;
}

/**
 * Fetch ledgers using paginated API (for smaller datasets)
 */
async function fetchLedgersPaginated(
  startUnix: number | undefined,
  endUnix: number,
  signal: AbortSignal | undefined,
  updateProgress: (progress: SyncProgress) => void
): Promise<Record<string, LedgerEntry>> {
  let allLedgers: Record<string, LedgerEntry> = {};
  let ledgerOffset = 0;
  let ledgerTotalCount = 0;

  do {
    if (signal?.aborted) {
      throw new Error('Sync cancelled');
    }

    const result = await krakenRateLimiter.executeWithRetry(
      () => krakenClient.getLedgers(undefined, 'currency', undefined, startUnix, endUnix, ledgerOffset),
      signal
    );

    allLedgers = { ...allLedgers, ...result.ledger };
    ledgerTotalCount = result.count;
    ledgerOffset = Object.keys(allLedgers).length;

    updateProgress({
      phase: 'ledgers',
      current: ledgerOffset,
      total: ledgerTotalCount || ledgerOffset,
      message: `Fetched ${ledgerOffset} of ${ledgerTotalCount} ledger entries...`,
    });
  } while (ledgerOffset < ledgerTotalCount);

  return allLedgers;
}

/**
 * Kraken Data Sync Service
 *
 * Handles syncing trades and ledger entries from Kraken API
 * with support for annual filtering and proper spot/margin categorization.
 */

import { krakenClient } from './client';
import type { TradeInfo, LedgerEntry } from './types';

// Extended TradeInfo that includes the txid from the API response key
export interface TradeInfoWithId extends TradeInfo {
  txid: string;
}

export interface SyncOptions {
  year?: number;
  startDate?: Date;
  endDate?: Date;
  includeSpot?: boolean;
  includeMargin?: boolean;
  onProgress?: (current: number, total: number, type: string) => void;
}

export interface SyncResult {
  trades: {
    spot: TradeInfoWithId[];
    margin: TradeInfoWithId[];
    total: number;
  };
  ledgers: {
    entries: LedgerEntry[];
    total: number;
  };
  dateRange: {
    start: Date;
    end: Date;
  };
  errors: string[];
}

/**
 * Get Unix timestamp for start of year
 */
export function getYearStartTimestamp(year: number): number {
  return Math.floor(new Date(year, 0, 1, 0, 0, 0).getTime() / 1000);
}

/**
 * Get Unix timestamp for end of year
 */
export function getYearEndTimestamp(year: number): number {
  return Math.floor(new Date(year, 11, 31, 23, 59, 59).getTime() / 1000);
}

/**
 * Determine if a trade is a margin trade
 */
export function isMarginTrade(trade: TradeInfo): boolean {
  // Margin trades have a non-zero margin field or leverage info
  return (
    parseFloat(trade.margin || '0') > 0 ||
    trade.misc?.includes('margin') ||
    trade.posstatus !== undefined
  );
}

/**
 * Categorize trades into spot and margin, preserving txid
 */
export function categorizeTrades(trades: Record<string, TradeInfo>): {
  spot: TradeInfoWithId[];
  margin: TradeInfoWithId[];
} {
  const spot: TradeInfoWithId[] = [];
  const margin: TradeInfoWithId[] = [];

  for (const [txid, trade] of Object.entries(trades)) {
    const tradeWithId: TradeInfoWithId = { ...trade, txid };
    if (isMarginTrade(trade)) {
      margin.push(tradeWithId);
    } else {
      spot.push(tradeWithId);
    }
  }

  // Sort by time
  spot.sort((a, b) => a.time - b.time);
  margin.sort((a, b) => a.time - b.time);

  return { spot, margin };
}

/**
 * Sync all data for a specific year
 */
export async function syncYear(
  year: number,
  options: Omit<SyncOptions, 'year'> = {}
): Promise<SyncResult> {
  const startTimestamp = getYearStartTimestamp(year);
  const endTimestamp = getYearEndTimestamp(year);

  return syncDateRange({
    ...options,
    startDate: new Date(startTimestamp * 1000),
    endDate: new Date(endTimestamp * 1000),
  });
}

/**
 * Sync data for a date range
 */
export async function syncDateRange(options: SyncOptions = {}): Promise<SyncResult> {
  const {
    startDate,
    endDate,
    includeSpot = true,
    includeMargin = true,
    onProgress,
  } = options;

  const errors: string[] = [];
  const start = startDate ? Math.floor(startDate.getTime() / 1000) : undefined;
  const end = endDate ? Math.floor(endDate.getTime() / 1000) : undefined;

  // Sync trades
  let allTrades: Record<string, TradeInfo> = {};
  try {
    onProgress?.(0, 100, 'trades');
    allTrades = await krakenClient.getAllTradesHistory(start, end, (current, total) => {
      onProgress?.(current, total, 'trades');
    });
  } catch (err) {
    errors.push(`Failed to sync trades: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Categorize trades
  const { spot, margin } = categorizeTrades(allTrades);

  // Filter based on options
  const filteredSpot = includeSpot ? spot : [];
  const filteredMargin = includeMargin ? margin : [];

  // Sync ledgers
  let allLedgers: Record<string, LedgerEntry> = {};
  try {
    onProgress?.(0, 100, 'ledgers');
    allLedgers = await krakenClient.getAllLedgers(start, end, (current, total) => {
      onProgress?.(current, total, 'ledgers');
    });
  } catch (err) {
    errors.push(`Failed to sync ledgers: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  const ledgerEntries = Object.values(allLedgers).sort((a, b) => a.time - b.time);

  return {
    trades: {
      spot: filteredSpot,
      margin: filteredMargin,
      total: filteredSpot.length + filteredMargin.length,
    },
    ledgers: {
      entries: ledgerEntries,
      total: ledgerEntries.length,
    },
    dateRange: {
      start: startDate || new Date(0),
      end: endDate || new Date(),
    },
    errors,
  };
}

/**
 * Get available years from existing data
 * (Checks what years have data in Kraken)
 */
export async function getAvailableYears(): Promise<number[]> {
  try {
    // Get the oldest trade to determine range
    const trades = await krakenClient.getTradesHistory('all', false, undefined, undefined, 0);

    if (!trades.trades || Object.keys(trades.trades).length === 0) {
      return [new Date().getFullYear()];
    }

    // Find min and max years
    const times = Object.values(trades.trades).map(t => t.time);
    const minYear = new Date(Math.min(...times) * 1000).getFullYear();
    const maxYear = new Date().getFullYear();

    const years: number[] = [];
    for (let y = maxYear; y >= minYear; y--) {
      years.push(y);
    }

    return years;
  } catch {
    // Return current and previous year as fallback
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear - 1, currentYear - 2];
  }
}

/**
 * Get summary statistics for synced data
 */
export function getSyncSummary(result: SyncResult): {
  spotTrades: number;
  marginTrades: number;
  totalTrades: number;
  deposits: number;
  withdrawals: number;
  stakingRewards: number;
  fees: number;
  totalLedgerEntries: number;
} {
  const ledgerCounts = {
    deposits: 0,
    withdrawals: 0,
    stakingRewards: 0,
    fees: 0,
  };

  for (const entry of result.ledgers.entries) {
    const amount = parseFloat(entry.amount);
    switch (entry.type) {
      case 'deposit':
        if (amount > 0) ledgerCounts.deposits++;
        break;
      case 'withdrawal':
        if (amount < 0) ledgerCounts.withdrawals++;
        break;
      case 'staking':
      case 'dividend':
        if (amount > 0) ledgerCounts.stakingRewards++;
        break;
      case 'trade':
        // Fees are recorded as separate ledger entries
        if (parseFloat(entry.fee) > 0) ledgerCounts.fees++;
        break;
    }
  }

  return {
    spotTrades: result.trades.spot.length,
    marginTrades: result.trades.margin.length,
    totalTrades: result.trades.total,
    ...ledgerCounts,
    totalLedgerEntries: result.ledgers.total,
  };
}

/**
 * Export-based Sync for Kraken
 *
 * Uses Kraken's Export API for fast bulk data fetching.
 * Much faster than pagination for large datasets (1000+ records).
 */

import { krakenClient } from '@/lib/kraken/client';
import { krakenRateLimiter } from '@/lib/kraken/rate-limiter';
import type { TradeInfo, LedgerEntry, ExportStatusResult } from '@/lib/kraken/types';
import JSZip from 'jszip';

// Threshold: if we estimate more than this many records, use export API
export const EXPORT_THRESHOLD = 500;

// Poll interval for export status (in ms)
const EXPORT_POLL_INTERVAL = 3000;

// Max wait time for export to complete (5 minutes)
const EXPORT_MAX_WAIT = 5 * 60 * 1000;

export interface ExportProgress {
  phase: 'requesting' | 'waiting' | 'downloading' | 'parsing' | 'complete' | 'error';
  message: string;
}

export interface ExportSyncOptions {
  type: 'trades' | 'ledgers';
  startTime?: number; // Unix timestamp
  endTime?: number;   // Unix timestamp
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface ParsedTradeExport {
  txid: string;
  ordertxid: string;
  pair: string;
  time: number;
  type: 'buy' | 'sell';
  ordertype: string;
  price: string;
  cost: string;
  fee: string;
  vol: string;
  margin: string;
  misc: string;
  postxid?: string;
  posstatus?: string;
  cprice?: string;
  ccost?: string;
  cfee?: string;
  cvol?: string;
  cmargin?: string;
  net?: string;
  trades?: string[];
}

export interface ParsedLedgerExport {
  refid: string;
  time: number;
  type: string;
  subtype: string;
  aclass: string;
  asset: string;
  amount: string;
  fee: string;
  balance: string;
}

/**
 * Fetch data using Export API
 * Returns parsed records from the CSV export
 */
export async function fetchViaExport(
  options: ExportSyncOptions & { type: 'trades' }
): Promise<Record<string, TradeInfo>>;
export async function fetchViaExport(
  options: ExportSyncOptions & { type: 'ledgers' }
): Promise<Record<string, LedgerEntry>>;
export async function fetchViaExport(
  options: ExportSyncOptions
): Promise<Record<string, TradeInfo> | Record<string, LedgerEntry>> {
  const { type, startTime, endTime, onProgress, signal } = options;

  // Check for abort
  if (signal?.aborted) {
    throw new Error('Operation aborted');
  }

  onProgress?.({ phase: 'requesting', message: `Requesting ${type} export from Kraken...` });

  // Step 1: Request the export
  const exportResult = await krakenRateLimiter.executeWithRetry(
    () => krakenClient.addExport({
      report: type,
      format: 'CSV',
      description: `SmartBeatCrypto sync ${new Date().toISOString()}`,
      starttm: startTime,
      endtm: endTime,
    }),
    signal
  );

  const exportId = exportResult.id;
  console.log(`[ExportSync] Export requested, ID: ${exportId}`);

  // Step 2: Poll for completion
  onProgress?.({ phase: 'waiting', message: `Waiting for Kraken to generate ${type} export...` });

  const startWait = Date.now();
  let exportStatus: ExportStatusResult | null = null;

  while (Date.now() - startWait < EXPORT_MAX_WAIT) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    await sleep(EXPORT_POLL_INTERVAL);

    const statusList = await krakenRateLimiter.executeWithRetry(
      () => krakenClient.getExportStatus(type),
      signal
    );

    exportStatus = statusList.find(s => s.id === exportId) || null;

    if (exportStatus) {
      console.log(`[ExportSync] Status: ${exportStatus.status}`);

      if (exportStatus.status === 'Processed') {
        break;
      } else if (exportStatus.status === 'Failed' || exportStatus.status === 'Deleted') {
        throw new Error(`Export failed with status: ${exportStatus.status}`);
      }

      onProgress?.({
        phase: 'waiting',
        message: `Export status: ${exportStatus.status}...`,
      });
    }
  }

  if (!exportStatus || exportStatus.status !== 'Processed') {
    throw new Error('Export timed out or failed');
  }

  // Step 3: Download the export
  onProgress?.({ phase: 'downloading', message: `Downloading ${type} export...` });

  const zipBuffer = await krakenRateLimiter.executeWithRetry(
    () => krakenClient.retrieveExport(exportId),
    signal
  );

  console.log(`[ExportSync] Downloaded ${zipBuffer.length} bytes`);

  // Step 4: Parse the ZIP and CSV
  onProgress?.({ phase: 'parsing', message: `Parsing ${type} data...` });

  const records = type === 'trades'
    ? await parseExportZip(zipBuffer, 'trades')
    : await parseExportZip(zipBuffer, 'ledgers');

  onProgress?.({ phase: 'complete', message: `Parsed ${Object.keys(records).length} ${type}` });

  // Step 5: Clean up - delete the export from Kraken
  try {
    await krakenClient.removeExport(exportId, 'delete');
  } catch (err) {
    console.warn('[ExportSync] Failed to delete export:', err);
  }

  return records;
}

/**
 * Parse the ZIP file containing CSV export
 */
async function parseExportZip(
  zipBuffer: Buffer,
  type: 'trades'
): Promise<Record<string, TradeInfo>>;
async function parseExportZip(
  zipBuffer: Buffer,
  type: 'ledgers'
): Promise<Record<string, LedgerEntry>>;
async function parseExportZip(
  zipBuffer: Buffer,
  type: 'trades' | 'ledgers'
): Promise<Record<string, TradeInfo> | Record<string, LedgerEntry>> {
  const zip = await JSZip.loadAsync(zipBuffer);

  // Find the CSV file in the ZIP
  const csvFileName = Object.keys(zip.files).find(name => name.endsWith('.csv'));
  if (!csvFileName) {
    throw new Error('No CSV file found in export ZIP');
  }

  const csvContent = await zip.files[csvFileName].async('string');
  const lines = csvContent.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    return {}; // Empty export
  }

  // Parse header
  const header = parseCSVLine(lines[0]);

  if (type === 'trades') {
    const records: Record<string, TradeInfo> = {};
    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < header.length) continue;

      const row: Record<string, string> = {};
      header.forEach((col, idx) => {
        row[col.toLowerCase().replace(/"/g, '')] = values[idx]?.replace(/"/g, '') || '';
      });

      const trade = parseTradeRow(row);
      if (trade) {
        records[trade.txid] = trade;
      }
    }
    return records;
  } else {
    const records: Record<string, LedgerEntry> = {};
    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < header.length) continue;

      const row: Record<string, string> = {};
      header.forEach((col, idx) => {
        row[col.toLowerCase().replace(/"/g, '')] = values[idx]?.replace(/"/g, '') || '';
      });

      const ledger = parseLedgerRow(row);
      if (ledger) {
        records[ledger.refid] = ledger;
      }
    }
    return records;
  }
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parse a trade row from CSV
 */
function parseTradeRow(row: Record<string, string>): (TradeInfo & { txid: string }) | null {
  const txid = row.txid || row.id;
  if (!txid) return null;

  // Parse time - could be "2024-01-15 10:30:45" or Unix timestamp
  let time: number;
  if (row.time?.includes('-')) {
    time = new Date(row.time).getTime() / 1000;
  } else {
    time = parseFloat(row.time) || 0;
  }

  return {
    txid,
    ordertxid: row.ordertxid || '',
    postxid: row.postxid || '',
    pair: row.pair || '',
    time,
    type: (row.type as 'buy' | 'sell') || 'buy',
    ordertype: row.ordertype || '',
    price: row.price || '0',
    cost: row.cost || '0',
    fee: row.fee || '0',
    vol: row.vol || row.volume || '0',
    margin: row.margin || '0',
    misc: row.misc || '',
    posstatus: row.posstatus,
    cprice: row.cprice,
    ccost: row.ccost,
    cfee: row.cfee,
    cvol: row.cvol,
    cmargin: row.cmargin,
    net: row.net,
    trades: row.trades ? row.trades.split(',') : undefined,
  };
}

/**
 * Parse a ledger row from CSV
 */
function parseLedgerRow(row: Record<string, string>): LedgerEntry | null {
  const refid = row.refid || row.id || row.txid;
  if (!refid) return null;

  // Parse time
  let time: number;
  if (row.time?.includes('-')) {
    time = new Date(row.time).getTime() / 1000;
  } else {
    time = parseFloat(row.time) || 0;
  }

  return {
    refid,
    time,
    type: row.type || 'unknown',
    subtype: row.subtype || '',
    aclass: row.aclass || 'currency',
    asset: row.asset || '',
    amount: row.amount || '0',
    fee: row.fee || '0',
    balance: row.balance || '0',
  };
}

/**
 * Check if export-based sync should be used
 * Returns true if estimated record count exceeds threshold
 */
export async function shouldUseExport(
  type: 'trades' | 'ledgers',
  startTime?: number,
  endTime?: number
): Promise<boolean> {
  try {
    // Do a quick paginated call to get total count
    if (type === 'trades') {
      const result = await krakenClient.getTradesHistory('all', false, startTime, endTime, 0);
      return result.count > EXPORT_THRESHOLD;
    } else {
      const result = await krakenClient.getLedgers(undefined, 'currency', undefined, startTime, endTime, 0);
      return result.count > EXPORT_THRESHOLD;
    }
  } catch {
    // If we can't check, default to paginated (safer)
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

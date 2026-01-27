/**
 * Kraken API Client
 * Server-side only - handles both public and private API calls
 */

import {
  generateNonce,
  createAuthHeaders,
  formatPostData,
} from './auth';
import { krakenRateLimiter } from './rate-limiter';
import type {
  KrakenResponse,
  TickerInfo,
  OHLCData,
  AssetPairInfo,
  Balance,
  TradeBalance,
  OpenOrders,
  ClosedOrders,
  OpenPositions,
  TradesHistory,
  Ledgers,
  AddOrderParams,
  AddOrderResult,
  CancelOrderResult,
  ExportRequest,
  ExportStatusResult,
} from './types';

const KRAKEN_API_BASE = 'https://api.kraken.com';
const KRAKEN_API_VERSION = '0';

export class KrakenClient {
  private apiKey: string;
  private privateKey: string;

  constructor(apiKey?: string, privateKey?: string) {
    this.apiKey = apiKey || process.env.KRAKEN_API_KEY || '';
    this.privateKey = privateKey || process.env.KRAKEN_PRIVATE_KEY || '';
  }

  /**
   * Check if credentials are configured
   */
  hasCredentials(): boolean {
    return Boolean(this.apiKey && this.privateKey);
  }

  // ==================== PUBLIC ENDPOINTS ====================

  /**
   * Get current server time
   */
  async getServerTime(): Promise<{ unixtime: number; rfc1123: string }> {
    return this.publicRequest('Time');
  }

  /**
   * Get asset info
   */
  async getAssets(assets?: string[]): Promise<Record<string, unknown>> {
    const params: Record<string, string | number> | undefined = assets ? { asset: assets.join(',') } : undefined;
    return this.publicRequest('Assets', params);
  }

  /**
   * Get tradable asset pairs
   */
  async getAssetPairs(pairs?: string[]): Promise<Record<string, AssetPairInfo>> {
    const params: Record<string, string | number> | undefined = pairs ? { pair: pairs.join(',') } : undefined;
    return this.publicRequest('AssetPairs', params);
  }

  /**
   * Get ticker information
   */
  async getTicker(pairs: string[]): Promise<Record<string, TickerInfo>> {
    return this.publicRequest('Ticker', { pair: pairs.join(',') });
  }

  /**
   * Get OHLC data
   */
  async getOHLC(
    pair: string,
    interval: 1 | 5 | 15 | 30 | 60 | 240 | 1440 | 10080 | 21600 = 15,
    since?: number
  ): Promise<{ data: OHLCData[]; last: number }> {
    const params: Record<string, string | number> = {
      pair,
      interval,
    };
    if (since) params.since = since;

    const result = await this.publicRequest<Record<string, unknown>>('OHLC', params);

    // Find the data key (not 'last')
    const dataKey = Object.keys(result).find(k => k !== 'last');
    const rawData = dataKey ? (result[dataKey] as unknown[][]) : [];

    const data: OHLCData[] = rawData.map((candle) => ({
      time: Number(candle[0]) * 1000, // Convert to milliseconds
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      vwap: Number(candle[5]),
      volume: Number(candle[6]),
      count: Number(candle[7]),
    }));

    return {
      data,
      last: result.last as number,
    };
  }

  /**
   * Get order book
   */
  async getOrderBook(pair: string, count = 100): Promise<{ asks: string[][]; bids: string[][] }> {
    const result = await this.publicRequest<Record<string, { asks: string[][]; bids: string[][] }>>('Depth', {
      pair,
      count,
    });
    const key = Object.keys(result)[0];
    return result[key];
  }

  // ==================== PRIVATE ENDPOINTS ====================

  /**
   * Get account balance
   */
  async getBalance(): Promise<Balance> {
    return this.privateRequest('Balance');
  }

  /**
   * Get trade balance (margin info)
   */
  async getTradeBalance(asset = 'ZEUR'): Promise<TradeBalance> {
    return this.privateRequest('TradeBalance', { asset });
  }

  /**
   * Get open orders
   */
  async getOpenOrders(trades = false, userref?: number): Promise<OpenOrders> {
    const params: Record<string, string | number | boolean> = { trades };
    if (userref) params.userref = userref;
    return this.privateRequest('OpenOrders', params);
  }

  /**
   * Get closed orders
   */
  async getClosedOrders(
    trades = false,
    userref?: number,
    start?: number,
    end?: number,
    ofs = 0,
    closetime = 'both'
  ): Promise<ClosedOrders> {
    const params: Record<string, string | number | boolean> = {
      trades,
      ofs,
      closetime,
    };
    if (userref) params.userref = userref;
    if (start) params.start = start;
    if (end) params.end = end;
    return this.privateRequest('ClosedOrders', params);
  }

  /**
   * Query orders info
   */
  async queryOrders(txids: string[], trades = false): Promise<Record<string, unknown>> {
    return this.privateRequest('QueryOrders', {
      txid: txids.join(','),
      trades,
    });
  }

  /**
   * Get trades history
   */
  async getTradesHistory(
    type = 'all',
    trades = false,
    start?: number,
    end?: number,
    ofs = 0
  ): Promise<TradesHistory> {
    const params: Record<string, string | number | boolean> = {
      type,
      trades,
      ofs,
    };
    if (start) params.start = start;
    if (end) params.end = end;
    return this.privateRequest('TradesHistory', params);
  }

  /**
   * Get all trades with pagination
   * Uses rate limiter with exponential backoff for reliable fetching
   */
  async getAllTradesHistory(
    start?: number,
    end?: number,
    onProgress?: (count: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<TradesHistory['trades']> {
    let allTrades: TradesHistory['trades'] = {};
    let offset = 0;
    let totalCount = 0;

    do {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      // Use rate limiter with automatic retry on rate limit errors
      const result = await krakenRateLimiter.executeWithRetry(
        () => this.getTradesHistory('all', true, start, end, offset),
        signal
      );

      allTrades = { ...allTrades, ...result.trades };
      totalCount = result.count;
      offset = Object.keys(allTrades).length;

      if (onProgress) {
        onProgress(offset, totalCount);
      }
    } while (offset < totalCount);

    return allTrades;
  }

  /**
   * Get open positions
   * Note: Using consolidation='market' returns aggregated data without timestamps.
   * We don't pass consolidation to get individual positions with full details including open time.
   */
  async getOpenPositions(
    docalcs = true
  ): Promise<OpenPositions> {
    return this.privateRequest('OpenPositions', { docalcs });
  }

  /**
   * Get ledgers info
   */
  async getLedgers(
    asset?: string,
    aclass = 'currency',
    type?: string,
    start?: number,
    end?: number,
    ofs = 0
  ): Promise<Ledgers> {
    const params: Record<string, string | number> = {
      aclass,
      ofs,
    };
    if (asset) params.asset = asset;
    if (type) params.type = type;
    if (start) params.start = start;
    if (end) params.end = end;
    return this.privateRequest('Ledgers', params);
  }

  /**
   * Get all ledgers with pagination
   * Uses rate limiter with exponential backoff for reliable fetching
   */
  async getAllLedgers(
    start?: number,
    end?: number,
    onProgress?: (count: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<Ledgers['ledger']> {
    let allLedgers: Ledgers['ledger'] = {};
    let offset = 0;
    let totalCount = 0;

    do {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      // Use rate limiter with automatic retry on rate limit errors
      const result = await krakenRateLimiter.executeWithRetry(
        () => this.getLedgers(undefined, 'currency', undefined, start, end, offset),
        signal
      );

      allLedgers = { ...allLedgers, ...result.ledger };
      totalCount = result.count;
      offset = Object.keys(allLedgers).length;

      if (onProgress) {
        onProgress(offset, totalCount);
      }
    } while (offset < totalCount);

    return allLedgers;
  }

  /**
   * Query ledgers
   */
  async queryLedgers(ids: string[]): Promise<Ledgers['ledger']> {
    return this.privateRequest('QueryLedgers', { id: ids.join(',') });
  }

  // ==================== TRADING ENDPOINTS ====================

  /**
   * Add a new order
   */
  async addOrder(params: AddOrderParams): Promise<AddOrderResult> {
    const reqParams: Record<string, string | number | boolean> = {
      pair: params.pair,
      type: params.type,
      ordertype: params.ordertype,
      volume: params.volume,
    };

    if (params.price) reqParams.price = params.price;
    if (params.price2) reqParams.price2 = params.price2;
    if (params.displayvol) reqParams.displayvol = params.displayvol;
    if (params.leverage) reqParams.leverage = params.leverage;
    if (params.oflags) reqParams.oflags = params.oflags;
    if (params.starttm) reqParams.starttm = params.starttm;
    if (params.expiretm) reqParams.expiretm = params.expiretm;
    if (params.userref) reqParams.userref = params.userref;
    if (params.validate) reqParams.validate = params.validate;

    if (params.close) {
      reqParams['close[ordertype]'] = params.close.ordertype;
      if (params.close.price) reqParams['close[price]'] = params.close.price;
      if (params.close.price2) reqParams['close[price2]'] = params.close.price2;
    }

    return this.privateRequest('AddOrder', reqParams);
  }

  /**
   * Cancel an order
   */
  async cancelOrder(txid: string): Promise<CancelOrderResult> {
    return this.privateRequest('CancelOrder', { txid });
  }

  /**
   * Cancel all orders
   */
  async cancelAllOrders(): Promise<{ count: number }> {
    return this.privateRequest('CancelAll');
  }

  // ==================== EXPORT ENDPOINTS ====================

  /**
   * Request export report
   */
  async addExport(params: ExportRequest): Promise<{ id: string }> {
    const reqParams: Record<string, string | number> = {
      report: params.report,
    };
    if (params.format) reqParams.format = params.format;
    if (params.description) reqParams.description = params.description;
    if (params.fields) reqParams.fields = params.fields;
    if (params.starttm) reqParams.starttm = params.starttm;
    if (params.endtm) reqParams.endtm = params.endtm;

    return this.privateRequest('AddExport', reqParams);
  }

  /**
   * Get export status
   */
  async getExportStatus(report: 'trades' | 'ledgers'): Promise<ExportStatusResult[]> {
    return this.privateRequest('ExportStatus', { report });
  }

  /**
   * Retrieve export data
   */
  async retrieveExport(id: string): Promise<Buffer> {
    const nonce = generateNonce();
    const urlPath = `/${KRAKEN_API_VERSION}/private/RetrieveExport`;
    const postData = formatPostData(nonce, { id });

    const headers = createAuthHeaders(
      urlPath,
      postData,
      nonce,
      this.apiKey,
      this.privateKey
    );

    const response = await fetch(`${KRAKEN_API_BASE}${urlPath}`, {
      method: 'POST',
      headers,
      body: postData,
    });

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Delete export
   */
  async removeExport(id: string, type: 'cancel' | 'delete'): Promise<{ delete: boolean }> {
    return this.privateRequest('RemoveExport', { id, type });
  }

  // ==================== INTERNAL METHODS ====================

  private async publicRequest<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${KRAKEN_API_BASE}/${KRAKEN_API_VERSION}/public/${endpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, String(value));
      }
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status}`);
    }

    const data: KrakenResponse<T> = await response.json();

    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API error: ${data.error.join(', ')}`);
    }

    return data.result as T;
  }

  private async privateRequest<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean>,
    retryCount = 0
  ): Promise<T> {
    if (!this.hasCredentials()) {
      throw new Error('API credentials not configured');
    }

    const nonce = generateNonce();
    const urlPath = `/${KRAKEN_API_VERSION}/private/${endpoint}`;

    // Convert params to string values
    const stringParams: Record<string, string | number> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'boolean') {
          stringParams[key] = value ? 'true' : 'false';
        } else if (value !== undefined) {
          stringParams[key] = value;
        }
      }
    }

    const postData = formatPostData(nonce, stringParams);

    const headers = createAuthHeaders(
      urlPath,
      postData,
      nonce,
      this.apiKey,
      this.privateKey
    );

    const response = await fetch(`${KRAKEN_API_BASE}${urlPath}`, {
      method: 'POST',
      headers,
      body: postData,
    });

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status}`);
    }

    const data: KrakenResponse<T> = await response.json();

    if (data.error && data.error.length > 0) {
      const errorMsg = data.error.join(', ');

      // Retry on nonce errors (caused by concurrent requests)
      if (errorMsg.includes('EAPI:Invalid nonce') && retryCount < 3) {
        // Wait a small random delay before retrying (50-150ms)
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        return this.privateRequest<T>(endpoint, params, retryCount + 1);
      }

      throw new Error(`Kraken API error: ${errorMsg}`);
    }

    return data.result as T;
  }
}

// Export singleton instance
export const krakenClient = new KrakenClient();

// Export a function to create a new client with different credentials
export function createKrakenClient(apiKey: string, privateKey: string): KrakenClient {
  return new KrakenClient(apiKey, privateKey);
}

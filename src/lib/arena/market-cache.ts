/**
 * Arena Market Data Cache
 *
 * Singleton that fetches OHLC + ticker data ONCE per tick, shared across all agents.
 * Uses direct Kraken public API calls (server-side) with 30s minimum refresh interval.
 */

import type { OHLCData, TickerInfo, TimeframeData } from '@/lib/kraken/types';
import type { SharedMarketData } from './types';
import { calculateIndicators, calculateBTCTrend } from '@/lib/trading/indicators';
import { generateRecommendation } from '@/lib/trading/recommendation';

const KRAKEN_API_BASE = 'https://api.kraken.com/0/public';
const MIN_REFRESH_MS = 30_000; // 30 seconds minimum between API calls

interface KrakenTickerResponse {
  error: string[];
  result: Record<string, TickerInfo>;
}

interface KrakenOHLCResponse {
  error: string[];
  result: Record<string, unknown>;
}

/**
 * Parse Kraken OHLC response into OHLCData array.
 * Kraken returns data under a key like "XXRPZEUR" or "XRPEUR" (varies by pair).
 */
function parseOHLCResponse(result: Record<string, unknown>): OHLCData[] {
  const dataKey = Object.keys(result).find(k => k !== 'last');
  if (!dataKey) return [];

  const rawData = result[dataKey] as unknown[][];
  return rawData.map((candle) => ({
    time: Number(candle[0]) * 1000,
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    vwap: Number(candle[5]),
    volume: Number(candle[6]),
    count: Number(candle[7]),
  }));
}

/**
 * Parse Kraken ticker response. Returns the TickerInfo for the first (only) pair key.
 */
function parseTickerResponse(result: Record<string, TickerInfo>): TickerInfo | null {
  const key = Object.keys(result)[0];
  return key ? result[key] : null;
}

// Persist singleton across Next.js HMR
const globalForCache = globalThis as unknown as { __arenaMarketCache?: MarketDataCache };

export class MarketDataCache {
  private lastFetchTime: number = 0;
  private cachedData: SharedMarketData | null = null;

  static getInstance(): MarketDataCache {
    if (!globalForCache.__arenaMarketCache) {
      globalForCache.__arenaMarketCache = new MarketDataCache();
    }
    return globalForCache.__arenaMarketCache;
  }

  private shouldRefresh(): boolean {
    return Date.now() - this.lastFetchTime >= MIN_REFRESH_MS;
  }

  getCachedData(): SharedMarketData | null {
    return this.cachedData;
  }

  async fetchMarketData(forceRefresh?: boolean): Promise<SharedMarketData> {
    if (!forceRefresh && !this.shouldRefresh() && this.cachedData) {
      return this.cachedData;
    }

    // Fetch all data in parallel: 5 OHLC timeframes + XRP ticker + BTC ticker
    const [
      ohlc5m,
      ohlc15m,
      ohlc1h,
      ohlc4h,
      ohlc1d,
      xrpTicker,
      btcTicker,
    ] = await Promise.all([
      this.fetchOHLC('XRPEUR', 5),
      this.fetchOHLC('XRPEUR', 15),
      this.fetchOHLC('XRPEUR', 60),
      this.fetchOHLC('XRPEUR', 240),
      this.fetchOHLC('XRPEUR', 1440),
      this.fetchTicker('XRPEUR'),
      this.fetchTicker('XBTEUR'),
    ]);

    // Parse ticker data
    const xrpInfo = xrpTicker;
    const btcInfo = btcTicker;

    const lastPrice = xrpInfo ? parseFloat(xrpInfo.c[0]) : 0;
    const bid = xrpInfo ? parseFloat(xrpInfo.b[0]) : 0;
    const ask = xrpInfo ? parseFloat(xrpInfo.a[0]) : 0;
    const volume24h = xrpInfo ? parseFloat(xrpInfo.v[1]) : 0;
    const high24h = xrpInfo ? parseFloat(xrpInfo.h[1]) : 0;
    const low24h = xrpInfo ? parseFloat(xrpInfo.l[1]) : 0;

    // Calculate BTC trend from 24h change
    let btcChange = 0;
    if (btcInfo) {
      const btcOpen = parseFloat(btcInfo.o);
      const btcLast = parseFloat(btcInfo.c[0]);
      btcChange = btcOpen > 0 ? ((btcLast - btcOpen) / btcOpen) * 100 : 0;
    }
    const { trend: btcTrend } = calculateBTCTrend(btcChange);

    // Calculate indicators for each timeframe
    const tfData: Record<string, TimeframeData> = {};
    const ohlcMap: Record<string, OHLCData[]> = {
      '5m': ohlc5m,
      '15m': ohlc15m,
      '1h': ohlc1h,
      '4h': ohlc4h,
      '1d': ohlc1d,
    };

    for (const [tfKey, ohlc] of Object.entries(ohlcMap)) {
      tfData[tfKey] = {
        ohlc,
        indicators: calculateIndicators(ohlc),
      };
    }

    // Generate base recommendation (no strategy mutations)
    let recommendation = undefined;
    if (tfData['4h'].indicators && tfData['1h'].indicators &&
        tfData['15m'].indicators && tfData['5m'].indicators) {
      recommendation = generateRecommendation(
        tfData['4h'],
        tfData['1h'],
        tfData['15m'],
        tfData['5m'],
        btcTrend,
        btcChange,
        null, // no microstructure
        null, // no liquidation
        tfData['1d'],
        lastPrice,
      ) ?? undefined;
    }

    const marketData: SharedMarketData = {
      price: lastPrice,
      timestamp: Date.now(),
      ticker: {
        bid,
        ask,
        last: lastPrice,
        volume24h,
        high24h,
        low24h,
      },
      tfData,
      btcTrend,
      btcChange,
      recommendation,
    };

    this.cachedData = marketData;
    this.lastFetchTime = Date.now();

    return marketData;
  }

  private async fetchOHLC(pair: string, interval: number): Promise<OHLCData[]> {
    try {
      const url = `${KRAKEN_API_BASE}/OHLC?pair=${pair}&interval=${interval}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`OHLC fetch failed for ${pair}/${interval}: ${response.status}`);
        return [];
      }
      const data: KrakenOHLCResponse = await response.json();
      if (data.error && data.error.length > 0) {
        console.error(`Kraken OHLC error for ${pair}/${interval}:`, data.error);
        return [];
      }
      return parseOHLCResponse(data.result);
    } catch (error) {
      console.error(`Failed to fetch OHLC ${pair}/${interval}:`, error);
      return [];
    }
  }

  private async fetchTicker(pair: string): Promise<TickerInfo | null> {
    try {
      const url = `${KRAKEN_API_BASE}/Ticker?pair=${pair}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Ticker fetch failed for ${pair}: ${response.status}`);
        return null;
      }
      const data: KrakenTickerResponse = await response.json();
      if (data.error && data.error.length > 0) {
        console.error(`Kraken Ticker error for ${pair}:`, data.error);
        return null;
      }
      return parseTickerResponse(data.result);
    } catch (error) {
      console.error(`Failed to fetch ticker ${pair}:`, error);
      return null;
    }
  }
}

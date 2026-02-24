import { NextRequest, NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';

// Cache for recent trades
interface TradesCacheEntry {
  data: TradesResponse;
  timestamp: number;
}

interface ParsedTrade {
  price: number;
  volume: number;
  time: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  eurValue: number;
}

interface LiquidationCascade {
  startTime: number;
  endTime: number;
  side: 'buy' | 'sell';
  tradeCount: number;
  totalVolume: number;
  totalEurValue: number;
  priceStart: number;
  priceEnd: number;
  priceImpactPercent: number;
  intensity: number; // 0-1 normalized
}

interface TradesResponse {
  pair: string;
  trades: ParsedTrade[];
  tradeCount: number;
  // Aggregated metrics
  buyVolume: number;
  sellVolume: number;
  buyEurValue: number;
  sellEurValue: number;
  netDelta: number; // buyEur - sellEur
  vwap: number;
  // Cascade detection (sudden bursts = likely liquidations)
  cascades: LiquidationCascade[];
  // Recent large trades
  largeTrades: ParsedTrade[];
  last: string;
  timestamp: number;
}

const cache: Map<string, TradesCacheEntry> = new Map();
const CACHE_TTL = 15_000; // 15 seconds

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get('pair') || 'XXRPZEUR';
  const since = searchParams.get('since') ? parseInt(searchParams.get('since')!) : undefined;
  const largeThreshold = parseFloat(searchParams.get('largeThreshold') || '500'); // EUR

  // Check cache
  const cacheKey = `${pair}-${since || 'latest'}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const raw = await krakenClient.getRecentTrades(pair, since);

    // Parse trades: [price, volume, time, buy/sell, market/limit, misc, trade_id]
    const trades: ParsedTrade[] = raw.trades.map(t => {
      const price = parseFloat(String(t[0]));
      const volume = parseFloat(String(t[1]));
      return {
        price,
        volume,
        time: Math.floor(Number(t[2]) * 1000), // to ms
        side: String(t[3]) === 'b' ? 'buy' as const : 'sell' as const,
        type: String(t[4]) === 'm' ? 'market' as const : 'limit' as const,
        eurValue: price * volume,
      };
    });

    // Aggregated metrics
    let buyVolume = 0, sellVolume = 0, buyEur = 0, sellEur = 0;
    let totalVwapNum = 0, totalVwapDen = 0;

    for (const t of trades) {
      if (t.side === 'buy') {
        buyVolume += t.volume;
        buyEur += t.eurValue;
      } else {
        sellVolume += t.volume;
        sellEur += t.eurValue;
      }
      totalVwapNum += t.price * t.volume;
      totalVwapDen += t.volume;
    }

    // Detect liquidation cascades
    const cascades = detectCascades(trades);

    // Large trades
    const largeTrades = trades.filter(t => t.eurValue >= largeThreshold);

    const result: TradesResponse = {
      pair,
      trades: trades.slice(-500), // Last 500 trades
      tradeCount: trades.length,
      buyVolume,
      sellVolume,
      buyEurValue: buyEur,
      sellEurValue: sellEur,
      netDelta: buyEur - sellEur,
      vwap: totalVwapDen > 0 ? totalVwapNum / totalVwapDen : 0,
      cascades,
      largeTrades: largeTrades.slice(-50), // Last 50 large trades
      last: raw.last,
      timestamp: now,
    };

    cache.set(cacheKey, { data: result, timestamp: now });
    if (cache.size > 20) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Trades API error:', error);
    if (cached) {
      return NextResponse.json(cached.data);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch trades' },
      { status: 500 }
    );
  }
}

/**
 * Detect liquidation cascades from trade data.
 * A cascade is a burst of same-side market orders within a short window
 * that causes significant price displacement.
 */
function detectCascades(trades: ParsedTrade[]): LiquidationCascade[] {
  if (trades.length < 10) return [];

  const cascades: LiquidationCascade[] = [];
  const WINDOW_MS = 30_000; // 30-second windows
  const MIN_TRADES_FOR_CASCADE = 5;
  const MIN_PRICE_IMPACT_PCT = 0.15; // 0.15% price move

  // Calculate average trade frequency and volume for baseline
  const totalTimeSpan = trades.length > 1
    ? trades[trades.length - 1].time - trades[0].time
    : 1;
  const avgTradesPerWindow = totalTimeSpan > 0
    ? (trades.length / totalTimeSpan) * WINDOW_MS
    : 0;
  const avgEurPerTrade = trades.reduce((s, t) => s + t.eurValue, 0) / trades.length;

  // Sliding window analysis
  let windowStart = 0;
  for (let i = 0; i < trades.length; i++) {
    // Advance window start
    while (windowStart < i && trades[i].time - trades[windowStart].time > WINDOW_MS) {
      windowStart++;
    }

    const windowTrades = trades.slice(windowStart, i + 1);
    if (windowTrades.length < MIN_TRADES_FOR_CASCADE) continue;

    // Count sides
    const buys = windowTrades.filter(t => t.side === 'buy');
    const sells = windowTrades.filter(t => t.side === 'sell');

    // Check if one side dominates (>75%)
    const dominant = buys.length > sells.length * 3 ? 'buy'
      : sells.length > buys.length * 3 ? 'sell'
      : null;

    if (!dominant) continue;

    const domTrades = dominant === 'buy' ? buys : sells;
    const priceStart = domTrades[0].price;
    const priceEnd = domTrades[domTrades.length - 1].price;
    const priceImpact = Math.abs(priceEnd - priceStart) / priceStart * 100;

    if (priceImpact < MIN_PRICE_IMPACT_PCT) continue;

    const totalEur = domTrades.reduce((s, t) => s + t.eurValue, 0);
    const tradeFrequencyRatio = avgTradesPerWindow > 0
      ? domTrades.length / avgTradesPerWindow
      : 1;
    const volumeRatio = avgEurPerTrade > 0
      ? (totalEur / domTrades.length) / avgEurPerTrade
      : 1;

    // Intensity: combination of frequency spike, volume spike, and price impact
    const intensity = Math.min(1,
      (tradeFrequencyRatio * 0.3 + volumeRatio * 0.3 + (priceImpact / 1.0) * 0.4)
    );

    // Avoid duplicate overlapping cascades
    const lastCascade = cascades[cascades.length - 1];
    if (lastCascade && lastCascade.endTime >= windowTrades[0].time && lastCascade.side === dominant) {
      // Extend existing cascade if this window is stronger
      if (intensity > lastCascade.intensity) {
        lastCascade.endTime = domTrades[domTrades.length - 1].time;
        lastCascade.tradeCount = domTrades.length;
        lastCascade.totalVolume = domTrades.reduce((s, t) => s + t.volume, 0);
        lastCascade.totalEurValue = totalEur;
        lastCascade.priceEnd = priceEnd;
        lastCascade.priceImpactPercent = priceImpact;
        lastCascade.intensity = intensity;
      }
      continue;
    }

    cascades.push({
      startTime: domTrades[0].time,
      endTime: domTrades[domTrades.length - 1].time,
      side: dominant,
      tradeCount: domTrades.length,
      totalVolume: domTrades.reduce((s, t) => s + t.volume, 0),
      totalEurValue: totalEur,
      priceStart,
      priceEnd,
      priceImpactPercent: priceImpact,
      intensity,
    });
  }

  return cascades;
}

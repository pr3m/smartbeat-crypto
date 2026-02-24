import { NextRequest, NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';

// Cache for order book snapshots
interface DepthCacheEntry {
  data: DepthResponse;
  timestamp: number;
}

interface DepthLevel {
  price: number;
  volume: number;
  eurValue: number;
  cumVolume: number;
  cumEurValue: number;
}

interface DepthResponse {
  pair: string;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  bidTotalEur: number;
  askTotalEur: number;
  imbalance: number;
  // Liquidity wall detection
  walls: {
    side: 'bid' | 'ask';
    price: number;
    eurValue: number;
    relativeSize: number; // How many times larger than average
    distancePercent: number; // Distance from mid price
  }[];
  timestamp: number;
}

const cache: Map<string, DepthCacheEntry> = new Map();
const CACHE_TTL = 10_000; // 10 seconds - order book changes fast

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get('pair') || 'XXRPZEUR';
  const count = Math.min(parseInt(searchParams.get('count') || '500'), 500);
  const wallThreshold = parseFloat(searchParams.get('wallThreshold') || '3.0'); // 3x average = wall

  // Check cache
  const cacheKey = `${pair}-${count}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const book = await krakenClient.getOrderBook(pair, count);

    // Parse bid/ask levels: [price, volume, timestamp]
    const parseBids = (raw: string[][]): DepthLevel[] => {
      let cumVolume = 0;
      let cumEurValue = 0;
      return raw.map(([priceStr, volStr]) => {
        const price = parseFloat(priceStr);
        const volume = parseFloat(volStr);
        const eurValue = price * volume;
        cumVolume += volume;
        cumEurValue += eurValue;
        return { price, volume, eurValue, cumVolume, cumEurValue };
      });
    };

    const parseAsks = (raw: string[][]): DepthLevel[] => {
      let cumVolume = 0;
      let cumEurValue = 0;
      return raw.map(([priceStr, volStr]) => {
        const price = parseFloat(priceStr);
        const volume = parseFloat(volStr);
        const eurValue = price * volume;
        cumVolume += volume;
        cumEurValue += eurValue;
        return { price, volume, eurValue, cumVolume, cumEurValue };
      });
    };

    const bids = parseBids(book.bids);
    const asks = parseAsks(book.asks);

    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    const bidTotalEur = bids.reduce((s, l) => s + l.eurValue, 0);
    const askTotalEur = asks.reduce((s, l) => s + l.eurValue, 0);
    const totalEur = bidTotalEur + askTotalEur;
    const imbalance = totalEur > 0 ? (bidTotalEur - askTotalEur) / totalEur : 0;

    // Detect liquidity walls
    const allLevels = [
      ...bids.map(b => ({ ...b, side: 'bid' as const })),
      ...asks.map(a => ({ ...a, side: 'ask' as const })),
    ];

    const avgEurValue = allLevels.length > 0
      ? allLevels.reduce((s, l) => s + l.eurValue, 0) / allLevels.length
      : 0;

    const walls = allLevels
      .filter(l => avgEurValue > 0 && l.eurValue >= avgEurValue * wallThreshold)
      .map(l => ({
        side: l.side,
        price: l.price,
        eurValue: l.eurValue,
        relativeSize: avgEurValue > 0 ? l.eurValue / avgEurValue : 0,
        distancePercent: midPrice > 0 ? Math.abs(l.price - midPrice) / midPrice * 100 : 0,
      }))
      .sort((a, b) => a.distancePercent - b.distancePercent);

    const result: DepthResponse = {
      pair,
      midPrice,
      spread,
      spreadPercent,
      bids,
      asks,
      bidTotalEur,
      askTotalEur,
      imbalance,
      walls,
      timestamp: now,
    };

    // Cache
    cache.set(cacheKey, { data: result, timestamp: now });
    if (cache.size > 20) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Depth API error:', error);
    if (cached) {
      return NextResponse.json(cached.data);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch order book' },
      { status: 500 }
    );
  }
}

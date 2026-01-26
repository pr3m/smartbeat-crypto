import { NextRequest, NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';
import type { OHLCData } from '@/lib/kraken/types';

// Valid Kraken OHLC intervals
const VALID_INTERVALS = [1, 5, 15, 30, 60, 240, 1440, 10080, 21600];

// Simple in-memory cache to prevent rate limiting
interface CacheEntry {
  data: { data: OHLCData[]; last: number };
  timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();

// Cache TTL based on interval (shorter intervals = shorter cache)
function getCacheTTL(interval: number): number {
  switch (interval) {
    case 1: return 30 * 1000;      // 30 seconds for 1m
    case 5: return 60 * 1000;      // 1 minute for 5m
    case 15: return 90 * 1000;     // 1.5 minutes for 15m
    case 30: return 120 * 1000;    // 2 minutes for 30m
    case 60: return 180 * 1000;    // 3 minutes for 1H
    case 240: return 300 * 1000;   // 5 minutes for 4H
    default: return 300 * 1000;    // 5 minutes default
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get('pair');
  const intervalParam = searchParams.get('interval');
  const since = searchParams.get('since');

  if (!pair) {
    return NextResponse.json(
      { error: 'Missing pair parameter' },
      { status: 400 }
    );
  }

  // Parse and validate interval
  let interval = 15;
  if (intervalParam) {
    const parsed = parseInt(intervalParam);
    if (VALID_INTERVALS.includes(parsed)) {
      interval = parsed;
    }
  }

  // Check cache first
  const cacheKey = `${pair}-${interval}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  const ttl = getCacheTTL(interval);

  if (cached && (now - cached.timestamp) < ttl) {
    return NextResponse.json(cached.data);
  }

  try {
    const result = await krakenClient.getOHLC(
      pair,
      interval as 1 | 5 | 15 | 30 | 60 | 240 | 1440 | 10080 | 21600,
      since ? parseInt(since) : undefined
    );

    // Store in cache
    cache.set(cacheKey, { data: result, timestamp: now });

    // Clean old cache entries (prevent memory leak)
    if (cache.size > 50) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('OHLC error for', pair, interval, ':', error);

    // If we have stale cached data, return it instead of error
    if (cached) {
      console.log('Returning stale cache for', cacheKey);
      return NextResponse.json(cached.data);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', data: [] },
      { status: 500 }
    );
  }
}

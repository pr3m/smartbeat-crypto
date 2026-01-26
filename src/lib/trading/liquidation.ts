/**
 * Liquidation Level Estimation
 *
 * Estimates liquidation zones based on:
 * - Recent price action (volume profile as proxy for entry prices)
 * - Common leverage levels (10x, 25x, 50x, 100x)
 * - Open interest data from Binance Futures
 * - Funding rate for long/short bias
 *
 * Formula:
 * - Long liquidation: entry × (1 - 1/leverage)
 * - Short liquidation: entry × (1 + 1/leverage)
 */

import type { OHLCData } from '@/lib/kraken/types';

// Common leverage levels used by traders
export const LEVERAGE_LEVELS = [10, 25, 50, 100] as const;

export interface LiquidationLevel {
  price: number;
  type: 'long' | 'short';
  leverage: number;
  strength: number; // 0-1, based on volume at entry price
  entryPrice: number;
  distancePercent: number; // Distance from current price
}

export interface LiquidationZone {
  priceFrom: number;
  priceTo: number;
  type: 'long' | 'short';
  totalStrength: number;
  levels: LiquidationLevel[];
}

export interface LiquidationAnalysis {
  currentPrice: number;
  // Zones above current price (short liquidations - bullish fuel)
  shortLiquidationZones: LiquidationZone[];
  // Zones below current price (long liquidations - bearish fuel)
  longLiquidationZones: LiquidationZone[];
  // Which direction has more liquidation "fuel"
  bias: 'long_squeeze' | 'short_squeeze' | 'neutral';
  biasStrength: number; // 0-1
  // Key price targets
  nearestShortLiquidation: number | null;
  nearestLongLiquidation: number | null;
  strongestShortZone: LiquidationZone | null;
  strongestLongZone: LiquidationZone | null;
  // Summary stats
  totalShortLiqStrength: number;
  totalLongLiqStrength: number;
  // External data
  openInterest?: number;
  fundingRate?: number;
  recentLiquidations?: RecentLiquidation[];
}

export interface RecentLiquidation {
  timestamp: number;
  side: 'buy' | 'sell'; // Forced order side (opposite of position)
  price: number;
  qty: number;
  usdValue: number;
}

export interface BinanceOpenInterest {
  symbol: string;
  openInterest: string;
  time: number;
}

export interface BinanceFundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

/**
 * Calculate liquidation price for a position
 */
export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: 'long' | 'short',
  maintenanceMargin: number = 0.004 // 0.4% typical maintenance margin
): number {
  if (side === 'long') {
    // Long liquidates when price drops
    return entryPrice * (1 - 1 / leverage + maintenanceMargin);
  } else {
    // Short liquidates when price rises
    return entryPrice * (1 + 1 / leverage - maintenanceMargin);
  }
}

/**
 * Build volume profile from OHLC data
 * Returns price levels with volume concentration
 */
export function buildVolumeProfile(
  candles: OHLCData[],
  numBuckets: number = 50
): Array<{ price: number; volume: number; normalized: number }> {
  if (candles.length === 0) return [];

  // Find price range
  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  const bucketSize = priceRange / numBuckets;

  // Initialize buckets
  const buckets: number[] = new Array(numBuckets).fill(0);

  // Distribute volume across price buckets
  for (const candle of candles) {
    const candleRange = candle.high - candle.low;
    if (candleRange === 0) {
      // Doji - all volume at one price
      const bucket = Math.min(
        Math.floor((candle.close - minPrice) / bucketSize),
        numBuckets - 1
      );
      buckets[bucket] += candle.volume;
    } else {
      // Distribute volume proportionally across candle range
      const lowBucket = Math.floor((candle.low - minPrice) / bucketSize);
      const highBucket = Math.min(
        Math.floor((candle.high - minPrice) / bucketSize),
        numBuckets - 1
      );
      const volumePerBucket = candle.volume / (highBucket - lowBucket + 1);
      for (let i = lowBucket; i <= highBucket; i++) {
        buckets[i] += volumePerBucket;
      }
    }
  }

  // Normalize and create output
  const maxVolume = Math.max(...buckets);
  return buckets.map((volume, i) => ({
    price: minPrice + (i + 0.5) * bucketSize,
    volume,
    normalized: maxVolume > 0 ? volume / maxVolume : 0,
  }));
}

/**
 * Estimate liquidation levels from volume profile
 */
export function estimateLiquidationLevels(
  volumeProfile: Array<{ price: number; volume: number; normalized: number }>,
  currentPrice: number,
  leverages: readonly number[] = LEVERAGE_LEVELS
): LiquidationLevel[] {
  const levels: LiquidationLevel[] = [];

  for (const profile of volumeProfile) {
    // Only consider entries with meaningful volume
    if (profile.normalized < 0.1) continue;

    for (const leverage of leverages) {
      // Calculate where longs entered at this price would liquidate
      const longLiqPrice = calculateLiquidationPrice(profile.price, leverage, 'long');
      // Calculate where shorts entered at this price would liquidate
      const shortLiqPrice = calculateLiquidationPrice(profile.price, leverage, 'short');

      // Long liquidations (below current price, below entry)
      if (longLiqPrice < currentPrice && longLiqPrice < profile.price) {
        levels.push({
          price: longLiqPrice,
          type: 'long',
          leverage,
          strength: profile.normalized * (leverage / 100), // Higher leverage = more likely to exist
          entryPrice: profile.price,
          distancePercent: ((currentPrice - longLiqPrice) / currentPrice) * 100,
        });
      }

      // Short liquidations (above current price, above entry)
      if (shortLiqPrice > currentPrice && shortLiqPrice > profile.price) {
        levels.push({
          price: shortLiqPrice,
          type: 'short',
          leverage,
          strength: profile.normalized * (leverage / 100),
          entryPrice: profile.price,
          distancePercent: ((shortLiqPrice - currentPrice) / currentPrice) * 100,
        });
      }
    }
  }

  return levels;
}

/**
 * Group liquidation levels into zones
 */
export function groupIntoZones(
  levels: LiquidationLevel[],
  currentPrice: number,
  zoneSize: number = 0.01 // 1% price zones
): { longZones: LiquidationZone[]; shortZones: LiquidationZone[] } {
  const longLevels = levels.filter(l => l.type === 'long').sort((a, b) => b.price - a.price);
  const shortLevels = levels.filter(l => l.type === 'short').sort((a, b) => a.price - b.price);

  const createZones = (
    sortedLevels: LiquidationLevel[],
    type: 'long' | 'short'
  ): LiquidationZone[] => {
    if (sortedLevels.length === 0) return [];

    const zones: LiquidationZone[] = [];
    let currentZone: LiquidationZone | null = null;

    for (const level of sortedLevels) {
      const zonePrice = type === 'long'
        ? Math.floor(level.price / (currentPrice * zoneSize)) * (currentPrice * zoneSize)
        : Math.ceil(level.price / (currentPrice * zoneSize)) * (currentPrice * zoneSize);

      if (!currentZone || Math.abs(currentZone.priceFrom - zonePrice) > currentPrice * zoneSize) {
        if (currentZone) zones.push(currentZone);
        currentZone = {
          priceFrom: zonePrice,
          priceTo: zonePrice + (type === 'short' ? currentPrice * zoneSize : -currentPrice * zoneSize),
          type,
          totalStrength: level.strength,
          levels: [level],
        };
      } else {
        currentZone.totalStrength += level.strength;
        currentZone.levels.push(level);
        currentZone.priceTo = type === 'short'
          ? Math.max(currentZone.priceTo, level.price)
          : Math.min(currentZone.priceTo, level.price);
      }
    }

    if (currentZone) zones.push(currentZone);

    // Normalize strengths
    const maxStrength = Math.max(...zones.map(z => z.totalStrength), 1);
    return zones.map(z => ({
      ...z,
      totalStrength: z.totalStrength / maxStrength,
    }));
  };

  return {
    longZones: createZones(longLevels, 'long'),
    shortZones: createZones(shortLevels, 'short'),
  };
}

/**
 * Main function: Analyze liquidation landscape
 */
export function analyzeLiquidations(
  candles: OHLCData[],
  currentPrice: number,
  openInterest?: number,
  fundingRate?: number,
  recentLiquidations?: RecentLiquidation[]
): LiquidationAnalysis {
  // Build volume profile from recent candles
  const volumeProfile = buildVolumeProfile(candles);

  // Estimate liquidation levels
  const levels = estimateLiquidationLevels(volumeProfile, currentPrice);

  // Group into zones
  const { longZones, shortZones } = groupIntoZones(levels, currentPrice);

  // Calculate totals
  const totalLongStrength = longZones.reduce((s, z) => s + z.totalStrength, 0);
  const totalShortStrength = shortZones.reduce((s, z) => s + z.totalStrength, 0);

  // Determine bias
  let bias: 'long_squeeze' | 'short_squeeze' | 'neutral' = 'neutral';
  let biasStrength = 0;

  const totalStrength = totalLongStrength + totalShortStrength;
  if (totalStrength > 0) {
    const shortRatio = totalShortStrength / totalStrength;
    if (shortRatio > 0.6) {
      bias = 'short_squeeze';
      biasStrength = (shortRatio - 0.5) * 2; // 0.6 = 0.2, 0.8 = 0.6, 1.0 = 1.0
    } else if (shortRatio < 0.4) {
      bias = 'long_squeeze';
      biasStrength = (0.5 - shortRatio) * 2;
    }
  }

  // Adjust bias based on funding rate (if available)
  // Positive funding = longs pay shorts = crowded long
  // Negative funding = shorts pay longs = crowded short
  if (fundingRate !== undefined) {
    if (fundingRate > 0.0001 && bias !== 'long_squeeze') {
      // Crowded long, more likely to squeeze longs
      biasStrength = Math.min(1, biasStrength + Math.abs(fundingRate) * 100);
      if (bias === 'neutral') bias = 'long_squeeze';
    } else if (fundingRate < -0.0001 && bias !== 'short_squeeze') {
      // Crowded short, more likely to squeeze shorts
      biasStrength = Math.min(1, biasStrength + Math.abs(fundingRate) * 100);
      if (bias === 'neutral') bias = 'short_squeeze';
    }
  }

  // Find nearest and strongest zones
  const nearestShort = shortZones.length > 0 ? shortZones[0] : null;
  const nearestLong = longZones.length > 0 ? longZones[0] : null;
  const strongestShort = shortZones.length > 0
    ? shortZones.reduce((a, b) => a.totalStrength > b.totalStrength ? a : b)
    : null;
  const strongestLong = longZones.length > 0
    ? longZones.reduce((a, b) => a.totalStrength > b.totalStrength ? a : b)
    : null;

  return {
    currentPrice,
    shortLiquidationZones: shortZones,
    longLiquidationZones: longZones,
    bias,
    biasStrength,
    nearestShortLiquidation: nearestShort?.priceFrom ?? null,
    nearestLongLiquidation: nearestLong?.priceFrom ?? null,
    strongestShortZone: strongestShort,
    strongestLongZone: strongestLong,
    totalShortLiqStrength: totalShortStrength,
    totalLongLiqStrength: totalLongStrength,
    openInterest,
    fundingRate,
    recentLiquidations,
  };
}

/**
 * Format liquidation analysis for display
 */
export function formatLiquidationBias(analysis: LiquidationAnalysis): {
  label: string;
  description: string;
  color: string;
} {
  if (analysis.bias === 'short_squeeze') {
    return {
      label: 'Short Squeeze Potential',
      description: `More shorts stacked above (${(analysis.biasStrength * 100).toFixed(0)}% confidence). Price magnet pulls UP.`,
      color: 'green',
    };
  } else if (analysis.bias === 'long_squeeze') {
    return {
      label: 'Long Squeeze Potential',
      description: `More longs stacked below (${(analysis.biasStrength * 100).toFixed(0)}% confidence). Price magnet pulls DOWN.`,
      color: 'red',
    };
  }
  return {
    label: 'Neutral',
    description: 'Balanced liquidation levels on both sides.',
    color: 'gray',
  };
}

/**
 * Get liquidation input for recommendation engine
 */
export interface LiquidationInput {
  bias: 'long_squeeze' | 'short_squeeze' | 'neutral';
  biasStrength: number;
  nearestUpside: number | null; // Nearest short liq (price target going up)
  nearestDownside: number | null; // Nearest long liq (price target going down)
  fundingRate: number | null;
  openInterest: number | null;
}

export function getLiquidationInput(analysis: LiquidationAnalysis): LiquidationInput {
  return {
    bias: analysis.bias,
    biasStrength: analysis.biasStrength,
    nearestUpside: analysis.nearestShortLiquidation,
    nearestDownside: analysis.nearestLongLiquidation,
    fundingRate: analysis.fundingRate ?? null,
    openInterest: analysis.openInterest ?? null,
  };
}

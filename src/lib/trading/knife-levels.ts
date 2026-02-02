/**
 * Knife Level Selection
 *
 * Identifies and selects key support/resistance levels for knife detection.
 * Uses TF-specific recency scoring and clamped ATR-based merging tolerance.
 */

import type { OHLCData } from '@/lib/kraken/types';
import { findSwingPoints, type SwingPoint } from './chart-context';

export interface KnifeLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  score: number;           // Composite score
  lastTouchTime: number;   // Unix SECONDS (from OHLC candle time)
  source: string;          // e.g., "swing_low+15m+1h"
}

export interface BrokenLevelResult {
  level: KnifeLevel;
  breakIndex: number;
  breakTime: number;
  breakDistanceATR: number;
  breakType: 'close' | 'wick_accept';
}

// TF-specific recency decay (tau in seconds)
const TAU_BY_TF: Record<string, number> = {
  '15m': 18 * 3600,     // 18 hours
  '1h': 3 * 24 * 3600,  // 3 days
  '4h': 10 * 24 * 3600, // 10 days
};

/**
 * Calculate level score with TF-specific recency decay
 */
function calculateLevelScore(
  level: KnifeLevel,
  currentPrice: number,
  nowSec: number,
  tf: '15m' | '1h' | '4h'
): number {
  const tau = TAU_BY_TF[tf] || 18 * 3600;

  const touchesScore = Math.min(level.touches, 6);
  const recencyScore = Math.exp(-(nowSec - level.lastTouchTime) / tau);
  const proxScore = 1 / (1 + Math.abs(level.price - currentPrice) / currentPrice * 50);

  return touchesScore * 1.2 + recencyScore * 2.0 + proxScore * 0.8;
}

/**
 * Find key support/resistance levels from OHLC data using swing points
 */
export function findKeyLevelsForKnife(
  ohlc: OHLCData[],
  tf: '15m' | '1h' | '4h',
  lookback: number = 3
): KnifeLevel[] {
  if (ohlc.length < 20) return [];

  const currentPrice = ohlc[ohlc.length - 1].close;
  const nowSec = ohlc[ohlc.length - 1].time; // Use OHLC time, not Date.now()

  // Find swing points
  const swings = findSwingPoints(ohlc, lookback);

  // Convert swing points to knife levels
  const levels: KnifeLevel[] = swings.map(swing => ({
    price: swing.price,
    type: swing.type === 'low' ? 'support' : 'resistance',
    touches: 1,
    lastTouchTime: ohlc[swing.index].time, // OHLC candle time in SECONDS
    source: `swing_${swing.type}`,
    score: 0, // Will be computed below
  }));

  // Calculate scores
  for (const level of levels) {
    level.score = calculateLevelScore(level, currentPrice, nowSec, tf);
  }

  // Sort by score descending and return top 30
  return levels
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

/**
 * Merge levels from multiple timeframes with clamped ATR-based tolerance
 * Scores are recomputed after merging (not summed)
 */
export function mergeKnifeLevels(
  levelsByTf: Array<{ tf: '15m' | '1h' | '4h'; levels: KnifeLevel[] }>,
  atr15m: number,
  currentPrice: number,
  nowSec: number
): KnifeLevel[] {
  if (currentPrice === 0) return [];

  // Clamped ATR-based tolerance (prevents over/under-merge)
  const rawTol = (0.15 * atr15m) / currentPrice;
  const tolerancePct = Math.max(0.0015, Math.min(0.006, rawTol));

  // Step 1: Merge into clusters using ROLLING CENTROID
  interface Cluster {
    priceSum: number;       // Sum for rolling average
    priceCount: number;     // Count for rolling average
    touches: number;
    lastTouchTime: number;  // max across all merged levels
    tfFlags: Set<string>;   // which TFs contributed
    type: 'support' | 'resistance';
  }
  const clusters: Cluster[] = [];

  for (const { tf, levels } of levelsByTf) {
    for (const lvl of levels) {
      // Compare to cluster AVERAGE price, not first price
      const hit = clusters.find(c => {
        const avgPrice = c.priceSum / c.priceCount;
        return Math.abs(avgPrice - lvl.price) / lvl.price < tolerancePct &&
               c.type === lvl.type;
      });
      if (hit) {
        hit.priceSum += lvl.price;
        hit.priceCount += 1;
        hit.touches += lvl.touches;
        hit.lastTouchTime = Math.max(hit.lastTouchTime, lvl.lastTouchTime);
        hit.tfFlags.add(tf);
      } else {
        clusters.push({
          priceSum: lvl.price,
          priceCount: 1,
          touches: lvl.touches,
          lastTouchTime: lvl.lastTouchTime,
          tfFlags: new Set([tf]),
          type: lvl.type,
        });
      }
    }
  }

  // Step 2: Recompute score ONCE from merged properties
  const merged: KnifeLevel[] = clusters.map(c => {
    const avgPrice = c.priceSum / c.priceCount;

    // TF bonus: +1.5 per extra TF beyond first
    const tfBonus = (c.tfFlags.size - 1) * 1.5;

    // Use blended tau based on highest TF present
    const tau = c.tfFlags.has('4h') ? 10 * 24 * 3600
              : c.tfFlags.has('1h') ? 3 * 24 * 3600
              : 18 * 3600;

    const touchesScore = Math.min(c.touches, 6);
    const recencyScore = Math.exp(-(nowSec - c.lastTouchTime) / tau);
    const proxScore = 1 / (1 + Math.abs(avgPrice - currentPrice) / currentPrice * 50);

    const score = touchesScore * 1.2 + recencyScore * 2.0 + proxScore * 0.8 + tfBonus;

    return {
      price: avgPrice,
      type: c.type,
      touches: c.touches,
      score,
      lastTouchTime: c.lastTouchTime,
      source: Array.from(c.tfFlags).join('+'),
    };
  });

  // Return sorted by score descending
  return merged.sort((a, b) => b.score - a.score);
}

/**
 * Select the most recently broken level using 2-step break definition
 * Recency-first: picks the most recently broken level, not the strongest far level
 */
export function selectBrokenLevel(
  mergedLevels: KnifeLevel[],
  ohlc15m: OHLCData[],
  atr15m: number,
  direction: 'down' | 'up',
  lookback: number = 50
): BrokenLevelResult | null {
  if (mergedLevels.length === 0 || ohlc15m.length < lookback || atr15m === 0) {
    return null;
  }

  const last = ohlc15m.length - 1;
  const searchStart = Math.max(0, last - lookback);

  // Filter top 20 levels by score, then filter by type
  const candidates = mergedLevels
    .slice(0, 20)
    .filter(lvl => direction === 'down' ? lvl.type === 'support' : lvl.type === 'resistance');

  if (candidates.length === 0) return null;

  // Thresholds for 2-step break detection
  const CLOSE_BREAK_ATR = 0.35;
  const WICK_BREAK_ATR = 0.6;
  const WICK_ACCEPT_ATR = 0.2;

  interface BreakMatch {
    level: KnifeLevel;
    breakIndex: number;
    candlesAgo: number;
    breakType: 'close' | 'wick_accept';
    breakDistanceATR: number;
  }

  const matches: BreakMatch[] = [];

  for (const level of candidates) {
    // Scan from most recent to oldest within lookback
    for (let i = last; i >= searchStart; i--) {
      const candle = ohlc15m[i];

      if (direction === 'down') {
        // Check support break (price falling through)
        const closeDistance = level.price - candle.close;
        const closeDistanceATR = closeDistance / atr15m;

        // Step A: Close break
        if (closeDistanceATR >= CLOSE_BREAK_ATR) {
          matches.push({
            level,
            breakIndex: i,
            candlesAgo: last - i,
            breakType: 'close',
            breakDistanceATR: closeDistanceATR,
          });
          break; // Found most recent break for this level
        }

        // Step B: Wick + accept pattern
        const wickDistance = level.price - candle.low;
        const wickDistanceATR = wickDistance / atr15m;

        if (wickDistanceATR >= WICK_BREAK_ATR && i < last) {
          // Check next candle for acceptance
          const nextCandle = ohlc15m[i + 1];
          const nextCloseDistance = level.price - nextCandle.close;
          const nextCloseDistanceATR = nextCloseDistance / atr15m;

          if (nextCloseDistanceATR >= WICK_ACCEPT_ATR) {
            matches.push({
              level,
              breakIndex: i + 1, // Break confirmed on accept candle
              candlesAgo: last - (i + 1),
              breakType: 'wick_accept',
              breakDistanceATR: nextCloseDistanceATR,
            });
            break;
          }
        }
      } else {
        // Check resistance break (price rising through)
        const closeDistance = candle.close - level.price;
        const closeDistanceATR = closeDistance / atr15m;

        // Step A: Close break
        if (closeDistanceATR >= CLOSE_BREAK_ATR) {
          matches.push({
            level,
            breakIndex: i,
            candlesAgo: last - i,
            breakType: 'close',
            breakDistanceATR: closeDistanceATR,
          });
          break;
        }

        // Step B: Wick + accept pattern
        const wickDistance = candle.high - level.price;
        const wickDistanceATR = wickDistance / atr15m;

        if (wickDistanceATR >= WICK_BREAK_ATR && i < last) {
          const nextCandle = ohlc15m[i + 1];
          const nextCloseDistance = nextCandle.close - level.price;
          const nextCloseDistanceATR = nextCloseDistance / atr15m;

          if (nextCloseDistanceATR >= WICK_ACCEPT_ATR) {
            matches.push({
              level,
              breakIndex: i + 1,
              candlesAgo: last - (i + 1),
              breakType: 'wick_accept',
              breakDistanceATR: nextCloseDistanceATR,
            });
            break;
          }
        }
      }
    }
  }

  if (matches.length === 0) return null;

  // Pick most recent break (smallest candlesAgo)
  // Tie-breaker: higher level score
  matches.sort((a, b) => {
    if (a.candlesAgo !== b.candlesAgo) {
      return a.candlesAgo - b.candlesAgo; // Recency first
    }
    return b.level.score - a.level.score; // Then by score
  });

  const best = matches[0];

  return {
    level: best.level,
    breakIndex: best.breakIndex,
    breakTime: ohlc15m[best.breakIndex].time,
    breakDistanceATR: best.breakDistanceATR,
    breakType: best.breakType,
  };
}

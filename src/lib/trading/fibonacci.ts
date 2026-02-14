/**
 * Fibonacci Level Calculator
 *
 * Computes retracement and extension levels from swing points.
 * Levels feed into the confluent S/R pipeline in chart-context.ts,
 * NOT as a standalone signal.
 */

import type { SwingPoint, PriceLevel } from './chart-context';

export interface FibonacciResult {
  levels: PriceLevel[];
  swingHigh: number;
  swingLow: number;
  range: number;
}

/**
 * Calculate Fibonacci retracement and extension levels from swing points.
 *
 * Returns PriceLevel[] that feed directly into the confluent level pipeline.
 * Each Fib level gets touches=1, strength='moderate', and a descriptive source.
 */
export function calculateFibonacciLevels(
  swings: SwingPoint[],
  currentPrice: number,
  config: {
    ratios: number[];
    extensions: number[];
    minSwingRangeATRMultiple: number;
  },
  atr?: number,
  sourceTimeframe?: number
): FibonacciResult | null {
  if (swings.length < 2) return null;

  // Find most recent confirmed swing high and swing low
  const swingHighs = swings.filter(s => s.type === 'high');
  const swingLows = swings.filter(s => s.type === 'low');

  if (swingHighs.length === 0 || swingLows.length === 0) return null;

  const recentHigh = swingHighs[swingHighs.length - 1];
  const recentLow = swingLows[swingLows.length - 1];

  const swingHigh = recentHigh.price;
  const swingLow = recentLow.price;
  const range = swingHigh - swingLow;

  if (range <= 0) return null;

  // Validate range vs ATR — prevent Fibs on tiny noise swings
  if (atr && atr > 0 && range < config.minSwingRangeATRMultiple * atr) {
    return null;
  }

  const levels: PriceLevel[] = [];

  const tfSuffix = sourceTimeframe ? `@tf${sourceTimeframe}` : '';

  // Retracement levels: swingHigh - ratio * range
  for (const ratio of config.ratios) {
    const price = swingHigh - ratio * range;
    levels.push({
      price,
      type: price < currentPrice ? 'support' : 'resistance',
      touches: 1,
      strength: 'moderate',
      sources: [`fib_${ratio}${tfSuffix}`],
    });
  }

  // Extension levels (upward): swingHigh + (ext - 1) * range
  for (const ext of config.extensions) {
    const priceUp = swingHigh + (ext - 1) * range;
    levels.push({
      price: priceUp,
      type: priceUp > currentPrice ? 'resistance' : 'support',
      touches: 1,
      strength: 'moderate',
      sources: [`fib_ext_${ext}${tfSuffix}`],
    });
  }

  // Extension levels (downward): swingLow - (ext - 1) * range
  for (const ext of config.extensions) {
    const priceDown = swingLow - (ext - 1) * range;
    if (priceDown > 0) {
      levels.push({
        price: priceDown,
        type: priceDown < currentPrice ? 'support' : 'resistance',
        touches: 1,
        strength: 'moderate',
        sources: [`fib_ext_${ext}${tfSuffix}`],
      });
    }
  }

  return { levels, swingHigh, swingLow, range };
}

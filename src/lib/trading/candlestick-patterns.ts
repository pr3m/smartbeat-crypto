/**
 * Candlestick Pattern Detection Library
 *
 * Professional-grade candlestick pattern recognition for crypto trading.
 * Detects 40+ patterns across single, two-candle, and three-candle formations
 * with crypto-specific adjustments (wider doji thresholds, no gap requirements
 * for 24/7 markets, volume confirmation weighting).
 *
 * Each pattern detector validates candle proportions, considers context
 * (prior trend direction), and returns a reliability score tuned for
 * crypto volatility.
 */

import type { OHLCData } from '@/lib/kraken/types';

// ============================================================================
// TYPES
// ============================================================================

export interface ExtendedCandlestickPattern {
  name: string;
  type:
    | 'reversal_bullish'
    | 'reversal_bearish'
    | 'continuation_bullish'
    | 'continuation_bearish'
    | 'indecision';
  reliability: number; // 0-1
  strength: number; // 0-1 based on actual proportions
  description: string;
  timeframe?: number;
  candlesUsed: number; // 1, 2, or 3
}

export interface ExhaustionSignal {
  detected: boolean;
  direction: 'bullish_exhaustion' | 'bearish_exhaustion';
  score: number; // 0-100
  signals: string[];
  description: string;
}

export interface ReversalScore {
  score: number; // 0-100
  direction: 'bullish' | 'bearish';
  patterns: ExtendedCandlestickPattern[];
  description: string;
}

// ============================================================================
// CANDLE ANALYSIS HELPERS
// ============================================================================

/** Absolute body size (|close - open|) */
function bodySize(c: OHLCData): number {
  return Math.abs(c.close - c.open);
}

/** Total range from high to low */
function totalRange(c: OHLCData): number {
  return c.high - c.low;
}

/** Body as a fraction of total range (0-1) */
function bodyPercent(c: OHLCData): number {
  const range = totalRange(c);
  if (range === 0) return 0;
  return bodySize(c) / range;
}

/** Upper shadow length */
function upperShadow(c: OHLCData): number {
  return c.high - Math.max(c.open, c.close);
}

/** Lower shadow length */
function lowerShadow(c: OHLCData): number {
  return Math.min(c.open, c.close) - c.low;
}

/** True if close > open */
function isBullish(c: OHLCData): boolean {
  return c.close > c.open;
}

/** True if close < open */
function isBearish(c: OHLCData): boolean {
  return c.close < c.open;
}

/**
 * Doji detection with configurable threshold.
 * Crypto uses a wider threshold (0.15) vs traditional (0.05) because
 * liquidation cascades create large wicks even on indecision candles.
 */
function isDoji(c: OHLCData, threshold = 0.15): boolean {
  const range = totalRange(c);
  if (range === 0) return true;
  return bodySize(c) / range < threshold;
}

/** Average body size across a set of candles (for context sizing) */
function avgBodySize(candles: OHLCData[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, c) => sum + bodySize(c), 0) / candles.length;
}

/** Average total range across candles (proxy for volatility / ATR) */
function avgRange(candles: OHLCData[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, c) => sum + totalRange(c), 0) / candles.length;
}

/** Body midpoint */
function bodyMid(c: OHLCData): number {
  return (c.open + c.close) / 2;
}

/** Real body top (max of open, close) */
function bodyTop(c: OHLCData): number {
  return Math.max(c.open, c.close);
}

/** Real body bottom (min of open, close) */
function bodyBottom(c: OHLCData): number {
  return Math.min(c.open, c.close);
}

/**
 * Determine the short-term trend direction from preceding candles.
 * Looks at the net price movement over the lookback window.
 * Returns a score: positive = uptrend, negative = downtrend.
 */
function priorTrend(candles: OHLCData[], lookback = 5): number {
  if (candles.length < 2) return 0;
  const window = candles.slice(-lookback);
  const first = window[0];
  const last = window[window.length - 1];
  const move = (last.close - first.close) / first.close;
  // Count bullish vs bearish candles for confirmation
  let bullCount = 0;
  let bearCount = 0;
  for (const c of window) {
    if (isBullish(c)) bullCount++;
    else if (isBearish(c)) bearCount++;
  }
  const directionBias = (bullCount - bearCount) / window.length;
  return move * 100 + directionBias * 2; // Weighted combo
}

/**
 * Volume confirmation bonus.
 * If the current candle's volume is significantly above the average
 * of the preceding candles, the pattern is more reliable.
 */
function volumeConfirmation(current: OHLCData, context: OHLCData[]): number {
  if (context.length === 0 || current.volume <= 0) return 0;
  const avgVol = context.reduce((s, c) => s + c.volume, 0) / context.length;
  if (avgVol <= 0) return 0;
  const ratio = current.volume / avgVol;
  if (ratio >= 2.0) return 0.1;
  if (ratio >= 1.5) return 0.05;
  return 0;
}

/**
 * Volatility adjustment for single-candle pattern reliability.
 * In highly volatile conditions (large ATR-equivalent ranges),
 * single-candle patterns are less reliable.
 */
function volatilityPenalty(current: OHLCData, context: OHLCData[]): number {
  if (context.length < 3) return 0;
  const avg = avgRange(context);
  if (avg === 0) return 0;
  const ratio = totalRange(current) / avg;
  // If current candle range is >2x average, penalize reliability
  if (ratio > 3.0) return -0.1;
  if (ratio > 2.0) return -0.05;
  return 0;
}

/** Clamp a value between min and max */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ============================================================================
// SINGLE-CANDLE PATTERNS
// ============================================================================

/**
 * Standard Doji - Open and close are nearly equal with visible wicks.
 * Indicates market indecision; neither buyers nor sellers dominate.
 */
function detectDoji(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const bodyRatio = bodySize(c) / range;
  // Crypto threshold: body < 15% of range
  if (bodyRatio >= 0.15) return null;

  // Must have visible range (not a flat candle)
  const avg = avgRange(context);
  if (avg > 0 && range < avg * 0.2) return null;

  const upper = upperShadow(c);
  const lower = lowerShadow(c);
  const wickBalance =
    Math.max(upper, lower) > 0
      ? Math.min(upper, lower) / Math.max(upper, lower)
      : 1;

  const strength = clamp((1 - bodyRatio) * (0.5 + wickBalance * 0.5), 0, 1);
  let reliability = 0.35 + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.1, 0.5);

  return {
    name: 'doji',
    type: 'indecision',
    reliability,
    strength,
    description: 'Doji — market indecision, open and close nearly equal',
    candlesUsed: 1,
  };
}

/**
 * Long-Legged Doji - Doji with exceptionally long upper and lower shadows.
 * Signals extreme indecision with wide price exploration in both directions.
 */
function detectLongLeggedDoji(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const bodyRatio = bodySize(c) / range;
  if (bodyRatio >= 0.15) return null;

  const upper = upperShadow(c);
  const lower = lowerShadow(c);

  // Both shadows must be significant (each at least 35% of range)
  if (upper < range * 0.35 || lower < range * 0.35) return null;

  // Range should be large relative to context
  const avg = avgRange(context);
  if (avg > 0 && range < avg * 0.8) return null;

  const wickBalance =
    Math.max(upper, lower) > 0
      ? Math.min(upper, lower) / Math.max(upper, lower)
      : 1;
  const strength = clamp((1 - bodyRatio) * wickBalance, 0, 1);
  let reliability = 0.4 + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.1, 0.5);

  return {
    name: 'long_legged_doji',
    type: 'indecision',
    reliability,
    strength,
    description:
      'Long-Legged Doji — extreme indecision with wide price exploration both ways',
    candlesUsed: 1,
  };
}

/**
 * Dragonfly Doji - Doji with a long lower shadow and no/tiny upper shadow.
 * At a bottom, signals bullish reversal potential (buyers rejected lower prices).
 */
function detectDragonflyDoji(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const bodyRatio = bodySize(c) / range;
  if (bodyRatio >= 0.15) return null;

  const upper = upperShadow(c);
  const lower = lowerShadow(c);

  // Long lower shadow, tiny or no upper shadow
  if (lower < range * 0.6) return null;
  if (upper > range * 0.1) return null;

  const trend = priorTrend(context);
  // More significant in a downtrend (reversal)
  const contextBonus = trend < -1 ? 0.1 : 0;

  const strength = clamp(lower / range, 0, 1);
  let reliability =
    0.4 + contextBonus + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.1, 0.5);

  return {
    name: 'dragonfly_doji',
    type: trend < -1 ? 'reversal_bullish' : 'indecision',
    reliability,
    strength,
    description:
      'Dragonfly Doji — long lower shadow, buyers rejected lower prices; bullish at bottoms',
    candlesUsed: 1,
  };
}

/**
 * Gravestone Doji - Doji with a long upper shadow and no/tiny lower shadow.
 * At a top, signals bearish reversal potential (sellers rejected higher prices).
 */
function detectGravestoneDoji(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const bodyRatio = bodySize(c) / range;
  if (bodyRatio >= 0.15) return null;

  const upper = upperShadow(c);
  const lower = lowerShadow(c);

  // Long upper shadow, tiny or no lower shadow
  if (upper < range * 0.6) return null;
  if (lower > range * 0.1) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.1 : 0;

  const strength = clamp(upper / range, 0, 1);
  let reliability =
    0.4 + contextBonus + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.1, 0.5);

  return {
    name: 'gravestone_doji',
    type: trend > 1 ? 'reversal_bearish' : 'indecision',
    reliability,
    strength,
    description:
      'Gravestone Doji — long upper shadow, sellers rejected higher prices; bearish at tops',
    candlesUsed: 1,
  };
}

/**
 * Hammer - Small body at the top of the range, long lower shadow >= 2x body.
 * Classic bullish reversal when found after a downtrend.
 * The candle color is secondary; the wick rejection is what matters.
 */
function detectHammer(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const body = bodySize(c);
  const lower = lowerShadow(c);
  const upper = upperShadow(c);

  // Body must exist but be small relative to range
  if (body < range * 0.05 || body > range * 0.4) return null;
  // Lower shadow at least 2x body
  if (lower < body * 2) return null;
  // Upper shadow must be small
  if (upper > body * 0.5) return null;

  const trend = priorTrend(context);
  // Hammer is only meaningful after a decline
  if (trend > 2) return null;

  const wickRatio = lower / Math.max(body, 0.0001);
  const contextBonus = trend < -2 ? 0.1 : 0;

  const strength = clamp(0.5 + (wickRatio - 2) * 0.1 + (isBullish(c) ? 0.05 : 0), 0, 1);
  let reliability =
    0.4 + contextBonus + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.15, 0.5);

  return {
    name: 'hammer',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Hammer — long lower wick rejection after decline; bullish reversal signal',
    candlesUsed: 1,
  };
}

/**
 * Inverted Hammer - Small body at the bottom of the range, long upper shadow >= 2x body.
 * Bullish reversal after a downtrend; buyers attempted to push higher.
 */
function detectInvertedHammer(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const body = bodySize(c);
  const lower = lowerShadow(c);
  const upper = upperShadow(c);

  if (body < range * 0.05 || body > range * 0.4) return null;
  if (upper < body * 2) return null;
  if (lower > body * 0.5) return null;

  const trend = priorTrend(context);
  if (trend > 2) return null;

  const wickRatio = upper / Math.max(body, 0.0001);
  const contextBonus = trend < -2 ? 0.1 : 0;

  const strength = clamp(0.45 + (wickRatio - 2) * 0.1, 0, 1);
  let reliability =
    0.35 + contextBonus + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.1, 0.5);

  return {
    name: 'inverted_hammer',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Inverted Hammer — long upper wick after decline; buyers testing higher, bullish',
    candlesUsed: 1,
  };
}

/**
 * Shooting Star - Small body at the bottom, long upper shadow >= 2x body.
 * Bearish reversal after an uptrend; buyers pushed high but sellers drove it back.
 */
function detectShootingStar(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const body = bodySize(c);
  const lower = lowerShadow(c);
  const upper = upperShadow(c);

  if (body < range * 0.05 || body > range * 0.4) return null;
  if (upper < body * 2) return null;
  if (lower > body * 0.5) return null;

  const trend = priorTrend(context);
  // Shooting star is only meaningful after a rally
  if (trend < -2) return null;

  const wickRatio = upper / Math.max(body, 0.0001);
  const contextBonus = trend > 2 ? 0.1 : 0;

  const strength = clamp(0.5 + (wickRatio - 2) * 0.1 + (isBearish(c) ? 0.05 : 0), 0, 1);
  let reliability =
    0.4 + contextBonus + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.15, 0.5);

  return {
    name: 'shooting_star',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Shooting Star — long upper wick rejection after rally; bearish reversal signal',
    candlesUsed: 1,
  };
}

/**
 * Hanging Man - Same shape as a Hammer but appears after an uptrend.
 * Small body at top, long lower shadow; warns that selling pressure is appearing.
 */
function detectHangingMan(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const body = bodySize(c);
  const lower = lowerShadow(c);
  const upper = upperShadow(c);

  if (body < range * 0.05 || body > range * 0.4) return null;
  if (lower < body * 2) return null;
  if (upper > body * 0.5) return null;

  const trend = priorTrend(context);
  // Hanging man only appears after an uptrend
  if (trend < 1) return null;

  const wickRatio = lower / Math.max(body, 0.0001);
  const contextBonus = trend > 3 ? 0.1 : 0;

  const strength = clamp(0.45 + (wickRatio - 2) * 0.1 + (isBearish(c) ? 0.05 : 0), 0, 1);
  let reliability =
    0.35 + contextBonus + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.1, 0.5);

  return {
    name: 'hanging_man',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Hanging Man — hammer-shaped candle after uptrend; warns of selling pressure',
    candlesUsed: 1,
  };
}

/**
 * Spinning Top - Small body with upper and lower shadows of roughly equal length.
 * Represents indecision; neither side controls.
 */
function detectSpinningTop(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  const range = totalRange(c);
  if (range === 0) return null;

  const body = bodySize(c);
  const upper = upperShadow(c);
  const lower = lowerShadow(c);

  // Body must be small (15-40% of range)
  const bodyRatio = body / range;
  if (bodyRatio < 0.15 || bodyRatio > 0.4) return null;

  // Both shadows must be visible and somewhat balanced
  if (upper < range * 0.15 || lower < range * 0.15) return null;
  const shadowBalance =
    Math.max(upper, lower) > 0
      ? Math.min(upper, lower) / Math.max(upper, lower)
      : 0;
  if (shadowBalance < 0.4) return null;

  const strength = clamp((1 - bodyRatio) * shadowBalance, 0, 1);
  let reliability = 0.3 + volumeConfirmation(c, context) + volatilityPenalty(c, context);
  reliability = clamp(reliability, 0.1, 0.45);

  return {
    name: 'spinning_top',
    type: 'indecision',
    reliability,
    strength,
    description:
      'Spinning Top — small body with balanced shadows; market indecision',
    candlesUsed: 1,
  };
}

/**
 * Bullish Marubozu - Large bullish body with no/tiny shadows.
 * Shows extreme buyer conviction; strong continuation or reversal depending on context.
 */
function detectBullishMarubozu(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c)) return null;

  const range = totalRange(c);
  if (range === 0) return null;

  const body = bodySize(c);
  const upper = upperShadow(c);
  const lower = lowerShadow(c);

  // Body must be very dominant (>85% of range)
  if (body < range * 0.85) return null;

  // Shadows must be tiny
  if (upper > range * 0.08 || lower > range * 0.08) return null;

  // Body should be significant relative to context
  const avg = avgBodySize(context);
  const sizeBonus = avg > 0 && body > avg * 1.5 ? 0.1 : 0;

  const strength = clamp(body / range + sizeBonus, 0, 1);
  let reliability = 0.4 + sizeBonus + volumeConfirmation(c, context);
  reliability = clamp(reliability, 0.2, 0.5);

  return {
    name: 'bullish_marubozu',
    type: 'continuation_bullish',
    reliability,
    strength,
    description:
      'Bullish Marubozu — full-body green candle with no shadows; extreme buyer conviction',
    candlesUsed: 1,
  };
}

/**
 * Bearish Marubozu - Large bearish body with no/tiny shadows.
 * Shows extreme seller conviction.
 */
function detectBearishMarubozu(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c)) return null;

  const range = totalRange(c);
  if (range === 0) return null;

  const body = bodySize(c);
  const upper = upperShadow(c);
  const lower = lowerShadow(c);

  if (body < range * 0.85) return null;
  if (upper > range * 0.08 || lower > range * 0.08) return null;

  const avg = avgBodySize(context);
  const sizeBonus = avg > 0 && body > avg * 1.5 ? 0.1 : 0;

  const strength = clamp(body / range + sizeBonus, 0, 1);
  let reliability = 0.4 + sizeBonus + volumeConfirmation(c, context);
  reliability = clamp(reliability, 0.2, 0.5);

  return {
    name: 'bearish_marubozu',
    type: 'continuation_bearish',
    reliability,
    strength,
    description:
      'Bearish Marubozu — full-body red candle with no shadows; extreme seller conviction',
    candlesUsed: 1,
  };
}

// ============================================================================
// TWO-CANDLE PATTERNS
// ============================================================================

/**
 * Bullish Engulfing - A large bullish candle completely engulfs the prior bearish candle's body.
 * One of the most reliable two-candle reversal patterns.
 */
function detectBullishEngulfing(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(prev) || !isBullish(curr)) return null;

  const currTop = bodyTop(curr);
  const currBot = bodyBottom(curr);
  const prevTop = bodyTop(prev);
  const prevBot = bodyBottom(prev);

  // Current body must fully engulf previous body
  if (currTop <= prevTop || currBot >= prevBot) return null;

  const engulfRatio = bodySize(curr) / Math.max(bodySize(prev), 0.0001);
  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.1 : 0;

  const strength = clamp(0.5 + (engulfRatio - 1) * 0.15 + contextBonus, 0, 1);
  let reliability =
    0.55 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.7);

  return {
    name: 'bullish_engulfing',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Bullish Engulfing — buyers overwhelmed sellers with a candle that fully engulfs the prior body',
    candlesUsed: 2,
  };
}

/**
 * Bearish Engulfing - A large bearish candle completely engulfs the prior bullish candle's body.
 */
function detectBearishEngulfing(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(prev) || !isBearish(curr)) return null;

  const currTop = bodyTop(curr);
  const currBot = bodyBottom(curr);
  const prevTop = bodyTop(prev);
  const prevBot = bodyBottom(prev);

  if (currTop <= prevTop || currBot >= prevBot) return null;

  const engulfRatio = bodySize(curr) / Math.max(bodySize(prev), 0.0001);
  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.1 : 0;

  const strength = clamp(0.5 + (engulfRatio - 1) * 0.15 + contextBonus, 0, 1);
  let reliability =
    0.55 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.7);

  return {
    name: 'bearish_engulfing',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Bearish Engulfing — sellers overwhelmed buyers with a candle that fully engulfs the prior body',
    candlesUsed: 2,
  };
}

/**
 * Piercing Line - After a bearish candle, a bullish candle opens below
 * the prior low and closes above the midpoint of the prior body.
 * Moderate bullish reversal signal.
 */
function detectPiercingLine(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(prev) || !isBullish(curr)) return null;

  const prevMid = bodyMid(prev);

  // In crypto (24/7 market), we relax the "open below prior low" to
  // "open below or near prior body bottom"
  if (curr.open > bodyBottom(prev) * 1.002) return null;

  // Must close above the midpoint of the prior candle's body
  if (curr.close <= prevMid) return null;

  // But not fully engulfing (that would be engulfing)
  if (curr.close >= bodyTop(prev)) return null;

  const penetration =
    (curr.close - bodyBottom(prev)) / Math.max(bodySize(prev), 0.0001);
  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.05 : 0;

  const strength = clamp(0.4 + penetration * 0.2 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.65);

  return {
    name: 'piercing_line',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Piercing Line — bullish candle opens low and closes above prior midpoint; moderate reversal',
    candlesUsed: 2,
  };
}

/**
 * Dark Cloud Cover - After a bullish candle, a bearish candle opens above
 * the prior high and closes below the midpoint of the prior body.
 * Moderate bearish reversal signal.
 */
function detectDarkCloudCover(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(prev) || !isBearish(curr)) return null;

  const prevMid = bodyMid(prev);

  // Crypto relaxation: open at or above prior body top
  if (curr.open < bodyTop(prev) * 0.998) return null;

  // Must close below the midpoint of the prior candle's body
  if (curr.close >= prevMid) return null;

  // But not fully engulfing
  if (curr.close <= bodyBottom(prev)) return null;

  const penetration =
    (bodyTop(prev) - curr.close) / Math.max(bodySize(prev), 0.0001);
  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.05 : 0;

  const strength = clamp(0.4 + penetration * 0.2 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.65);

  return {
    name: 'dark_cloud_cover',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Dark Cloud Cover — bearish candle opens high and closes below prior midpoint; moderate reversal',
    candlesUsed: 2,
  };
}

/**
 * Tweezer Bottom - Two consecutive candles share roughly the same low.
 * The first is bearish, the second bullish. Signals support at that level.
 */
function detectTweezerBottom(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(prev) || !isBullish(curr)) return null;

  const avg = avgRange(context);
  if (avg === 0) return null;

  // Lows must be within 0.2% of each other (or within 5% of average range)
  const lowDiff = Math.abs(prev.low - curr.low);
  const threshold = Math.min(avg * 0.05, prev.low * 0.002);
  if (lowDiff > threshold) return null;

  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.1 : 0;

  const precision = 1 - lowDiff / Math.max(threshold, 0.0001);
  const strength = clamp(0.4 + precision * 0.3 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.65);

  return {
    name: 'tweezer_bottom',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Tweezer Bottom — two candles share the same low; strong support level, bullish reversal',
    candlesUsed: 2,
  };
}

/**
 * Tweezer Top - Two consecutive candles share roughly the same high.
 * The first is bullish, the second bearish. Signals resistance at that level.
 */
function detectTweezerTop(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(prev) || !isBearish(curr)) return null;

  const avg = avgRange(context);
  if (avg === 0) return null;

  const highDiff = Math.abs(prev.high - curr.high);
  const threshold = Math.min(avg * 0.05, prev.high * 0.002);
  if (highDiff > threshold) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.1 : 0;

  const precision = 1 - highDiff / Math.max(threshold, 0.0001);
  const strength = clamp(0.4 + precision * 0.3 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.65);

  return {
    name: 'tweezer_top',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Tweezer Top — two candles share the same high; strong resistance level, bearish reversal',
    candlesUsed: 2,
  };
}

/**
 * Bullish Harami - A small bullish candle is contained within the prior large bearish candle.
 * The "inside bar" variant suggests the selling pressure is weakening.
 */
function detectBullishHarami(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(prev) || !isBullish(curr)) return null;

  // Current body must be inside previous body
  if (bodyTop(curr) >= bodyTop(prev) || bodyBottom(curr) <= bodyBottom(prev)) return null;

  // Previous body should be large relative to context
  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(prev) < avg * 0.8) return null;

  // Current body should be noticeably smaller
  const sizeRatio = bodySize(curr) / Math.max(bodySize(prev), 0.0001);
  if (sizeRatio > 0.6) return null;

  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.05 : 0;

  const strength = clamp(0.4 + (1 - sizeRatio) * 0.3 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.6);

  return {
    name: 'bullish_harami',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Bullish Harami — small bullish candle inside prior large bearish candle; selling pressure fading',
    candlesUsed: 2,
  };
}

/**
 * Bearish Harami - A small bearish candle is contained within the prior large bullish candle.
 */
function detectBearishHarami(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(prev) || !isBearish(curr)) return null;

  if (bodyTop(curr) >= bodyTop(prev) || bodyBottom(curr) <= bodyBottom(prev)) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(prev) < avg * 0.8) return null;

  const sizeRatio = bodySize(curr) / Math.max(bodySize(prev), 0.0001);
  if (sizeRatio > 0.6) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.05 : 0;

  const strength = clamp(0.4 + (1 - sizeRatio) * 0.3 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.6);

  return {
    name: 'bearish_harami',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Bearish Harami — small bearish candle inside prior large bullish candle; buying pressure fading',
    candlesUsed: 2,
  };
}

/**
 * Bullish Kicker - A bearish candle is followed by a bullish candle that opens
 * at or above the prior open. One of the most powerful two-candle reversal patterns.
 * In crypto we relax the gap requirement to "opens at or above prior open".
 */
function detectBullishKicker(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(prev) || !isBullish(curr)) return null;

  // Bullish kicker: current opens at or above previous open
  if (curr.open < prev.open * 0.998) return null;

  // Both candles should have significant bodies
  const avg = avgBodySize(context);
  if (avg > 0 && (bodySize(prev) < avg * 0.5 || bodySize(curr) < avg * 0.5)) return null;

  const gapSize = (curr.open - prev.open) / Math.max(prev.open, 0.0001);
  const gapBonus = gapSize > 0.005 ? 0.1 : 0; // True gap adds reliability

  const strength = clamp(
    0.6 + gapBonus + (bodySize(curr) / Math.max(bodySize(prev), 0.0001) - 1) * 0.1,
    0,
    1
  );
  let reliability = 0.6 + gapBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.4, 0.7);

  return {
    name: 'bullish_kicker',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Bullish Kicker — powerful reversal: bearish candle followed by bullish candle opening above prior open',
    candlesUsed: 2,
  };
}

/**
 * Bearish Kicker - A bullish candle is followed by a bearish candle that opens
 * at or below the prior open.
 */
function detectBearishKicker(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(prev) || !isBearish(curr)) return null;

  if (curr.open > prev.open * 1.002) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && (bodySize(prev) < avg * 0.5 || bodySize(curr) < avg * 0.5)) return null;

  const gapSize = (prev.open - curr.open) / Math.max(prev.open, 0.0001);
  const gapBonus = gapSize > 0.005 ? 0.1 : 0;

  const strength = clamp(
    0.6 + gapBonus + (bodySize(curr) / Math.max(bodySize(prev), 0.0001) - 1) * 0.1,
    0,
    1
  );
  let reliability = 0.6 + gapBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.4, 0.7);

  return {
    name: 'bearish_kicker',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Bearish Kicker — powerful reversal: bullish candle followed by bearish candle opening below prior open',
    candlesUsed: 2,
  };
}

// ============================================================================
// THREE-CANDLE PATTERNS
// ============================================================================

/**
 * Morning Star - Classic three-candle bullish reversal.
 * 1) Large bearish candle, 2) small-bodied candle (star), 3) large bullish candle
 * that closes above the midpoint of candle 1's body.
 *
 * Crypto adjustment: no gap requirement between candles (24/7 market).
 */
function detectMorningStar(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  // Candle 1: large bearish body
  if (!isBearish(c1)) return null;
  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c1) < avg * 0.7) return null;

  // Candle 2: small body (star), significantly smaller than both c1 and c3
  if (bodySize(c2) > bodySize(c1) * 0.4) return null;
  if (bodySize(c2) > bodySize(c3) * 0.4) return null;

  // Candle 3: large bullish body
  if (!isBullish(c3)) return null;
  if (avg > 0 && bodySize(c3) < avg * 0.5) return null;

  // Candle 3 must close above the midpoint of candle 1's body
  const c1Mid = bodyMid(c1);
  if (c3.close <= c1Mid) return null;

  const recoveryRatio = bodySize(c3) / Math.max(bodySize(c1), 0.0001);
  const starSmallness = 1 - bodySize(c2) / Math.max(bodySize(c1), 0.0001);
  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.05 : 0;

  const strength = clamp(
    0.5 + recoveryRatio * 0.15 + starSmallness * 0.1 + contextBonus,
    0,
    1
  );
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.9);

  return {
    name: 'morning_star',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Morning Star — 3-candle bullish reversal (bearish, star, bullish); one of the most reliable patterns',
    candlesUsed: 3,
  };
}

/**
 * Evening Star - Classic three-candle bearish reversal.
 * 1) Large bullish candle, 2) small-bodied candle (star), 3) large bearish candle
 * that closes below the midpoint of candle 1's body.
 */
function detectEveningStar(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1)) return null;
  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c1) < avg * 0.7) return null;

  if (bodySize(c2) > bodySize(c1) * 0.4) return null;
  if (bodySize(c2) > bodySize(c3) * 0.4) return null;

  if (!isBearish(c3)) return null;
  if (avg > 0 && bodySize(c3) < avg * 0.5) return null;

  const c1Mid = bodyMid(c1);
  if (c3.close >= c1Mid) return null;

  const recoveryRatio = bodySize(c3) / Math.max(bodySize(c1), 0.0001);
  const starSmallness = 1 - bodySize(c2) / Math.max(bodySize(c1), 0.0001);
  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.05 : 0;

  const strength = clamp(
    0.5 + recoveryRatio * 0.15 + starSmallness * 0.1 + contextBonus,
    0,
    1
  );
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.9);

  return {
    name: 'evening_star',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Evening Star — 3-candle bearish reversal (bullish, star, bearish); one of the most reliable patterns',
    candlesUsed: 3,
  };
}

/**
 * Three White Soldiers - Three consecutive bullish candles with progressively higher closes.
 * Each candle opens within the prior candle's body and closes near its high.
 * Strong bullish continuation / reversal signal.
 */
function detectThreeWhiteSoldiers(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBullish(c2) || !isBullish(c3)) return null;

  // Progressive higher closes
  if (c2.close <= c1.close || c3.close <= c2.close) return null;

  // Each candle opens within the prior candle's body
  if (c2.open < bodyBottom(c1) || c2.open > bodyTop(c1)) return null;
  if (c3.open < bodyBottom(c2) || c3.open > bodyTop(c2)) return null;

  // Each candle should close near its high (small upper shadow)
  const maxUpperShadowRatio = 0.3;
  for (const c of [c1, c2, c3]) {
    const range = totalRange(c);
    if (range > 0 && upperShadow(c) / range > maxUpperShadowRatio) return null;
  }

  // Bodies should be meaningful
  const avg = avgBodySize(context);
  if (avg > 0) {
    for (const c of [c1, c2, c3]) {
      if (bodySize(c) < avg * 0.3) return null;
    }
  }

  const trend = priorTrend(context);
  const contextBonus = trend < 0 ? 0.05 : 0; // More significant as reversal from bearish

  const avgBody = (bodySize(c1) + bodySize(c2) + bodySize(c3)) / 3;
  const consistency =
    avg > 0 ? Math.min(avgBody / avg, 2) / 2 : 0.5;

  const strength = clamp(0.6 + consistency * 0.2 + contextBonus, 0, 1);
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.85);

  return {
    name: 'three_white_soldiers',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Three White Soldiers — three advancing bullish candles; strong bullish conviction',
    candlesUsed: 3,
  };
}

/**
 * Three Black Crows - Three consecutive bearish candles with progressively lower closes.
 * Each candle opens within the prior candle's body and closes near its low.
 * Strong bearish continuation / reversal signal.
 */
function detectThreeBlackCrows(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c1) || !isBearish(c2) || !isBearish(c3)) return null;

  // Progressive lower closes
  if (c2.close >= c1.close || c3.close >= c2.close) return null;

  // Each candle opens within the prior candle's body
  if (c2.open < bodyBottom(c1) || c2.open > bodyTop(c1)) return null;
  if (c3.open < bodyBottom(c2) || c3.open > bodyTop(c2)) return null;

  // Each candle should close near its low (small lower shadow)
  const maxLowerShadowRatio = 0.3;
  for (const c of [c1, c2, c3]) {
    const range = totalRange(c);
    if (range > 0 && lowerShadow(c) / range > maxLowerShadowRatio) return null;
  }

  const avg = avgBodySize(context);
  if (avg > 0) {
    for (const c of [c1, c2, c3]) {
      if (bodySize(c) < avg * 0.3) return null;
    }
  }

  const trend = priorTrend(context);
  const contextBonus = trend > 0 ? 0.05 : 0;

  const avgBody = (bodySize(c1) + bodySize(c2) + bodySize(c3)) / 3;
  const consistency =
    avg > 0 ? Math.min(avgBody / avg, 2) / 2 : 0.5;

  const strength = clamp(0.6 + consistency * 0.2 + contextBonus, 0, 1);
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.85);

  return {
    name: 'three_black_crows',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Three Black Crows — three declining bearish candles; strong bearish conviction',
    candlesUsed: 3,
  };
}

/**
 * Three Inside Up - Confirmed bullish harami.
 * 1) Large bearish candle, 2) smaller bullish candle inside candle 1,
 * 3) bullish candle closing above candle 1's body top.
 */
function detectThreeInsideUp(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c1) || !isBullish(c2) || !isBullish(c3)) return null;

  // Candle 2 must be inside candle 1 (harami condition)
  if (bodyTop(c2) >= bodyTop(c1) || bodyBottom(c2) <= bodyBottom(c1)) return null;

  // Candle 3 must close above candle 1's body top (confirmation)
  if (c3.close <= bodyTop(c1)) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c1) < avg * 0.5) return null;

  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.05 : 0;

  const confirmStrength =
    (c3.close - bodyTop(c1)) / Math.max(bodySize(c1), 0.0001);
  const strength = clamp(0.55 + confirmStrength * 0.2 + contextBonus, 0, 1);
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.85);

  return {
    name: 'three_inside_up',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Three Inside Up — confirmed bullish harami with breakout above resistance; reliable reversal',
    candlesUsed: 3,
  };
}

/**
 * Three Inside Down - Confirmed bearish harami.
 * 1) Large bullish candle, 2) smaller bearish candle inside candle 1,
 * 3) bearish candle closing below candle 1's body bottom.
 */
function detectThreeInsideDown(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBearish(c2) || !isBearish(c3)) return null;

  if (bodyTop(c2) >= bodyTop(c1) || bodyBottom(c2) <= bodyBottom(c1)) return null;

  if (c3.close >= bodyBottom(c1)) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c1) < avg * 0.5) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.05 : 0;

  const confirmStrength =
    (bodyBottom(c1) - c3.close) / Math.max(bodySize(c1), 0.0001);
  const strength = clamp(0.55 + confirmStrength * 0.2 + contextBonus, 0, 1);
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.85);

  return {
    name: 'three_inside_down',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Three Inside Down — confirmed bearish harami with breakdown below support; reliable reversal',
    candlesUsed: 3,
  };
}

/**
 * Bullish Abandoned Baby - Rare but powerful.
 * 1) Bearish candle, 2) doji that gaps below, 3) bullish candle that gaps above the doji.
 *
 * Crypto adjustment: Since crypto rarely gaps, we check for a small-bodied star candle
 * whose high is below candle 1's low and whose low is above candle 3's open,
 * OR that the star is clearly separated by at least a small price gap from both sides.
 * We relax this to "star candle's body doesn't overlap with either neighbor's body".
 */
function detectBullishAbandonedBaby(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c1) || !isBullish(c3)) return null;

  // Star candle must be a doji or very small body
  if (!isDoji(c2, 0.2)) return null;

  // Star should be below candle 1's body (relaxed for crypto: body bottom of star below c1 body bottom)
  if (bodyTop(c2) >= bodyBottom(c1)) return null;

  // Star should be below candle 3's body
  if (bodyTop(c2) >= bodyBottom(c3)) return null;

  // Check for some gap: star high should be below c1 low or c3 open
  const hasGapDown = c2.high < bodyBottom(c1);
  const hasGapUp = c2.high < bodyBottom(c3);
  const gapScore = (hasGapDown ? 0.1 : 0) + (hasGapUp ? 0.1 : 0);

  const trend = priorTrend(context);
  const contextBonus = trend < -2 ? 0.05 : 0;

  const strength = clamp(0.6 + gapScore + contextBonus, 0, 1);
  let reliability = 0.75 + gapScore + contextBonus;
  reliability = clamp(reliability, 0.5, 0.9);

  return {
    name: 'bullish_abandoned_baby',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Bullish Abandoned Baby — rare and powerful: gapped doji between bearish and bullish candles',
    candlesUsed: 3,
  };
}

/**
 * Bearish Abandoned Baby - Mirror of bullish version.
 */
function detectBearishAbandonedBaby(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBearish(c3)) return null;

  if (!isDoji(c2, 0.2)) return null;

  // Star should be above candle 1's body
  if (bodyBottom(c2) <= bodyTop(c1)) return null;

  // Star should be above candle 3's body
  if (bodyBottom(c2) <= bodyTop(c3)) return null;

  const hasGapUp = c2.low > bodyTop(c1);
  const hasGapDown = c2.low > bodyTop(c3);
  const gapScore = (hasGapUp ? 0.1 : 0) + (hasGapDown ? 0.1 : 0);

  const trend = priorTrend(context);
  const contextBonus = trend > 2 ? 0.05 : 0;

  const strength = clamp(0.6 + gapScore + contextBonus, 0, 1);
  let reliability = 0.75 + gapScore + contextBonus;
  reliability = clamp(reliability, 0.5, 0.9);

  return {
    name: 'bearish_abandoned_baby',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Bearish Abandoned Baby — rare and powerful: gapped doji between bullish and bearish candles',
    candlesUsed: 3,
  };
}

/**
 * Three Outside Up - Confirmed bullish engulfing.
 * 1) Small bearish candle, 2) large bullish candle engulfing candle 1,
 * 3) bullish candle closing above candle 2's close (confirmation).
 */
function detectThreeOutsideUp(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c1) || !isBullish(c2) || !isBullish(c3)) return null;

  // Candle 2 must engulf candle 1's body
  if (bodyTop(c2) <= bodyTop(c1) || bodyBottom(c2) >= bodyBottom(c1)) return null;

  // Candle 3 must close above candle 2's close (confirmation)
  if (c3.close <= c2.close) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c2) < avg * 0.5) return null;

  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.05 : 0;

  const confirmStrength =
    (c3.close - c2.close) / Math.max(bodySize(c2), 0.0001);
  const strength = clamp(0.55 + confirmStrength * 0.15 + contextBonus, 0, 1);
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.85);

  return {
    name: 'three_outside_up',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Three Outside Up — confirmed bullish engulfing with follow-through; strong reversal',
    candlesUsed: 3,
  };
}

/**
 * Three Outside Down - Confirmed bearish engulfing.
 * 1) Small bullish candle, 2) large bearish candle engulfing candle 1,
 * 3) bearish candle closing below candle 2's close (confirmation).
 */
function detectThreeOutsideDown(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBearish(c2) || !isBearish(c3)) return null;

  if (bodyTop(c2) <= bodyTop(c1) || bodyBottom(c2) >= bodyBottom(c1)) return null;

  if (c3.close >= c2.close) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c2) < avg * 0.5) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.05 : 0;

  const confirmStrength =
    (c2.close - c3.close) / Math.max(bodySize(c2), 0.0001);
  const strength = clamp(0.55 + confirmStrength * 0.15 + contextBonus, 0, 1);
  let reliability = 0.7 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.5, 0.85);

  return {
    name: 'three_outside_down',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Three Outside Down — confirmed bearish engulfing with follow-through; strong reversal',
    candlesUsed: 3,
  };
}

/**
 * Tri-Star - Three consecutive doji candles.
 * Extremely rare and powerful reversal signal. The direction depends on
 * the prior trend: after uptrend = bearish reversal, after downtrend = bullish reversal.
 */
function detectTriStar(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  // All three must be doji
  if (!isDoji(c1, 0.15) || !isDoji(c2, 0.15) || !isDoji(c3, 0.15)) return null;

  // All three should have meaningful range
  const avg = avgRange(context);
  if (avg > 0) {
    for (const c of [c1, c2, c3]) {
      if (totalRange(c) < avg * 0.3) return null;
    }
  }

  const trend = priorTrend(context);
  // Needs a clear trend to be meaningful
  if (Math.abs(trend) < 1) return null;

  const isBullishReversal = trend < -1;
  const contextBonus = Math.abs(trend) > 3 ? 0.05 : 0;

  const strength = clamp(0.6 + contextBonus, 0, 1);
  let reliability = 0.75 + contextBonus;
  reliability = clamp(reliability, 0.55, 0.9);

  return {
    name: 'tri_star',
    type: isBullishReversal ? 'reversal_bullish' : 'reversal_bearish',
    reliability,
    strength,
    description: isBullishReversal
      ? 'Tri-Star — three consecutive dojis after downtrend; rare and powerful bullish reversal'
      : 'Tri-Star — three consecutive dojis after uptrend; rare and powerful bearish reversal',
    candlesUsed: 3,
  };
}

// ============================================================================
// CONTINUATION PATTERNS (important for filtering false reversal signals)
// ============================================================================

/**
 * Rising Three Methods - Bullish continuation.
 * 1) Large bullish candle, 2) small bearish/neutral candle within c1 range,
 * 3) bullish candle closing above c1's close.
 *
 * The classic pattern uses 5 candles (1 bull + 3 small bears + 1 bull) but
 * we detect a simplified 3-candle version common in crypto's faster price action.
 * Indicates a brief pullback within an uptrend that resolves higher.
 */
function detectRisingThreeMethods(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBullish(c3)) return null;

  // c1 must be a strong bullish candle
  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c1) < avg * 0.7) return null;

  // c2 must be small and contained within c1's range
  if (bodySize(c2) > bodySize(c1) * 0.5) return null;
  if (c2.high > c1.high || c2.low < c1.low) return null;

  // c2 should ideally be bearish (pullback)
  const pullbackBonus = isBearish(c2) ? 0.05 : 0;

  // c3 must close above c1's close (continuation)
  if (c3.close <= c1.close) return null;

  // c3 should be a strong candle
  if (avg > 0 && bodySize(c3) < avg * 0.5) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.05 : 0;

  const strength = clamp(0.5 + pullbackBonus + contextBonus, 0, 1);
  let reliability = 0.6 + contextBonus + pullbackBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.4, 0.8);

  return {
    name: 'rising_three_methods',
    type: 'continuation_bullish',
    reliability,
    strength,
    description:
      'Rising Three Methods — brief pullback within uptrend resolves higher; bullish continuation',
    candlesUsed: 3,
  };
}

/**
 * Falling Three Methods - Bearish continuation.
 * Mirror of Rising Three Methods for downtrends.
 */
function detectFallingThreeMethods(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c1) || !isBearish(c3)) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c1) < avg * 0.7) return null;

  if (bodySize(c2) > bodySize(c1) * 0.5) return null;
  if (c2.high > c1.high || c2.low < c1.low) return null;

  const pullbackBonus = isBullish(c2) ? 0.05 : 0;

  if (c3.close >= c1.close) return null;

  if (avg > 0 && bodySize(c3) < avg * 0.5) return null;

  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.05 : 0;

  const strength = clamp(0.5 + pullbackBonus + contextBonus, 0, 1);
  let reliability = 0.6 + contextBonus + pullbackBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.4, 0.8);

  return {
    name: 'falling_three_methods',
    type: 'continuation_bearish',
    reliability,
    strength,
    description:
      'Falling Three Methods — brief bounce within downtrend resolves lower; bearish continuation',
    candlesUsed: 3,
  };
}

/**
 * Mat Hold (Bullish) - Strong bullish continuation.
 * 1) Large bullish candle, 2) small candle that gaps up but trades lower (pullback),
 * 3) bullish candle closing above both prior candles.
 *
 * Crypto adjustment: instead of requiring a gap, we check that c2 opens above c1's body
 * midpoint but closes lower than its open (mild pullback within the trend).
 */
function detectMatHold(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBullish(c3)) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c1) < avg * 0.8) return null;

  // c2: opens in upper half of c1's body, pulls back (bearish or small body)
  if (c2.open < bodyMid(c1)) return null;
  if (bodySize(c2) > bodySize(c1) * 0.5) return null;
  // c2 must stay above c1's body bottom (contained pullback)
  if (c2.low < bodyBottom(c1)) return null;

  // c3 closes above c1's high (strong continuation)
  if (c3.close <= c1.high) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 2 ? 0.05 : 0;

  const strength = clamp(0.55 + contextBonus, 0, 1);
  let reliability = 0.65 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.45, 0.8);

  return {
    name: 'mat_hold',
    type: 'continuation_bullish',
    reliability,
    strength,
    description:
      'Mat Hold — strong bullish candle, mild pullback, then continuation above prior high; reliable trend continuation',
    candlesUsed: 3,
  };
}

/**
 * Upside Tasuki Gap - Bullish continuation.
 * 1) Bullish candle, 2) bullish candle that gaps up (crypto: opens above c1 close),
 * 3) bearish candle that opens within c2 body and closes within the gap between c1 and c2.
 * The gap is not fully closed, suggesting the uptrend will resume.
 *
 * Crypto adjustment: "gap" = c2 opens above c1 close.
 */
function detectUpsideTasukiGap(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBullish(c2) || !isBearish(c3)) return null;

  // c2 opens above c1 close (the "gap")
  if (c2.open <= c1.close) return null;

  // c3 opens within c2 body
  if (c3.open < bodyBottom(c2) || c3.open > bodyTop(c2)) return null;

  // c3 closes in the gap (between c1 close and c2 open) but doesn't fully close it
  if (c3.close <= c1.close || c3.close >= c2.open) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.05 : 0;

  const strength = clamp(0.5 + contextBonus, 0, 1);
  let reliability = 0.55 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.35, 0.7);

  return {
    name: 'upside_tasuki_gap',
    type: 'continuation_bullish',
    reliability,
    strength,
    description:
      'Upside Tasuki Gap — gap up followed by pullback that fails to close the gap; bullish continuation',
    candlesUsed: 3,
  };
}

/**
 * Downside Tasuki Gap - Bearish continuation.
 * Mirror of upside version.
 */
function detectDownsideTasukiGap(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c1) || !isBearish(c2) || !isBullish(c3)) return null;

  // c2 opens below c1 close (the "gap")
  if (c2.open >= c1.close) return null;

  // c3 opens within c2 body
  if (c3.open < bodyBottom(c2) || c3.open > bodyTop(c2)) return null;

  // c3 closes in the gap but doesn't fully close it
  if (c3.close >= c1.close || c3.close <= c2.open) return null;

  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.05 : 0;

  const strength = clamp(0.5 + contextBonus, 0, 1);
  let reliability = 0.55 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.35, 0.7);

  return {
    name: 'downside_tasuki_gap',
    type: 'continuation_bearish',
    reliability,
    strength,
    description:
      'Downside Tasuki Gap — gap down followed by bounce that fails to close the gap; bearish continuation',
    candlesUsed: 3,
  };
}

// ============================================================================
// EXHAUSTION-SPECIFIC PATTERNS
// ============================================================================

/**
 * Advance Block - Bullish exhaustion pattern.
 * Three consecutive bullish candles where bodies progressively shrink
 * and upper shadows progressively grow. The bulls are running out of steam.
 */
function detectAdvanceBlock(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBullish(c2) || !isBullish(c3)) return null;

  // Higher closes
  if (c2.close <= c1.close || c3.close <= c2.close) return null;

  // Shrinking bodies
  const b1 = bodySize(c1);
  const b2 = bodySize(c2);
  const b3 = bodySize(c3);
  if (b2 >= b1 || b3 >= b2) return null;

  // Growing upper shadows (optional but adds conviction)
  const u1 = upperShadow(c1);
  const u2 = upperShadow(c2);
  const u3 = upperShadow(c3);
  const growingShadows = u2 >= u1 && u3 >= u2;

  const shrinkRatio = b3 / Math.max(b1, 0.0001);
  const exhaustionStrength = 1 - shrinkRatio; // More shrinkage = stronger signal

  const trend = priorTrend(context);
  const contextBonus = trend > 2 ? 0.05 : 0;
  const shadowBonus = growingShadows ? 0.1 : 0;

  const strength = clamp(0.4 + exhaustionStrength * 0.3 + shadowBonus + contextBonus, 0, 1);
  let reliability = 0.6 + shadowBonus + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.4, 0.8);

  return {
    name: 'advance_block',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Advance Block — three rising candles with shrinking bodies; bullish momentum exhausting',
    candlesUsed: 3,
  };
}

/**
 * Deliberation - Similar to advance block but the third candle is very small (spinning top or doji).
 * Three bullish candles where the last one shows extreme hesitation.
 */
function detectDeliberation(
  c1: OHLCData,
  c2: OHLCData,
  c3: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c1) || !isBullish(c2) || !isBullish(c3)) return null;

  // First two candles should be strong
  const avg = avgBodySize(context);
  if (avg > 0 && (bodySize(c1) < avg * 0.6 || bodySize(c2) < avg * 0.6)) return null;

  // Third candle should be very small (spinning top or doji)
  if (bodySize(c3) > bodySize(c1) * 0.3) return null;
  if (bodySize(c3) > bodySize(c2) * 0.3) return null;

  // Higher closes overall
  if (c3.close <= c1.close) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 2 ? 0.05 : 0;

  const hesitation = 1 - bodySize(c3) / Math.max(bodySize(c2), 0.0001);
  const strength = clamp(0.4 + hesitation * 0.3 + contextBonus, 0, 1);
  let reliability = 0.55 + contextBonus + volumeConfirmation(c3, context);
  reliability = clamp(reliability, 0.35, 0.75);

  return {
    name: 'deliberation',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Deliberation — two strong bullish candles followed by hesitation; stalling momentum',
    candlesUsed: 3,
  };
}

/**
 * Bullish Belt Hold - A strong bullish candle that opens at or near its low
 * after a decline. The open IS the low (or very close), signaling instant buyer control.
 *
 * In crypto, we check for open being within 5% of the range from the low.
 */
function detectBullishBeltHold(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(c)) return null;

  const range = totalRange(c);
  if (range === 0) return null;

  // Open must be near the low
  const lowerWick = lowerShadow(c);
  if (lowerWick > range * 0.05) return null;

  // Body must be dominant
  if (bodySize(c) < range * 0.6) return null;

  // Should be large relative to context
  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c) < avg * 0.8) return null;

  const trend = priorTrend(context);
  if (trend > 3) return null; // Belt hold only meaningful after decline or consolidation

  const contextBonus = trend < -1 ? 0.1 : 0;

  const strength = clamp(bodyPercent(c) + contextBonus, 0, 1);
  let reliability = 0.45 + contextBonus + volumeConfirmation(c, context);
  reliability = clamp(reliability, 0.25, 0.6);

  return {
    name: 'bullish_belt_hold',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Bullish Belt Hold — opens at the low and closes strong; instant buyer dominance',
    candlesUsed: 1,
  };
}

/**
 * Bearish Belt Hold - A strong bearish candle that opens at or near its high.
 */
function detectBearishBeltHold(
  c: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(c)) return null;

  const range = totalRange(c);
  if (range === 0) return null;

  const upperWick = upperShadow(c);
  if (upperWick > range * 0.05) return null;

  if (bodySize(c) < range * 0.6) return null;

  const avg = avgBodySize(context);
  if (avg > 0 && bodySize(c) < avg * 0.8) return null;

  const trend = priorTrend(context);
  if (trend < -3) return null;

  const contextBonus = trend > 1 ? 0.1 : 0;

  const strength = clamp(bodyPercent(c) + contextBonus, 0, 1);
  let reliability = 0.45 + contextBonus + volumeConfirmation(c, context);
  reliability = clamp(reliability, 0.25, 0.6);

  return {
    name: 'bearish_belt_hold',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Bearish Belt Hold — opens at the high and closes strong; instant seller dominance',
    candlesUsed: 1,
  };
}

/**
 * Matching Low - Two consecutive bearish candles with the same (or very close) close price.
 * Forms a double-bottom support level; bullish reversal signal.
 */
function detectMatchingLow(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBearish(prev) || !isBearish(curr)) return null;

  const avg = avgRange(context);
  if (avg === 0) return null;

  // Closes must match within a tight tolerance
  const closeDiff = Math.abs(prev.close - curr.close);
  const threshold = Math.min(avg * 0.03, prev.close * 0.001);
  if (closeDiff > threshold) return null;

  const trend = priorTrend(context);
  const contextBonus = trend < -1 ? 0.1 : 0;

  const precision = 1 - closeDiff / Math.max(threshold, 0.0001);
  const strength = clamp(0.4 + precision * 0.3 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.65);

  return {
    name: 'matching_low',
    type: 'reversal_bullish',
    reliability,
    strength,
    description:
      'Matching Low — two bearish candles close at the same level; double-bottom support',
    candlesUsed: 2,
  };
}

/**
 * Matching High - Two consecutive bullish candles with the same (or very close) close price.
 * Forms a double-top resistance level; bearish reversal signal.
 */
function detectMatchingHigh(
  prev: OHLCData,
  curr: OHLCData,
  context: OHLCData[]
): ExtendedCandlestickPattern | null {
  if (!isBullish(prev) || !isBullish(curr)) return null;

  const avg = avgRange(context);
  if (avg === 0) return null;

  const closeDiff = Math.abs(prev.close - curr.close);
  const threshold = Math.min(avg * 0.03, prev.close * 0.001);
  if (closeDiff > threshold) return null;

  const trend = priorTrend(context);
  const contextBonus = trend > 1 ? 0.1 : 0;

  const precision = 1 - closeDiff / Math.max(threshold, 0.0001);
  const strength = clamp(0.4 + precision * 0.3 + contextBonus, 0, 1);
  let reliability = 0.5 + contextBonus + volumeConfirmation(curr, context);
  reliability = clamp(reliability, 0.3, 0.65);

  return {
    name: 'matching_high',
    type: 'reversal_bearish',
    reliability,
    strength,
    description:
      'Matching High — two bullish candles close at the same level; double-top resistance',
    candlesUsed: 2,
  };
}

// ============================================================================
// MAIN DETECTION FUNCTION
// ============================================================================

/**
 * Detect all candlestick patterns on the provided OHLC data.
 *
 * Feed this at least 10 candles for context. The function examines
 * the most recent 1-3 candles for patterns while using preceding
 * candles to determine trend context and average body sizes.
 *
 * @param ohlc - Array of OHLC candles, oldest first
 * @param timeframe - Optional timeframe in minutes (for tagging results)
 * @returns Array of detected patterns, sorted by reliability descending
 */
export function detectAllCandlestickPatterns(
  ohlc: OHLCData[],
  timeframe?: number
): ExtendedCandlestickPattern[] {
  if (!ohlc || ohlc.length < 3) return [];

  const patterns: ExtendedCandlestickPattern[] = [];
  const len = ohlc.length;

  // The candles we analyze
  const last = ohlc[len - 1];
  const prev = ohlc[len - 2];
  const prevPrev = len >= 3 ? ohlc[len - 3] : null;

  // Use a wider context for averaging that includes a bit more history
  const wideContext = ohlc.slice(Math.max(0, len - 15), len - 1);

  // --- Single-candle patterns (on the most recent candle) ---
  const singleDetectors = [
    detectDoji,
    detectLongLeggedDoji,
    detectDragonflyDoji,
    detectGravestoneDoji,
    detectHammer,
    detectInvertedHammer,
    detectShootingStar,
    detectHangingMan,
    detectSpinningTop,
    detectBullishMarubozu,
    detectBearishMarubozu,
    detectBullishBeltHold,
    detectBearishBeltHold,
  ];

  for (const detect of singleDetectors) {
    const p = detect(last, wideContext);
    if (p) {
      if (timeframe !== undefined) p.timeframe = timeframe;
      patterns.push(p);
    }
  }

  // --- Two-candle patterns (on prev + last) ---
  const twoDetectors: Array<
    (p: OHLCData, c: OHLCData, ctx: OHLCData[]) => ExtendedCandlestickPattern | null
  > = [
    detectBullishEngulfing,
    detectBearishEngulfing,
    detectPiercingLine,
    detectDarkCloudCover,
    detectTweezerBottom,
    detectTweezerTop,
    detectBullishHarami,
    detectBearishHarami,
    detectBullishKicker,
    detectBearishKicker,
    detectMatchingLow,
    detectMatchingHigh,
  ];

  for (const detect of twoDetectors) {
    const p = detect(prev, last, wideContext);
    if (p) {
      if (timeframe !== undefined) p.timeframe = timeframe;
      patterns.push(p);
    }
  }

  // --- Three-candle patterns (on prevPrev + prev + last) ---
  if (prevPrev) {
    const threeDetectors: Array<
      (
        a: OHLCData,
        b: OHLCData,
        c: OHLCData,
        ctx: OHLCData[]
      ) => ExtendedCandlestickPattern | null
    > = [
      detectMorningStar,
      detectEveningStar,
      detectThreeWhiteSoldiers,
      detectThreeBlackCrows,
      detectThreeInsideUp,
      detectThreeInsideDown,
      detectBullishAbandonedBaby,
      detectBearishAbandonedBaby,
      detectAdvanceBlock,
      detectDeliberation,
      detectThreeOutsideUp,
      detectThreeOutsideDown,
      detectTriStar,
      // Continuation patterns (important for filtering false reversals)
      detectRisingThreeMethods,
      detectFallingThreeMethods,
      detectMatHold,
      detectUpsideTasukiGap,
      detectDownsideTasukiGap,
    ];

    for (const detect of threeDetectors) {
      const p = detect(prevPrev, prev, last, wideContext);
      if (p) {
        if (timeframe !== undefined) p.timeframe = timeframe;
        patterns.push(p);
      }
    }
  }

  // Sort by reliability descending, then by strength descending for ties
  patterns.sort((a, b) => {
    if (b.reliability !== a.reliability) return b.reliability - a.reliability;
    return b.strength - a.strength;
  });

  return patterns;
}

// ============================================================================
// REVERSAL SCORING
// ============================================================================

/**
 * Score the reversal probability from a set of detected patterns.
 * Combines pattern reliability, strength, and candle count to produce
 * a composite reversal score in the requested direction.
 *
 * @param patterns - Detected patterns from detectAllCandlestickPatterns
 * @param direction - The reversal direction to score ('bullish' or 'bearish')
 * @returns Composite reversal score 0-100 with supporting details
 */
export function scoreReversalSignal(
  patterns: ExtendedCandlestickPattern[],
  direction: 'bullish' | 'bearish'
): ReversalScore {
  const targetType =
    direction === 'bullish' ? 'reversal_bullish' : 'reversal_bearish';

  const matching = patterns.filter((p) => p.type === targetType);

  if (matching.length === 0) {
    return {
      score: 0,
      direction,
      patterns: [],
      description: `No ${direction} reversal patterns detected`,
    };
  }

  // Score: weighted sum of each pattern's (reliability * strength), capped at 100
  // Multi-candle patterns contribute more than single-candle ones
  let weightedSum = 0;
  let totalWeight = 0;

  for (const p of matching) {
    // Weight by candles used: 1-candle=1, 2-candle=1.5, 3-candle=2
    const candleWeight = p.candlesUsed === 3 ? 2 : p.candlesUsed === 2 ? 1.5 : 1;
    const contribution = p.reliability * p.strength * candleWeight;
    weightedSum += contribution;
    totalWeight += candleWeight;
  }

  // Normalize and scale to 0-100
  const avgScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  // Multiple confirming patterns boost the score
  const confirmationBonus = Math.min((matching.length - 1) * 5, 15);
  const raw = avgScore * 100 + confirmationBonus;
  const score = clamp(Math.round(raw), 0, 100);

  const topPatterns = matching
    .slice(0, 3)
    .map((p) => p.name)
    .join(', ');

  return {
    score,
    direction,
    patterns: matching,
    description:
      score >= 70
        ? `Strong ${direction} reversal signal from ${matching.length} pattern(s): ${topPatterns}`
        : score >= 40
          ? `Moderate ${direction} reversal signal: ${topPatterns}`
          : `Weak ${direction} reversal hint: ${topPatterns}`,
  };
}

// ============================================================================
// EXHAUSTION DETECTION
// ============================================================================

/**
 * Detect exhaustion patterns in recent candles.
 * Exhaustion = momentum fading: shrinking bodies, growing wicks, declining volume.
 *
 * This is distinct from specific named patterns like Advance Block. It provides
 * a general exhaustion score based on multiple structural signals.
 *
 * @param ohlc - Array of OHLC candles (at least 5 recommended)
 * @returns ExhaustionSignal if exhaustion is detected, null otherwise
 */
export function detectExhaustionPattern(
  ohlc: OHLCData[]
): ExhaustionSignal | null {
  if (!ohlc || ohlc.length < 5) return null;

  const recent = ohlc.slice(-5);
  const signals: string[] = [];
  let score = 0;

  // Determine the predominant direction of the recent candles
  let bullishCount = 0;
  let bearishCount = 0;
  for (const c of recent) {
    if (isBullish(c)) bullishCount++;
    else if (isBearish(c)) bearishCount++;
  }

  // Need a clear direction to detect exhaustion of that direction
  if (bullishCount < 3 && bearishCount < 3) return null;

  const direction: 'bullish_exhaustion' | 'bearish_exhaustion' =
    bullishCount >= 3 ? 'bullish_exhaustion' : 'bearish_exhaustion';

  // 1. Shrinking bodies (last 3 candles)
  const last3 = recent.slice(-3);
  const bodies = last3.map((c) => bodySize(c));
  if (bodies[0] > 0 && bodies[1] < bodies[0] && bodies[2] < bodies[1]) {
    const shrinkage = 1 - bodies[2] / Math.max(bodies[0], 0.0001);
    const pts = Math.round(shrinkage * 30);
    score += pts;
    signals.push(`Shrinking bodies (${Math.round(shrinkage * 100)}% reduction)`);
  }

  // 2. Growing upper wicks (for bullish exhaustion) or lower wicks (for bearish)
  const wicks = last3.map((c) =>
    direction === 'bullish_exhaustion' ? upperShadow(c) : lowerShadow(c)
  );
  if (wicks[2] > wicks[1] && wicks[1] > wicks[0] && wicks[0] > 0) {
    const growth = wicks[2] / Math.max(wicks[0], 0.0001);
    const pts = Math.min(Math.round(growth * 10), 25);
    score += pts;
    signals.push(
      `Growing ${direction === 'bullish_exhaustion' ? 'upper' : 'lower'} wicks (${growth.toFixed(1)}x)`
    );
  }

  // 3. Declining volume
  const vols = recent.map((c) => c.volume);
  const recentVols = vols.slice(-3);
  if (
    recentVols[0] > 0 &&
    recentVols[1] < recentVols[0] &&
    recentVols[2] < recentVols[1]
  ) {
    const decline = 1 - recentVols[2] / Math.max(recentVols[0], 0.0001);
    const pts = Math.round(decline * 25);
    score += pts;
    signals.push(`Declining volume (${Math.round(decline * 100)}% drop)`);
  }

  // 4. Increasing range with decreasing body (wicking = rejection)
  const ranges = last3.map((c) => totalRange(c));
  const bodyRatios = last3.map((c) => bodyPercent(c));
  if (
    ranges[2] > ranges[0] &&
    bodyRatios[2] < bodyRatios[0] &&
    bodyRatios[0] > 0
  ) {
    const rejectionStrength = bodyRatios[0] - bodyRatios[2];
    const pts = Math.round(rejectionStrength * 30);
    score += pts;
    signals.push('Expanding range but shrinking body (rejection)');
  }

  // 5. Slowing price progress
  const closes = recent.map((c) => c.close);
  const moves = [];
  for (let i = 1; i < closes.length; i++) {
    moves.push(Math.abs(closes[i] - closes[i - 1]));
  }
  if (moves.length >= 4) {
    const earlyMoves = (moves[0] + moves[1]) / 2;
    const lateMoves = (moves[2] + moves[3]) / 2;
    if (earlyMoves > 0 && lateMoves < earlyMoves * 0.5) {
      const slowdown = 1 - lateMoves / Math.max(earlyMoves, 0.0001);
      const pts = Math.round(slowdown * 20);
      score += pts;
      signals.push(
        `Price progress slowing (${Math.round(slowdown * 100)}% deceleration)`
      );
    }
  }

  score = clamp(score, 0, 100);

  // Only report exhaustion if score is meaningful
  if (score < 20 || signals.length < 2) return null;

  const desc =
    direction === 'bullish_exhaustion'
      ? 'Bullish momentum exhausting — buyers losing steam'
      : 'Bearish momentum exhausting — sellers losing steam';

  return {
    detected: true,
    direction,
    score,
    signals,
    description: `${desc} (score: ${score}/100)`,
  };
}

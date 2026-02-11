/**
 * Technical Indicators
 * Professional-grade calculations for crypto trading
 * Based on standard TA methods used in TradingView, MetaTrader, etc.
 */

import type { OHLCData, Indicators, CandlestickPattern } from '@/lib/kraken/types';
import { detectAllCandlestickPatterns } from './candlestick-patterns';

/**
 * Calculate EMA (Exponential Moving Average)
 * Uses standard EMA formula with proper initialization
 */
export function ema(data: number[], period: number): number[] {
  if (data.length < period) return [];

  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];

  // Initialize with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  emaValues[period - 1] = sum / period;

  // Calculate EMA for remaining values
  for (let i = period; i < data.length; i++) {
    emaValues[i] = (data[i] - emaValues[i - 1]) * multiplier + emaValues[i - 1];
  }

  return emaValues;
}

/**
 * Get last EMA value
 */
export function emaLast(data: number[], period: number): number {
  const values = ema(data, period);
  return values[values.length - 1] || 0;
}

/**
 * Calculate SMA (Simple Moving Average)
 */
export function sma(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate RSI (Relative Strength Index) using Wilder's Smoothing
 * This is the standard RSI calculation used in TradingView and most platforms
 * Default period: 14
 */
export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Separate gains and losses
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));

  // Use Wilder's smoothing (not simple average)
  // First average is SMA
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Apply Wilder's smoothing for subsequent values
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * Standard MACD with proper signal line calculation
 * Default: fast=12, slow=26, signal=9
 */
export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number; signal: number; histogram: number } {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Calculate EMAs
  const emaFast = ema(closes, fastPeriod);
  const emaSlow = ema(closes, slowPeriod);

  // Calculate MACD line (EMA fast - EMA slow)
  const macdLine: number[] = [];
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    if (emaFast[i] !== undefined && emaSlow[i] !== undefined) {
      macdLine.push(emaFast[i] - emaSlow[i]);
    }
  }

  if (macdLine.length < signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Calculate Signal line (9-period EMA of MACD)
  const signalLine = ema(macdLine, signalPeriod);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1] || 0;
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

/**
 * Calculate Bollinger Bands
 * Standard calculation: 20-period SMA with 2 standard deviations
 */
export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number; middle: number; lower: number; position: number } {
  if (closes.length < period) {
    const lastClose = closes[closes.length - 1] || 0;
    return { upper: lastClose, middle: lastClose, lower: lastClose, position: 0.5 };
  }

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;

  // Calculate standard deviation (population formula)
  const squaredDiffs = slice.map(p => Math.pow(p - middle, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;

  const currentPrice = closes[closes.length - 1];
  const bandWidth = upper - lower;
  const position = bandWidth > 0 ? (currentPrice - lower) / bandWidth : 0.5;

  return { upper, middle, lower, position: Math.max(0, Math.min(1, position)) };
}

/**
 * Calculate ATR (Average True Range) using Wilder's Smoothing
 * Standard calculation used in most trading platforms
 * Default period: 14
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  if (highs.length < period + 1) return 0;

  // Calculate True Range for each period
  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],                    // Current high - low
      Math.abs(highs[i] - closes[i - 1]),    // Current high - previous close
      Math.abs(lows[i] - closes[i - 1])      // Current low - previous close
    );
    trueRanges.push(tr);
  }

  // First ATR is simple average
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Apply Wilder's smoothing for subsequent values
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

/**
 * Calculate Volume Ratio (current volume vs average)
 * Compares current candle volume to 20-period average
 */
export function calculateVolumeRatio(volumes: number[], period = 20): number {
  if (volumes.length < period + 1) return 1;

  // Average of previous 'period' candles (excluding current)
  const avgVolume = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  const currentVolume = volumes[volumes.length - 1];

  return avgVolume > 0 ? currentVolume / avgVolume : 1;
}

/**
 * Calculate ADX (Average Directional Index) using Wilder's smoothing
 * Measures trend strength regardless of direction.
 * Default period: 14 (requires 2*period+1 = 29 candles minimum)
 */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): { adx: number; plusDI: number; minusDI: number } {
  const minCandles = 2 * period + 1;
  if (highs.length < minCandles) return { adx: 0, plusDI: 0, minusDI: 0 };

  // Calculate +DM, -DM and TR for each bar
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  // First smoothed values are simple sums over the period
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);

  // Calculate first +DI and -DI
  let plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
  let minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

  // First DX
  const dxValues: number[] = [];
  const diSum = plusDI + minusDI;
  dxValues.push(diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0);

  // Apply Wilder's smoothing for subsequent values
  for (let i = period; i < trueRanges.length; i++) {
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];
    smoothedTR = smoothedTR - (smoothedTR / period) + trueRanges[i];

    plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

    const diSumCurr = plusDI + minusDI;
    dxValues.push(diSumCurr > 0 ? (Math.abs(plusDI - minusDI) / diSumCurr) * 100 : 0);
  }

  // ADX is the Wilder's smoothed average of DX values
  if (dxValues.length < period) return { adx: 0, plusDI, minusDI };

  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }

  return { adx, plusDI, minusDI };
}

/**
 * Calculate EMA slope (rate of change over lookback period)
 * Returns percentage change per candle
 */
export function calculateEMASlope(emaValues: number[], lookback = 5): number {
  if (emaValues.length < lookback + 1) return 0;

  const recent = emaValues.slice(-lookback - 1);
  const oldValue = recent[0];
  const newValue = recent[recent.length - 1];

  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100 / lookback; // % change per candle
}

/**
 * Determine EMA alignment (stacking order)
 * Bullish: Price > EMA20 > EMA50 > EMA200 (golden alignment)
 * Bearish: Price < EMA20 < EMA50 < EMA200 (death alignment)
 * Mixed: Any other configuration
 */
export function determineEMAAlignment(
  price: number,
  ema20: number,
  ema50: number,
  ema200: number
): 'bullish' | 'bearish' | 'mixed' {
  // Perfect bullish alignment
  if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
    return 'bullish';
  }
  // Perfect bearish alignment
  if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
    return 'bearish';
  }
  return 'mixed';
}

/**
 * Professional Trend Analysis
 * Determines trend based on price structure relative to EMAs
 * This is the CORRECT way to determine trend direction
 *
 * Key principles:
 * 1. Price position relative to EMAs shows current trend state
 * 2. EMA alignment shows trend strength and maturity
 * 3. EMA slopes show momentum
 * 4. RSI/BB are for ENTRY TIMING, not trend determination
 */
export function analyzeTrend(
  currentPrice: number,
  ema20: number,
  ema50: number,
  ema200: number,
  ema20Slope: number,
  ema50Slope: number
): { trend: 'bullish' | 'bearish' | 'neutral'; trendScore: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // === PRICE POSITION VS EMAs (Most Important - 60 points max) ===

  // Price vs EMA20 (short-term trend) - 20 points
  if (currentPrice > ema20) {
    score += 20;
    reasons.push('Price > EMA20');
  } else if (currentPrice < ema20) {
    score -= 20;
    reasons.push('Price < EMA20');
  }

  // Price vs EMA50 (medium-term trend) - 20 points
  if (currentPrice > ema50) {
    score += 20;
    reasons.push('Price > EMA50');
  } else if (currentPrice < ema50) {
    score -= 20;
    reasons.push('Price < EMA50');
  }

  // Price vs EMA200 (long-term trend) - 20 points
  if (currentPrice > ema200) {
    score += 20;
    reasons.push('Price > EMA200');
  } else if (currentPrice < ema200) {
    score -= 20;
    reasons.push('Price < EMA200');
  }

  // === EMA ALIGNMENT (Trend structure) - 25 points max ===
  const alignment = determineEMAAlignment(currentPrice, ema20, ema50, ema200);
  if (alignment === 'bullish') {
    score += 25;
    reasons.push('Bullish EMA stack');
  } else if (alignment === 'bearish') {
    score -= 25;
    reasons.push('Bearish EMA stack');
  }

  // === EMA SLOPES (Momentum) - 15 points max ===
  // EMA20 slope (faster, more sensitive)
  if (ema20Slope > 0.1) {
    score += 8;
    reasons.push('EMA20 rising');
  } else if (ema20Slope < -0.1) {
    score -= 8;
    reasons.push('EMA20 falling');
  }

  // EMA50 slope (slower, more significant)
  if (ema50Slope > 0.05) {
    score += 7;
    reasons.push('EMA50 rising');
  } else if (ema50Slope < -0.05) {
    score -= 7;
    reasons.push('EMA50 falling');
  }

  // Clamp score to -100 to +100
  score = Math.max(-100, Math.min(100, score));

  // Determine trend direction
  // Need at least 25 points conviction (price above/below at least one major EMA + some structure)
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (score >= 25) trend = 'bullish';
  else if (score <= -25) trend = 'bearish';

  return { trend, trendScore: score, reasons };
}

/**
 * Detect candlestick patterns on recent OHLC candles.
 * Analyzes the last N candles for reversal and indecision patterns
 * meaningful on 5m and 15m timeframes for swing entry timing.
 *
 * Uses ATR-based significance filtering to ignore tiny patterns in choppy markets.
 */
export function detectCandlestickPatterns(ohlc: OHLCData[]): CandlestickPattern[] {
  if (!ohlc || ohlc.length < 3) return [];

  const patterns: CandlestickPattern[] = [];

  // Calculate a simple ATR over available candles for significance filtering
  const atrPeriod = Math.min(14, ohlc.length - 1);
  let atrSum = 0;
  for (let i = 1; i <= atrPeriod; i++) {
    const idx = ohlc.length - 1 - (atrPeriod - i);
    const tr = Math.max(
      ohlc[idx].high - ohlc[idx].low,
      Math.abs(ohlc[idx].high - ohlc[idx - 1].close),
      Math.abs(ohlc[idx].low - ohlc[idx - 1].close)
    );
    atrSum += tr;
  }
  const recentATR = atrSum / atrPeriod;
  const minBody = recentATR * 0.3; // Minimum body size for significance

  // Helper: candle metrics
  function metrics(c: OHLCData) {
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const range = c.high - c.low;
    const isGreen = c.close > c.open;
    const isRed = c.close < c.open;
    return { body, upperWick, lowerWick, range, isGreen, isRed };
  }

  const last = ohlc[ohlc.length - 1];
  const prev = ohlc[ohlc.length - 2];
  const prevPrev = ohlc.length >= 3 ? ohlc[ohlc.length - 3] : null;

  const m = metrics(last);
  const pm = metrics(prev);
  const ppm = prevPrev ? metrics(prevPrev) : null;

  // --- Doji (neutral / indecision) ---
  if (m.range > 0 && m.body < m.range * 0.1 && m.range >= minBody * 0.5) {
    const wickBalance = m.range > 0 ? Math.min(m.upperWick, m.lowerWick) / Math.max(m.upperWick, m.lowerWick) : 0;
    const strength = Math.min(1, (1 - m.body / m.range) * (0.5 + wickBalance * 0.5));
    patterns.push({
      name: 'doji',
      direction: 'neutral',
      strength,
      description: 'Doji - market indecision, open and close nearly equal',
    });
  }

  // --- Hammer (bullish) ---
  // Small body at top, long lower wick >= 2x body, little upper wick
  if (m.body >= minBody * 0.3 && m.lowerWick >= 2 * m.body && m.upperWick <= m.body * 0.5 && m.range > 0) {
    const wickRatio = m.lowerWick / Math.max(m.body, 0.0001);
    const strength = Math.min(1, 0.5 + (wickRatio - 2) * 0.1 + (m.body >= minBody ? 0.2 : 0));
    patterns.push({
      name: 'hammer',
      direction: 'bullish',
      strength,
      description: 'Hammer - rejection of lower prices, potential bullish reversal',
    });
  }

  // --- Shooting Star (bearish) ---
  // Small body at bottom, long upper wick >= 2x body, little lower wick
  if (m.body >= minBody * 0.3 && m.upperWick >= 2 * m.body && m.lowerWick <= m.body * 0.5 && m.range > 0) {
    const wickRatio = m.upperWick / Math.max(m.body, 0.0001);
    const strength = Math.min(1, 0.5 + (wickRatio - 2) * 0.1 + (m.body >= minBody ? 0.2 : 0));
    patterns.push({
      name: 'shooting_star',
      direction: 'bearish',
      strength,
      description: 'Shooting star - rejection of higher prices, potential bearish reversal',
    });
  }

  // --- Pin Bar Bullish ---
  // Very long lower wick >= 3x body, tiny upper wick
  if (m.body > 0 && m.lowerWick >= 3 * m.body && m.upperWick <= m.body * 0.3 && m.range > 0) {
    const wickRatio = m.lowerWick / Math.max(m.body, 0.0001);
    const strength = Math.min(1, 0.6 + (wickRatio - 3) * 0.08 + (m.body >= minBody ? 0.15 : 0));
    patterns.push({
      name: 'pin_bar_bullish',
      direction: 'bullish',
      strength,
      description: 'Bullish pin bar - strong rejection of lower prices',
    });
  }

  // --- Pin Bar Bearish ---
  // Very long upper wick >= 3x body, tiny lower wick
  if (m.body > 0 && m.upperWick >= 3 * m.body && m.lowerWick <= m.body * 0.3 && m.range > 0) {
    const wickRatio = m.upperWick / Math.max(m.body, 0.0001);
    const strength = Math.min(1, 0.6 + (wickRatio - 3) * 0.08 + (m.body >= minBody ? 0.15 : 0));
    patterns.push({
      name: 'pin_bar_bearish',
      direction: 'bearish',
      strength,
      description: 'Bearish pin bar - strong rejection of higher prices',
    });
  }

  // --- Bullish Engulfing ---
  // Current green candle's body fully engulfs previous red candle's body
  if (m.isGreen && pm.isRed && m.body >= minBody) {
    const currBodyHigh = Math.max(last.open, last.close);
    const currBodyLow = Math.min(last.open, last.close);
    const prevBodyHigh = Math.max(prev.open, prev.close);
    const prevBodyLow = Math.min(prev.open, prev.close);
    if (currBodyHigh > prevBodyHigh && currBodyLow < prevBodyLow) {
      const engulfRatio = m.body / Math.max(pm.body, 0.0001);
      const strength = Math.min(1, 0.6 + (engulfRatio - 1) * 0.15);
      patterns.push({
        name: 'bullish_engulfing',
        direction: 'bullish',
        strength,
        description: 'Bullish engulfing - buyers overwhelmed sellers, reversal signal',
      });
    }
  }

  // --- Bearish Engulfing ---
  // Current red candle's body fully engulfs previous green candle's body
  if (m.isRed && pm.isGreen && m.body >= minBody) {
    const currBodyHigh = Math.max(last.open, last.close);
    const currBodyLow = Math.min(last.open, last.close);
    const prevBodyHigh = Math.max(prev.open, prev.close);
    const prevBodyLow = Math.min(prev.open, prev.close);
    if (currBodyHigh > prevBodyHigh && currBodyLow < prevBodyLow) {
      const engulfRatio = m.body / Math.max(pm.body, 0.0001);
      const strength = Math.min(1, 0.6 + (engulfRatio - 1) * 0.15);
      patterns.push({
        name: 'bearish_engulfing',
        direction: 'bearish',
        strength,
        description: 'Bearish engulfing - sellers overwhelmed buyers, reversal signal',
      });
    }
  }

  // --- Morning Star (bullish 3-candle reversal) ---
  if (prevPrev && ppm) {
    const isFirstBigRed = ppm.isRed && ppm.body >= minBody;
    const isMiddleSmall = pm.body < ppm.body * 0.4 && pm.body < m.body * 0.4;
    const isLastBigGreen = m.isGreen && m.body >= minBody;
    // Last candle should close above midpoint of first candle
    const firstMid = (prevPrev.open + prevPrev.close) / 2;
    if (isFirstBigRed && isMiddleSmall && isLastBigGreen && last.close > firstMid) {
      const recoveryRatio = m.body / Math.max(ppm.body, 0.0001);
      const strength = Math.min(1, 0.5 + recoveryRatio * 0.2 + (pm.body < ppm.body * 0.2 ? 0.15 : 0));
      patterns.push({
        name: 'morning_star',
        direction: 'bullish',
        strength,
        description: 'Morning star - 3-candle bullish reversal pattern',
      });
    }
  }

  // --- Evening Star (bearish 3-candle reversal) ---
  if (prevPrev && ppm) {
    const isFirstBigGreen = ppm.isGreen && ppm.body >= minBody;
    const isMiddleSmall = pm.body < ppm.body * 0.4 && pm.body < m.body * 0.4;
    const isLastBigRed = m.isRed && m.body >= minBody;
    // Last candle should close below midpoint of first candle
    const firstMid = (prevPrev.open + prevPrev.close) / 2;
    if (isFirstBigGreen && isMiddleSmall && isLastBigRed && last.close < firstMid) {
      const recoveryRatio = m.body / Math.max(ppm.body, 0.0001);
      const strength = Math.min(1, 0.5 + recoveryRatio * 0.2 + (pm.body < ppm.body * 0.2 ? 0.15 : 0));
      patterns.push({
        name: 'evening_star',
        direction: 'bearish',
        strength,
        description: 'Evening star - 3-candle bearish reversal pattern',
      });
    }
  }

  // Sort by strength descending
  patterns.sort((a, b) => b.strength - a.strength);
  return patterns;
}

/**
 * Calculate all indicators for OHLC data
 * Requires minimum 50 candles for accurate calculations
 *
 * IMPORTANT: Now separates TREND (from EMAs) from ENTRY SIGNALS (RSI/BB)
 */
export function calculateIndicators(ohlc: OHLCData[]): Indicators | null {
  if (!ohlc || ohlc.length < 50) {
    console.warn('Insufficient data for indicator calculation:', ohlc?.length || 0, 'candles');
    return null;
  }

  // Use all available data (up to 720 candles for EMA200 accuracy)
  const data = ohlc.slice(-720);
  const closes = data.map(x => x.close);
  const highs = data.map(x => x.high);
  const lows = data.map(x => x.low);
  const volumes = data.map(x => x.volume);
  const currentPrice = closes[closes.length - 1];

  // === ENTRY TIMING INDICATORS (for timing entries within a trend) ===
  const rsi = calculateRSI(closes);
  const { macd, signal: macdSignal, histogram } = calculateMACD(closes);
  const { position: bbPos, upper: bbUpper, lower: bbLower } = calculateBollingerBands(closes);
  const bbWidthPercent = currentPrice > 0 ? ((bbUpper - bbLower) / currentPrice) * 100 : 0;
  const atr = calculateATR(highs, lows, closes);
  const volRatio = calculateVolumeRatio(volumes);
  const adxResult = calculateADX(highs, lows, closes);

  // === TREND ANALYSIS (EMA-based - the CORRECT way) ===
  const ema20Values = ema(closes, 20);
  const ema50Values = ema(closes, 50);
  const ema200Values = ema(closes, 200);

  const ema20Val = ema20Values[ema20Values.length - 1] || currentPrice;
  const ema50Val = ema50Values[ema50Values.length - 1] || currentPrice;
  const ema200Val = ema200Values[ema200Values.length - 1] || currentPrice;

  // Calculate EMA slopes (momentum indicators)
  const ema20Slope = calculateEMASlope(ema20Values, 5);
  const ema50Slope = calculateEMASlope(ema50Values, 10);

  // Calculate price distance from EMAs (%)
  const priceVsEma20 = ((currentPrice - ema20Val) / ema20Val) * 100;
  const priceVsEma50 = ((currentPrice - ema50Val) / ema50Val) * 100;
  const priceVsEma200 = ((currentPrice - ema200Val) / ema200Val) * 100;

  // Determine EMA alignment
  const emaAlignment = determineEMAAlignment(currentPrice, ema20Val, ema50Val, ema200Val);

  // Analyze trend properly using EMA structure
  const trendAnalysis = analyzeTrend(
    currentPrice,
    ema20Val,
    ema50Val,
    ema200Val,
    ema20Slope,
    ema50Slope
  );

  // === LEGACY SCORE (for entry conditions, not trend) ===
  // This score is now ONLY used for entry timing, not trend direction
  let entryScore = 0;

  // RSI contribution (for entry timing within trend)
  if (rsi < 35) entryScore += 2;        // Oversold - good long entry
  else if (rsi < 45) entryScore += 1;
  else if (rsi > 65) entryScore -= 2;   // Overbought - good short entry
  else if (rsi > 55) entryScore -= 1;

  // MACD momentum
  if (macd > 0) entryScore += 1;
  else if (macd < 0) entryScore -= 1;

  // BB position
  if (bbPos < 0.3) entryScore += 1;
  else if (bbPos > 0.7) entryScore -= 1;

  // === BIAS is now based on TREND, not entry signals ===
  // This is the key fix - bias reflects actual trend direction
  const bias = trendAnalysis.trend;

  // Trend strength from trendScore
  const absTrendScore = Math.abs(trendAnalysis.trendScore);
  const trendStrength: 'strong' | 'moderate' | 'weak' =
    absTrendScore >= 60 ? 'strong' :
    absTrendScore >= 35 ? 'moderate' : 'weak';

  // Detect candlestick patterns on recent candles
  const candlestickPatterns = detectCandlestickPatterns(data.slice(-5));
  // Extended pattern detection (uses last 10+ candles for context)
  const extendedPatterns = detectAllCandlestickPatterns(data.slice(-15));

  return {
    rsi,
    macd,
    macdSignal,
    histogram,
    bbPos,
    bbUpper,
    bbLower,
    atr,
    volRatio,
    score: entryScore, // Legacy score for entry timing
    bias,              // NOW based on EMA trend, not RSI/BB
    trendStrength,
    // New professional trend fields
    ema20: ema20Val,
    ema50: ema50Val,
    ema200: ema200Val,
    priceVsEma20,
    priceVsEma50,
    priceVsEma200,
    emaAlignment,
    ema20Slope,
    ema50Slope,
    trend: trendAnalysis.trend,
    trendScore: trendAnalysis.trendScore,
    candlestickPatterns,
    extendedPatterns,
    adx: adxResult.adx,
    plusDI: adxResult.plusDI,
    minusDI: adxResult.minusDI,
    bbWidth: bbWidthPercent,
  };
}

/**
 * Calculate BTC trend from price change percentage
 * Used for BTC correlation check
 */
export function calculateBTCTrend(
  btcChange: number
): { trend: 'bull' | 'bear' | 'neut'; change: number } {
  // BTC needs >0.5% move to be considered trending
  const trend = btcChange > 0.5 ? 'bull' : btcChange < -0.5 ? 'bear' : 'neut';
  return { trend, change: btcChange };
}

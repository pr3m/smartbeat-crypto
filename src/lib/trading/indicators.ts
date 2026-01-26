/**
 * Technical Indicators
 * Professional-grade calculations for crypto trading
 * Based on standard TA methods used in TradingView, MetaTrader, etc.
 */

import type { OHLCData, Indicators } from '@/lib/kraken/types';

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
 * Calculate all indicators for OHLC data
 * Requires minimum 50 candles for accurate calculations
 */
export function calculateIndicators(ohlc: OHLCData[]): Indicators | null {
  if (!ohlc || ohlc.length < 50) {
    console.warn('Insufficient data for indicator calculation:', ohlc?.length || 0, 'candles');
    return null;
  }

  // Use all available data (up to 720 candles for accuracy)
  const data = ohlc.slice(-720);
  const closes = data.map(x => x.close);
  const highs = data.map(x => x.high);
  const lows = data.map(x => x.low);
  const volumes = data.map(x => x.volume);

  // Calculate indicators
  const rsi = calculateRSI(closes);
  const { macd, signal: macdSignal, histogram } = calculateMACD(closes);
  const { position: bbPos, upper: bbUpper, lower: bbLower } = calculateBollingerBands(closes);
  const atr = calculateATR(highs, lows, closes);
  const volRatio = calculateVolumeRatio(volumes);

  // Calculate bias score for MTF analysis
  // Thresholds calibrated for typical crypto market conditions
  let score = 0;

  // RSI contribution (oversold = bullish opportunity, overbought = bearish)
  if (rsi < 35) score += 2;        // Oversold - strong buy signal
  else if (rsi < 45) score += 1;   // Below neutral - mild bullish
  else if (rsi > 65) score -= 2;   // Overbought - strong sell signal
  else if (rsi > 55) score -= 1;   // Above neutral - mild bearish

  // MACD contribution (trend momentum)
  if (macd > 0) score += 1;        // Bullish momentum
  else if (macd < 0) score -= 1;   // Bearish momentum

  // Bollinger Band position (mean reversion signal)
  if (bbPos < 0.3) score += 1;     // Near lower band - bullish
  else if (bbPos > 0.7) score -= 1; // Near upper band - bearish

  // Determine overall bias
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (score >= 2) bias = 'bullish';
  else if (score <= -2) bias = 'bearish';

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
    score,
    bias,
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

/**
 * Knife Detection Module
 *
 * Detects falling and rising knives to protect against premature counter-trend entries.
 * Uses stateful phase tracking with deterministic signals.
 */

import type { OHLCData } from '@/lib/kraken/types';
import { findSwingPoints, type SwingPoint } from './chart-context';
import {
  type KnifeState,
  type KnifePhase,
  type KnifeDirection,
  makeKnifeKey,
  getTfSeconds,
  getKnifeState,
  setKnifeState,
  logPhaseTransition,
} from './knife-state';
import {
  findKeyLevelsForKnife,
  mergeKnifeLevels,
  selectBrokenLevel,
  type KnifeLevel,
} from './knife-levels';
import { calculateATR } from './indicators';

// ============================================================================
// Types
// ============================================================================

export interface KnifeSignals {
  // Impulse signals
  decisiveBreak: boolean;
  fastVelocity: boolean;
  volumeExpansion: boolean;

  // Capitulation signals
  capitulationCandle: boolean;

  // Stabilization signals
  noNewExtreme: boolean;
  atrContraction: boolean;
  volumeFading: boolean;
  hlSequence: boolean;      // Higher lows (falling) or lower highs (rising)
  clvDrift: boolean;

  // Confirmation signals
  reclaimed: boolean;
  microStructureShift: boolean;

  // Retest signals
  retestQuality: 'good' | 'poor' | 'none';

  // Reset signals
  bounceSold: boolean;
}

export interface KnifeMetrics {
  velocityATR: number;
  breakDistanceATR: number;
  relVolume: number;
  rangeATR: number;
  bodyATR: number;
  clv: number;
}

export interface KnifeAnalysis {
  isKnife: boolean;
  direction: KnifeDirection | null;
  phase: KnifePhase;

  brokenLevel: number | null;
  knifeScore: number;           // 0-100: impulse/capitulation strength
  reversalReadiness: number;    // 0-100: stabilization + confirmation progress

  gateAction: 'block' | 'warn' | 'allow';
  sizeMultiplier: number;
  flipSuggestion: boolean;

  signals: KnifeSignals;
  metrics: KnifeMetrics;

  waitFor: string[];
  reasons: string[];
}

export interface KnifeConfig {
  // Break detection
  closeBreakATR: number;
  wickBreakATR: number;
  wickAcceptATR: number;

  // Velocity
  fastVelocityATR: number;
  fastBodyATR: number;

  // Capitulation
  capRangeATR: number;
  capVolMultiple: number;

  // Retest
  retestTouchATR: number;
  retestHoldATR: number;
  retestWindow: number;

  // TTL
  maxAgeCandles: number;
  maxInactiveSec: number;
}

const DEFAULT_CONFIG: KnifeConfig = {
  closeBreakATR: 0.35,
  wickBreakATR: 0.6,
  wickAcceptATR: 0.2,
  fastVelocityATR: 2.0,
  fastBodyATR: 1.2,
  capRangeATR: 2.0,
  capVolMultiple: 1.5,
  retestTouchATR: 0.3,
  retestHoldATR: 0.3,
  retestWindow: 8,
  maxAgeCandles: 48,
  maxInactiveSec: 21600,
};

// Symbol-specific config overrides
const CONFIG_BY_SYMBOL: Record<string, Partial<KnifeConfig>> = {
  'XRPEUR': {
    retestTouchATR: 0.3,
    retestHoldATR: 0.3,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
  return denominator !== 0 && isFinite(denominator) ? numerator / denominator : fallback;
}

function calcRelVolume(ohlc: OHLCData[], index: number): number | null {
  if (index < 20) return null;
  const sum = ohlc.slice(index - 19, index + 1).reduce((s, c) => s + c.volume, 0);
  const sma20 = sum / 20;
  if (sma20 === 0) return null;
  return ohlc[index].volume / sma20;
}

function calcRangeATR(candle: OHLCData, atr: number): number | null {
  if (atr === 0) return null;
  return (candle.high - candle.low) / atr;
}

function calcVelocityATR(ohlc: OHLCData[], n: number, atr: number): number | null {
  const last = ohlc.length - 1;
  const prevN = last - n;
  if (prevN < 0 || atr === 0) return null;
  return Math.abs(ohlc[last].close - ohlc[prevN].close) / atr;
}

function calcBodyATR(candle: OHLCData, atr: number): number | null {
  if (atr === 0) return null;
  return Math.abs(candle.close - candle.open) / atr;
}

function calcCLV(candle: OHLCData): number | null {
  const range = candle.high - candle.low;
  if (range === 0) return null;
  return ((candle.close - candle.low) / range) * 2 - 1;
}

function calcATR(ohlc: OHLCData[], period: number = 14): number {
  const highs = ohlc.map(c => c.high);
  const lows = ohlc.map(c => c.low);
  const closes = ohlc.map(c => c.close);
  return calculateATR(highs, lows, closes, period);
}

function calcMedianVolume(ohlc: OHLCData[], startIdx: number, endIdx: number): number {
  if (startIdx < 0 || endIdx >= ohlc.length || startIdx > endIdx) return 0;
  const volumes = ohlc.slice(startIdx, endIdx + 1).map(c => c.volume).sort((a, b) => a - b);
  const mid = Math.floor(volumes.length / 2);
  return volumes.length % 2 === 0
    ? (volumes[mid - 1] + volumes[mid]) / 2
    : volumes[mid];
}

// Helper: find last element matching predicate (reverse iteration)
function findLast<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return undefined;
}

// ============================================================================
// Signal Detection Functions
// ============================================================================

function detectImpulseSignals(
  ohlc: OHLCData[],
  atr: number,
  _config: KnifeConfig
): { decisiveBreak: boolean; fastVelocity: boolean; volumeExpansion: boolean; rangeATR: number } {
  const last = ohlc.length - 1;
  const candle = ohlc[last];

  const relVol = calcRelVolume(ohlc, last);
  const rangeATR = calcRangeATR(candle, atr) ?? 0;
  const velocityATR = calcVelocityATR(ohlc, 5, atr) ?? 0;
  const bodyATR = calcBodyATR(candle, atr) ?? 0;

  // Volume expansion
  const volumeExpansion = relVol !== null && relVol >= 1.5;

  // Fast velocity: >= 2.0 ATR over 5 candles OR >= 1.2 ATR single body
  const fastVelocity = velocityATR >= _config.fastVelocityATR || bodyATR >= _config.fastBodyATR;

  // Decisive break: This will be determined by selectBrokenLevel
  // For now, consider decisive if rangeATR >= 1.2
  const decisiveBreak = rangeATR >= 1.2;

  return { decisiveBreak, fastVelocity, volumeExpansion, rangeATR };
}

function detectCapitulation(
  ohlc: OHLCData[],
  atr: number,
  direction: KnifeDirection,
  config: KnifeConfig,
  lookback: number = 10
): { detected: boolean; pending: boolean; candleIndex: number } {
  const last = ohlc.length - 1;

  for (let i = last; i >= Math.max(0, last - lookback); i--) {
    const candle = ohlc[i];
    const rangeATR = calcRangeATR(candle, atr);
    const relVol = calcRelVolume(ohlc, i);

    if (rangeATR !== null && rangeATR >= config.capRangeATR &&
        relVol !== null && relVol >= config.capVolMultiple) {
      // Candidate capitulation candle found
      if (i === last) {
        // Can't confirm follow-through yet
        return { detected: false, pending: true, candleIndex: i };
      }

      // Check follow-through failure
      const hasFollowThrough = checkFollowThrough(ohlc, i, direction, atr);
      if (!hasFollowThrough) {
        return { detected: true, pending: false, candleIndex: i };
      }
    }
  }

  return { detected: false, pending: false, candleIndex: -1 };
}

function checkFollowThrough(
  ohlc: OHLCData[],
  capIndex: number,
  direction: KnifeDirection,
  atr: number
): boolean {
  const windowEnd = Math.min(capIndex + 3, ohlc.length - 1);
  const capCandle = ohlc[capIndex];
  const continuationThreshold = 0.2 * atr;

  for (let j = capIndex + 1; j <= windowEnd; j++) {
    const c = ohlc[j];
    if (direction === 'falling') {
      if (c.low <= capCandle.low - continuationThreshold) {
        return true; // Meaningful continuation
      }
    } else {
      if (c.high >= capCandle.high + continuationThreshold) {
        return true;
      }
    }
  }
  return false; // No meaningful continuation = follow-through failure
}

function detectStabilizationSignals(
  ohlc: OHLCData[],
  atr: number,
  direction: KnifeDirection,
  state: KnifeState | null
): {
  noNewExtreme: boolean;
  atrContraction: boolean;
  volumeFading: boolean;
  hlSequence: boolean;
  clvDrift: boolean;
  count: number;
} {
  const last = ohlc.length - 1;

  // No new extreme for 4+ candles
  let noNewExtreme = false;
  if (state && last - state.breakCandleIndex >= 4) {
    const recentCandles = ohlc.slice(state.breakCandleIndex + 1);
    if (direction === 'falling') {
      const breakLow = ohlc[state.breakCandleIndex].low;
      noNewExtreme = recentCandles.every(c => c.low >= breakLow);
    } else {
      const breakHigh = ohlc[state.breakCandleIndex].high;
      noNewExtreme = recentCandles.every(c => c.high <= breakHigh);
    }
  }

  // ATR contraction: ATR(7)/ATR(21) <= 0.85
  let atrContraction = false;
  if (ohlc.length >= 21) {
    const atr7 = calcATR(ohlc.slice(-7), 7);
    const atr21 = calcATR(ohlc.slice(-21), 21);
    if (atr21 > 0) {
      atrContraction = atr7 / atr21 <= 0.85;
    }
  }

  // Volume fading: SMA(relVol,3) < SMA(relVol,10)
  let volumeFading = false;
  if (ohlc.length >= 30) {
    const relVols: number[] = [];
    for (let i = last - 9; i <= last; i++) {
      const rv = calcRelVolume(ohlc, i);
      if (rv !== null) relVols.push(rv);
    }
    if (relVols.length >= 10) {
      const sma3 = (relVols[7] + relVols[8] + relVols[9]) / 3;
      const sma10 = relVols.reduce((a, b) => a + b, 0) / 10;
      volumeFading = sma3 < sma10;
    }
  }

  // HL sequence (for falling: higher lows in last 4 candle lows)
  let hlSequence = false;
  if (ohlc.length >= 4) {
    const recentLows = ohlc.slice(-4).map(c => c.low);
    const recentHighs = ohlc.slice(-4).map(c => c.high);
    if (direction === 'falling') {
      // Check for higher lows
      hlSequence = recentLows.every((l, i) => i === 0 || l >= recentLows[i - 1]);
    } else {
      // Check for lower highs
      hlSequence = recentHighs.every((h, i) => i === 0 || h <= recentHighs[i - 1]);
    }
  }

  // CLV drift (improving over last 4 candles)
  let clvDrift = false;
  if (ohlc.length >= 4) {
    const clvs: number[] = [];
    for (let i = last - 3; i <= last; i++) {
      const c = calcCLV(ohlc[i]);
      if (c !== null) clvs.push(c);
    }
    if (clvs.length >= 4) {
      if (direction === 'falling') {
        // For falling knife, CLV should trend up (closes near highs)
        clvDrift = clvs[3] > clvs[0] + 0.2;
      } else {
        // For rising knife, CLV should trend down (closes near lows)
        clvDrift = clvs[3] < clvs[0] - 0.2;
      }
    }
  }

  // Count how many stabilization signals are true
  const count = [noNewExtreme, atrContraction, volumeFading, hlSequence, clvDrift]
    .filter(Boolean).length;

  return { noNewExtreme, atrContraction, volumeFading, hlSequence, clvDrift, count };
}

function detectReclaim(
  ohlc: OHLCData[],
  brokenLevel: number,
  atr: number,
  direction: KnifeDirection,
  config: KnifeConfig
): boolean {
  const last = ohlc[ohlc.length - 1];
  const reclaimThreshold = config.retestTouchATR * atr;

  if (direction === 'falling') {
    // Price must close back above level by threshold
    return last.close >= brokenLevel + reclaimThreshold;
  } else {
    // Price must close back below level by threshold
    return last.close <= brokenLevel - reclaimThreshold;
  }
}

function detectMicroStructureShift(
  ohlc5m: OHLCData[],
  direction: KnifeDirection
): boolean {
  if (ohlc5m.length < 15) return false;

  const swings = findSwingPoints(ohlc5m, 2); // lookback=2 for 5m sensitivity

  if (direction === 'falling') {
    // SEQUENCE: low1 -> intervening high -> low2 (higher) -> break that high
    const lows = swings.filter(s => s.type === 'low');
    const highs = swings.filter(s => s.type === 'high');

    if (lows.length < 2) return false;
    const low1 = lows[lows.length - 2];
    const low2 = lows[lows.length - 1];
    if (low2.index <= low1.index) return false;

    // Check higher low
    if (low2.price <= low1.price) return false;

    // Find LAST intervening high between low1 and low2
    const interveningHigh = findLast(highs, h => h.index > low1.index && h.index < low2.index);
    // Find FIRST high after low2
    const postHigh = highs.find(h => h.index > low2.index);

    // Prefer intervening if exists, else use post
    const targetHigh = interveningHigh || postHigh;
    if (!targetHigh) return false;

    // Check if current price breaks that high
    const currentPrice = ohlc5m[ohlc5m.length - 1].close;
    return currentPrice > targetHigh.price;

  } else {
    // SEQUENCE: high1 -> intervening low -> high2 (lower) -> break that low
    const highs = swings.filter(s => s.type === 'high');
    const lows = swings.filter(s => s.type === 'low');

    if (highs.length < 2) return false;
    const high1 = highs[highs.length - 2];
    const high2 = highs[highs.length - 1];
    if (high2.index <= high1.index) return false;

    // Check lower high
    if (high2.price >= high1.price) return false;

    // Find LAST intervening low between high1 and high2
    const interveningLow = findLast(lows, l => l.index > high1.index && l.index < high2.index);
    // Find FIRST low after high2
    const postLow = lows.find(l => l.index > high2.index);

    // Prefer intervening if exists, else use post
    const targetLow = interveningLow || postLow;
    if (!targetLow) return false;

    // Check if current price breaks that low
    const currentPrice = ohlc5m[ohlc5m.length - 1].close;
    return currentPrice < targetLow.price;
  }
}

function detectRetestQuality(
  ohlc: OHLCData[],
  brokenLevel: number,
  atr: number,
  impulseVolBaseline: number,
  direction: KnifeDirection,
  config: KnifeConfig
): 'good' | 'poor' | 'none' {
  const last = ohlc.length - 1;
  const touchThreshold = config.retestTouchATR * atr;
  const holdThreshold = config.retestHoldATR * atr;
  const windowCandles = config.retestWindow;

  // Look for retest in recent candles
  let touchedIndex = -1;
  const searchStart = Math.max(0, last - windowCandles);

  for (let i = searchStart; i <= last; i++) {
    const candle = ohlc[i];
    if (direction === 'falling') {
      // Retest of support-turned-resistance: price should approach from below
      if (Math.abs(candle.high - brokenLevel) <= touchThreshold) {
        touchedIndex = i;
        break;
      }
    } else {
      // Retest of resistance-turned-support: price should approach from above
      if (Math.abs(candle.low - brokenLevel) <= touchThreshold) {
        touchedIndex = i;
        break;
      }
    }
  }

  if (touchedIndex === -1) return 'none';

  // Check hold condition: no close beyond level by more than holdThreshold
  let holdViolated = false;
  for (let i = touchedIndex; i <= last; i++) {
    const candle = ohlc[i];
    if (direction === 'falling') {
      if (candle.close > brokenLevel + holdThreshold) {
        holdViolated = true;
        break;
      }
    } else {
      if (candle.close < brokenLevel - holdThreshold) {
        holdViolated = true;
        break;
      }
    }
  }

  if (holdViolated) return 'poor';

  // Check volume condition
  const avgVol = ohlc.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const retestVol = ohlc.slice(touchedIndex, last + 1).reduce((s, c) => s + c.volume, 0) /
                    (last - touchedIndex + 1);

  const volThreshold = Math.min(0.7 * impulseVolBaseline, 0.9 * avgVol);
  if (retestVol >= volThreshold) return 'poor';

  return 'good';
}

function detectBounceSold(
  ohlc: OHLCData[],
  brokenLevel: number,
  atr: number,
  direction: KnifeDirection,
  hasReclaimed: boolean
): boolean {
  if (!hasReclaimed) return false;

  const last = ohlc.length - 1;
  if (last < 2) return false;

  const threshold = 0.3 * atr;
  const candle = ohlc[last];
  const prevCandle = ohlc[last - 1];

  if (direction === 'falling') {
    // Check if price fell back below broken level
    if (candle.close <= brokenLevel - threshold) return true;

    // 2 consecutive closes below
    if (candle.close < brokenLevel && prevCandle.close < brokenLevel) return true;

    // Velocity check
    const vel = calcVelocityATR(ohlc, 3, atr);
    if (vel !== null && vel >= 1.5 && candle.close < ohlc[last - 3].close) return true;

  } else {
    // Check if price rose back above broken level
    if (candle.close >= brokenLevel + threshold) return true;

    // 2 consecutive closes above
    if (candle.close > brokenLevel && prevCandle.close > brokenLevel) return true;

    // Velocity check
    const vel = calcVelocityATR(ohlc, 3, atr);
    if (vel !== null && vel >= 1.5 && candle.close > ohlc[last - 3].close) return true;
  }

  return false;
}

// ============================================================================
// Main Detection Function
// ============================================================================

function canRunKnifeDetection(
  ohlc15m: OHLCData[],
  ohlc5m: OHLCData[],
  atr15m: number
): { canRun: boolean; reason?: string } {
  if (ohlc15m.length < 50) return { canRun: false, reason: 'Need 50+ 15m candles' };
  if (ohlc5m.length < 30) return { canRun: false, reason: 'Need 30+ 5m candles' };
  if (atr15m === 0 || !isFinite(atr15m)) return { canRun: false, reason: 'Invalid ATR' };
  return { canRun: true };
}

export function detectKnife(
  ohlc15m: OHLCData[],
  ohlc5m: OHLCData[],
  ohlc1h: OHLCData[],
  ohlc4h: OHLCData[],
  exchange: string = 'kraken',
  pair: string = 'XRPEUR'
): KnifeAnalysis {
  const defaultResult: KnifeAnalysis = {
    isKnife: false,
    direction: null,
    phase: 'none',
    brokenLevel: null,
    knifeScore: 0,
    reversalReadiness: 0,
    gateAction: 'allow',
    sizeMultiplier: 1.0,
    flipSuggestion: false,
    signals: {
      decisiveBreak: false,
      fastVelocity: false,
      volumeExpansion: false,
      capitulationCandle: false,
      noNewExtreme: false,
      atrContraction: false,
      volumeFading: false,
      hlSequence: false,
      clvDrift: false,
      reclaimed: false,
      microStructureShift: false,
      retestQuality: 'none',
      bounceSold: false,
    },
    metrics: {
      velocityATR: 0,
      breakDistanceATR: 0,
      relVolume: 0,
      rangeATR: 0,
      bodyATR: 0,
      clv: 0,
    },
    waitFor: [],
    reasons: [],
  };

  // Calculate 15m ATR
  const atr15m = calcATR(ohlc15m);

  // Validate inputs
  const guard = canRunKnifeDetection(ohlc15m, ohlc5m, atr15m);
  if (!guard.canRun) {
    return { ...defaultResult, reasons: [guard.reason || 'Insufficient data'] };
  }

  // Get config for this symbol
  const config: KnifeConfig = {
    ...DEFAULT_CONFIG,
    ...(CONFIG_BY_SYMBOL[pair] || {}),
  };

  const tf = '15m';
  const key = makeKnifeKey(exchange, pair, tf);
  const currentCandleTime = ohlc15m[ohlc15m.length - 1].time;
  const currentPrice = ohlc15m[ohlc15m.length - 1].close;
  const nowSec = currentCandleTime;

  // Get existing state
  let state = getKnifeState(key, currentCandleTime);

  // Calculate current metrics
  const lastCandle = ohlc15m[ohlc15m.length - 1];
  const metrics: KnifeMetrics = {
    velocityATR: calcVelocityATR(ohlc15m, 5, atr15m) ?? 0,
    breakDistanceATR: 0,
    relVolume: calcRelVolume(ohlc15m, ohlc15m.length - 1) ?? 1,
    rangeATR: calcRangeATR(lastCandle, atr15m) ?? 0,
    bodyATR: calcBodyATR(lastCandle, atr15m) ?? 0,
    clv: calcCLV(lastCandle) ?? 0,
  };

  // If no active state, check for new knife formation
  if (!state) {
    // Find key levels from multiple timeframes
    const levels15m = findKeyLevelsForKnife(ohlc15m, '15m', 2);
    const levels1h = ohlc1h.length >= 20 ? findKeyLevelsForKnife(ohlc1h, '1h', 3) : [];
    const levels4h = ohlc4h.length >= 20 ? findKeyLevelsForKnife(ohlc4h, '4h', 3) : [];

    const mergedLevels = mergeKnifeLevels(
      [
        { tf: '15m', levels: levels15m },
        { tf: '1h', levels: levels1h },
        { tf: '4h', levels: levels4h },
      ],
      atr15m,
      currentPrice,
      nowSec
    );

    // Try to detect a broken level (falling or rising)
    const fallingBreak = selectBrokenLevel(mergedLevels, ohlc15m, atr15m, 'down');
    const risingBreak = selectBrokenLevel(mergedLevels, ohlc15m, atr15m, 'up');

    // Pick the more recent break
    let selectedBreak = null;
    let direction: KnifeDirection | null = null;

    if (fallingBreak && risingBreak) {
      // Both exist, pick most recent
      if (fallingBreak.breakIndex >= risingBreak.breakIndex) {
        selectedBreak = fallingBreak;
        direction = 'falling';
      } else {
        selectedBreak = risingBreak;
        direction = 'rising';
      }
    } else if (fallingBreak) {
      selectedBreak = fallingBreak;
      direction = 'falling';
    } else if (risingBreak) {
      selectedBreak = risingBreak;
      direction = 'rising';
    }

    if (!selectedBreak || !direction) {
      // No knife detected
      return defaultResult;
    }

    // Check for impulse conditions
    const impulseSignals = detectImpulseSignals(ohlc15m, atr15m, config);

    // Require decisiveBreak AND volumeExpansion AND (fastVelocity OR rangeATR >= 1.2)
    const isImpulse = impulseSignals.volumeExpansion &&
                      (impulseSignals.fastVelocity || impulseSignals.rangeATR >= 1.2);

    if (!isImpulse) {
      // Break detected but not impulsive enough
      return defaultResult;
    }

    // Create new knife state
    const breakIndex = selectedBreak.breakIndex;
    state = {
      key,
      direction,
      phase: 'impulse',
      tfSec: getTfSeconds(tf),
      brokenLevel: selectedBreak.level.price,
      breakTime: selectedBreak.breakTime,
      breakCandleIndex: breakIndex,
      breakType: selectedBreak.breakType,
      impulseStartIndex: Math.max(0, breakIndex - 3),
      impulseEndIndex: breakIndex,
      impulseVolBaseline: calcMedianVolume(ohlc15m, Math.max(0, breakIndex - 3), breakIndex),
      lastActivitySec: Math.floor(Date.now() / 1000),
    };

    setKnifeState(key, state);
    logPhaseTransition(key, 'none', 'impulse', state.brokenLevel, currentPrice, atr15m,
      { decisiveBreak: true, volumeExpansion: true, fastVelocity: impulseSignals.fastVelocity });

    metrics.breakDistanceATR = selectedBreak.breakDistanceATR;
  }

  // Now we have an active state, compute all signals
  const direction = state.direction;
  const brokenLevel = state.brokenLevel;

  metrics.breakDistanceATR = Math.abs(currentPrice - brokenLevel) / atr15m;

  const signals: KnifeSignals = {
    decisiveBreak: true, // Already confirmed
    fastVelocity: metrics.velocityATR >= config.fastVelocityATR,
    volumeExpansion: metrics.relVolume >= 1.5,
    capitulationCandle: false,
    noNewExtreme: false,
    atrContraction: false,
    volumeFading: false,
    hlSequence: false,
    clvDrift: false,
    reclaimed: false,
    microStructureShift: false,
    retestQuality: 'none',
    bounceSold: false,
  };

  // Phase-dependent signal detection
  const prevPhase = state.phase;
  let newPhase = state.phase;

  // Check for capitulation
  const capResult = detectCapitulation(ohlc15m, atr15m, direction, config);
  signals.capitulationCandle = capResult.detected;

  // Check stabilization signals
  const stabSignals = detectStabilizationSignals(ohlc15m, atr15m, direction, state);
  signals.noNewExtreme = stabSignals.noNewExtreme;
  signals.atrContraction = stabSignals.atrContraction;
  signals.volumeFading = stabSignals.volumeFading;
  signals.hlSequence = stabSignals.hlSequence;
  signals.clvDrift = stabSignals.clvDrift;

  // Check reclaim
  signals.reclaimed = detectReclaim(ohlc15m, brokenLevel, atr15m, direction, config);

  // Check micro structure shift
  signals.microStructureShift = detectMicroStructureShift(ohlc5m, direction);

  // Check retest quality (only if reclaimed)
  if (signals.reclaimed) {
    signals.retestQuality = detectRetestQuality(
      ohlc15m, brokenLevel, atr15m, state.impulseVolBaseline, direction, config
    );
  }

  // Check bounce sold (only if reclaimed)
  signals.bounceSold = detectBounceSold(ohlc15m, brokenLevel, atr15m, direction, signals.reclaimed);

  // ============================================================================
  // Phase State Machine
  // ============================================================================

  // Check for re-impulse (reversion to impulse from any phase)
  if (signals.decisiveBreak && signals.volumeExpansion && metrics.relVolume >= 1.2) {
    if (newPhase !== 'impulse') {
      newPhase = 'impulse';
    }
  }

  // Bounce sold (only after reclaim)
  if (signals.bounceSold && (newPhase === 'confirming' || newPhase === 'safe')) {
    newPhase = 'impulse';
  }

  // Normal phase transitions
  switch (state.phase) {
    case 'impulse':
      // impulse -> capitulation
      if (signals.capitulationCandle ||
          (ohlc15m.length - state.breakCandleIndex >= 3)) {
        newPhase = 'capitulation';
      }
      break;

    case 'capitulation':
      // capitulation -> stabilizing
      if (stabSignals.count >= 2) {
        newPhase = 'stabilizing';
      }
      break;

    case 'stabilizing':
      // stabilizing -> confirming
      if (signals.reclaimed || signals.microStructureShift) {
        newPhase = 'confirming';
        state.reclaimTime = currentCandleTime;
        state.reclaimCandleIndex = ohlc15m.length - 1;
      }
      break;

    case 'confirming':
      // confirming -> safe
      if (signals.retestQuality === 'good') {
        newPhase = 'safe';
      }
      break;

    case 'safe':
      // Already safe, no change needed
      break;
  }

  // Update state if phase changed
  if (newPhase !== prevPhase) {
    state.phase = newPhase;
    logPhaseTransition(key, prevPhase, newPhase, brokenLevel, currentPrice, atr15m, signals as unknown as Record<string, boolean>);
  }
  setKnifeState(key, state);

  // ============================================================================
  // Compute Scores and Gate Action
  // ============================================================================

  // Knife score (0-100): strength of impulse/capitulation
  let knifeScore = 0;
  if (signals.decisiveBreak) knifeScore += 25;
  if (signals.fastVelocity) knifeScore += 25;
  if (signals.volumeExpansion) knifeScore += 25;
  if (signals.capitulationCandle) knifeScore += 25;

  // Reversal readiness (0-100): progress toward safe
  let reversalReadiness = 0;
  if (signals.noNewExtreme) reversalReadiness += 10;
  if (signals.atrContraction) reversalReadiness += 10;
  if (signals.volumeFading) reversalReadiness += 10;
  if (signals.hlSequence) reversalReadiness += 10;
  if (signals.clvDrift) reversalReadiness += 10;
  if (signals.reclaimed) reversalReadiness += 20;
  if (signals.microStructureShift) reversalReadiness += 15;
  if (signals.retestQuality === 'good') reversalReadiness += 15;
  else if (signals.retestQuality === 'poor') reversalReadiness += 5;

  // Gate action and size multiplier based on phase
  let gateAction: 'block' | 'warn' | 'allow' = 'allow';
  let sizeMultiplier = 1.0;
  let flipSuggestion = false;
  const waitFor: string[] = [];
  const reasons: string[] = [];

  switch (state.phase) {
    case 'impulse':
      gateAction = 'block';
      sizeMultiplier = 0;
      flipSuggestion = true;
      waitFor.push('capitulation', 'stabilization');
      reasons.push(`${direction} knife impulse active`);
      break;

    case 'capitulation':
      gateAction = 'block';
      sizeMultiplier = 0;
      flipSuggestion = true;
      waitFor.push('stabilization signals (2+ of: noNewExtreme, atrContraction, volumeFading, hlSequence, clvDrift)');
      reasons.push(`${direction} knife capitulation - wait for stabilization`);
      break;

    case 'stabilizing':
      if (!signals.reclaimed && !signals.microStructureShift) {
        gateAction = 'block';
        sizeMultiplier = 0;
        waitFor.push('reclaim or micro structure shift');
        reasons.push(`Stabilizing, no confirmation yet`);
      } else {
        gateAction = 'warn';
        sizeMultiplier = 0.4;
        reasons.push('Early confirmation, reduced size');
      }
      break;

    case 'confirming':
      gateAction = 'warn';
      sizeMultiplier = signals.retestQuality === 'good' ? 0.8 : 0.5;
      if (signals.retestQuality !== 'good') {
        waitFor.push('quality retest');
        reasons.push('Awaiting quality retest');
      }
      break;

    case 'safe':
      gateAction = 'allow';
      sizeMultiplier = 1.0;
      reasons.push(`${direction} knife resolved - safe to trade`);
      break;
  }

  return {
    isKnife: true,
    direction,
    phase: state.phase,
    brokenLevel,
    knifeScore,
    reversalReadiness,
    gateAction,
    sizeMultiplier,
    flipSuggestion,
    signals,
    metrics,
    waitFor,
    reasons,
  };
}

// Feature flag for easy rollback
export const KNIFE_GATING_ENABLED = process.env.KNIFE_GATING_ENABLED !== 'false';

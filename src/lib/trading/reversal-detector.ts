/**
 * Reversal Detection Engine
 *
 * Multi-timeframe confluence detector that combines candlestick patterns
 * with technical indicators to identify reversals BEFORE they complete.
 *
 * PHILOSOPHY: "Trade the reversal, not the chase"
 * - Detect exhaustion early (direction running out of fuel)
 * - Confirm with multi-TF pattern confluence
 * - Score reversal probability to inform entry/exit decisions
 *
 * DETECTION HIERARCHY (earliest to latest):
 * 1. Exhaustion   – momentum fading, shrinking bodies, volume decline
 * 2. Indecision   – doji sequences, spinning tops, conflicting signals
 * 3. Initiation   – first reversal pattern appears (e.g. engulfing)
 * 4. Confirmation  – multi-TF confluence, 3-candle patterns complete
 *
 * TIMING PRINCIPLE:
 * - 5m is the leading indicator (first to show exhaustion)
 * - 15m is the confirmation timeframe (higher reliability)
 * - When 5m shows exhaustion AND 15m shows indecision → early warning
 * - When both show reversal patterns → high-confidence signal
 */

import type { OHLCData, Indicators } from '@/lib/kraken/types';
import type { ExtendedCandlestickPattern, ExhaustionSignal } from './candlestick-patterns';
import { detectAllCandlestickPatterns, scoreReversalSignal, detectExhaustionPattern } from './candlestick-patterns';

// ============================================================================
// TYPES
// ============================================================================

/** Phase of reversal development — earlier = more opportunity, less certainty */
export type ReversalPhase = 'exhaustion' | 'indecision' | 'initiation' | 'confirmation';

/** How urgently should we act on this signal */
export type ReversalUrgency = 'immediate' | 'developing' | 'early_warning';

/** Full reversal signal output */
export interface ReversalSignal {
  /** Whether a meaningful reversal signal was detected */
  detected: boolean;
  /** Phase of the reversal */
  phase: ReversalPhase;
  /** Direction OF the reversal (the NEW direction, not the current one) */
  direction: 'bullish' | 'bearish';
  /** Overall confidence 0-100 */
  confidence: number;
  /** What each timeframe is showing */
  timeframeConfluence: {
    [key: string]: TimeframeReversalDetail | null;
  };
  /** All patterns detected across timeframes */
  patterns: ExtendedCandlestickPattern[];
  /** How spent is the current direction (0-100, higher = more exhausted) */
  exhaustionScore: number;
  /** How urgently should we act */
  urgency: ReversalUrgency;
  /** Human-readable description */
  description: string;
  /** Individual scoring breakdown */
  scoreBreakdown: ReversalScoreComponent[];
}

/** Detail for what a specific timeframe is showing */
interface TimeframeReversalDetail {
  patterns: ExtendedCandlestickPattern[];
  exhaustion: ExhaustionSignal | null;
  /** Dominant signal on this TF */
  signal: string;
}

/** Individual score component for transparency */
interface ReversalScoreComponent {
  name: string;
  points: number;
  maxPoints: number;
  detail: string;
}

/** Parameters for reversal detection — timeframe-agnostic */
export interface ReversalDetectorParams {
  /** OHLC data keyed by timeframe label (e.g. '5m', '15m', '1h') */
  ohlcByTimeframe: Record<string, OHLCData[]>;
  /** Indicators keyed by timeframe label */
  indicatorsByTimeframe: Record<string, Indicators>;
  /** Current position direction (null if no position) */
  currentDirection: 'long' | 'short' | null;
  /** Optional: timeframe priority for weighting (first = highest priority for confirmation) */
  timeframePriority?: string[];
}

/** No reversal detected — default state */
export const NO_REVERSAL: ReversalSignal = {
  detected: false,
  phase: 'exhaustion',
  direction: 'bullish',
  confidence: 0,
  timeframeConfluence: {},
  patterns: [],
  exhaustionScore: 0,
  urgency: 'early_warning',
  description: 'No reversal signals detected',
  scoreBreakdown: [],
};

// ============================================================================
// MAIN DETECTION FUNCTION
// ============================================================================

/**
 * Detect reversal signals across multiple timeframes.
 *
 * This is timeframe-agnostic: pass any combination of timeframes via
 * ohlcByTimeframe and indicatorsByTimeframe. The function will analyze
 * each and combine them with confluence weighting.
 *
 * For the default strategy, call with:
 *   ohlcByTimeframe: { '5': ohlc5m, '15': ohlc15m }
 *   indicatorsByTimeframe: { '5': ind5m, '15': ind15m }
 *
 * @param params - Timeframe data, indicators, and current position direction
 * @returns ReversalSignal with confidence scoring and phase detection
 */
export function detectReversal(params: ReversalDetectorParams): ReversalSignal {
  const { ohlcByTimeframe, indicatorsByTimeframe, currentDirection, timeframePriority } = params;

  const tfLabels = timeframePriority ?? Object.keys(ohlcByTimeframe);
  if (tfLabels.length === 0) return NO_REVERSAL;

  // Determine the reversal direction we're looking for
  // If we have a position, reversal = opposite direction
  // If no position, detect whichever direction has stronger signal
  const reversalDir = currentDirection === 'long' ? 'bearish'
    : currentDirection === 'short' ? 'bullish'
    : null; // Will detect both and pick stronger

  const allPatterns: ExtendedCandlestickPattern[] = [];
  const tfDetails: Record<string, TimeframeReversalDetail | null> = {};
  const scoreComponents: ReversalScoreComponent[] = [];
  let totalScore = 0;
  let maxPossibleScore = 0;

  // Weight multipliers based on position in priority list
  // First TF in priority = lighter weight (leading, less reliable)
  // Last TF = heavier weight (confirming, more reliable)
  const tfWeights = buildTimeframeWeights(tfLabels);

  // ========================================================================
  // 1. CANDLESTICK PATTERN ANALYSIS (per timeframe)
  // ========================================================================
  for (const tf of tfLabels) {
    const ohlc = ohlcByTimeframe[tf];
    const ind = indicatorsByTimeframe[tf];
    if (!ohlc || ohlc.length < 5) {
      tfDetails[tf] = null;
      continue;
    }

    // Detect all patterns on this TF
    const tfPatterns = detectAllCandlestickPatterns(ohlc, parseFloat(tf) || 0);
    const exhaustion = detectExhaustionPattern(ohlc);

    // Volatility filter: In low-volatility (tight BB, low ATR) conditions,
    // single-candle indecision patterns (doji, spinning top) are unreliable.
    // Reduce their reliability to prevent false reversal signals in ranging markets.
    if (ind) {
      const lastPrice = ohlc[ohlc.length - 1].close;
      const atrPct = lastPrice > 0 ? (ind.atr / lastPrice) * 100 : 0;
      const bbWidth = (ind.bbUpper && ind.bbLower && lastPrice > 0)
        ? ((ind.bbUpper - ind.bbLower) / lastPrice) * 100
        : null;
      // Low volatility: ATR < 0.3% of price OR BB width < 0.5% of price
      const isLowVol = atrPct < 0.3 || (bbWidth !== null && bbWidth < 0.5);
      if (isLowVol) {
        for (const p of tfPatterns) {
          if (p.candlesUsed === 1 && p.type === 'indecision') {
            p.reliability *= 0.4; // Drastically reduce single-candle indecision
            p.strength *= 0.5;
          } else if (p.candlesUsed === 1) {
            p.reliability *= 0.6; // Moderate reduction for other single-candle patterns
          }
        }
      }
    }

    // Filter patterns for the reversal direction (or both if no position)
    const relevantPatterns = reversalDir
      ? tfPatterns.filter(p =>
          p.type === `reversal_${reversalDir}` || p.type === 'indecision'
        )
      : tfPatterns.filter(p =>
          p.type.startsWith('reversal_') || p.type === 'indecision'
        );

    allPatterns.push(...tfPatterns);

    // Determine dominant signal for this TF
    let signal = 'neutral';
    if (relevantPatterns.length > 0) {
      const bestPattern = relevantPatterns.reduce((best, p) =>
        p.reliability * p.strength > best.reliability * best.strength ? p : best
      );
      signal = bestPattern.name;
    } else if (exhaustion?.detected) {
      signal = exhaustion.direction;
    }

    tfDetails[tf] = {
      patterns: tfPatterns,
      exhaustion,
      signal,
    };

    // Score reversal patterns by candle count and TF weight
    const weight = tfWeights[tf] || 1;

    // 3-candle reversal patterns (highest reliability)
    const threeCandle = relevantPatterns.filter(p => p.candlesUsed === 3 && p.type.startsWith('reversal_'));
    if (threeCandle.length > 0) {
      const best = threeCandle.reduce((a, b) => a.reliability > b.reliability ? a : b);
      const points = 30 * weight * best.reliability;
      totalScore += points;
      scoreComponents.push({
        name: `3-candle ${tf}`,
        points: Math.round(points),
        maxPoints: Math.round(30 * weight),
        detail: `${best.name} (rel: ${(best.reliability * 100).toFixed(0)}%)`,
      });
    }
    maxPossibleScore += 30 * weight;

    // 2-candle reversal patterns
    const twoCandle = relevantPatterns.filter(p => p.candlesUsed === 2 && p.type.startsWith('reversal_'));
    if (twoCandle.length > 0) {
      const best = twoCandle.reduce((a, b) => a.reliability > b.reliability ? a : b);
      const points = 20 * weight * best.reliability;
      totalScore += points;
      scoreComponents.push({
        name: `2-candle ${tf}`,
        points: Math.round(points),
        maxPoints: Math.round(20 * weight),
        detail: `${best.name} (rel: ${(best.reliability * 100).toFixed(0)}%)`,
      });
    }
    maxPossibleScore += 20 * weight;

    // Single-candle patterns (lower weight)
    const oneCandle = relevantPatterns.filter(p => p.candlesUsed === 1 && p.type.startsWith('reversal_'));
    if (oneCandle.length > 0) {
      const best = oneCandle.reduce((a, b) => a.reliability > b.reliability ? a : b);
      const points = 10 * weight * best.reliability;
      totalScore += points;
      scoreComponents.push({
        name: `1-candle ${tf}`,
        points: Math.round(points),
        maxPoints: Math.round(10 * weight),
        detail: `${best.name} (rel: ${(best.reliability * 100).toFixed(0)}%)`,
      });
    }
    maxPossibleScore += 10 * weight;
  }

  // ========================================================================
  // 2. CONFLUENCE BONUS — patterns on multiple TFs
  // ========================================================================
  const tfsWithReversalPatterns = tfLabels.filter(tf => {
    const detail = tfDetails[tf];
    return detail && detail.patterns.some(p => p.type.startsWith('reversal_'));
  });

  if (tfsWithReversalPatterns.length >= 2) {
    const confluenceBonus = 15;
    totalScore += confluenceBonus;
    maxPossibleScore += confluenceBonus;
    scoreComponents.push({
      name: 'Multi-TF confluence',
      points: confluenceBonus,
      maxPoints: confluenceBonus,
      detail: `Reversal patterns on ${tfsWithReversalPatterns.join(', ')}`,
    });
  } else {
    maxPossibleScore += 15;
  }

  // ========================================================================
  // 3. RSI DIVERGENCE
  // ========================================================================
  const rsiDivPoints = 15;
  maxPossibleScore += rsiDivPoints;

  // Check for divergence on each TF
  let rsiDivDetected = false;
  for (const tf of tfLabels) {
    const ohlc = ohlcByTimeframe[tf];
    const ind = indicatorsByTimeframe[tf];
    if (!ohlc || ohlc.length < 10 || !ind) continue;

    const div = detectRSIDivergence(ohlc, ind.rsi, reversalDir);
    if (div) {
      totalScore += rsiDivPoints;
      rsiDivDetected = true;
      scoreComponents.push({
        name: `RSI divergence (${tf})`,
        points: rsiDivPoints,
        maxPoints: rsiDivPoints,
        detail: div,
      });
      break; // Count once
    }
  }

  // ========================================================================
  // 4. VOLUME CONFIRMATION
  // ========================================================================
  const volPoints = 10;
  maxPossibleScore += volPoints;

  // Look for volume spike on the most recent reversal candle
  for (const tf of [...tfLabels].reverse()) {
    const ohlc = ohlcByTimeframe[tf];
    if (!ohlc || ohlc.length < 10) continue;

    const volSpike = detectVolumeSpike(ohlc);
    if (volSpike) {
      totalScore += volPoints;
      scoreComponents.push({
        name: `Volume spike (${tf})`,
        points: volPoints,
        maxPoints: volPoints,
        detail: volSpike,
      });
      break;
    }
  }

  // ========================================================================
  // 5. MACD HISTOGRAM CROSSOVER
  // ========================================================================
  const macdPoints = 10;
  maxPossibleScore += macdPoints;

  for (const tf of [...tfLabels].reverse()) {
    const ind = indicatorsByTimeframe[tf];
    if (!ind || ind.histogram === undefined) continue;

    const macdCross = detectMACDCrossover(ind, reversalDir);
    if (macdCross) {
      totalScore += macdPoints;
      scoreComponents.push({
        name: `MACD cross (${tf})`,
        points: macdPoints,
        maxPoints: macdPoints,
        detail: macdCross,
      });
      break;
    }
  }

  // ========================================================================
  // 6. EXHAUSTION PATTERN SEQUENCE
  // ========================================================================
  const exhaustionPoints = 10;
  maxPossibleScore += exhaustionPoints;

  let maxExhaustionScore = 0;
  for (const tf of tfLabels) {
    const detail = tfDetails[tf];
    if (detail?.exhaustion?.detected) {
      maxExhaustionScore = Math.max(maxExhaustionScore, detail.exhaustion.score);
    }
  }

  if (maxExhaustionScore > 30) {
    const earnedPoints = (maxExhaustionScore / 100) * exhaustionPoints;
    totalScore += earnedPoints;
    scoreComponents.push({
      name: 'Exhaustion sequence',
      points: Math.round(earnedPoints),
      maxPoints: exhaustionPoints,
      detail: `Exhaustion score: ${maxExhaustionScore}`,
    });
  }

  // ========================================================================
  // 7. CONTINUATION PATTERN PENALTY
  // ========================================================================
  const continuationPenalty = 20;

  // If continuation patterns in the CURRENT direction are present, subtract
  const currentContinuationType = currentDirection === 'long' ? 'continuation_bullish'
    : currentDirection === 'short' ? 'continuation_bearish'
    : null;

  if (currentContinuationType) {
    const continuationPatterns = allPatterns.filter(p => p.type === currentContinuationType);
    if (continuationPatterns.length > 0) {
      const strongestContinuation = continuationPatterns.reduce((a, b) =>
        a.reliability > b.reliability ? a : b
      );
      const penalty = continuationPenalty * strongestContinuation.reliability;
      totalScore -= penalty;
      scoreComponents.push({
        name: 'Continuation penalty',
        points: -Math.round(penalty),
        maxPoints: 0,
        detail: `${strongestContinuation.name} opposes reversal`,
      });
    }
  }

  // ========================================================================
  // 8. SINGLE-TF-ONLY PENALTY — patterns on only one TF are unreliable
  // ========================================================================
  if (tfsWithReversalPatterns.length === 1) {
    // Only 1-candle patterns on a single TF? Very weak signal. Apply penalty.
    const singleTfPatterns = tfDetails[tfsWithReversalPatterns[0]]?.patterns ?? [];
    const hasMultiCandle = singleTfPatterns.some(p =>
      p.candlesUsed >= 2 && p.type.startsWith('reversal_')
    );
    if (!hasMultiCandle) {
      // Only single-candle reversal patterns on one TF — high false positive risk
      const singleTfPenalty = 10;
      totalScore -= singleTfPenalty;
      scoreComponents.push({
        name: 'Single-TF single-candle penalty',
        points: -singleTfPenalty,
        maxPoints: 0,
        detail: 'Only 1-candle patterns on one TF — low reliability',
      });
    }
  }

  // ========================================================================
  // 9. RANGING MARKET PENALTY — low ATR makes patterns unreliable
  // ========================================================================
  // Check if indicators show a ranging/low-volatility environment.
  // When BB is narrow (bbPos close to 0.5) on the confirming TF, penalize.
  const confirmingTf = tfLabels[tfLabels.length - 1]; // Last = confirming TF
  const confirmingInd = indicatorsByTimeframe[confirmingTf];
  if (confirmingInd) {
    const bbPos = confirmingInd.bbPos;
    const isRanging = bbPos > 0.3 && bbPos < 0.7; // Price near middle of BB = no trend
    const atr = confirmingInd.atr;
    const confirmingOhlc = ohlcByTimeframe[confirmingTf];
    const currentPrice = confirmingOhlc?.[confirmingOhlc.length - 1]?.close ?? 0;
    // Low ATR relative to price = low volatility (< 0.5% of price for crypto is quiet)
    const isLowVol = currentPrice > 0 && atr > 0 && (atr / currentPrice) < 0.005;

    if (isRanging && isLowVol) {
      const rangingPenalty = 8;
      totalScore -= rangingPenalty;
      scoreComponents.push({
        name: 'Ranging market penalty',
        points: -rangingPenalty,
        maxPoints: 0,
        detail: `Low volatility + ranging (BB: ${(bbPos * 100).toFixed(0)}%, ATR: ${(atr / currentPrice * 100).toFixed(2)}%)`,
      });
    }
  }

  // ========================================================================
  // SCORING & PHASE DETERMINATION
  // ========================================================================

  // Normalize confidence to 0-100
  const confidence = Math.max(0, Math.min(100, Math.round(
    maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0
  )));

  // Determine reversal direction from patterns
  let detectedDirection: 'bullish' | 'bearish' = reversalDir || 'bullish';
  if (!reversalDir) {
    // No position — pick direction with stronger reversal patterns
    const bullishScore = scoreReversalSignal(allPatterns, 'bullish');
    const bearishScore = scoreReversalSignal(allPatterns, 'bearish');
    detectedDirection = bullishScore.score >= bearishScore.score ? 'bullish' : 'bearish';
  }

  // Determine phase
  const phase = determineReversalPhase(
    allPatterns, tfDetails, maxExhaustionScore, confidence, tfsWithReversalPatterns.length
  );

  // Determine urgency
  const urgency = determineUrgency(phase, confidence);

  // Build description
  const description = buildDescription(
    phase, detectedDirection, confidence, tfsWithReversalPatterns,
    allPatterns, maxExhaustionScore, rsiDivDetected
  );

  // Only flag as "detected" if confidence crosses minimum threshold
  const detected = confidence >= 25;

  return {
    detected,
    phase,
    direction: detectedDirection,
    confidence,
    timeframeConfluence: tfDetails,
    patterns: allPatterns,
    exhaustionScore: maxExhaustionScore,
    urgency,
    description,
    scoreBreakdown: scoreComponents,
  };
}

// ============================================================================
// CONVENIENCE WRAPPER — for the common 5m+15m setup
// ============================================================================

/**
 * Simplified call for the default strategy's 5m+15m reversal detection.
 */
export function detectReversal5m15m(
  ohlc5m: OHLCData[],
  ohlc15m: OHLCData[],
  ind5m: Indicators,
  ind15m: Indicators,
  currentDirection: 'long' | 'short' | null
): ReversalSignal {
  return detectReversal({
    ohlcByTimeframe: { '5': ohlc5m, '15': ohlc15m },
    indicatorsByTimeframe: { '5': ind5m, '15': ind15m },
    currentDirection,
    timeframePriority: ['5', '15'], // 5m leads, 15m confirms
  });
}

// ============================================================================
// HELPER: TIMEFRAME WEIGHTS
// ============================================================================

/**
 * Build weight multipliers for TFs. Last TF in priority gets highest weight
 * (confirmation TF), first gets lowest (leading indicator, less reliable).
 */
function buildTimeframeWeights(tfLabels: string[]): Record<string, number> {
  const weights: Record<string, number> = {};
  const count = tfLabels.length;
  if (count === 0) return weights;
  if (count === 1) {
    weights[tfLabels[0]] = 1;
    return weights;
  }
  // Linear scale from 0.6 (leading) to 1.4 (confirming)
  for (let i = 0; i < count; i++) {
    weights[tfLabels[i]] = 0.6 + (0.8 * i) / (count - 1);
  }
  return weights;
}

// ============================================================================
// HELPER: RSI DIVERGENCE DETECTION
// ============================================================================

/**
 * Detect RSI divergence: price makes new high/low but RSI doesn't confirm.
 * This is a classic early reversal signal.
 */
function detectRSIDivergence(
  ohlc: OHLCData[],
  currentRSI: number,
  reversalDir: 'bullish' | 'bearish' | null
): string | null {
  if (ohlc.length < 10) return null;

  const recent = ohlc.slice(-10);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  // Bearish divergence: price making higher highs but RSI failing to confirm
  // RSI must have been elevated (>60) and now declining — not just "below 60"
  if (reversalDir === 'bearish' || reversalDir === null) {
    const recentHigh = Math.max(...highs.slice(-3));
    const priorHigh = Math.max(...highs.slice(0, 5));
    // Price must make a meaningfully higher high (>0.1% above prior)
    const higherHighMargin = priorHigh * 0.001;
    if (recentHigh > priorHigh + higherHighMargin && currentRSI < 60 && currentRSI > 30) {
      // Classic bearish divergence: new price high but RSI well below overbought
      return `Bearish divergence: price at ${recentHigh.toFixed(4)} (new high) but RSI only ${currentRSI.toFixed(0)}`;
    }
  }

  // Bullish divergence: price making lower lows but RSI failing to confirm
  if (reversalDir === 'bullish' || reversalDir === null) {
    const recentLow = Math.min(...lows.slice(-3));
    const priorLow = Math.min(...lows.slice(0, 5));
    // Price must make a meaningfully lower low (>0.1% below prior)
    const lowerLowMargin = priorLow * 0.001;
    if (recentLow < priorLow - lowerLowMargin && currentRSI > 40 && currentRSI < 70) {
      // Classic bullish divergence: new price low but RSI well above oversold
      return `Bullish divergence: price at ${recentLow.toFixed(4)} (new low) but RSI at ${currentRSI.toFixed(0)}`;
    }
  }

  // Removed: "price flat but RSI declining/rising" checks.
  // These fired too easily in ranging/consolidating markets (RSI 45-65 with 0.5% price
  // tolerance covers most sideways action). The classic divergence above is sufficient.

  return null;
}

// ============================================================================
// HELPER: VOLUME SPIKE DETECTION
// ============================================================================

/**
 * Detect volume spike on the most recent candle — a spike on a reversal candle
 * significantly increases reliability.
 */
function detectVolumeSpike(ohlc: OHLCData[]): string | null {
  if (ohlc.length < 10) return null;

  const volumes = ohlc.slice(-10).map(c => c.volume);
  const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
  const lastVol = volumes[volumes.length - 1];

  if (avgVol <= 0) return null;

  const ratio = lastVol / avgVol;
  if (ratio >= 1.5) {
    return `Volume spike: ${ratio.toFixed(1)}x average (${lastVol.toFixed(0)} vs avg ${avgVol.toFixed(0)})`;
  }

  return null;
}

// ============================================================================
// HELPER: MACD CROSSOVER
// ============================================================================

/**
 * Detect MACD histogram crossing zero line — confirms momentum shift.
 */
function detectMACDCrossover(
  ind: Indicators,
  reversalDir: 'bullish' | 'bearish' | null
): string | null {
  const histogram = ind.histogram;
  if (histogram === undefined) return null;

  // Dead zone threshold (from existing engine)
  const deadZone = 0.00005;

  if (reversalDir === 'bearish' || reversalDir === null) {
    // Histogram turning negative = bearish reversal confirmation
    if (histogram < -deadZone && histogram > -0.001) {
      return `MACD histogram crossed bearish (${histogram.toFixed(6)})`;
    }
  }

  if (reversalDir === 'bullish' || reversalDir === null) {
    // Histogram turning positive = bullish reversal confirmation
    if (histogram > deadZone && histogram < 0.001) {
      return `MACD histogram crossed bullish (${histogram.toFixed(6)})`;
    }
  }

  return null;
}

// ============================================================================
// HELPER: PHASE DETERMINATION
// ============================================================================

/**
 * Determine the phase of reversal development.
 * Earlier phases = more opportunity but less certainty.
 */
function determineReversalPhase(
  patterns: ExtendedCandlestickPattern[],
  tfDetails: Record<string, TimeframeReversalDetail | null>,
  exhaustionScore: number,
  confidence: number,
  confluenceTFs: number
): ReversalPhase {
  const hasThreeCandle = patterns.some(p => p.candlesUsed === 3 && p.type.startsWith('reversal_'));
  const hasTwoCandle = patterns.some(p => p.candlesUsed === 2 && p.type.startsWith('reversal_'));
  const hasIndecision = patterns.some(p => p.type === 'indecision');

  // Confirmation: 3-candle pattern OR multi-TF 2-candle + high confidence
  if (hasThreeCandle && confluenceTFs >= 2) return 'confirmation';
  if (hasThreeCandle && confidence >= 60) return 'confirmation';
  if (hasTwoCandle && confluenceTFs >= 2 && confidence >= 50) return 'confirmation';

  // Initiation: 2-candle reversal pattern present
  if (hasTwoCandle) return 'initiation';

  // Indecision: doji/spinning tops but no clear reversal yet
  if (hasIndecision && exhaustionScore > 30) return 'indecision';

  // Exhaustion: only momentum fading signals
  return 'exhaustion';
}

// ============================================================================
// HELPER: URGENCY DETERMINATION
// ============================================================================

function determineUrgency(phase: ReversalPhase, confidence: number): ReversalUrgency {
  if (phase === 'confirmation' && confidence >= 70) return 'immediate';
  if (phase === 'initiation' && confidence >= 50) return 'developing';
  if (phase === 'confirmation' && confidence >= 50) return 'developing';
  return 'early_warning';
}

// ============================================================================
// HELPER: DESCRIPTION BUILDER
// ============================================================================

function buildDescription(
  phase: ReversalPhase,
  direction: 'bullish' | 'bearish',
  confidence: number,
  confluenceTFs: string[],
  patterns: ExtendedCandlestickPattern[],
  exhaustionScore: number,
  rsiDivergence: boolean
): string {
  const dirLabel = direction === 'bullish' ? 'Bullish' : 'Bearish';
  const phaseLabel = {
    exhaustion: 'Exhaustion detected',
    indecision: 'Indecision forming',
    initiation: 'Reversal initiating',
    confirmation: 'Reversal confirmed',
  }[phase];

  const parts: string[] = [`${dirLabel} ${phaseLabel.toLowerCase()} (${confidence}%)`];

  // Key patterns
  const reversalPatterns = patterns
    .filter(p => p.type.startsWith('reversal_'))
    .sort((a, b) => b.reliability * b.strength - a.reliability * a.strength)
    .slice(0, 2);

  if (reversalPatterns.length > 0) {
    parts.push(`Patterns: ${reversalPatterns.map(p => p.name.replace(/_/g, ' ')).join(', ')}`);
  }

  if (confluenceTFs.length >= 2) {
    parts.push(`Confluence on ${confluenceTFs.join('+')}`);
  }

  if (exhaustionScore > 50) {
    parts.push(`Exhaustion: ${exhaustionScore}%`);
  }

  if (rsiDivergence) {
    parts.push('RSI divergence');
  }

  return parts.join(' | ');
}

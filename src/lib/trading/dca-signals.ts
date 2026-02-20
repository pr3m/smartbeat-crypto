/**
 * DCA Signal Engine v2
 *
 * Detects WHEN to DCA based on momentum exhaustion, not fixed price levels.
 *
 * Trader's philosophy:
 * "When price goes in opposite direction, wait for the momentum to dry out,
 *  and DCA to buy/sell more to improve Average Buy/Sell price"
 *
 * Detection logic:
 * - For LONG underwater: look for selling exhaustion (RSI oversold, volume
 *   declining, MACD contracting, ATR calming, price stabilizing)
 * - For SHORT underwater: look for buying exhaustion (RSI overbought,
 *   volume declining, MACD contracting, ATR calming, price topping)
 *
 * Requires 3+ of 5 signals for DCA trigger.
 * Minimum time spacing between entries enforced.
 *
 * ALL thresholds come from TradingStrategy.dca.exhaustionThresholds.
 */

import type { Indicators, OHLCData } from '@/lib/kraken/types';
import type {
  PositionState,
  DCASignal,
  DCAExhaustionSignal,
  MomentumExhaustionType,
  DCAConfig,
  DCAExhaustionThresholds,
  TradingStrategy,
  PositionSizingConfig,
  UnderwaterPolicy,
} from './v2-types';
import { NO_DCA_SIGNAL, DEFAULT_DCA_CONFIG, DEFAULT_POSITION_SIZING } from './v2-types';

// ============================================================================
// MAIN DCA ANALYSIS
// ============================================================================

/**
 * Analyze whether a DCA opportunity exists based on momentum exhaustion.
 *
 * @param position - Current position state
 * @param ind15m - 15-minute indicators (primary)
 * @param ind1h - 1-hour indicators (confirmation)
 * @param ind5m - 5-minute indicators (micro structure)
 * @param ohlc5m - 5-minute OHLC data (for HL/LH pattern detection)
 * @param currentPrice - Current market price
 * @param config - DCA configuration (from strategy.dca)
 * @returns DCA signal with exhaustion analysis
 */
export function analyzeDCAOpportunity(
  position: PositionState,
  ind15m: Indicators | null,
  ind1h: Indicators | null,
  ind5m: Indicators | null,
  ohlc5m: OHLCData[],
  currentPrice: number,
  config: DCAConfig = DEFAULT_DCA_CONFIG,
  positionSizingConfig: PositionSizingConfig = DEFAULT_POSITION_SIZING,
  underwaterPolicy?: UnderwaterPolicy | null
): DCASignal {
  // No position or position not open - no DCA
  if (!position.isOpen || position.phase === 'closed' || position.phase === 'idle') {
    return NO_DCA_SIGNAL;
  }

  const maxDCA = positionSizingConfig.maxDCACount;

  // Already at max DCAs
  if (position.dcaCount >= maxDCA) {
    return {
      ...NO_DCA_SIGNAL,
      reason: `Max ${maxDCA} DCAs reached`,
      warnings: ['No more DCA capacity'],
    };
  }

  // No indicator data - can't analyze
  if (!ind15m || !ind1h || !ind5m) {
    return NO_DCA_SIGNAL;
  }

  const nextDCALevel = position.dcaCount + 1;
  const thresholds = config.exhaustionThresholds;

  // Recovery mode: overdue + underwater + policy active
  const isOverdue = position.timeboxProgress >= 1.0;
  const isRecoveryMode = underwaterPolicy?.enabled === true && position.unrealizedPnL < 0;

  // Check time spacing from strategy config (reduced in recovery mode)
  const lastEntryTime = position.entries.length > 0
    ? position.entries[position.entries.length - 1].timestamp
    : position.openedAt;
  const timeSinceLastEntry = Date.now() - lastEntryTime;
  let minHours = thresholds.minHoursBetweenByLevel[nextDCALevel] || 1;
  if (isRecoveryMode && isOverdue && underwaterPolicy.overdueDCA.timeSpacingMultiplier > 0) {
    minHours = minHours * underwaterPolicy.overdueDCA.timeSpacingMultiplier;
  }
  const minTimeMs = minHours * 60 * 60 * 1000;

  if (timeSinceLastEntry < minTimeMs) {
    const hoursRemaining = ((minTimeMs - timeSinceLastEntry) / (1000 * 60 * 60)).toFixed(1);
    return {
      ...NO_DCA_SIGNAL,
      reason: `Too soon for DCA${nextDCALevel}. Wait ${hoursRemaining}h`,
      dcaLevel: nextDCALevel,
    };
  }

  // After timebox midpoint (24h): allow DCA only with higher confidence threshold
  // In recovery mode + overdue: LOWER the bar instead using overdueDCA.confidenceAdjustment
  const isPostMidpoint = position.timeboxProgress > 0.5;
  let effectiveMinConfidence: number;
  if (isRecoveryMode && isOverdue) {
    effectiveMinConfidence = Math.max(0, config.minExhaustionConfidence + (underwaterPolicy.overdueDCA.confidenceAdjustment));
  } else if (isPostMidpoint) {
    effectiveMinConfidence = Math.max(config.minExhaustionConfidence, 75); // Require 75%+ confidence after 24h
  } else {
    effectiveMinConfidence = config.minExhaustionConfidence;
  }

  if (!config.allowDCAAfterMidpoint && isPostMidpoint) {
    return {
      ...NO_DCA_SIGNAL,
      reason: 'Past timebox midpoint - no more DCAs',
      dcaLevel: nextDCALevel,
      warnings: ['Position past 24h - focus on exit strategy'],
    };
  }

  // Calculate drawdown from entry
  const drawdownPercent = position.direction === 'long'
    ? ((position.avgPrice - currentPrice) / position.avgPrice) * 100
    : ((currentPrice - position.avgPrice) / position.avgPrice) * 100;

  // Only consider DCA when underwater with minimum drawdown
  // In recovery mode: lower the drawdown threshold
  const effectiveMinDrawdown = isRecoveryMode && isOverdue
    ? Math.max(0, config.minDrawdownForDCA + underwaterPolicy.overdueDCA.minDrawdownAdjustment)
    : config.minDrawdownForDCA;
  if (drawdownPercent < effectiveMinDrawdown) {
    return {
      ...NO_DCA_SIGNAL,
      reason: drawdownPercent > 0
        ? `Drawdown ${drawdownPercent.toFixed(1)}% below minimum ${effectiveMinDrawdown.toFixed(1)}%`
        : 'Position in profit - no DCA needed',
      dcaLevel: nextDCALevel,
      drawdownPercent: Math.max(0, drawdownPercent),
    };
  }

  // Run all exhaustion signal detectors (passing thresholds)
  const signals = detectExhaustionSignals(
    position.direction,
    ind15m,
    ind1h,
    ind5m,
    ohlc5m,
    thresholds
  );

  const activeSignals = signals.filter(s => s.active);
  const signalCount = activeSignals.length;
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const activeWeight = activeSignals.reduce((sum, s) => sum + s.weight, 0);
  const confidence = totalWeight > 0
    ? Math.round((activeWeight / totalWeight) * 100)
    : 0;

  // Determine primary exhaustion type
  const exhaustionType = determineExhaustionType(activeSignals);

  // DCA sizing: DCA3 is LARGER (deepest exhaustion = strongest conviction)
  const baseDCAMarginPercent = positionSizingConfig.dcaMarginPercent;
  const levelMultiplier = nextDCALevel === 1 ? 1.0 : nextDCALevel === 2 ? 1.0 : config.dcaSizeScaleFactor > 1.0 ? config.dcaSizeScaleFactor : 1.3;
  const suggestedMarginPercent = baseDCAMarginPercent * levelMultiplier;

  // Build warnings
  const warnings: string[] = [];
  if (drawdownPercent > 5) {
    if (isRecoveryMode && underwaterPolicy.alertMessages.dcaEncourage) {
      warnings.push(underwaterPolicy.alertMessages.dcaEncourage);
    } else {
      warnings.push(`Large drawdown: ${drawdownPercent.toFixed(1)}%`);
    }
  }
  if (position.hoursRemaining < 12 && !isRecoveryMode) {
    warnings.push(`Only ${position.hoursRemaining.toFixed(0)}h left in timebox`);
  } else if (isRecoveryMode && isOverdue && underwaterPolicy.alertMessages.overdueUnderwater) {
    warnings.push(underwaterPolicy.alertMessages.overdueUnderwater);
  }
  if (nextDCALevel === maxDCA) {
    warnings.push('Final DCA - no more capacity after this');
  }

  // Require 3+ signals and minimum confidence (higher bar after midpoint)
  const shouldDCA = signalCount >= 3 && confidence >= effectiveMinConfidence;

  // Build reason string
  const reason = shouldDCA
    ? `DCA${nextDCALevel}: ${signalCount}/5 exhaustion signals (${confidence}%). ${exhaustionType.replace(/_/g, ' ')}. Drawdown: ${drawdownPercent.toFixed(1)}%`
    : signalCount >= 2
    ? `DCA forming: ${signalCount}/5 signals. Need 3+ for trigger.`
    : `Momentum still active against position (${signalCount}/5 signals)`;

  return {
    shouldDCA,
    confidence,
    dcaLevel: nextDCALevel,
    exhaustionType,
    drawdownPercent,
    signals,
    reason,
    suggestedMarginPercent,
    warnings,
  };
}

// ============================================================================
// EXHAUSTION SIGNAL DETECTION
// ============================================================================

/**
 * Detect all 5 momentum exhaustion signals.
 * All thresholds come from the strategy config.
 */
function detectExhaustionSignals(
  direction: 'long' | 'short',
  ind15m: Indicators,
  ind1h: Indicators,
  ind5m: Indicators,
  ohlc5m: OHLCData[],
  thresholds: DCAExhaustionThresholds
): DCAExhaustionSignal[] {
  const signals: DCAExhaustionSignal[] = [];

  // 1. RSI Exhaustion
  signals.push(detectRSIExhaustion(direction, ind15m, thresholds));

  // 2. Volume Declining
  signals.push(detectVolumeDeclining(direction, ind15m, ind5m, thresholds));

  // 3. MACD Contracting
  signals.push(detectMACDContracting(direction, ind15m, ind1h, thresholds));

  // 4. ATR Contracting
  signals.push(detectATRContracting(ind15m, thresholds));

  // 5. Price Stabilizing (higher lows for long, lower highs for short)
  signals.push(detectPriceStabilizing(direction, ohlc5m, thresholds));

  return signals;
}

/**
 * Signal 1: RSI showing exhaustion of the counter-trend move.
 *
 * For LONG underwater: RSI < rsiOversold on 15m means sellers are exhausted
 * For SHORT underwater: RSI > rsiOverbought on 15m means buyers are exhausted
 */
function detectRSIExhaustion(
  direction: 'long' | 'short',
  ind15m: Indicators,
  thresholds: DCAExhaustionThresholds
): DCAExhaustionSignal {
  if (direction === 'long') {
    const isExhausted = ind15m.rsi < thresholds.rsiOversold;
    return {
      name: 'RSI Exhaustion',
      active: isExhausted,
      value: `RSI ${ind15m.rsi.toFixed(0)}${isExhausted ? ' (sellers exhausted)' : ''}`,
      weight: 0.25,
      timeframe: '15m',
    };
  } else {
    const isExhausted = ind15m.rsi > thresholds.rsiOverbought;
    return {
      name: 'RSI Exhaustion',
      active: isExhausted,
      value: `RSI ${ind15m.rsi.toFixed(0)}${isExhausted ? ' (buyers exhausted)' : ''}`,
      weight: 0.25,
      timeframe: '15m',
    };
  }
}

/**
 * Signal 2: Volume declining after the move against position.
 *
 * Selling/buying pressure is fading when recent volume is declining.
 */
function detectVolumeDeclining(
  direction: 'long' | 'short',
  ind15m: Indicators,
  ind5m: Indicators,
  thresholds: DCAExhaustionThresholds
): DCAExhaustionSignal {
  const isDecling = ind5m.volRatio < thresholds.volumeDecline5m && ind15m.volRatio < thresholds.volumeDecline15m;
  const isFading = ind5m.volRatio < thresholds.volumeFading5m;

  return {
    name: 'Volume Declining',
    active: isDecling,
    value: `5m: ${ind5m.volRatio.toFixed(2)}x, 15m: ${ind15m.volRatio.toFixed(2)}x${isFading ? ' (pressure fading)' : ''}`,
    weight: 0.20,
    timeframe: '5m',
  };
}

/**
 * Signal 3: MACD histogram contracting toward zero.
 *
 * For LONG underwater: histogram was deeply negative, now moving toward 0
 * For SHORT underwater: histogram was deeply positive, now moving toward 0
 */
function detectMACDContracting(
  direction: 'long' | 'short',
  ind15m: Indicators,
  ind1h: Indicators,
  thresholds: DCAExhaustionThresholds
): DCAExhaustionSignal {
  const hist15m = ind15m.histogram ?? 0;

  let isContracting = false;
  let value = '';

  if (direction === 'long') {
    const hist15mContracting = hist15m < 0 && hist15m > -thresholds.macdNearZero;
    const macd15mRising = ind15m.macd < 0 && ind15m.macdSignal !== undefined && ind15m.macd > ind15m.macdSignal - thresholds.macdSignalProximity;
    isContracting = hist15mContracting || macd15mRising;
    value = `Hist: ${hist15m >= 0 ? '+' : ''}${hist15m.toFixed(5)}${isContracting ? ' (contracting)' : ''}`;
  } else {
    const hist15mContracting = hist15m > 0 && hist15m < thresholds.macdNearZero;
    const macd15mFalling = ind15m.macd > 0 && ind15m.macdSignal !== undefined && ind15m.macd < ind15m.macdSignal + thresholds.macdSignalProximity;
    isContracting = hist15mContracting || macd15mFalling;
    value = `Hist: ${hist15m >= 0 ? '+' : ''}${hist15m.toFixed(5)}${isContracting ? ' (contracting)' : ''}`;
  }

  return {
    name: 'MACD Contracting',
    active: isContracting,
    value,
    weight: 0.20,
    timeframe: '15m',
  };
}

/**
 * Signal 4: ATR contracting (volatility calming after spike).
 *
 * BB position near middle + volume calm = volatility calming.
 */
function detectATRContracting(
  ind15m: Indicators,
  thresholds: DCAExhaustionThresholds
): DCAExhaustionSignal {
  const bbNearMiddle = ind15m.bbPos >= thresholds.bbMiddleLow && ind15m.bbPos <= thresholds.bbMiddleHigh;
  const volumeCalm = ind15m.volRatio < thresholds.volumeDecline15m;
  const isCalming = bbNearMiddle && volumeCalm;

  return {
    name: 'Volatility Calming',
    active: isCalming,
    value: `BB: ${(ind15m.bbPos * 100).toFixed(0)}%, Vol: ${ind15m.volRatio.toFixed(2)}x${isCalming ? ' (calming)' : ''}`,
    weight: 0.15,
    timeframe: '15m',
  };
}

/**
 * Signal 5: Price stabilizing (higher lows for long, lower highs for short).
 *
 * Look at recent 5m candles to see if a pattern is forming:
 * - For LONG: lows should be rising (higher lows = buyers stepping in)
 * - For SHORT: highs should be falling (lower highs = sellers stepping in)
 */
function detectPriceStabilizing(
  direction: 'long' | 'short',
  ohlc5m: OHLCData[],
  thresholds: DCAExhaustionThresholds
): DCAExhaustionSignal {
  const lookback = thresholds.priceStabilizingLookback;
  const minMatches = thresholds.priceStabilizingMinMatches;

  if (ohlc5m.length < lookback) {
    return {
      name: 'Price Stabilizing',
      active: false,
      value: 'Insufficient data',
      weight: 0.20,
      timeframe: '5m',
    };
  }

  const recent = ohlc5m.slice(-lookback);
  const comparisons = recent.length - 1;

  if (direction === 'long') {
    let higherLowCount = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].low >= recent[i - 1].low * 0.999) {
        higherLowCount++;
      }
    }
    const isStabilizing = higherLowCount >= minMatches;

    return {
      name: 'Price Stabilizing',
      active: isStabilizing,
      value: `${higherLowCount}/${comparisons} higher lows${isStabilizing ? ' (base forming)' : ''}`,
      weight: 0.20,
      timeframe: '5m',
    };
  } else {
    let lowerHighCount = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].high <= recent[i - 1].high * 1.001) {
        lowerHighCount++;
      }
    }
    const isStabilizing = lowerHighCount >= minMatches;

    return {
      name: 'Price Stabilizing',
      active: isStabilizing,
      value: `${lowerHighCount}/${comparisons} lower highs${isStabilizing ? ' (top forming)' : ''}`,
      weight: 0.20,
      timeframe: '5m',
    };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Determine the primary exhaustion type from active signals.
 */
function determineExhaustionType(
  activeSignals: DCAExhaustionSignal[]
): MomentumExhaustionType {
  if (activeSignals.length === 0) return 'multi_signal';
  if (activeSignals.length >= 3) return 'multi_signal';

  // Find highest weighted active signal
  const sorted = [...activeSignals].sort((a, b) => b.weight - a.weight);
  const primary = sorted[0].name;

  switch (primary) {
    case 'RSI Exhaustion': return 'rsi_divergence';
    case 'Volume Declining': return 'volume_dry_up';
    case 'MACD Contracting': return 'macd_convergence';
    case 'Volatility Calming': return 'ema_slope_flatten';
    case 'Price Stabilizing': return 'candle_rejection';
    default: return 'multi_signal';
  }
}

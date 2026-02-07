/**
 * Exit Signal Engine v2
 *
 * Condition-based exit system with 48h timebox and anti-greed logic.
 * The trader has NO stop loss and NO fixed take-profit.
 *
 * TRADER'S RULES:
 * - Ideally exit within 48 hours
 * - Take any profit, little profit is better than nothing
 * - Prevent staying in trade too long hoping for more profit
 * - If no volatility or volume, take small profit and exit - even +50 EUR
 * - No selling at loss (willing to be liquidated)
 *
 * TIME PRESSURE:
 * - 0-12h (normal): no urgency unless strong exit signal
 * - 12-24h (monitor): consider exit if in profit
 * - 24-36h (escalating): recommended exit if any green
 * - 36-48h (urgent): take whatever is there
 * - 48h+ (overdue): exit on any green tick
 *
 * CONDITION-BASED EXITS:
 * - 15m RSI extremes (momentum exhaustion)
 * - 1H MACD histogram reversal
 * - Volume declining while in profit
 * - Anti-greed: P&L dropped 30%+ from high water mark
 *
 * CRITICAL: shouldExit is NEVER true when at a loss (unrealizedPnL < 0)
 */

import type { Indicators } from '@/lib/kraken/types';
import type {
  PositionState,
  ExitSignal,
  ExitPressure,
  ExitReason,
  ExitUrgency,
  AntiGreedConfig,
  TimeboxConfig,
  TradingStrategy,
} from './v2-types';
import {
  NO_EXIT_SIGNAL,
  DEFAULT_STRATEGY,
  DEFAULT_TIMEBOX,
  DEFAULT_ANTI_GREED,
} from './v2-types';

// ============================================================================
// TIME PHASE DETERMINATION
// ============================================================================

/** Time phase of the position lifecycle */
export type TimePhase = 'normal' | 'monitor' | 'escalating' | 'urgent' | 'overdue';

/**
 * Determine the time phase based on hours in trade.
 */
export function getTimePhase(hoursInTrade: number): TimePhase {
  if (hoursInTrade >= 48) return 'overdue';
  if (hoursInTrade >= 36) return 'urgent';
  if (hoursInTrade >= 24) return 'escalating';
  if (hoursInTrade >= 12) return 'monitor';
  return 'normal';
}

/**
 * Calculate timebox pressure using step function from config.
 * Returns 0-100 pressure value.
 */
export function calculateTimeboxPressure(
  hoursInTrade: number,
  config: TimeboxConfig = DEFAULT_STRATEGY.timebox
): number {
  const { steps } = config;

  // Find the two steps we're between
  for (let i = steps.length - 1; i >= 0; i--) {
    if (hoursInTrade >= steps[i].hours) {
      // If we're past the last step, return its pressure
      if (i === steps.length - 1) {
        return steps[i].pressure;
      }
      // Linear interpolation between steps
      const current = steps[i];
      const next = steps[i + 1];
      const progress = (hoursInTrade - current.hours) / (next.hours - current.hours);
      return current.pressure + (next.pressure - current.pressure) * progress;
    }
  }
  return 0;
}

// ============================================================================
// INDIVIDUAL EXIT SIGNAL DETECTION
// ============================================================================

/**
 * Detect RSI extreme on 15m (momentum exhaustion).
 * For LONG: RSI > 70 = overbought = momentum exhausting
 * For SHORT: RSI < 30 = oversold = momentum exhausting
 */
export function detectRSIExhaustion(
  direction: PositionState['direction'],
  rsi15m: number
): { active: boolean; value: number; detail: string } {
  if (direction === 'long') {
    if (rsi15m > 75) {
      return { active: true, value: 90, detail: `15m RSI ${rsi15m.toFixed(0)} - strongly overbought` };
    }
    if (rsi15m > 70) {
      return { active: true, value: 60, detail: `15m RSI ${rsi15m.toFixed(0)} - overbought` };
    }
  } else {
    if (rsi15m < 25) {
      return { active: true, value: 90, detail: `15m RSI ${rsi15m.toFixed(0)} - strongly oversold` };
    }
    if (rsi15m < 30) {
      return { active: true, value: 60, detail: `15m RSI ${rsi15m.toFixed(0)} - oversold` };
    }
  }
  return { active: false, value: 0, detail: `15m RSI ${rsi15m.toFixed(0)} - neutral` };
}

/**
 * Detect MACD histogram reversal on 1H.
 * If histogram was favorable and is now reversing, momentum is fading.
 */
export function detectMACDReversal(
  direction: PositionState['direction'],
  histogram1h: number,
  macd1h: number
): { active: boolean; value: number; detail: string } {
  const hist = histogram1h ?? 0;

  if (direction === 'long') {
    // For longs: MACD turning negative = bearish reversal
    if (hist < 0 && macd1h < 0) {
      return { active: true, value: 80, detail: `1H MACD reversed bearish (hist: ${hist.toFixed(5)})` };
    }
    if (hist < 0) {
      return { active: true, value: 50, detail: `1H histogram turning negative (${hist.toFixed(5)})` };
    }
  } else {
    // For shorts: MACD turning positive = bullish reversal
    if (hist > 0 && macd1h > 0) {
      return { active: true, value: 80, detail: `1H MACD reversed bullish (hist: +${hist.toFixed(5)})` };
    }
    if (hist > 0) {
      return { active: true, value: 50, detail: `1H histogram turning positive (+${hist.toFixed(5)})` };
    }
  }
  return { active: false, value: 0, detail: `1H MACD histogram ${hist >= 0 ? '+' : ''}${hist.toFixed(5)}` };
}

/**
 * Detect volume drying up (no conviction left to squeeze).
 * Low volume + in profit = time to take it.
 */
export function detectVolumeDryUp(
  volRatio15m: number,
  volRatio5m: number,
  isInProfit: boolean
): { active: boolean; value: number; detail: string } {
  if (!isInProfit) {
    return { active: false, value: 0, detail: `Vol: 15m ${volRatio15m.toFixed(1)}x, 5m ${volRatio5m.toFixed(1)}x` };
  }

  const avgVol = (volRatio15m + volRatio5m) / 2;

  if (avgVol < 0.5) {
    return { active: true, value: 80, detail: `Volume dried up (avg ${avgVol.toFixed(1)}x) - take profit` };
  }
  if (avgVol < 0.7) {
    return { active: true, value: 50, detail: `Volume declining (avg ${avgVol.toFixed(1)}x) - consider exit` };
  }
  return { active: false, value: 0, detail: `Volume ok (avg ${avgVol.toFixed(1)}x)` };
}

/**
 * Anti-greed detection: P&L dropped too far from high water mark.
 */
export function detectAntiGreed(
  unrealizedPnL: number,
  highWaterMark: number,
  config: AntiGreedConfig = DEFAULT_STRATEGY.antiGreed
): { active: boolean; value: number; detail: string; drawdownPercent: number } {
  if (!config.enabled) {
    return { active: false, value: 0, detail: 'Anti-greed disabled', drawdownPercent: 0 };
  }

  // Don't activate if HWM is below tracking threshold
  if (highWaterMark < config.minHWMToTrack) {
    return { active: false, value: 0, detail: `HWM ${highWaterMark.toFixed(0)} EUR below tracking threshold`, drawdownPercent: 0 };
  }

  // Don't activate if current P&L is below activation threshold
  if (unrealizedPnL < config.minPnLToActivate) {
    return { active: false, value: 0, detail: `P&L ${unrealizedPnL.toFixed(0)} EUR below activation threshold`, drawdownPercent: 0 };
  }

  const drawdown = highWaterMark - unrealizedPnL;
  const drawdownPercent = highWaterMark > 0 ? (drawdown / highWaterMark) * 100 : 0;

  if (drawdownPercent >= config.drawdownThresholdPercent) {
    return {
      active: true,
      value: 90,
      detail: `Gave back ${drawdownPercent.toFixed(0)}% from peak (${highWaterMark.toFixed(0)} EUR -> ${unrealizedPnL.toFixed(0)} EUR)`,
      drawdownPercent,
    };
  }

  // Approaching threshold - early warning
  if (drawdownPercent >= config.drawdownThresholdPercent * 0.7) {
    return {
      active: false,
      value: 30,
      detail: `Drawdown ${drawdownPercent.toFixed(0)}% from peak (approaching ${config.drawdownThresholdPercent}% threshold)`,
      drawdownPercent,
    };
  }

  return { active: false, value: 0, detail: `Drawdown ${drawdownPercent.toFixed(0)}% from peak - healthy`, drawdownPercent };
}

/**
 * Detect momentum fading on 15m: MACD histogram converging to zero + RSI drifting to 50.
 */
export function detectMomentumFading(
  direction: PositionState['direction'],
  ind15m: Indicators
): { active: boolean; value: number; detail: string } {
  const hist = ind15m.histogram ?? 0;
  const rsi = ind15m.rsi;

  let signals = 0;

  if (direction === 'long') {
    // Histogram was positive but shrinking
    if (hist > 0 && hist < 0.0001) signals++;
    // RSI drifting down from favorable zone
    if (rsi > 45 && rsi < 55) signals++;
    // EMA slope flattening
    if (Math.abs(ind15m.ema20Slope) < 0.02) signals++;
  } else {
    // Histogram was negative but shrinking
    if (hist < 0 && hist > -0.0001) signals++;
    // RSI drifting up from favorable zone
    if (rsi > 45 && rsi < 55) signals++;
    // EMA slope flattening
    if (Math.abs(ind15m.ema20Slope) < 0.02) signals++;
  }

  if (signals >= 2) {
    return { active: true, value: 60, detail: `Momentum fading (${signals}/3 signals)` };
  }
  if (signals === 1) {
    return { active: false, value: 20, detail: `Partial momentum fade (${signals}/3 signals)` };
  }
  return { active: false, value: 0, detail: 'Momentum intact' };
}

/**
 * Detect trend reversal on higher timeframe (1H trend flipping against position).
 */
export function detectTrendReversal(
  direction: PositionState['direction'],
  ind1h: Indicators
): { active: boolean; value: number; detail: string } {
  if (direction === 'long') {
    if (ind1h.trend === 'bearish' && ind1h.emaAlignment === 'bearish') {
      return { active: true, value: 90, detail: '1H trend reversed to bearish with EMA stack' };
    }
    if (ind1h.trend === 'bearish') {
      return { active: true, value: 60, detail: '1H trend turned bearish' };
    }
  } else {
    if (ind1h.trend === 'bullish' && ind1h.emaAlignment === 'bullish') {
      return { active: true, value: 90, detail: '1H trend reversed to bullish with EMA stack' };
    }
    if (ind1h.trend === 'bullish') {
      return { active: true, value: 60, detail: '1H trend turned bullish' };
    }
  }
  return { active: false, value: 0, detail: `1H trend: ${ind1h.trend}` };
}

// ============================================================================
// URGENCY DETERMINATION
// ============================================================================

/**
 * Map time phase and profit status to exit urgency.
 */
export function determineUrgency(
  timePhase: TimePhase,
  isInProfit: boolean,
  totalPressure: number
): ExitUrgency {
  // Critical signals override time phase
  if (totalPressure >= 90) return 'immediate';

  switch (timePhase) {
    case 'overdue':
      return isInProfit ? 'immediate' : 'soon';
    case 'urgent':
      return isInProfit ? 'soon' : 'consider';
    case 'escalating':
      if (totalPressure >= 60) return 'soon';
      return isInProfit ? 'consider' : 'monitor';
    case 'monitor':
      if (totalPressure >= 70) return 'consider';
      return 'monitor';
    case 'normal':
      if (totalPressure >= 80) return 'consider';
      return 'monitor';
  }
}

// ============================================================================
// MAIN EXIT ANALYSIS
// ============================================================================

/**
 * Analyze all exit conditions and produce an ExitSignal.
 *
 * @param position - Current position state
 * @param ind15m - 15-minute indicators
 * @param ind1h - 1-hour indicators
 * @param ind5m - 5-minute indicators
 * @param currentPrice - Current market price
 * @param currentTime - Current timestamp (ms)
 * @param strategy - Trading strategy (provides exit, antiGreed, timebox config)
 * @returns ExitSignal with all analysis results
 */
export function analyzeExitConditions(
  position: PositionState,
  ind15m: Indicators,
  ind1h: Indicators,
  ind5m: Indicators,
  currentPrice: number,
  currentTime: number,
  strategy: TradingStrategy = DEFAULT_STRATEGY
): ExitSignal {
  const antiGreedConfig = strategy.antiGreed;
  const timeboxConfig = strategy.timebox;
  const exitConfig = strategy.exit;
  // No position open - nothing to exit
  if (!position.isOpen) {
    return NO_EXIT_SIGNAL;
  }

  const isInProfit = position.unrealizedPnL > 0;
  const hoursInTrade = position.timeInTradeMs / (1000 * 60 * 60);
  const timePhase = getTimePhase(hoursInTrade);

  // --- Calculate all pressures ---
  const pressures: ExitPressure[] = [];

  // 1. Timebox pressure
  const timeboxPressureValue = calculateTimeboxPressure(hoursInTrade, timeboxConfig);
  if (timeboxPressureValue > 0) {
    pressures.push({
      source: 'timebox_expired' as ExitReason,
      value: timeboxPressureValue,
      weight: 0.30,
      detail: `${hoursInTrade.toFixed(1)}h in trade (${timePhase}) - pressure ${timeboxPressureValue.toFixed(0)}%`,
    });
  }

  // 2. RSI exhaustion
  const rsiExhaustion = detectRSIExhaustion(position.direction, ind15m.rsi);
  if (rsiExhaustion.active) {
    pressures.push({
      source: 'momentum_exhaustion',
      value: rsiExhaustion.value,
      weight: 0.20,
      detail: rsiExhaustion.detail,
    });
  }

  // 3. MACD reversal
  const macdReversal = detectMACDReversal(
    position.direction,
    ind1h.histogram ?? 0,
    ind1h.macd
  );
  if (macdReversal.active) {
    pressures.push({
      source: 'momentum_exhaustion',
      value: macdReversal.value,
      weight: 0.15,
      detail: macdReversal.detail,
    });
  }

  // 4. Volume drying up
  const volumeDryUp = detectVolumeDryUp(ind15m.volRatio, ind5m.volRatio, isInProfit);
  if (volumeDryUp.active) {
    pressures.push({
      source: 'condition_deterioration',
      value: volumeDryUp.value,
      weight: 0.10,
      detail: volumeDryUp.detail,
    });
  }

  // 5. Anti-greed
  const antiGreed = detectAntiGreed(
    position.unrealizedPnL,
    position.highWaterMarkPnL,
    antiGreedConfig
  );
  if (antiGreed.active) {
    pressures.push({
      source: 'anti_greed',
      value: antiGreed.value,
      weight: 0.25,
      detail: antiGreed.detail,
    });
  }

  // 6. Momentum fading
  const momentumFade = detectMomentumFading(position.direction, ind15m);
  if (momentumFade.active) {
    pressures.push({
      source: 'momentum_exhaustion',
      value: momentumFade.value,
      weight: 0.10,
      detail: momentumFade.detail,
    });
  }

  // 7. Trend reversal
  const trendReversal = detectTrendReversal(position.direction, ind1h);
  if (trendReversal.active) {
    pressures.push({
      source: 'trend_reversal',
      value: trendReversal.value,
      weight: 0.20,
      detail: trendReversal.detail,
    });
  }

  // --- Calculate composite pressure ---
  let totalPressure = 0;
  let totalWeight = 0;
  for (const p of pressures) {
    totalPressure += p.value * p.weight;
    totalWeight += p.weight;
  }
  // Normalize to 0-100
  totalPressure = totalWeight > 0 ? Math.min(100, totalPressure / totalWeight) : 0;

  // Boost pressure when timebox is critical
  if (timePhase === 'overdue') {
    totalPressure = Math.max(totalPressure, 90);
  } else if (timePhase === 'urgent') {
    totalPressure = Math.max(totalPressure, 50);
  }

  // --- Determine urgency ---
  const urgency = determineUrgency(timePhase, isInProfit, totalPressure);

  // --- Determine shouldExit ---
  // CRITICAL RULE: Never exit at a loss (trader prefers liquidation)
  // Exception: none. Even at 48h+, only exit if in profit.
  // Minimum profit check from strategy config
  const meetsMinProfit = position.unrealizedPnL >= exitConfig.minProfitForExit;
  const shouldExit = isInProfit && meetsMinProfit && totalPressure >= exitConfig.exitPressureThreshold;

  // --- Determine primary reason ---
  let primaryReason: ExitReason = 'timebox_approaching';
  if (antiGreed.active) {
    primaryReason = 'anti_greed';
  } else if (trendReversal.active && trendReversal.value >= 80) {
    primaryReason = 'trend_reversal';
  } else if (timePhase === 'overdue') {
    primaryReason = 'timebox_expired';
  } else if (rsiExhaustion.active || macdReversal.active) {
    primaryReason = 'momentum_exhaustion';
  } else if (volumeDryUp.active) {
    primaryReason = 'condition_deterioration';
  } else if (timeboxPressureValue >= 50) {
    primaryReason = 'timebox_approaching';
  }

  // --- Build explanation ---
  const explanationParts: string[] = [];
  if (shouldExit) {
    explanationParts.push(`Exit recommended (pressure ${totalPressure.toFixed(0)}%).`);
  } else if (isInProfit) {
    explanationParts.push(`In profit but pressure low (${totalPressure.toFixed(0)}%).`);
  } else {
    explanationParts.push(`At a loss - no exit signal (trader holds to liquidation).`);
  }

  if (timePhase !== 'normal') {
    explanationParts.push(`Time: ${hoursInTrade.toFixed(1)}h (${timePhase}).`);
  }
  if (isInProfit) {
    explanationParts.push(`P&L: +${position.unrealizedPnL.toFixed(0)} EUR.`);
  }
  if (antiGreed.active) {
    explanationParts.push(antiGreed.detail);
  }

  // --- Suggested exit percentage ---
  let suggestedExitPercent = 0;
  if (shouldExit) {
    if (urgency === 'immediate') {
      suggestedExitPercent = 100; // Full exit
    } else if (urgency === 'soon') {
      suggestedExitPercent = totalPressure >= 80 ? 100 : 75;
    } else if (urgency === 'consider') {
      suggestedExitPercent = 50; // Partial exit
    }
  }

  // --- Confidence in the exit signal ---
  const exitConfidence = shouldExit ? Math.min(95, Math.round(totalPressure)) : 0;

  return {
    shouldExit,
    urgency,
    reason: primaryReason,
    confidence: exitConfidence,
    explanation: explanationParts.join(' '),
    pressures,
    totalPressure: Math.round(totalPressure),
    suggestedExitPercent,
  };
}

// ============================================================================
// CONVENIENCE HELPERS
// ============================================================================

/**
 * Quick check: is this position approaching timebox?
 */
export function isApproachingTimebox(position: PositionState): boolean {
  const hoursInTrade = position.timeInTradeMs / (1000 * 60 * 60);
  return hoursInTrade >= 36;
}

/**
 * Quick check: has the anti-greed threshold been breached?
 */
export function isAntiGreedTriggered(
  position: PositionState,
  config: AntiGreedConfig = DEFAULT_STRATEGY.antiGreed
): boolean {
  if (!config.enabled) return false;
  if (position.highWaterMarkPnL < config.minHWMToTrack) return false;
  if (position.unrealizedPnL < config.minPnLToActivate) return false;

  const drawdownPercent = position.highWaterMarkPnL > 0
    ? ((position.highWaterMarkPnL - position.unrealizedPnL) / position.highWaterMarkPnL) * 100
    : 0;

  return drawdownPercent >= config.drawdownThresholdPercent;
}

/**
 * Get a summary of exit status for display.
 */
export function getExitStatusSummary(signal: ExitSignal): {
  label: string;
  color: 'green' | 'yellow' | 'orange' | 'red' | 'gray';
} {
  if (!signal.shouldExit && signal.totalPressure === 0) {
    return { label: 'Holding', color: 'green' };
  }

  switch (signal.urgency) {
    case 'immediate':
      return { label: 'EXIT NOW', color: 'red' };
    case 'soon':
      return { label: 'Exit Soon', color: 'orange' };
    case 'consider':
      return { label: 'Consider Exit', color: 'yellow' };
    case 'monitor':
      return { label: 'Monitoring', color: 'green' };
    default:
      return { label: 'Holding', color: 'gray' };
  }
}

/**
 * Exit Signal Engine v2
 *
 * PROFIT-SEEKING exit system with regime-aware timebox and knife integration.
 * The trader has NO stop loss and NO fixed take-profit.
 *
 * TRADER'S RULES:
 * - Take any profit, little profit is better than nothing
 * - Prevent staying in trade too long hoping for more profit
 * - If no volatility or volume, take small profit and exit - even +50 EUR
 * - No selling at loss (willing to be liquidated)
 *
 * REGIME-AWARE TIMEBOX:
 * - strong_trend: up to 72h, timebox weight 0.05 (backstop only)
 * - trending: up to 48h, timebox weight 0.10
 * - ranging/low_vol: up to 36h, timebox weight 0.20
 * Phase boundaries scale proportionally with maxHours.
 *
 * PROFIT-AWARE EXITS:
 * - Profitable trades get higher exit thresholds (hold longer when winning)
 * - +20% P&L → threshold 70, +10% → threshold 65
 * - Strong trend regime adds +10 to threshold (cap 80)
 *
 * KNIFE EXIT PRESSURE:
 * - Knife impulse/capitulation against position → high exit pressure
 * - Overrides profit-aware threshold to 50 for emergency exits
 *
 * CRITICAL: shouldExit is NEVER true when at a loss (unrealizedPnL < 0)
 */

import type { Indicators, KnifeStatus, MicrostructureInput } from '@/lib/kraken/types';
import type {
  PositionState,
  ExitSignal,
  ExitPressure,
  ExitReason,
  ExitUrgency,
  AntiGreedConfig,
  TimeboxConfig,
  TradingStrategy,
  UnderwaterPolicy,
} from './v2-types';
import {
  NO_EXIT_SIGNAL,
  DEFAULT_STRATEGY,
  DEFAULT_TIMEBOX,
  DEFAULT_ANTI_GREED,
} from './v2-types';
import type { ReversalSignal } from './reversal-detector';
import type { MarketRegimeAnalysis } from './market-regime';

// ============================================================================
// TIME PHASE DETERMINATION
// ============================================================================

/** Time phase of the position lifecycle */
export type TimePhase = 'normal' | 'monitor' | 'escalating' | 'urgent' | 'overdue';

/**
 * Determine the time phase based on hours in trade.
 * Phase boundaries scale proportionally with maxHours:
 * - normal: < 25% of maxHours
 * - monitor: 25-50%
 * - escalating: 50-75%
 * - urgent: 75-100%
 * - overdue: > 100%
 */
export function getTimePhase(hoursInTrade: number, maxHours = 48): TimePhase {
  const pct = maxHours > 0 ? hoursInTrade / maxHours : 1;
  if (pct >= 1.0) return 'overdue';
  if (pct >= 0.75) return 'urgent';
  if (pct >= 0.50) return 'escalating';
  if (pct >= 0.25) return 'monitor';
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

  // Dead zone: histogram must be meaningfully past zero to trigger exit pressure.
  // Prevents noise from histogram hovering near zero from creating false exit signals.
  const MACD_EXIT_DEAD_ZONE = 0.0002;

  if (direction === 'long') {
    // For longs: MACD turning negative = bearish reversal
    if (hist < -MACD_EXIT_DEAD_ZONE && macd1h < 0) {
      return { active: true, value: 80, detail: `1H MACD reversed bearish (hist: ${hist.toFixed(5)})` };
    }
    if (hist < -MACD_EXIT_DEAD_ZONE) {
      return { active: true, value: 50, detail: `1H histogram turning negative (${hist.toFixed(5)})` };
    }
  } else {
    // For shorts: MACD turning positive = bullish reversal
    if (hist > MACD_EXIT_DEAD_ZONE && macd1h > 0) {
      return { active: true, value: 80, detail: `1H MACD reversed bullish (hist: +${hist.toFixed(5)})` };
    }
    if (hist > MACD_EXIT_DEAD_ZONE) {
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

  if (signals >= 3) {
    return { active: true, value: 60, detail: `Momentum fading (${signals}/3 signals)` };
  }
  if (signals === 2) {
    return { active: false, value: 30, detail: `Partial momentum fade (${signals}/3 signals)` };
  }
  if (signals === 1) {
    return { active: false, value: 10, detail: `Partial momentum fade (${signals}/3 signals)` };
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

/** Urgency rank for comparison/clamping */
const URGENCY_RANK: Record<ExitUrgency, number> = {
  monitor: 0,
  consider: 1,
  soon: 2,
  immediate: 3,
};
const URGENCY_BY_RANK: ExitUrgency[] = ['monitor', 'consider', 'soon', 'immediate'];

/**
 * Map time phase and profit status to exit urgency.
 * When underwaterPolicy is active and position is at a loss, caps urgency.
 */
export function determineUrgency(
  timePhase: TimePhase,
  isInProfit: boolean,
  totalPressure: number,
  underwaterPolicy?: UnderwaterPolicy | null
): ExitUrgency {
  // Critical signals override time phase
  let raw: ExitUrgency;
  if (totalPressure >= 90) {
    raw = 'immediate';
  } else {
    switch (timePhase) {
      case 'overdue':
        raw = isInProfit ? 'immediate' : 'soon';
        break;
      case 'urgent':
        raw = isInProfit ? 'soon' : 'consider';
        break;
      case 'escalating':
        if (totalPressure >= 60) raw = 'soon';
        else raw = isInProfit ? 'consider' : 'monitor';
        break;
      case 'monitor':
        raw = totalPressure >= 70 ? 'consider' : 'monitor';
        break;
      case 'normal':
        raw = totalPressure >= 80 ? 'consider' : 'monitor';
        break;
    }
  }

  // Cap urgency when underwater with recovery policy active
  if (!isInProfit && underwaterPolicy?.enabled) {
    const maxAllowed = underwaterPolicy.maxUrgencyWhenUnderwater;
    const maxRank = URGENCY_RANK[maxAllowed];
    const rawRank = URGENCY_RANK[raw];
    if (rawRank > maxRank) {
      raw = URGENCY_BY_RANK[maxRank];
    }
  }

  return raw;
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
 * @param reversalSignal - Candlestick reversal pattern detection
 * @param knifeStatus - Knife detection status (sharp move against position)
 * @param regimeAnalysis - Market regime analysis (adjusts timebox + weights)
 * @returns ExitSignal with all analysis results
 */
export function analyzeExitConditions(
  position: PositionState,
  ind15m: Indicators,
  ind1h: Indicators,
  ind5m: Indicators,
  currentPrice: number,
  currentTime: number,
  strategy: TradingStrategy = DEFAULT_STRATEGY,
  reversalSignal?: ReversalSignal | null,
  knifeStatus?: KnifeStatus | null,
  regimeAnalysis?: MarketRegimeAnalysis | null,
  micro?: MicrostructureInput | null,
  ind4h?: Indicators | null
): ExitSignal {
  const antiGreedConfig = strategy.antiGreed;
  const timeboxConfig = strategy.timebox;
  const exitConfig = strategy.exit;
  const underwaterPolicy = strategy.underwaterPolicy;

  // No position open - nothing to exit
  if (!position.isOpen) {
    return NO_EXIT_SIGNAL;
  }

  const isInProfit = position.unrealizedPnL > 0;
  const isRecoveryMode = underwaterPolicy?.enabled === true && !isInProfit;
  const hoursInTrade = position.timeInTradeMs / (1000 * 60 * 60);

  // Use regime-adjusted maxHours if available, otherwise fall back to strategy config
  const effectiveMaxHours = regimeAnalysis?.adjustedTimeboxMaxHours ?? timeboxConfig.maxHours;
  const timePhase = getTimePhase(hoursInTrade, effectiveMaxHours);

  // Regime-adjusted timebox weight (backstop, not driver)
  const timeboxWeight = regimeAnalysis?.adjustedTimeboxWeight ?? 0.20;

  // --- Calculate all pressures ---
  const pressures: ExitPressure[] = [];

  // 1. Timebox pressure (regime-aware weight, recovery-aware)
  const rawTimeboxPressure = calculateTimeboxPressure(hoursInTrade, timeboxConfig);
  let timeboxPressureValue = rawTimeboxPressure;
  let effectiveTimeboxWeight = timeboxWeight;
  if (isRecoveryMode && underwaterPolicy.suppressTimeboxPressureWhenUnderwater) {
    timeboxPressureValue = 0;
    effectiveTimeboxWeight = 0;
  } else if (isRecoveryMode) {
    effectiveTimeboxWeight = timeboxWeight * underwaterPolicy.underwaterTimeboxWeightMultiplier;
  }
  if (timeboxPressureValue > 0) {
    pressures.push({
      source: 'timebox_expired' as ExitReason,
      value: timeboxPressureValue,
      weight: effectiveTimeboxWeight,
      detail: isRecoveryMode
        ? `${hoursInTrade.toFixed(1)}h in trade (${timePhase}, recovery mode)`
        : `${hoursInTrade.toFixed(1)}h in trade (${timePhase}, max ${effectiveMaxHours}h) - pressure ${timeboxPressureValue.toFixed(0)}%`,
    });
  }

  // 2. RSI exhaustion (weight 0.25, up from 0.20)
  const rsiExhaustion = detectRSIExhaustion(position.direction, ind15m.rsi);
  if (rsiExhaustion.active) {
    pressures.push({
      source: 'momentum_exhaustion',
      value: rsiExhaustion.value,
      weight: 0.25,
      detail: rsiExhaustion.detail,
    });
  }

  // 3. MACD reversal (weight 0.18, up from 0.15)
  const macdReversal = detectMACDReversal(
    position.direction,
    ind1h.histogram ?? 0,
    ind1h.macd
  );
  if (macdReversal.active) {
    pressures.push({
      source: 'momentum_exhaustion',
      value: macdReversal.value,
      weight: 0.18,
      detail: macdReversal.detail,
    });
  }

  // 4. Volume drying up (weight 0.15, up from 0.10)
  const volumeDryUp = detectVolumeDryUp(ind15m.volRatio, ind5m.volRatio, isInProfit);
  if (volumeDryUp.active) {
    pressures.push({
      source: 'condition_deterioration',
      value: volumeDryUp.value,
      weight: 0.15,
      detail: volumeDryUp.detail,
    });
  }

  // 5. Anti-greed (weight 0.25, unchanged)
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

  // 6. Momentum fading (weight 0.15, up from 0.10)
  const momentumFade = detectMomentumFading(position.direction, ind15m);
  if (momentumFade.active) {
    pressures.push({
      source: 'momentum_exhaustion',
      value: momentumFade.value,
      weight: 0.15,
      detail: momentumFade.detail,
    });
  }

  // 7. Trend reversal (weight 0.25, up from 0.20 — most important signal)
  const trendReversal = detectTrendReversal(position.direction, ind1h);
  if (trendReversal.active) {
    pressures.push({
      source: 'trend_reversal',
      value: trendReversal.value,
      weight: 0.25,
      detail: trendReversal.detail,
    });
  }

  // 8. Candlestick reversal pattern detection (weight 0.20, unchanged)
  let reversalPressureActive = false;
  if (reversalSignal && reversalSignal.detected) {
    // Only add pressure if the reversal is AGAINST our position
    const reversalOpposesPosition =
      (position.direction === 'long' && reversalSignal.direction === 'bearish') ||
      (position.direction === 'short' && reversalSignal.direction === 'bullish');

    if (reversalOpposesPosition) {
      // Map reversal phase + confidence to pressure value
      let reversalPressure = 0;
      switch (reversalSignal.phase) {
        case 'confirmation':
          reversalPressure = reversalSignal.confidence >= 70 ? 85 : 65;
          break;
        case 'initiation':
          reversalPressure = reversalSignal.confidence >= 50 ? 55 : 40;
          break;
        case 'indecision':
          reversalPressure = 30;
          break;
        case 'exhaustion':
          reversalPressure = reversalSignal.exhaustionScore > 60 ? 40 : 25;
          break;
      }

      if (reversalPressure > 0) {
        reversalPressureActive = true;
        const patternNames = reversalSignal.patterns
          .filter(p => p.type.startsWith('reversal_'))
          .slice(0, 2)
          .map(p => p.name.replace(/_/g, ' '));
        const detail = patternNames.length > 0
          ? `↺ ${reversalSignal.direction} reversal: ${patternNames.join(', ')} (${reversalSignal.phase}, ${reversalSignal.confidence}%)`
          : `↺ ${reversalSignal.direction} ${reversalSignal.phase} (${reversalSignal.confidence}%)`;

        pressures.push({
          source: 'reversal_detected',
          value: reversalPressure,
          weight: 0.20,
          detail,
        });
      }
    }
  }

  // 9. Knife exit pressure — sharp move against position (weight 0.22)
  let knifeEmergency = false;
  if (knifeStatus && knifeStatus.isKnife) {
    // Only add pressure if the knife opposes our position
    const knifeOpposesPosition =
      (position.direction === 'long' && knifeStatus.direction === 'falling') ||
      (position.direction === 'short' && knifeStatus.direction === 'rising');

    if (knifeOpposesPosition) {
      let knifePressure = 0;
      switch (knifeStatus.phase) {
        case 'impulse':
          knifePressure = 95;
          knifeEmergency = true;
          break;
        case 'capitulation':
          knifePressure = 85;
          knifeEmergency = true;
          break;
        case 'stabilizing':
          knifePressure = 50;
          break;
        case 'confirming':
          knifePressure = 30;
          break;
        case 'safe':
        default:
          knifePressure = 0;
          break;
      }

      // Scale by knife score (0-100)
      knifePressure = Math.round(knifePressure * Math.min(1, knifeStatus.knifeScore / 100));

      if (knifePressure > 0) {
        pressures.push({
          source: 'knife_detected',
          value: knifePressure,
          weight: 0.22,
          detail: `🔪 ${knifeStatus.direction} knife ${knifeStatus.phase} (score ${knifeStatus.knifeScore.toFixed(0)}) against ${position.direction}`,
        });
      }
    }
  }

  // 10. Whale activity pressure — large opposing orders (weight 0.12)
  if (micro) {
    const opposingWhales = position.direction === 'long'
      ? micro.recentLargeSells - micro.recentLargeBuys
      : micro.recentLargeBuys - micro.recentLargeSells;

    if (opposingWhales >= 3) {
      pressures.push({
        source: 'condition_deterioration',
        value: Math.min(80, 40 + opposingWhales * 10),
        weight: 0.12,
        detail: `Whale ${position.direction === 'long' ? 'selling' : 'buying'} pressure (${opposingWhales} opposing large orders)`,
      });
    }
  }

  // 11. Trend exhaustion — parabolic/overextended move (weight 0.15)
  if (ind4h) {
    let exhaustionSignals = 0;
    const exhaustionDetails: string[] = [];

    // Multi-TF RSI overbought/oversold
    if (position.direction === 'long') {
      if (ind1h.rsi > 75) { exhaustionSignals++; exhaustionDetails.push(`1H RSI ${ind1h.rsi.toFixed(0)}`); }
      if (ind4h.rsi > 70) { exhaustionSignals++; exhaustionDetails.push(`4H RSI ${ind4h.rsi.toFixed(0)}`); }
    } else {
      if (ind1h.rsi < 25) { exhaustionSignals++; exhaustionDetails.push(`1H RSI ${ind1h.rsi.toFixed(0)}`); }
      if (ind4h.rsi < 30) { exhaustionSignals++; exhaustionDetails.push(`4H RSI ${ind4h.rsi.toFixed(0)}`); }
    }

    // Price far from EMA20
    const priceDistFromEma = Math.abs(ind4h.priceVsEma20);
    if (priceDistFromEma > 5) { exhaustionSignals++; exhaustionDetails.push(`Price ${priceDistFromEma.toFixed(1)}% from 4H EMA20`); }

    // BB extreme
    if (position.direction === 'long' && ind4h.bbPos > 0.95) {
      exhaustionSignals++; exhaustionDetails.push(`4H BB ${(ind4h.bbPos * 100).toFixed(0)}%`);
    } else if (position.direction === 'short' && ind4h.bbPos < 0.05) {
      exhaustionSignals++; exhaustionDetails.push(`4H BB ${(ind4h.bbPos * 100).toFixed(0)}%`);
    }

    // Require 2+ of 4 conditions
    if (exhaustionSignals >= 2) {
      pressures.push({
        source: 'momentum_exhaustion',
        value: Math.min(85, 30 + exhaustionSignals * 20),
        weight: 0.15,
        detail: `Trend exhaustion (${exhaustionSignals}/4): ${exhaustionDetails.join(', ')}`,
      });
    }
  }

  // De-duplicate: when reversal_detected is active, reduce MACD reversal weight
  // to avoid double-counting (the reversal detector already includes MACD crossover
  // in its confidence score). We halve the MACD pressure weight.
  if (reversalPressureActive && macdReversal.active) {
    const macdPressure = pressures.find(p => p.detail === macdReversal.detail);
    if (macdPressure) {
      macdPressure.weight = 0.09; // Reduced from 0.18
    }
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

  // Soft backstop: overdue AND profitable → floor at 60 (not 90)
  // No forced minimum for 'urgent' — let real signals drive exits
  // Skip floor when in recovery mode (underwater + policy active)
  if (timePhase === 'overdue' && isInProfit && !isRecoveryMode) {
    totalPressure = Math.max(totalPressure, 60);
  }

  // --- Profit-aware exit threshold ---
  // Hold longer when the trade is working well
  let effectiveExitThreshold = exitConfig.exitPressureThreshold; // 60
  if (position.unrealizedPnLPercent > 20) {
    effectiveExitThreshold = 70;
  } else if (position.unrealizedPnLPercent > 10) {
    effectiveExitThreshold = 65;
  }
  // Strong trend regime: even more patient
  if (regimeAnalysis?.regime === 'strong_trend') {
    effectiveExitThreshold = Math.min(80, effectiveExitThreshold + 10);
  }
  // Knife emergency overrides: lower threshold for safety
  if (knifeEmergency) {
    effectiveExitThreshold = Math.min(effectiveExitThreshold, 50);
  }

  // --- Determine urgency ---
  const urgency = determineUrgency(timePhase, isInProfit, totalPressure, underwaterPolicy);

  // --- Determine shouldExit ---
  // CRITICAL RULE: Never exit at a loss (trader prefers liquidation)
  // Exception: none. Even at timebox expiry, only exit if in profit.
  // Minimum profit check from strategy config
  const meetsMinProfit = position.unrealizedPnL >= exitConfig.minProfitForExit;
  const shouldExit = isInProfit && meetsMinProfit && totalPressure >= effectiveExitThreshold;

  // --- Determine primary reason ---
  let primaryReason: ExitReason = 'timebox_approaching';
  const hasKnifePressure = pressures.some(p => p.source === 'knife_detected' && p.value >= 50);
  const hasReversalPressure = pressures.some(p => p.source === 'reversal_detected' && p.value >= 60);
  if (antiGreed.active) {
    primaryReason = 'anti_greed';
  } else if (hasKnifePressure) {
    primaryReason = 'knife_detected';
  } else if (hasReversalPressure) {
    primaryReason = 'reversal_detected';
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
    explanationParts.push(`Exit recommended (pressure ${totalPressure.toFixed(0)}%, threshold ${effectiveExitThreshold}).`);
  } else if (isRecoveryMode) {
    explanationParts.push(`Recovery mode — holding underwater position. DCA or wait for recovery.`);
  } else if (isInProfit) {
    explanationParts.push(`In profit but pressure low (${totalPressure.toFixed(0)}%, need ${effectiveExitThreshold}).`);
  } else {
    explanationParts.push(`At a loss - no exit signal (trader holds to liquidation).`);
  }

  if (timePhase !== 'normal') {
    explanationParts.push(`Time: ${hoursInTrade.toFixed(1)}h / ${effectiveMaxHours}h (${timePhase}).`);
  }
  if (isInProfit) {
    explanationParts.push(`P&L: +${position.unrealizedPnL.toFixed(0)} EUR.`);
  }
  if (antiGreed.active) {
    explanationParts.push(antiGreed.detail);
  }
  if (regimeAnalysis) {
    explanationParts.push(`Regime: ${regimeAnalysis.regime.replace('_', ' ')}.`);
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
 * When isRecoveryMode is true, returns blue recovery status instead of panic signals.
 */
export function getExitStatusSummary(
  signal: ExitSignal,
  isRecoveryMode = false
): {
  label: string;
  color: 'green' | 'yellow' | 'orange' | 'red' | 'gray' | 'blue';
} {
  if (isRecoveryMode) {
    return { label: 'Recovery Mode', color: 'blue' };
  }

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

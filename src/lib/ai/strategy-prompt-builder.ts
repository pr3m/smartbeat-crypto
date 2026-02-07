/**
 * Strategy Prompt Builder
 *
 * Central module that converts the strategy JSON into prompt text for the AI.
 * All AI functionality should derive its trading knowledge from here,
 * not from hardcoded values.
 *
 * Three exports:
 * - buildStrategySystemPrompt() - full strategy section for system prompts
 * - buildTradingContextThresholds() - technical thresholds for buildContextInfo()
 * - buildStrategyContextForTools() - compact JSON for tool results
 */

import { getDefaultStrategy } from '@/lib/trading/strategies';
import type { TradingStrategy } from '@/lib/trading/v2-types';

/**
 * Generate the full strategy section for AI system prompts.
 * Replaces all hardcoded strategy descriptions with values from the JSON.
 */
export function buildStrategySystemPrompt(strategy?: TradingStrategy): string {
  const s = strategy ?? getDefaultStrategy();
  const w = s.timeframeWeights;
  const sig = s.signals;
  const ps = s.positionSizing;
  const dca = s.dca;
  const exit = s.exit;
  const tb = s.timebox;
  const ag = s.antiGreed;
  const risk = s.risk;
  const ai = s.aiInstructions;

  const sections: string[] = [];

  // Strategy identity
  sections.push(`## Trading Strategy: ${s.meta.name}
${s.meta.description}
Pair: ${s.meta.pair} | Leverage: ${ps.leverage}x | Version: ${s.meta.version}`);

  // AI personality
  if (ai?.personality) {
    sections.push(`## Communication Style
${ai.personality}`);
  }

  // Core philosophy
  if (ai?.corePhilosophy && ai.corePhilosophy.length > 0) {
    sections.push(`## Core Philosophy (NON-NEGOTIABLE)
${ai.corePhilosophy.map(r => `- ${r}`).join('\n')}`);
  }

  // Timeframe weights
  sections.push(`## Multi-Timeframe Weights
- Daily (1D): ${w['1d']}% - Macro trend filter
- 4H: ${w['4h']}% - Trend determination
- 1H: ${w['1h']}% - Setup confirmation (PRIMARY)
- 15m: ${w['15m']}% - Entry timing (PRIMARY)
- 5m: ${w['5m']}% - Spike detection`);

  // Signal evaluation
  sections.push(`## Signal Evaluation
- Action threshold: ${sig.actionThreshold} (minimum strength to trigger LONG/SHORT)
- Direction lead: ${sig.directionLeadThreshold} (minimum lead over opposite direction)
- Sit-on-hands: ${sig.sitOnHandsThreshold} (below this = no setup)

**Direction Weights**: 1D=${sig.directionWeights['1dTrend']}, 4H=${sig.directionWeights['4hTrend']}, 1H=${sig.directionWeights['1hSetup']}, 15m=${sig.directionWeights['15mEntry']}, Volume=${sig.directionWeights.volume}, BTC=${sig.directionWeights.btcAlign}, MACD=${sig.directionWeights.macdMom}, Flow=${sig.directionWeights.flow}, Candlestick=${sig.directionWeights.candlestick}

**Grading**: A(${sig.gradeThresholds.A}+), B(${sig.gradeThresholds.B}-${sig.gradeThresholds.A - 1}), C(${sig.gradeThresholds.C}-${sig.gradeThresholds.B - 1}), D(${sig.gradeThresholds.D}-${sig.gradeThresholds.C - 1}), F(<${sig.gradeThresholds.D})`);

  // Position sizing
  sections.push(`## Position Sizing
- Full entry: ${ps.fullEntryMarginPercent}% margin when confidence >= ${ps.fullEntryConfidence}%
- Cautious entry: ${ps.cautiousEntryMarginPercent}% margin when confidence ${ps.minEntryConfidence}-${ps.fullEntryConfidence - 1}%
- Below ${ps.minEntryConfidence}% confidence: NO ENTRY
- Max ${ps.maxDCACount} DCA entries at ${ps.dcaMarginPercent}% margin each
- Max total margin: ${ps.maxTotalMarginPercent}%, keep ${ps.minFreeMarginPercent}% free`);

  // Risk rules
  sections.push(`## Risk Management
- Stop losses: ${risk.useStopLoss ? 'YES' : 'NONE - the 48h timebox IS the risk management'}
- Fixed take-profit: ${risk.useFixedTP ? 'YES' : 'NONE - exits are condition-based'}
- Accept liquidation: ${risk.acceptLiquidation ? 'YES - by design with ' + ps.leverage + 'x leverage' : 'NO'}
- Strategy NEVER exits at a loss - hold or get liquidated`);

  // DCA rules
  if (ai?.dcaGuidance) {
    sections.push(`## DCA Rules (Momentum Exhaustion)
${ai.dcaGuidance}

**Thresholds**: Min drawdown ${dca.minDrawdownForDCA}%, Min exhaustion confidence ${dca.minExhaustionConfidence}%, Min time between DCAs: ${dca.minTimeBetweenDCAs / 3600000}h (level-dependent)`);
  } else {
    sections.push(`## DCA Rules
- Trigger: Momentum exhaustion signals (NOT fixed % drops)
- Min drawdown: ${dca.minDrawdownForDCA}%
- Min exhaustion confidence: ${dca.minExhaustionConfidence}%
- 5 exhaustion signals: RSI divergence, Volume dry-up, MACD contraction, BB middle return, Price stabilization
- Need 3+ signals active for DCA trigger`);
  }

  // Exit rules
  if (ai?.exitGuidance) {
    sections.push(`## Exit Rules (Pressure-Based)
${ai.exitGuidance}`);
  } else {
    sections.push(`## Exit Rules
- Exit pressure threshold: ${exit.exitPressureThreshold}/100
- Min condition flips for deterioration: ${exit.minConditionFlips}
- Partial exits: ${exit.allowPartialExits ? 'allowed' : 'not allowed'}
- Min profit for exit: €${exit.minProfitForExit}`);
  }

  // Timebox
  const stepsDesc = tb.steps.map(step =>
    `  - ${step.hours}h: ${step.pressure}% pressure — ${step.label}`
  ).join('\n');
  sections.push(`## 48h Timebox
Max position duration: ${tb.maxHours}h with ${tb.pressureCurve} escalation.
${stepsDesc}`);

  // Anti-greed
  if (ag.enabled) {
    sections.push(`## Anti-Greed Protection
- Triggers when P&L drops ${ag.drawdownThresholdPercent}% from high water mark
- Min P&L to activate: €${ag.minPnLToActivate}
- Min HWM to track: €${ag.minHWMToTrack}`);
  }

  // Response rules
  if (ai?.responseRules && ai.responseRules.length > 0) {
    sections.push(`## AI Response Rules
${ai.responseRules.map(r => `- ${r}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Generate the technical thresholds section for buildContextInfo().
 * Replaces hardcoded RSI zones, volume thresholds, etc.
 */
export function buildTradingContextThresholds(strategy?: TradingStrategy): string {
  const s = strategy ?? getDefaultStrategy();
  const spike = s.spike;
  const sig = s.signals;

  return `**Key Technical Thresholds (from strategy config):**
- RSI Oversold: <${spike.oversoldRSI} (spike alert zone)
- RSI Overbought: >${spike.overboughtRSI} (spike alert zone)
- Volume spike: >${spike.volumeRatioThreshold}x average
- Action threshold: ${sig.actionThreshold}% (minimum for LONG/SHORT signal)
- Direction lead: ${sig.directionLeadThreshold}+ over opposite direction
- NEVER suggest stop losses or fixed take-profit levels
- NEVER suggest exiting at a loss - strategy accepts liquidation
- For DCA questions, call \`get_v2_engine_state\` to check momentum exhaustion signals
- For exit questions, call \`get_v2_engine_state\` to check exit pressure`;
}

/**
 * Returns a compact JSON object with key strategy parameters.
 * Included in tool results so the AI has the rules when interpreting data.
 */
export function buildStrategyContextForTools(strategy?: TradingStrategy): Record<string, unknown> {
  const s = strategy ?? getDefaultStrategy();

  return {
    strategyName: s.meta.name,
    timeframeWeights: s.timeframeWeights,
    actionThreshold: s.signals.actionThreshold,
    grades: s.signals.gradeThresholds,
    leverage: s.positionSizing.leverage,
    risk: {
      stopLoss: s.risk.useStopLoss,
      fixedTP: s.risk.useFixedTP,
      acceptLiquidation: s.risk.acceptLiquidation,
    },
    dca: {
      maxCount: s.positionSizing.maxDCACount,
      minDrawdown: s.dca.minDrawdownForDCA,
      method: 'momentum_exhaustion',
      minConfidence: s.dca.minExhaustionConfidence,
    },
    exit: {
      pressureThreshold: s.exit.exitPressureThreshold,
      method: 'condition_based',
      neverExitAtLoss: true,
    },
    timebox: {
      maxHours: s.timebox.maxHours,
      escalationStart: s.timebox.escalationStartHours,
    },
    antiGreed: {
      enabled: s.antiGreed.enabled,
      drawdownThreshold: s.antiGreed.drawdownThresholdPercent,
    },
  };
}

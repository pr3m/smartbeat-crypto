/**
 * Arena Agent Archetypes
 *
 * 6 fundamentally different trading personalities, each using a different
 * subset of indicators with unique strategy mutations, commentary styles,
 * and regime preferences.
 */

import type { AgentArchetype, GeneratedAgentConfig } from './types';
import type { TradingStrategy } from '@/lib/trading/v2-types';
import type { DeepPartial } from './types';
import { deepMerge } from './types';
import { DEFAULT_STRATEGY } from '@/lib/trading/v2-types';
import { getPersonality, getAllArchetypeCommentary } from './prompt-loader';

// ============================================================================
// ARCHETYPE DEFINITIONS
// ============================================================================

const scalper: AgentArchetype = {
  id: 'scalper',
  name: 'The Knife',
  personality: getPersonality('scalper'),
  avatarShape: 'hexagon',
  colorIndex: 0,
  marginPercentRange: [5, 8],
  maxTimeboxHours: 1,
  maxDCACount: 0,
  primaryIndicators: ['RSI_5m', 'Volume_5m', 'RSI_15m', 'BB_5m'],
  regimePreferences: {
    trending: -0.2,
    ranging: 0.8,
    volatile: 0.9,
  },
  strategyMutations: {
    timeframeWeights: {
      '1d': 0,
      '4h': 5,
      '1h': 15,
      '15m': 30,
      '5m': 50,
    },
    positionSizing: {
      fullEntryMarginPercent: 8,
      cautiousEntryMarginPercent: 5,
      minEntryConfidence: 70,
      fullEntryConfidence: 85,
      maxDCACount: 0,
      dcaMarginPercent: 0,
      maxTotalMarginPercent: 10,
      minFreeMarginPercent: 90,
    },
    timebox: {
      maxHours: 1,
      escalationStartHours: 0.5,
      pressureCurve: 'exponential' as const,
    },
    spike: {
      volumeRatioThreshold: 1.8,
      oversoldRSI: 25,
      overboughtRSI: 75,
    },
    signals: {
      actionThreshold: 55,
      directionLeadThreshold: 10,
      directionWeights: {
        '1dTrend': 0,
        '4hTrend': 5,
        '1hSetup': 10,
        '15mEntry': 30,
        volume: 25,
        btcAlign: 5,
        macdMom: 10,
        flow: 5,
        liq: 5,
        candlestick: 5,
      },
    },
    risk: {
      useStopLoss: false,
      useFixedTP: false,
      acceptLiquidation: true,
    },
  } as DeepPartial<TradingStrategy>,
};

const momentum: AgentArchetype = {
  id: 'momentum',
  name: 'The Surfer',
  personality: getPersonality('momentum'),
  avatarShape: 'diamond',
  colorIndex: 1,
  marginPercentRange: [10, 15],
  maxTimeboxHours: 6,
  maxDCACount: 1,
  primaryIndicators: ['MACD_15m', 'Volume_15m', 'RSI_15m', 'MACD_1h', 'EMA_15m'],
  regimePreferences: {
    trending: 0.7,
    ranging: -0.5,
    volatile: 0.4,
  },
  strategyMutations: {
    timeframeWeights: {
      '1d': 0,
      '4h': 10,
      '1h': 25,
      '15m': 45,
      '5m': 20,
    },
    positionSizing: {
      fullEntryMarginPercent: 15,
      cautiousEntryMarginPercent: 10,
      minEntryConfidence: 65,
      fullEntryConfidence: 80,
      maxDCACount: 1,
      dcaMarginPercent: 10,
      maxTotalMarginPercent: 30,
      minFreeMarginPercent: 70,
    },
    timebox: {
      maxHours: 6,
      escalationStartHours: 4,
      pressureCurve: 'linear' as const,
    },
    spike: {
      volumeRatioThreshold: 2.0,
      oversoldRSI: 30,
      overboughtRSI: 70,
    },
    signals: {
      actionThreshold: 50,
      directionLeadThreshold: 12,
      directionWeights: {
        '1dTrend': 0,
        '4hTrend': 10,
        '1hSetup': 20,
        '15mEntry': 25,
        volume: 20,
        btcAlign: 5,
        macdMom: 15,
        flow: 0,
        liq: 0,
        candlestick: 5,
      },
    },
    risk: {
      useStopLoss: false,
      useFixedTP: false,
      acceptLiquidation: true,
    },
  } as DeepPartial<TradingStrategy>,
};

const meanReversion: AgentArchetype = {
  id: 'mean_reversion',
  name: 'The Professor',
  personality: getPersonality('mean_reversion'),
  avatarShape: 'circle',
  colorIndex: 2,
  marginPercentRange: [8, 12],
  maxTimeboxHours: 12,
  maxDCACount: 2,
  primaryIndicators: ['BB_1h', 'EMA_1h', 'RSI_1h', 'BB_15m', 'ATR_1h'],
  regimePreferences: {
    trending: -0.6,
    ranging: 0.9,
    volatile: 0.3,
  },
  strategyMutations: {
    timeframeWeights: {
      '1d': 5,
      '4h': 15,
      '1h': 40,
      '15m': 25,
      '5m': 15,
    },
    positionSizing: {
      fullEntryMarginPercent: 12,
      cautiousEntryMarginPercent: 8,
      minEntryConfidence: 60,
      fullEntryConfidence: 75,
      maxDCACount: 2,
      dcaMarginPercent: 10,
      maxTotalMarginPercent: 40,
      minFreeMarginPercent: 60,
    },
    timebox: {
      maxHours: 12,
      escalationStartHours: 8,
      pressureCurve: 'step' as const,
    },
    spike: {
      volumeRatioThreshold: 2.5,
      oversoldRSI: 22,
      overboughtRSI: 78,
    },
    signals: {
      actionThreshold: 45,
      directionLeadThreshold: 8,
      directionWeights: {
        '1dTrend': 5,
        '4hTrend': 10,
        '1hSetup': 25,
        '15mEntry': 15,
        volume: 10,
        btcAlign: 5,
        macdMom: 10,
        flow: 5,
        liq: 5,
        candlestick: 10,
      },
    },
    risk: {
      useStopLoss: false,
      useFixedTP: false,
      acceptLiquidation: true,
    },
  } as DeepPartial<TradingStrategy>,
};

const trendFollower: AgentArchetype = {
  id: 'trend_follower',
  name: 'The General',
  personality: getPersonality('trend_follower'),
  avatarShape: 'triangle',
  colorIndex: 3,
  marginPercentRange: [15, 20],
  maxTimeboxHours: 16,
  maxDCACount: 3,
  primaryIndicators: ['EMA_4h', 'EMA_1h', 'MACD_4h', 'RSI_4h', 'Volume_1h'],
  regimePreferences: {
    trending: 1.0,
    ranging: -0.8,
    volatile: 0.1,
  },
  strategyMutations: {
    timeframeWeights: {
      '1d': 15,
      '4h': 40,
      '1h': 25,
      '15m': 15,
      '5m': 5,
    },
    positionSizing: {
      fullEntryMarginPercent: 20,
      cautiousEntryMarginPercent: 15,
      minEntryConfidence: 70,
      fullEntryConfidence: 85,
      maxDCACount: 3,
      dcaMarginPercent: 15,
      maxTotalMarginPercent: 70,
      minFreeMarginPercent: 30,
    },
    timebox: {
      maxHours: 16,
      escalationStartHours: 12,
      pressureCurve: 'linear' as const,
    },
    spike: {
      volumeRatioThreshold: 2.2,
      oversoldRSI: 28,
      overboughtRSI: 72,
    },
    signals: {
      actionThreshold: 55,
      directionLeadThreshold: 15,
      directionWeights: {
        '1dTrend': 15,
        '4hTrend': 25,
        '1hSetup': 20,
        '15mEntry': 10,
        volume: 10,
        btcAlign: 10,
        macdMom: 5,
        flow: 0,
        liq: 0,
        candlestick: 5,
      },
    },
    risk: {
      useStopLoss: false,
      useFixedTP: false,
      acceptLiquidation: true,
    },
  } as DeepPartial<TradingStrategy>,
};

const breakout: AgentArchetype = {
  id: 'breakout',
  name: 'The Sniper',
  personality: getPersonality('breakout'),
  avatarShape: 'square',
  colorIndex: 4,
  marginPercentRange: [12, 18],
  maxTimeboxHours: 4,
  maxDCACount: 0,
  primaryIndicators: ['BB_15m', 'Volume_15m', 'ATR_15m', 'BB_1h', 'Volume_5m'],
  regimePreferences: {
    trending: 0.3,
    ranging: 0.2,
    volatile: 1.0,
  },
  strategyMutations: {
    timeframeWeights: {
      '1d': 0,
      '4h': 10,
      '1h': 20,
      '15m': 45,
      '5m': 25,
    },
    positionSizing: {
      fullEntryMarginPercent: 18,
      cautiousEntryMarginPercent: 12,
      minEntryConfidence: 75,
      fullEntryConfidence: 88,
      maxDCACount: 0,
      dcaMarginPercent: 0,
      maxTotalMarginPercent: 20,
      minFreeMarginPercent: 80,
    },
    timebox: {
      maxHours: 4,
      escalationStartHours: 2.5,
      pressureCurve: 'exponential' as const,
    },
    spike: {
      volumeRatioThreshold: 2.5,
      oversoldRSI: 20,
      overboughtRSI: 80,
    },
    signals: {
      actionThreshold: 60,
      directionLeadThreshold: 18,
      directionWeights: {
        '1dTrend': 0,
        '4hTrend': 5,
        '1hSetup': 15,
        '15mEntry': 30,
        volume: 25,
        btcAlign: 5,
        macdMom: 5,
        flow: 5,
        liq: 5,
        candlestick: 5,
      },
    },
    risk: {
      useStopLoss: false,
      useFixedTP: false,
      acceptLiquidation: true,
    },
  } as DeepPartial<TradingStrategy>,
};

const contrarian: AgentArchetype = {
  id: 'contrarian',
  name: 'The Rebel',
  personality: getPersonality('contrarian'),
  avatarShape: 'pentagon',
  colorIndex: 5,
  marginPercentRange: [5, 10],
  maxTimeboxHours: 8,
  maxDCACount: 1,
  primaryIndicators: ['RSI_1h', 'BTC_correlation', 'Volume_1h', 'MACD_1h', 'BB_1h'],
  regimePreferences: {
    trending: -0.9,
    ranging: 0.4,
    volatile: 0.6,
  },
  strategyMutations: {
    timeframeWeights: {
      '1d': 10,
      '4h': 20,
      '1h': 35,
      '15m': 25,
      '5m': 10,
    },
    positionSizing: {
      fullEntryMarginPercent: 10,
      cautiousEntryMarginPercent: 5,
      minEntryConfidence: 60,
      fullEntryConfidence: 78,
      maxDCACount: 1,
      dcaMarginPercent: 8,
      maxTotalMarginPercent: 20,
      minFreeMarginPercent: 80,
    },
    timebox: {
      maxHours: 8,
      escalationStartHours: 5,
      pressureCurve: 'linear' as const,
    },
    spike: {
      volumeRatioThreshold: 2.0,
      oversoldRSI: 25,
      overboughtRSI: 75,
    },
    signals: {
      actionThreshold: 40,
      directionLeadThreshold: 5,
      directionWeights: {
        '1dTrend': 10,
        '4hTrend': 15,
        '1hSetup': 20,
        '15mEntry': 15,
        volume: 10,
        btcAlign: 15,
        macdMom: 10,
        flow: 0,
        liq: 0,
        candlestick: 5,
      },
    },
    risk: {
      useStopLoss: false,
      useFixedTP: false,
      acceptLiquidation: true,
    },
  } as DeepPartial<TradingStrategy>,
};

// ============================================================================
// EXPORTS
// ============================================================================

export const AGENT_ARCHETYPES: AgentArchetype[] = [
  scalper,
  momentum,
  meanReversion,
  trendFollower,
  breakout,
  contrarian,
];

/**
 * Select `count` random archetypes without replacement.
 * If count >= available archetypes, returns all of them shuffled.
 */
export function getRandomArchetypes(count: number): AgentArchetype[] {
  const shuffled = [...AGENT_ARCHETYPES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Get an archetype by its ID.
 */
export function getArchetypeById(id: string): AgentArchetype | undefined {
  return AGENT_ARCHETYPES.find((a) => a.id === id);
}

// ============================================================================
// COMMENTARY TEMPLATES (loaded from prompts.yaml)
// ============================================================================

export interface ArchetypeCommentaryMap {
  on_entry: string[];
  on_exit_profit: string[];
  on_exit_loss: string[];
  on_death: string[];
  on_rival_death: string[];
}

export const ARCHETYPE_COMMENTARY: Record<string, ArchetypeCommentaryMap> =
  getAllArchetypeCommentary() as unknown as Record<string, ArchetypeCommentaryMap>;

// ============================================================================
// ARCHETYPE → GENERATED CONFIG CONVERTER
// ============================================================================

/**
 * Convert a legacy AgentArchetype to a GeneratedAgentConfig by deep-merging
 * the archetype's strategyMutations onto DEFAULT_STRATEGY and mapping fields.
 */
export function archetypeToGeneratedConfig(
  arch: AgentArchetype,
  index: number,
): GeneratedAgentConfig {
  // Deep-merge archetype mutations onto the default strategy
  const strategy = deepMerge(
    DEFAULT_STRATEGY as unknown as Record<string, unknown>,
    arch.strategyMutations as DeepPartial<Record<string, unknown>>,
  ) as unknown as TradingStrategy;

  // Derive a one-liner trading philosophy from the first sentence of personality
  const firstSentence = arch.personality.split(/[.!?]/)[0]?.trim() || arch.personality;
  const tradingPhilosophy = firstSentence;

  return {
    name: arch.name,
    personality: arch.personality,
    avatarShape: arch.avatarShape,
    colorIndex: arch.colorIndex,
    archetypeId: arch.id,
    strategy,
    commentaryTemplates: ARCHETYPE_COMMENTARY[arch.id] || {},
    tradingPhilosophy,
    marketRegimePreference: arch.regimePreferences,
    primaryIndicators: arch.primaryIndicators,
  };
}

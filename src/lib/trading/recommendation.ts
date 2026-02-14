/**
 * Trading Recommendation Engine
 * Multi-timeframe analysis and signal generation
 * Migrated from xrp-dashboard-v9-mtf.html
 */

import type {
  Indicators,
  TradingRecommendation,
  DirectionRecommendation,
  TimeframeData,
  ChecklistItem,
  MicrostructureInput,
  LiquidationInput,
  OHLCData,
} from '@/lib/kraken/types';
import type {
  TradingStrategy,
  SignalEvaluationConfig,
  SpikeDetectionConfig,
  LiquidationStrategyConfig,
} from './v2-types';
import { DEFAULT_STRATEGY } from './v2-types';
import { detectKnife, KNIFE_GATING_ENABLED, type KnifeAnalysis } from './knife-detection';
import { detectReversal, type ReversalSignal, NO_REVERSAL } from './reversal-detector';
import { detectMarketRegime, type MarketRegimeAnalysis } from './market-regime';
import { analyzeTimeframe, buildChartContext, findSwingPoints, type TrendStructure, type PriceLevel } from './chart-context';
import { getTradingSession } from './session';
import type { KeyLevelConfig, SessionFilterConfig, SpreadGuardConfig, DerivativesConfig, RejectionConfig } from './v2-types';

export interface TimeframeWeights {
  '1d': number;
  '4h': number;
  '1h': number;
  '15m': number;
  '5m': number;
}

export const DEFAULT_WEIGHTS: TimeframeWeights = {
  '1d': 5,   // Advisory macro context (not a veto)
  '4h': 10,  // Trend context
  '1h': 30,  // Setup confirmation
  '15m': 42, // Primary decision maker
  '5m': 13,  // Volume spikes + candlestick patterns
};

export interface LongChecks {
  trend1d?: boolean; // Daily trend filter (NEW)
  trend4h: boolean;
  setup1h: boolean;
  entry15m: boolean;
  volume: boolean;
  btcAlign: boolean;
  macdMomentum: boolean; // MACD histogram > 0 (replaces rsiExtreme)
  flowConfirm?: boolean; // Option B: Flow confirmation
  liqBias?: boolean; // Liquidation bias alignment
}

export interface ShortChecks {
  trend1d?: boolean; // Daily trend filter (NEW)
  trend4h: boolean;
  setup1h: boolean;
  entry15m: boolean;
  volume: boolean;
  btcAlign: boolean;
  macdMomentum: boolean; // MACD histogram < 0 (replaces rsiExtreme)
  flowConfirm?: boolean; // Option B: Flow confirmation
  liqBias?: boolean; // Liquidation bias alignment
}

/**
 * Analyze CVD trend from history
 */
export function analyzeCVDTrend(
  cvdHistory: Array<{ time: number; value: number; price: number }>
): { trend: 'rising' | 'falling' | 'neutral'; momentum: number } {
  if (cvdHistory.length < 10) {
    return { trend: 'neutral', momentum: 0 };
  }

  const recent = cvdHistory.slice(-20);
  const firstHalf = recent.slice(0, 10);
  const secondHalf = recent.slice(-10);

  const firstAvg = firstHalf.reduce((s, c) => s + c.value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, c) => s + c.value, 0) / secondHalf.length;

  const change = secondAvg - firstAvg;
  const momentum = Math.abs(change) / (Math.abs(firstAvg) || 1);

  if (change > 500) return { trend: 'rising', momentum };
  if (change < -500) return { trend: 'falling', momentum };
  return { trend: 'neutral', momentum };
}

/**
 * Detect CVD divergence with price
 */
export function detectCVDDivergence(
  cvdHistory: Array<{ time: number; value: number; price: number }>
): { hasDivergence: boolean; type?: 'bullish' | 'bearish' } {
  if (cvdHistory.length < 20) {
    return { hasDivergence: false };
  }

  const recent = cvdHistory.slice(-20);
  const firstPrice = recent[0].price;
  const lastPrice = recent[recent.length - 1].price;
  const firstCVD = recent[0].value;
  const lastCVD = recent[recent.length - 1].value;

  const priceChange = (lastPrice - firstPrice) / firstPrice;
  const cvdChange = lastCVD - firstCVD;

  // Bullish divergence: price down, CVD up (accumulation)
  if (priceChange < -0.005 && cvdChange > 1000) {
    return { hasDivergence: true, type: 'bullish' };
  }

  // Bearish divergence: price up, CVD down (distribution)
  if (priceChange > 0.005 && cvdChange < -1000) {
    return { hasDivergence: true, type: 'bearish' };
  }

  return { hasDivergence: false };
}

/**
 * Analyze microstructure flow for a direction
 */
export function analyzeFlow(
  direction: 'long' | 'short',
  micro: MicrostructureInput | null
): {
  status: 'aligned' | 'neutral' | 'opposing';
  imbalance: number;
  cvdTrend: 'rising' | 'falling' | 'neutral';
  hasDivergence: boolean;
  divergenceType?: 'bullish' | 'bearish';
  spreadStatus: 'normal' | 'wide';
  whaleActivity: 'buying' | 'selling' | 'none';
  flowConfirmPass: boolean;
  adjustments: {
    flowAligned: number;
    whaleActivity: number;
    divergence: number;
    spreadWide: number;
    flowOpposing: number;
    total: number;
  };
} {
  // Default values when no microstructure data
  if (!micro) {
    return {
      status: 'neutral',
      imbalance: 0,
      cvdTrend: 'neutral',
      hasDivergence: false,
      spreadStatus: 'normal',
      whaleActivity: 'none',
      flowConfirmPass: true, // Pass by default when no data
      adjustments: {
        flowAligned: 0,
        whaleActivity: 0,
        divergence: 0,
        spreadWide: 0,
        flowOpposing: 0,
        total: 0,
      },
    };
  }

  const { trend: cvdTrend, momentum } = analyzeCVDTrend(micro.cvdHistory);
  const { hasDivergence, type: divergenceType } = detectCVDDivergence(micro.cvdHistory);

  // Determine spread status
  const spreadStatus: 'normal' | 'wide' =
    micro.avgSpreadPercent > 0 && micro.spreadPercent > micro.avgSpreadPercent * 1.5
      ? 'wide'
      : 'normal';

  // Determine whale activity
  let whaleActivity: 'buying' | 'selling' | 'none' = 'none';
  if (micro.recentLargeBuys > micro.recentLargeSells + 2) {
    whaleActivity = 'buying';
  } else if (micro.recentLargeSells > micro.recentLargeBuys + 2) {
    whaleActivity = 'selling';
  }

  // Calculate if flow supports the direction
  const imbalanceSupports =
    direction === 'long' ? micro.imbalance > 0.2 : micro.imbalance < -0.2;
  const cvdSupports =
    direction === 'long' ? cvdTrend === 'rising' : cvdTrend === 'falling';
  const imbalanceOpposes =
    direction === 'long' ? micro.imbalance < -0.3 : micro.imbalance > 0.3;
  const cvdOpposes =
    direction === 'long' ? cvdTrend === 'falling' : cvdTrend === 'rising';

  // Determine overall status
  let status: 'aligned' | 'neutral' | 'opposing' = 'neutral';
  if (imbalanceSupports || cvdSupports) {
    status = 'aligned';
  }
  if (imbalanceOpposes && cvdOpposes) {
    status = 'opposing';
  }

  // Option B: Flow confirm passes if imbalance OR CVD supports direction
  const flowConfirmPass = imbalanceSupports || cvdSupports || (!imbalanceOpposes && !cvdOpposes);

  // Calculate confidence adjustments (Option A)
  const adjustments = {
    flowAligned: status === 'aligned' ? 15 : 0,
    whaleActivity:
      (direction === 'long' && whaleActivity === 'buying') ||
      (direction === 'short' && whaleActivity === 'selling')
        ? 5
        : 0,
    divergence:
      hasDivergence &&
      ((direction === 'long' && divergenceType === 'bearish') ||
        (direction === 'short' && divergenceType === 'bullish'))
        ? -20
        : 0,
    spreadWide: spreadStatus === 'wide' ? -10 : 0,
    flowOpposing: status === 'opposing' ? -15 : 0,
    total: 0,
  };
  adjustments.total =
    adjustments.flowAligned +
    adjustments.whaleActivity +
    adjustments.divergence +
    adjustments.spreadWide +
    adjustments.flowOpposing;

  return {
    status,
    imbalance: micro.imbalance,
    cvdTrend,
    hasDivergence,
    divergenceType,
    spreadStatus,
    whaleActivity,
    flowConfirmPass,
    adjustments,
  };
}

/**
 * Zone-aware liquidation analysis result
 */
export interface LiquidationAnalysisResult {
  aligned: boolean;
  bias: 'long_squeeze' | 'short_squeeze' | 'neutral';
  biasStrength: number;
  fundingRate: number | null;
  nearestTarget: number | null;
  magnetEffect: 'aligned' | 'opposing' | 'none';
  wallEffect: 'supporting' | 'blocking' | 'none';
  asymmetry: 'strong_aligned' | 'mild_aligned' | 'neutral' | 'opposing';
  description: string;
  adjustments: {
    magnetEffect: number;
    wallEffect: number;
    asymmetry: number;
    fundingConfirm: number;
    proximityBonus: number;
    total: number;
  };
}

/** Default scoring when no strategy config provided */
const DEFAULT_LIQ_SCORING = {
  magnetAligned: 15, magnetOpposing: -10,
  wallSupport: 8, wallBlock: -8,
  asymmetryAligned: 10, asymmetryOpposing: -5,
  fundingConfirm: 5, proximityBonus: 5,
};
const DEFAULT_STRONG_ASYMMETRY = 1.5;

/**
 * Analyze liquidation data for a direction with zone awareness
 */
export function analyzeLiquidation(
  direction: 'long' | 'short',
  liq: LiquidationInput | null,
  liqConfig?: LiquidationStrategyConfig
): LiquidationAnalysisResult {
  if (!liq) {
    return {
      aligned: true,
      bias: 'neutral',
      biasStrength: 0,
      fundingRate: null,
      nearestTarget: null,
      magnetEffect: 'none',
      wallEffect: 'none',
      asymmetry: 'neutral',
      description: 'No data',
      adjustments: { magnetEffect: 0, wallEffect: 0, asymmetry: 0, fundingConfirm: 0, proximityBonus: 0, total: 0 },
    };
  }

  const scoring = liqConfig?.scoring ?? DEFAULT_LIQ_SCORING;
  const strongAsymThreshold = liqConfig?.strongAsymmetryThreshold ?? DEFAULT_STRONG_ASYMMETRY;

  // Basic alignment (unchanged logic)
  const aligned =
    (direction === 'long' && liq.bias === 'short_squeeze') ||
    (direction === 'short' && liq.bias === 'long_squeeze') ||
    liq.bias === 'neutral';

  const nearestTarget = direction === 'long' ? liq.nearestUpside : liq.nearestDownside;

  // --- Magnet effect ---
  // LONG: upside magnet = aligned (cluster pulls price up), downside magnet = opposing
  // SHORT: downside magnet = aligned, upside magnet = opposing
  let magnetEffect: 'aligned' | 'opposing' | 'none' = 'none';
  if (direction === 'long') {
    if (liq.upsideMagnet) magnetEffect = 'aligned';
    else if (liq.downsideMagnet) magnetEffect = 'opposing';
  } else {
    if (liq.downsideMagnet) magnetEffect = 'aligned';
    else if (liq.upsideMagnet) magnetEffect = 'opposing';
  }

  // --- Wall effect ---
  // LONG: upside wall = supporting (cascade fuel in direction), downside wall = blocking
  // SHORT: downside wall = supporting, upside wall = blocking
  let wallEffect: 'supporting' | 'blocking' | 'none' = 'none';
  if (direction === 'long') {
    if (liq.upsideWall) wallEffect = 'supporting';
    else if (liq.downsideWall) wallEffect = 'blocking';
  } else {
    if (liq.downsideWall) wallEffect = 'supporting';
    else if (liq.upsideWall) wallEffect = 'blocking';
  }

  // --- Asymmetry ---
  // For LONG: asymmetryRatio > 1 means more upside fuel = aligned
  // For SHORT: asymmetryRatio < 1 means more downside fuel = aligned
  let asymmetry: 'strong_aligned' | 'mild_aligned' | 'neutral' | 'opposing' = 'neutral';
  if (direction === 'long') {
    if (liq.asymmetryRatio >= strongAsymThreshold) asymmetry = 'strong_aligned';
    else if (liq.asymmetryRatio > 1.1) asymmetry = 'mild_aligned';
    else if (liq.asymmetryRatio < 1 / strongAsymThreshold) asymmetry = 'opposing';
  } else {
    if (liq.asymmetryRatio <= 1 / strongAsymThreshold) asymmetry = 'strong_aligned';
    else if (liq.asymmetryRatio < 0.9) asymmetry = 'mild_aligned';
    else if (liq.asymmetryRatio > strongAsymThreshold) asymmetry = 'opposing';
  }

  // --- Adjustments ---
  const magnetAdj = magnetEffect === 'aligned' ? scoring.magnetAligned
    : magnetEffect === 'opposing' ? scoring.magnetOpposing : 0;

  const wallAdj = wallEffect === 'supporting' ? scoring.wallSupport
    : wallEffect === 'blocking' ? scoring.wallBlock : 0;

  const asymAdj = asymmetry === 'strong_aligned' ? scoring.asymmetryAligned
    : asymmetry === 'mild_aligned' ? Math.round(scoring.asymmetryAligned * 0.5)
    : asymmetry === 'opposing' ? scoring.asymmetryOpposing : 0;

  // Funding rate confirms direction
  const fundingAdj =
    liq.fundingRate !== null
      ? (direction === 'long' && liq.fundingRate < -0.0001) ||
        (direction === 'short' && liq.fundingRate > 0.0001)
        ? scoring.fundingConfirm
        : 0
      : 0;

  // Proximity bonus: nearest cluster in direction is close
  const nearDistPct = direction === 'long' ? liq.nearestUpsideDistPct : liq.nearestDownsideDistPct;
  const proximityAdj = nearDistPct !== null && nearDistPct <= 2.0 ? scoring.proximityBonus : 0;

  const total = magnetAdj + wallAdj + asymAdj + fundingAdj + proximityAdj;

  // --- Description string ---
  const parts: string[] = [];

  if (magnetEffect === 'aligned') {
    parts.push(`Magnet ${direction === 'long' ? '↑' : '↓'}`);
  } else if (magnetEffect === 'opposing') {
    parts.push(`Magnet ${direction === 'long' ? '↓' : '↑'} \u26A0`);
  }

  if (wallEffect === 'supporting') {
    parts.push('Wall+fuel');
  } else if (wallEffect === 'blocking') {
    parts.push('Wall blocks \u26A0');
  }

  if (asymmetry === 'strong_aligned' || asymmetry === 'mild_aligned') {
    parts.push('Fuel lopsided');
  } else if (asymmetry === 'opposing') {
    parts.push('Fuel against');
  } else {
    parts.push('Balanced');
  }

  // Distance info
  if (nearDistPct !== null) {
    parts.push(`${nearDistPct.toFixed(1)}% away`);
  }

  // Funding rate
  if (liq.fundingRate !== null) {
    parts.push(`FR ${(liq.fundingRate * 100).toFixed(3)}%`);
  }

  const description = parts.join(' | ') || 'No data';

  return {
    aligned,
    bias: liq.bias,
    biasStrength: liq.biasStrength,
    fundingRate: liq.fundingRate,
    nearestTarget,
    magnetEffect,
    wallEffect,
    asymmetry,
    description,
    adjustments: {
      magnetEffect: magnetAdj,
      wallEffect: wallAdj,
      asymmetry: asymAdj,
      fundingConfirm: fundingAdj,
      proximityBonus: proximityAdj,
      total,
    },
  };
}

/**
 * Evaluate 1H setup conditions for LONG
 * Professional setup confirmation looks for:
 * 1. Trend alignment (EMA-based)
 * 2. Pullback quality (price near EMA support)
 * 3. Momentum alignment (MACD)
 * 4. Structure (higher lows forming)
 */
export function evaluate1hLongSetup(ind1h: Indicators): {
  pass: boolean;
  score: number;
  quality: 'strong' | 'moderate' | 'weak';
  signals: string[];
} {
  let score = 0;
  const signals: string[] = [];

  // 1. Trend direction (most important - uses EMA structure)
  if (ind1h.trend === 'bullish') {
    score += 3;
    signals.push('1H trend bullish');
  } else if (ind1h.trend === 'neutral') {
    score += 1;
    signals.push('1H trend neutral');
  }
  // Bearish trend = 0 points

  // 2. EMA alignment bonus
  if (ind1h.emaAlignment === 'bullish') {
    score += 2;
    signals.push('EMA stack bullish');
  } else if (ind1h.emaAlignment === 'mixed' && ind1h.priceVsEma20 > 0) {
    score += 1;
    signals.push('Price > EMA20');
  }

  // 3. Pullback to EMA support (ideal entry is near EMA, not extended)
  // Best: Price 0-2% above EMA20 (healthy pullback)
  // Good: Price 2-4% above (slightly extended)
  // Bad: Price >4% above (overextended) or below EMA
  if (ind1h.priceVsEma20 >= 0 && ind1h.priceVsEma20 <= 2) {
    score += 2;
    signals.push(`Pullback to EMA (${ind1h.priceVsEma20.toFixed(1)}%)`);
  } else if (ind1h.priceVsEma20 > 2 && ind1h.priceVsEma20 <= 4) {
    score += 1;
    signals.push('Slightly extended');
  } else if (ind1h.priceVsEma20 < 0 && ind1h.priceVsEma20 > -2) {
    score += 1; // Reclaiming EMA - potential
    signals.push('Reclaiming EMA');
  }

  // 4. MACD momentum - want positive or turning positive
  const hist = ind1h.histogram ?? 0;
  if (hist > 0 && ind1h.macd > 0) {
    score += 2;
    signals.push('MACD bullish');
  } else if (hist > 0 || ind1h.macd > 0) {
    score += 1;
    signals.push('MACD turning');
  }

  // 5. EMA slope - want rising EMAs
  if (ind1h.ema20Slope > 0.05) {
    score += 1;
    signals.push('EMA rising');
  }

  // Determine quality
  const quality: 'strong' | 'moderate' | 'weak' =
    score >= 8 ? 'strong' :
    score >= 5 ? 'moderate' : 'weak';

  return {
    pass: score >= 4, // Need at least moderate setup
    score,
    quality,
    signals,
  };
}

/**
 * Evaluate 1H setup conditions for SHORT
 */
export function evaluate1hShortSetup(ind1h: Indicators): {
  pass: boolean;
  score: number;
  quality: 'strong' | 'moderate' | 'weak';
  signals: string[];
} {
  let score = 0;
  const signals: string[] = [];

  // 1. Trend direction
  if (ind1h.trend === 'bearish') {
    score += 3;
    signals.push('1H trend bearish');
  } else if (ind1h.trend === 'neutral') {
    score += 1;
    signals.push('1H trend neutral');
  }

  // 2. EMA alignment
  if (ind1h.emaAlignment === 'bearish') {
    score += 2;
    signals.push('EMA stack bearish');
  } else if (ind1h.emaAlignment === 'mixed' && ind1h.priceVsEma20 < 0) {
    score += 1;
    signals.push('Price < EMA20');
  }

  // 3. Pullback to EMA resistance (ideal: price 0-2% below EMA20)
  if (ind1h.priceVsEma20 <= 0 && ind1h.priceVsEma20 >= -2) {
    score += 2;
    signals.push(`Pullback to EMA (${ind1h.priceVsEma20.toFixed(1)}%)`);
  } else if (ind1h.priceVsEma20 < -2 && ind1h.priceVsEma20 >= -4) {
    score += 1;
    signals.push('Slightly extended');
  } else if (ind1h.priceVsEma20 > 0 && ind1h.priceVsEma20 < 2) {
    score += 1;
    signals.push('Testing EMA resistance');
  }

  // 4. MACD momentum - want negative
  const hist = ind1h.histogram ?? 0;
  if (hist < 0 && ind1h.macd < 0) {
    score += 2;
    signals.push('MACD bearish');
  } else if (hist < 0 || ind1h.macd < 0) {
    score += 1;
    signals.push('MACD turning');
  }

  // 5. EMA slope - want falling EMAs
  if (ind1h.ema20Slope < -0.05) {
    score += 1;
    signals.push('EMA falling');
  }

  const quality: 'strong' | 'moderate' | 'weak' =
    score >= 8 ? 'strong' :
    score >= 5 ? 'moderate' : 'weak';

  return {
    pass: score >= 4,
    score,
    quality,
    signals,
  };
}

/**
 * Evaluate 15m entry conditions for LONG
 * Professional entry timing uses multiple confirmations, not just RSI
 *
 * Good LONG entry requires at least 2 of:
 * 1. RSI oversold (20-45) - momentum exhaustion
 * 2. Price near lower BB (bbPos < 0.35) - mean reversion opportunity
 * 3. MACD histogram turning positive - momentum shift
 * 4. Price above 15m EMA20 or reclaiming it - structure support
 */
export function evaluate15mLongEntry(ind15m: Indicators): {
  pass: boolean;
  score: number;
  signals: string[];
} {
  let score = 0;
  const signals: string[] = [];

  // 1. RSI oversold zone (classic entry signal)
  if (ind15m.rsi >= 20 && ind15m.rsi <= 40) {
    score += 2;
    signals.push(`RSI ${ind15m.rsi.toFixed(0)} oversold`);
  } else if (ind15m.rsi > 40 && ind15m.rsi <= 50) {
    score += 1; // Approaching neutral - weaker signal
    signals.push(`RSI ${ind15m.rsi.toFixed(0)} neutral-low`);
  }

  // 2. Bollinger Band position - price near lower band
  if (ind15m.bbPos < 0.25) {
    score += 2;
    signals.push(`BB ${(ind15m.bbPos * 100).toFixed(0)}% (oversold)`);
  } else if (ind15m.bbPos < 0.4) {
    score += 1;
    signals.push(`BB ${(ind15m.bbPos * 100).toFixed(0)}% (lower half)`);
  }

  // 3. MACD histogram positive or turning positive
  const hist = ind15m.histogram ?? 0;
  if (hist > 0) {
    score += 2;
    signals.push(`MACD hist +${hist.toFixed(5)}`);
  } else if (hist > -0.0001) {
    score += 1; // Histogram near zero, potentially turning
    signals.push('MACD turning');
  }

  // 4. Price structure - above or reclaiming EMA20
  if (ind15m.priceVsEma20 > 0) {
    score += 1;
    signals.push('Above EMA20');
  } else if (ind15m.priceVsEma20 > -1) {
    score += 0.5; // Within 1% of EMA20 - potential reclaim
    signals.push('Near EMA20');
  }

  // Need at least 3 points (roughly 2 solid signals) to pass
  return {
    pass: score >= 3,
    score,
    signals,
  };
}

/**
 * Evaluate 15m entry conditions for SHORT
 * Mirror of long entry but inverted
 */
export function evaluate15mShortEntry(ind15m: Indicators): {
  pass: boolean;
  score: number;
  signals: string[];
} {
  let score = 0;
  const signals: string[] = [];

  // 1. RSI overbought zone
  if (ind15m.rsi >= 60 && ind15m.rsi <= 80) {
    score += 2;
    signals.push(`RSI ${ind15m.rsi.toFixed(0)} overbought`);
  } else if (ind15m.rsi >= 50 && ind15m.rsi < 60) {
    score += 1;
    signals.push(`RSI ${ind15m.rsi.toFixed(0)} neutral-high`);
  }

  // 2. Bollinger Band position - price near upper band
  if (ind15m.bbPos > 0.75) {
    score += 2;
    signals.push(`BB ${(ind15m.bbPos * 100).toFixed(0)}% (overbought)`);
  } else if (ind15m.bbPos > 0.6) {
    score += 1;
    signals.push(`BB ${(ind15m.bbPos * 100).toFixed(0)}% (upper half)`);
  }

  // 3. MACD histogram negative or turning negative
  const hist = ind15m.histogram ?? 0;
  if (hist < 0) {
    score += 2;
    signals.push(`MACD hist ${hist.toFixed(5)}`);
  } else if (hist < 0.0001) {
    score += 1;
    signals.push('MACD turning');
  }

  // 4. Price structure - below or losing EMA20
  if (ind15m.priceVsEma20 < 0) {
    score += 1;
    signals.push('Below EMA20');
  } else if (ind15m.priceVsEma20 < 1) {
    score += 0.5;
    signals.push('Near EMA20');
  }

  return {
    pass: score >= 3,
    score,
    signals,
  };
}

// ============================================================================
// BREAKOUT-PULLBACK EVALUATORS
// ============================================================================

/**
 * Evaluate 5m breakout entry conditions.
 * For breakout-pullback strategy: checks if price has broken a key level,
 * volume confirmed the break, and we're retesting the broken level.
 *
 * Scoring (max ~8):
 * - Level break detected: +3
 * - Volume >= 2.0x on breakout: +2 (scored separately; not a hard gate)
 * - Price retesting broken level (within 0.3%): +2
 * - MACD histogram in breakout direction: +1
 */
export function evaluate5mBreakoutEntry(
  ind5m: Indicators,
  confluentLevels: PriceLevel[],
  direction: 'long' | 'short',
  currentPrice: number,
  ohlc5m?: OHLCData[]
): {
  pass: boolean;
  score: number;
  signals: string[];
  brokenLevel?: PriceLevel;
} {
  let score = 0;
  const signals: string[] = [];
  let brokenLevel: PriceLevel | undefined;
  let retestMet = false;

  if (!confluentLevels || confluentLevels.length === 0 || currentPrice <= 0) {
    return { pass: false, score: 0, signals: ['No key levels available'] };
  }

  // 1. Check if price has broken a key level (within last 6 candles)
  // For long: price above a resistance level = breakout
  // For short: price below a support level = breakdown
  if (direction === 'long') {
    // Find resistance levels that price has broken above
    const brokenResistances = confluentLevels
      .filter(l => l.type === 'resistance' && currentPrice > l.price)
      .filter(l => {
        const distPct = ((currentPrice - l.price) / l.price) * 100;
        return distPct <= 1.5; // Within 1.5% above = recent break
      })
      .sort((a, b) => b.price - a.price); // Closest broken level first

    if (brokenResistances.length > 0) {
      brokenLevel = brokenResistances[0];
      const distPct = ((currentPrice - brokenLevel.price) / brokenLevel.price) * 100;
      score += 3;
      signals.push(`Broke resistance ${brokenLevel.price.toFixed(5)} (${distPct.toFixed(2)}% above)`);

      // 3. Check if retesting (within 0.3% of broken level)
      if (distPct <= 0.3) {
        score += 2;
        signals.push(`Retesting level (${distPct.toFixed(2)}%)`);
        retestMet = true;
      } else if (distPct <= 0.6) {
        score += 1;
        signals.push(`Near retest (${distPct.toFixed(2)}%)`);
        retestMet = true;
      }
    }
  } else {
    // Short: find support levels broken below
    const brokenSupports = confluentLevels
      .filter(l => l.type === 'support' && currentPrice < l.price)
      .filter(l => {
        const distPct = ((l.price - currentPrice) / l.price) * 100;
        return distPct <= 1.5;
      })
      .sort((a, b) => a.price - b.price);

    if (brokenSupports.length > 0) {
      brokenLevel = brokenSupports[0];
      const distPct = ((brokenLevel.price - currentPrice) / brokenLevel.price) * 100;
      score += 3;
      signals.push(`Broke support ${brokenLevel.price.toFixed(5)} (${distPct.toFixed(2)}% below)`);

      if (distPct <= 0.3) {
        score += 2;
        signals.push(`Retesting level (${distPct.toFixed(2)}%)`);
        retestMet = true;
      } else if (distPct <= 0.6) {
        score += 1;
        signals.push(`Near retest (${distPct.toFixed(2)}%)`);
        retestMet = true;
      }
    }
  }

  // 2. Volume confirmation — breakout needs >= 2.0x average volume
  // Check recent candles for volume spike if OHLC available
  let breakoutVolumeConfirmed = false;
  if (ohlc5m && ohlc5m.length >= 6) {
    const recentCandles = ohlc5m.slice(-6);
    const olderCandles = ohlc5m.slice(-26, -6);
    const avgVol = olderCandles.length > 0
      ? olderCandles.reduce((s, c) => s + c.volume, 0) / olderCandles.length
      : 1;

    // Find candle with highest volume in recent 6
    const maxVolCandle = recentCandles.reduce((max, c) => c.volume > max.volume ? c : max, recentCandles[0]);
    const breakoutVolRatio = avgVol > 0 ? maxVolCandle.volume / avgVol : 0;

    if (breakoutVolRatio >= 2.0) {
      score += 2;
      signals.push(`Breakout vol ${breakoutVolRatio.toFixed(1)}x avg`);
      breakoutVolumeConfirmed = true;
    } else if (breakoutVolRatio >= 1.5) {
      score += 1;
      signals.push(`Vol ${breakoutVolRatio.toFixed(1)}x (needs 2.0x)`);
    }
  } else {
    // Fallback to indicator volRatio
    if (ind5m.volRatio >= 2.0) {
      score += 2;
      signals.push(`Vol ${ind5m.volRatio.toFixed(1)}x avg — confirmed`);
      breakoutVolumeConfirmed = true;
    } else if (ind5m.volRatio >= 1.5) {
      score += 1;
      signals.push(`Vol ${ind5m.volRatio.toFixed(1)}x (needs 2.0x)`);
    }
  }

  if (!breakoutVolumeConfirmed && brokenLevel) {
    signals.push('Volume too low for confirmed breakout');
  }

  // 4. MACD histogram in breakout direction
  const hist = ind5m.histogram ?? 0;
  if (direction === 'long' && hist > 0) {
    score += 1;
    signals.push(`MACD hist +${hist.toFixed(5)}`);
  } else if (direction === 'short' && hist < 0) {
    score += 1;
    signals.push(`MACD hist ${hist.toFixed(5)}`);
  }

  return {
    pass: score >= 4 && brokenLevel !== undefined && retestMet,
    score,
    signals,
    brokenLevel,
  };
}

/**
 * Evaluate 1H bias for breakout direction.
 * Simplified version of evaluate1hLongSetup/evaluate1hShortSetup.
 * Only checks trend direction and EMA alignment — does NOT penalize
 * extended price (which is normal for breakouts).
 *
 * Scoring (max ~8):
 * - Trend aligned: +3
 * - EMA alignment: +2
 * - MACD momentum: +2
 * - EMA slope: +1
 */
export function evaluate1hBreakoutBias(
  ind1h: Indicators,
  direction: 'long' | 'short'
): {
  pass: boolean;
  score: number;
  quality: 'strong' | 'moderate' | 'weak';
  signals: string[];
} {
  let score = 0;
  const signals: string[] = [];

  if (direction === 'long') {
    // 1. Trend direction (most important)
    if (ind1h.trend === 'bullish') {
      score += 3;
      signals.push('1H trend bullish');
    } else if (ind1h.trend === 'neutral') {
      score += 1.5; // Neutral is acceptable for breakouts
      signals.push('1H trend neutral');
    }
    // Bearish = 0 points but NOT blocking

    // 2. EMA alignment
    if (ind1h.emaAlignment === 'bullish') {
      score += 2;
      signals.push('EMA stack bullish');
    } else if (ind1h.emaAlignment === 'mixed') {
      score += 1;
      signals.push('EMA mixed');
    }

    // 3. MACD in breakout direction — no pullback requirement
    const hist = ind1h.histogram ?? 0;
    if (hist > 0 && ind1h.macd > 0) {
      score += 2;
      signals.push('MACD bullish');
    } else if (hist > 0 || ind1h.macd > 0) {
      score += 1;
      signals.push('MACD turning');
    }

    // 4. EMA slope rising
    if (ind1h.ema20Slope > 0.05) {
      score += 1;
      signals.push('EMA rising');
    }
  } else {
    // Short direction
    if (ind1h.trend === 'bearish') {
      score += 3;
      signals.push('1H trend bearish');
    } else if (ind1h.trend === 'neutral') {
      score += 1.5;
      signals.push('1H trend neutral');
    }

    if (ind1h.emaAlignment === 'bearish') {
      score += 2;
      signals.push('EMA stack bearish');
    } else if (ind1h.emaAlignment === 'mixed') {
      score += 1;
      signals.push('EMA mixed');
    }

    const hist = ind1h.histogram ?? 0;
    if (hist < 0 && ind1h.macd < 0) {
      score += 2;
      signals.push('MACD bearish');
    } else if (hist < 0 || ind1h.macd < 0) {
      score += 1;
      signals.push('MACD turning');
    }

    if (ind1h.ema20Slope < -0.05) {
      score += 1;
      signals.push('EMA falling');
    }
  }

  // More permissive pass threshold than swing (3 vs 4)
  // Breakouts just need 1H to not actively oppose
  const quality: 'strong' | 'moderate' | 'weak' =
    score >= 7 ? 'strong' :
    score >= 4 ? 'moderate' : 'weak';

  return {
    pass: score >= 3,
    score,
    quality,
    signals,
  };
}

// ============================================================================
// VOLUME EVALUATION
// ============================================================================

/**
 * Evaluate volume conditions for swing trading
 *
 * For swing trades:
 * - High volume confirms breakouts and trend continuation
 * - LOW volume on pullbacks is actually GOOD (healthy retracement)
 * - Very low volume = no conviction = wait
 *
 * Context matters:
 * - Trend continuation: want moderate-high volume (>1.2x)
 * - Pullback entry: low volume is fine (0.7-1.2x)
 * - Breakout: want high volume (>1.5x)
 */
export function evaluateVolume(
  volRatio: number,
  context: 'pullback' | 'breakout' | 'continuation'
): { pass: boolean; quality: 'strong' | 'moderate' | 'weak'; description: string } {
  if (context === 'pullback') {
    // For pullback entries, low volume is actually preferred (no selling pressure)
    if (volRatio >= 0.5 && volRatio <= 1.3) {
      return { pass: true, quality: 'strong', description: `${volRatio.toFixed(2)}x (healthy pullback)` };
    } else if (volRatio < 0.5) {
      return { pass: true, quality: 'moderate', description: `${volRatio.toFixed(2)}x (very quiet)` };
    } else {
      return { pass: true, quality: 'weak', description: `${volRatio.toFixed(2)}x (high vol pullback)` };
    }
  } else if (context === 'breakout') {
    // Breakouts need volume confirmation
    if (volRatio >= 1.8) {
      return { pass: true, quality: 'strong', description: `${volRatio.toFixed(2)}x (strong breakout)` };
    } else if (volRatio >= 1.3) {
      return { pass: true, quality: 'moderate', description: `${volRatio.toFixed(2)}x (confirmed)` };
    } else {
      return { pass: false, quality: 'weak', description: `${volRatio.toFixed(2)}x (weak breakout)` };
    }
  } else {
    // Continuation - moderate volume is fine
    if (volRatio >= 1.3) {
      return { pass: true, quality: 'strong', description: `${volRatio.toFixed(2)}x` };
    } else if (volRatio >= 0.8) {
      return { pass: true, quality: 'moderate', description: `${volRatio.toFixed(2)}x (normal)` };
    } else {
      return { pass: false, quality: 'weak', description: `${volRatio.toFixed(2)}x (low)` };
    }
  }
}

/**
 * Evaluate MACD momentum with dead zone
 *
 * The histogram value near zero is NEUTRAL, not bullish/bearish
 * Dead zone: -0.0001 to +0.0001 = neutral (no clear momentum)
 */
export function evaluateMACDMomentum(
  direction: 'long' | 'short',
  histogram: number | undefined,
  macd: number
): { pass: boolean; strength: 'strong' | 'moderate' | 'weak' | 'neutral'; description: string } {
  const hist = histogram ?? 0;

  // Dead zone - histogram too small to be meaningful
  const DEAD_ZONE = 0.00005;

  if (Math.abs(hist) < DEAD_ZONE) {
    return {
      pass: false, // Neutral doesn't pass either direction
      strength: 'neutral',
      description: `Hist ${hist >= 0 ? '+' : ''}${hist.toFixed(5)} (neutral)`,
    };
  }

  if (direction === 'long') {
    if (hist > DEAD_ZONE) {
      // Histogram positive - bullish momentum
      const strength = hist > 0.0005 ? 'strong' :
                       hist > 0.0001 ? 'moderate' : 'weak';
      return {
        pass: true,
        strength,
        description: `Hist +${hist.toFixed(5)} ${macd > 0 ? '(MACD+)' : ''}`,
      };
    } else {
      // Histogram negative - bearish momentum, bad for longs
      return {
        pass: false,
        strength: 'weak',
        description: `Hist ${hist.toFixed(5)} (bearish)`,
      };
    }
  } else {
    // SHORT
    if (hist < -DEAD_ZONE) {
      // Histogram negative - bearish momentum
      const strength = hist < -0.0005 ? 'strong' :
                       hist < -0.0001 ? 'moderate' : 'weak';
      return {
        pass: true,
        strength,
        description: `Hist ${hist.toFixed(5)} ${macd < 0 ? '(MACD-)' : ''}`,
      };
    } else {
      // Histogram positive - bullish momentum, bad for shorts
      return {
        pass: false,
        strength: 'weak',
        description: `Hist +${hist.toFixed(5)} (bullish)`,
      };
    }
  }
}

/**
 * Evaluate BTC alignment with nuance
 *
 * For swing trades:
 * - BTC trending same direction = strong confirmation
 * - BTC neutral = acceptable for strong setups
 * - BTC opposing = warning, need very strong setup
 */
export function evaluateBTCAlignment(
  direction: 'long' | 'short',
  btcTrend: 'bull' | 'bear' | 'neut',
  btcChange: number,
  setupStrength: 'strong' | 'moderate' | 'weak'
): { pass: boolean; quality: 'aligned' | 'neutral' | 'opposing'; description: string } {
  if (direction === 'long') {
    if (btcTrend === 'bull') {
      return { pass: true, quality: 'aligned', description: `BTC bull ${btcChange.toFixed(1)}%` };
    } else if (btcTrend === 'neut') {
      // Neutral BTC passes for strong/moderate setups
      const pass = setupStrength !== 'weak';
      return { pass, quality: 'neutral', description: `BTC neut ${btcChange.toFixed(1)}%` };
    } else {
      // BTC bearish - only pass for very strong setups (divergence play)
      return { pass: false, quality: 'opposing', description: `BTC bear ${btcChange.toFixed(1)}% ⚠️` };
    }
  } else {
    // SHORT
    if (btcTrend === 'bear') {
      return { pass: true, quality: 'aligned', description: `BTC bear ${btcChange.toFixed(1)}%` };
    } else if (btcTrend === 'neut') {
      const pass = setupStrength !== 'weak';
      return { pass, quality: 'neutral', description: `BTC neut ${btcChange.toFixed(1)}%` };
    } else {
      return { pass: false, quality: 'opposing', description: `BTC bull ${btcChange.toFixed(1)}% ⚠️` };
    }
  }
}

/**
 * Determine entry context (pullback vs breakout vs continuation)
 * This affects how we evaluate volume and other signals
 */
export function determineEntryContext(
  ind15m: Indicators,
  ind1h: Indicators,
  direction: 'long' | 'short'
): 'pullback' | 'breakout' | 'continuation' {
  // Check if price is extended from EMA (potential breakout)
  const extended = direction === 'long'
    ? ind15m.priceVsEma20 > 2 && ind1h.priceVsEma20 > 3
    : ind15m.priceVsEma20 < -2 && ind1h.priceVsEma20 < -3;

  if (extended) {
    return 'breakout';
  }

  // Check if price is near EMA (pullback)
  const nearEma = Math.abs(ind15m.priceVsEma20) < 1.5;

  if (nearEma) {
    return 'pullback';
  }

  return 'continuation';
}

/**
 * Evaluate conditions for LONG entry
 */
export function evaluateLongConditions(
  ind4h: Indicators,
  ind1h: Indicators,
  ind15m: Indicators,
  btcTrend: 'bull' | 'bear' | 'neut',
  micro?: MicrostructureInput | null,
  liq?: LiquidationInput | null,
  ind1d?: Indicators | null,
  strategy?: TradingStrategy,
  ind5m?: Indicators | null,
  confluentLevels?: PriceLevel[],
  currentPrice?: number,
  ohlc5m?: OHLCData[]
): LongChecks {
  const flowAnalysis = analyzeFlow('long', micro || null);
  const liqAnalysis = analyzeLiquidation('long', liq || null);

  if (strategy?.meta.type === 'breakout' && ind5m) {
    // Breakout strategy: use 5m breakout entry + 1H bias
    const entry5m = evaluate5mBreakoutEntry(ind5m, confluentLevels || [], 'long', currentPrice || 0, ohlc5m);
    const bias1h = evaluate1hBreakoutBias(ind1h, 'long');
    // Volume always in 'breakout' context for this strategy
    const volumeEval = evaluateVolume(ind5m.volRatio, 'breakout');
    const macdEval = evaluateMACDMomentum('long', ind5m.histogram, ind5m.macd);
    const btcEval = evaluateBTCAlignment('long', btcTrend, 0, bias1h.quality);

    return {
      trend1d: ind1d ? ind1d.trend !== 'bearish' : undefined,
      trend4h: ind4h.trend === 'bullish',
      setup1h: bias1h.pass,
      entry15m: entry5m.pass, // 5m breakout entry fills the entry15m slot
      volume: volumeEval.pass,
      btcAlign: btcEval.pass,
      macdMomentum: macdEval.pass,
      flowConfirm: flowAnalysis.flowConfirmPass,
      liqBias: liqAnalysis.aligned,
    };
  }

  // Swing strategy (default): existing logic
  const entry15m = evaluate15mLongEntry(ind15m);
  const setup1h = evaluate1hLongSetup(ind1h);
  const context = determineEntryContext(ind15m, ind1h, 'long');
  const volumeEval = evaluateVolume(ind15m.volRatio, context);
  const macdEval = evaluateMACDMomentum('long', ind15m.histogram, ind15m.macd);
  const btcEval = evaluateBTCAlignment('long', btcTrend, 0, setup1h.quality);

  return {
    trend1d: ind1d ? ind1d.trend !== 'bearish' : undefined,
    trend4h: ind4h.trend === 'bullish',
    setup1h: setup1h.pass,
    entry15m: entry15m.pass,
    volume: volumeEval.pass,
    btcAlign: btcEval.pass,
    macdMomentum: macdEval.pass,
    flowConfirm: flowAnalysis.flowConfirmPass,
    liqBias: liqAnalysis.aligned,
  };
}

/**
 * Evaluate conditions for SHORT entry
 */
export function evaluateShortConditions(
  ind4h: Indicators,
  ind1h: Indicators,
  ind15m: Indicators,
  btcTrend: 'bull' | 'bear' | 'neut',
  micro?: MicrostructureInput | null,
  liq?: LiquidationInput | null,
  ind1d?: Indicators | null,
  strategy?: TradingStrategy,
  ind5m?: Indicators | null,
  confluentLevels?: PriceLevel[],
  currentPrice?: number,
  ohlc5m?: OHLCData[]
): ShortChecks {
  const flowAnalysis = analyzeFlow('short', micro || null);
  const liqAnalysis = analyzeLiquidation('short', liq || null);

  if (strategy?.meta.type === 'breakout' && ind5m) {
    // Breakout strategy: use 5m breakout entry + 1H bias
    const entry5m = evaluate5mBreakoutEntry(ind5m, confluentLevels || [], 'short', currentPrice || 0, ohlc5m);
    const bias1h = evaluate1hBreakoutBias(ind1h, 'short');
    const volumeEval = evaluateVolume(ind5m.volRatio, 'breakout');
    const macdEval = evaluateMACDMomentum('short', ind5m.histogram, ind5m.macd);
    const btcEval = evaluateBTCAlignment('short', btcTrend, 0, bias1h.quality);

    return {
      trend1d: ind1d ? ind1d.trend !== 'bullish' : undefined,
      trend4h: ind4h.trend === 'bearish',
      setup1h: bias1h.pass,
      entry15m: entry5m.pass,
      volume: volumeEval.pass,
      btcAlign: btcEval.pass,
      macdMomentum: macdEval.pass,
      flowConfirm: flowAnalysis.flowConfirmPass,
      liqBias: liqAnalysis.aligned,
    };
  }

  // Swing strategy (default): existing logic
  const entry15m = evaluate15mShortEntry(ind15m);
  const setup1h = evaluate1hShortSetup(ind1h);
  const context = determineEntryContext(ind15m, ind1h, 'short');
  const volumeEval = evaluateVolume(ind15m.volRatio, context);
  const macdEval = evaluateMACDMomentum('short', ind15m.histogram, ind15m.macd);
  const btcEval = evaluateBTCAlignment('short', btcTrend, 0, setup1h.quality);

  return {
    trend1d: ind1d ? ind1d.trend !== 'bullish' : undefined,
    trend4h: ind4h.trend === 'bearish',
    setup1h: setup1h.pass,
    entry15m: entry15m.pass,
    volume: volumeEval.pass,
    btcAlign: btcEval.pass,
    macdMomentum: macdEval.pass,
    flowConfirm: flowAnalysis.flowConfirmPass,
    liqBias: liqAnalysis.aligned,
  };
}

/**
 * Count passing conditions (excluding flowConfirm and liqBias for base score)
 * Base conditions: trend1d (if present), trend4h, setup1h, entry15m, volume, btcAlign, macdMomentum
 */
export function countPassed(checks: LongChecks | ShortChecks, includeExtras = false): number {
  const { flowConfirm, liqBias, trend1d, ...coreChecks } = checks;
  // Count core checks (always 6: trend4h, setup1h, entry15m, volume, btcAlign, macdMomentum)
  let baseCount = Object.values(coreChecks).filter(Boolean).length;
  // Add trend1d if present (it's optional when daily data not loaded)
  if (trend1d !== undefined && trend1d) baseCount++;

  if (includeExtras) {
    let extras = 0;
    if (flowConfirm !== undefined && flowConfirm) extras++;
    if (liqBias !== undefined && liqBias) extras++;
    return baseCount + extras;
  }
  return baseCount;
}

/**
 * Get total base conditions count (excluding flowConfirm and liqBias)
 */
export function getTotalBaseConditions(checks: LongChecks | ShortChecks): number {
  // 6 core conditions + 1 if daily data present
  return checks.trend1d !== undefined ? 7 : 6;
}

/**
 * Get missing conditions for a setup
 */
export function getMissingConditions(
  checks: LongChecks | ShortChecks,
  direction: 'long' | 'short',
  includeExtras = false
): string[] {
  const missing: string[] = [];
  if (checks.trend1d !== undefined && !checks.trend1d) {
    missing.push('1D trend');
  }
  if (!checks.trend4h) missing.push('4H trend');
  if (!checks.setup1h) missing.push('1H setup');
  if (!checks.entry15m) {
    missing.push(direction === 'long'
      ? '15m entry (need RSI+BB+MACD confluence)'
      : '15m entry (need RSI+BB+MACD confluence)');
  }
  if (!checks.volume) missing.push('volume confirmation');
  if (!checks.btcAlign) missing.push('BTC alignment');
  if (!checks.macdMomentum)
    missing.push(direction === 'long' ? 'MACD histogram > 0' : 'MACD histogram < 0');
  if (includeExtras && checks.flowConfirm === false) {
    missing.push('flow confirmation');
  }
  if (includeExtras && checks.liqBias === false) {
    missing.push('liquidation bias');
  }
  return missing;
}

/**
 * Check for 5m spike conditions
 */
export function detectSpike(
  ind5m: Indicators,
  spikeConfig: SpikeDetectionConfig = DEFAULT_STRATEGY.spike
): {
  isSpike: boolean;
  direction: 'long' | 'short' | null;
} {
  const hasVolumeSpike = ind5m.volRatio > spikeConfig.volumeRatioThreshold;
  const isOversold = ind5m.rsi < spikeConfig.oversoldRSI;
  const isOverbought = ind5m.rsi > spikeConfig.overboughtRSI;

  if (hasVolumeSpike && isOversold) {
    return { isSpike: true, direction: 'long' };
  }
  if (hasVolumeSpike && isOverbought) {
    return { isSpike: true, direction: 'short' };
  }
  return { isSpike: false, direction: null };
}

/**
 * Format EMA info for checklist display
 */
function formatEMAInfo(ind: Indicators): string {
  const pricePos = ind.priceVsEma20 >= 0 ? '↑' : '↓';
  const alignment = ind.emaAlignment === 'bullish' ? '🟢' :
                    ind.emaAlignment === 'bearish' ? '🔴' : '🟡';
  const slopeArrow = ind.ema20Slope > 0.1 ? '↗' :
                     ind.ema20Slope < -0.1 ? '↘' : '→';
  return `${ind.trend} ${alignment} EMA${pricePos}${ind.priceVsEma20.toFixed(1)}% ${slopeArrow}`;
}

/**
 * Format 1H setup value with multi-signal info
 */
function format1hSetupValue(direction: 'long' | 'short', ind1h: Indicators): string {
  const setup = direction === 'long'
    ? evaluate1hLongSetup(ind1h)
    : evaluate1hShortSetup(ind1h);

  // Show quality and key signal
  const topSignal = setup.signals[0] || '';
  const qualityIcon = setup.quality === 'strong' ? '★' :
                      setup.quality === 'moderate' ? '✓' : '';

  return `${setup.score}/10 ${setup.quality} ${qualityIcon} ${topSignal}`;
}

/**
 * Format 15m entry value with multi-signal info
 */
function formatEntry15mValue(direction: 'long' | 'short', ind15m: Indicators): string {
  const entry = direction === 'long'
    ? evaluate15mLongEntry(ind15m)
    : evaluate15mShortEntry(ind15m);

  // Show score and top signals
  const topSignals = entry.signals.slice(0, 2).join(', ');
  const scoreDisplay = `${entry.score.toFixed(1)}/3`;

  if (entry.pass) {
    return `✓ ${scoreDisplay} (${topSignals})`;
  } else {
    return `${scoreDisplay} - ${topSignals || 'weak signals'}`;
  }
}

/**
 * Format volume value with context
 */
function formatVolumeValue(
  direction: 'long' | 'short',
  ind15m: Indicators,
  ind1h: Indicators
): string {
  const context = determineEntryContext(ind15m, ind1h, direction);
  const volEval = evaluateVolume(ind15m.volRatio, context);
  return volEval.description;
}

/**
 * Format MACD momentum with dead zone awareness
 */
function formatMACDValue(direction: 'long' | 'short', ind15m: Indicators): string {
  const macdEval = evaluateMACDMomentum(direction, ind15m.histogram, ind15m.macd);
  return macdEval.description;
}

/**
 * Format BTC alignment value
 */
function formatBTCValue(
  direction: 'long' | 'short',
  btcTrend: string,
  btcChange: number,
  setupQuality: 'strong' | 'moderate' | 'weak'
): string {
  const btcEval = evaluateBTCAlignment(
    direction,
    btcTrend as 'bull' | 'bear' | 'neut',
    btcChange,
    setupQuality
  );
  return btcEval.description;
}

/**
 * Convert checks to checklist items with values
 */
export function formatChecklist(
  checks: LongChecks | ShortChecks,
  direction: 'long' | 'short',
  ind4h: Indicators,
  ind1h: Indicators,
  ind15m: Indicators,
  btcTrend: string,
  btcChange: number,
  micro?: MicrostructureInput | null,
  liq?: LiquidationInput | null,
  ind1d?: Indicators | null,
  liqConfig?: LiquidationStrategyConfig,
  reversalSignal?: ReversalSignal | null,
  ohlc4h?: OHLCData[],
  ohlc1h?: OHLCData[],
  confluentLevels?: PriceLevel[],
  currentPrice?: number,
  strategy?: TradingStrategy,
  ind5m?: Indicators | null,
  ohlc5m?: OHLCData[]
): TradingRecommendation['checklist'] {
  const flowAnalysis = micro ? analyzeFlow(direction, micro) : null;
  const liqAnalysis = liq ? analyzeLiquidation(direction, liq, liqConfig) : null;
  const isBreakout = strategy?.meta.type === 'breakout';

  // Format 4H trend with EMA info
  const trend4hValue = formatEMAInfo(ind4h);

  // Build checklist incrementally — required fields are filled in the if/else blocks below
  const checklist = {
    trend4h: {
      pass: checks.trend4h,
      value: trend4hValue + (ind4h.trendStrength === 'strong' ? ' ★' : ''),
    },
  } as TradingRecommendation['checklist'];

  if (isBreakout) {
    // --- Breakout strategy: 1H Bias + 5m Breakout Entry labels ---
    const bias1h = evaluate1hBreakoutBias(ind1h, direction);
    const topSignal = bias1h.signals[0] || '';
    const qualityIcon = bias1h.quality === 'strong' ? '★' :
                        bias1h.quality === 'moderate' ? '✓' : '';
    checklist.setup1h = {
      pass: checks.setup1h,
      value: `${bias1h.score}/8 ${bias1h.quality} ${qualityIcon} ${topSignal}`,
    };

    // 5m Breakout Entry with level break info
    if (ind5m) {
      const entry5m = evaluate5mBreakoutEntry(ind5m, confluentLevels || [], direction, currentPrice || 0, ohlc5m);
      const topSignals = entry5m.signals.slice(0, 2).join(', ');
      checklist.entry15m = {
        pass: checks.entry15m,
        value: entry5m.pass
          ? `✓ ${entry5m.score.toFixed(0)}/8 (${topSignals})`
          : `${entry5m.score.toFixed(0)}/8 - ${topSignals || 'no breakout'}`,
      };

      // Add dedicated level break checklist item for breakout strategy
      if (entry5m.brokenLevel) {
        const distPct = direction === 'long'
          ? ((currentPrice! - entry5m.brokenLevel.price) / entry5m.brokenLevel.price) * 100
          : ((entry5m.brokenLevel.price - currentPrice!) / entry5m.brokenLevel.price) * 100;
        const retestStatus = distPct <= 0.3 ? 'retesting' : distPct <= 0.6 ? 'near retest' : 'extended';
        checklist.keyLevelProximity = {
          pass: distPct <= 0.6,
          value: `${entry5m.brokenLevel.type === 'resistance' ? 'Res' : 'Sup'} ${entry5m.brokenLevel.price.toFixed(5)} broken — ${retestStatus} (${distPct.toFixed(2)}%)`,
        };
      }

      // Volume with breakout emphasis
      const volEval = evaluateVolume(ind5m.volRatio, 'breakout');
      checklist.volume = {
        pass: checks.volume,
        value: `${ind5m.volRatio.toFixed(1)}x avg ${volEval.quality === 'strong' ? '— confirmed breakout' : volEval.quality === 'moderate' ? '— confirmed' : '— weak'}`,
      };
    } else {
      checklist.entry15m = {
        pass: checks.entry15m,
        value: formatEntry15mValue(direction, ind15m),
      };
      checklist.volume = {
        pass: checks.volume,
        value: formatVolumeValue(direction, ind15m, ind1h),
      };
    }

    // MACD on 5m for breakout
    if (ind5m) {
      checklist.macdMomentum = {
        pass: checks.macdMomentum,
        value: formatMACDValue(direction, ind5m),
      };
    } else {
      checklist.macdMomentum = {
        pass: checks.macdMomentum,
        value: formatMACDValue(direction, ind15m),
      };
    }
  } else {
    // --- Swing strategy (default): existing labels ---
    checklist.setup1h = {
      pass: checks.setup1h,
      value: format1hSetupValue(direction, ind1h),
    };
    checklist.entry15m = {
      pass: checks.entry15m,
      value: formatEntry15mValue(direction, ind15m),
    };
    checklist.volume = {
      pass: checks.volume,
      value: formatVolumeValue(direction, ind15m, ind1h),
    };
    checklist.macdMomentum = {
      pass: checks.macdMomentum,
      value: formatMACDValue(direction, ind15m),
    };
  }

  // BTC alignment (shared)
  const setupQuality = isBreakout
    ? evaluate1hBreakoutBias(ind1h, direction).quality
    : (direction === 'long' ? evaluate1hLongSetup(ind1h) : evaluate1hShortSetup(ind1h)).quality;
  checklist.btcAlign = {
    pass: checks.btcAlign,
    value: formatBTCValue(direction, btcTrend, btcChange, setupQuality),
  };

  // Add daily trend if available with EMA info (skip for breakout if weight is 0)
  if (ind1d && checks.trend1d !== undefined && !(isBreakout && (strategy?.timeframeWeights['1d'] ?? 0) === 0)) {
    checklist.trend1d = {
      pass: checks.trend1d,
      value: formatEMAInfo(ind1d) + (ind1d.trendStrength === 'strong' ? ' ★' : ''),
    };
  }

  // Flow confirmation
  if (flowAnalysis) {
    const imbalanceStr = `${(flowAnalysis.imbalance * 100).toFixed(0)}%`;
    const cvdStr = flowAnalysis.cvdTrend;
    checklist.flowConfirm = {
      pass: checks.flowConfirm ?? true,
      value: `Imb ${imbalanceStr}, CVD ${cvdStr}`,
    };
  }

  // Liquidation bias
  if (liqAnalysis) {
    checklist.liqBias = {
      pass: checks.liqBias ?? true,
      value: liqAnalysis.description,
    };
  }

  // Reversal signal
  if (reversalSignal && reversalSignal.detected) {
    const reversalAligns = (direction === 'long' && reversalSignal.direction === 'bullish')
      || (direction === 'short' && reversalSignal.direction === 'bearish');
    const patternNames = reversalSignal.patterns
      .filter(p => p.type.startsWith('reversal_'))
      .slice(0, 2)
      .map(p => p.name.replace(/_/g, ' '));
    const patternStr = patternNames.length > 0 ? patternNames.join(', ') : reversalSignal.phase;
    checklist.reversalSignal = {
      pass: reversalAligns && reversalSignal.confidence >= 40,
      value: `${reversalAligns ? '↺' : '⚠'} ${reversalSignal.direction} ${reversalSignal.phase} (${reversalSignal.confidence}%) ${patternStr}`,
    };
  }

  // Market structure
  if (ohlc4h || ohlc1h) {
    const ms = evaluateMarketStructure(direction, ohlc4h, ohlc1h);
    checklist.marketStructure = {
      pass: ms.value >= 0.6,
      value: ms.description,
    };
  }

  // Key level proximity (only for swing — breakout handles this via entry5m above)
  if (!isBreakout && confluentLevels && confluentLevels.length > 0 && currentPrice && currentPrice > 0) {
    const kl = evaluateKeyLevelProximity(direction, currentPrice, confluentLevels, strategy?.keyLevels);
    checklist.keyLevelProximity = {
      pass: kl.value >= 0.55,
      value: kl.description + (kl.rrWarning ? ' ⚠' : ''),
    };
  }

  // Rejection signal
  if (strategy?.rejection?.enabled && confluentLevels && confluentLevels.length > 0 && currentPrice && currentPrice > 0 && ind5m) {
    const rej = evaluateRejection(direction, currentPrice, confluentLevels, ind15m, ind5m, strategy.rejection, reversalSignal);
    if (rej.detected || rej.components?.levelProximity.met) {
      checklist.rejection = { pass: rej.detected, value: rej.description };
    }
  }

  return checklist;
}

/**
 * Evaluate market structure (HH/HL vs LH/LL) from swing points.
 * Uses existing chart-context.ts TrendStructure analysis.
 * 4H structure weighs 60%, 1H 40%.
 */
export function evaluateMarketStructure(
  direction: 'long' | 'short',
  ohlc4h: OHLCData[] | undefined,
  ohlc1h: OHLCData[] | undefined
): { value: number; description: string } {
  let score4h = 0.5;
  let score1h = 0.5;
  let desc4h = '';
  let desc1h = '';

  if (ohlc4h && ohlc4h.length >= 20) {
    const ctx4h = analyzeTimeframe(ohlc4h, 240, '4H');
    if (ctx4h) {
      const t = ctx4h.trend;
      if (direction === 'long') {
        if (t.direction === 'uptrend') {
          score4h = t.strength === 'strong' ? 1.0 : t.strength === 'moderate' ? 0.85 : 0.7;
        } else if (t.direction === 'sideways') {
          score4h = 0.45;
        } else {
          score4h = t.strength === 'strong' ? 0.1 : t.strength === 'moderate' ? 0.2 : 0.3;
        }
      } else {
        if (t.direction === 'downtrend') {
          score4h = t.strength === 'strong' ? 1.0 : t.strength === 'moderate' ? 0.85 : 0.7;
        } else if (t.direction === 'sideways') {
          score4h = 0.45;
        } else {
          score4h = t.strength === 'strong' ? 0.1 : t.strength === 'moderate' ? 0.2 : 0.3;
        }
      }
      desc4h = `4H ${t.direction}(${t.strength}) HH${t.higherHighs}/HL${t.higherLows}/LH${t.lowerHighs}/LL${t.lowerLows}`;
    }
  }

  if (ohlc1h && ohlc1h.length >= 20) {
    const ctx1h = analyzeTimeframe(ohlc1h, 60, '1H');
    if (ctx1h) {
      const t = ctx1h.trend;
      if (direction === 'long') {
        if (t.direction === 'uptrend') {
          score1h = t.strength === 'strong' ? 1.0 : t.strength === 'moderate' ? 0.85 : 0.7;
        } else if (t.direction === 'sideways') {
          score1h = 0.45;
        } else {
          score1h = t.strength === 'strong' ? 0.1 : t.strength === 'moderate' ? 0.2 : 0.3;
        }
      } else {
        if (t.direction === 'downtrend') {
          score1h = t.strength === 'strong' ? 1.0 : t.strength === 'moderate' ? 0.85 : 0.7;
        } else if (t.direction === 'sideways') {
          score1h = 0.45;
        } else {
          score1h = t.strength === 'strong' ? 0.1 : t.strength === 'moderate' ? 0.2 : 0.3;
        }
      }
      desc1h = `1H ${t.direction}(${t.strength})`;
    }
  }

  // 4H weighs 60%, 1H weighs 40%
  const value = score4h * 0.6 + score1h * 0.4;
  const description = [desc4h, desc1h].filter(Boolean).join(' | ') || 'No structure data';

  return { value: Math.max(0, Math.min(1, value)), description };
}

/**
 * Evaluate key level proximity and risk/reward.
 * Uses existing confluent levels from chart-context.ts.
 * Scores higher when price is near support (for long) or resistance (for short).
 */
export function evaluateKeyLevelProximity(
  direction: 'long' | 'short',
  currentPrice: number,
  confluentLevels: PriceLevel[],
  config?: KeyLevelConfig
): { value: number; description: string; rrRatio: number | null; rrWarning: boolean } {
  const nearPct = config?.nearProximityPct ?? 1.0;
  const strongPct = config?.strongProximityPct ?? 0.5;
  const minTouches = config?.minTouches ?? 2;
  const rrMinRatio = config?.rrMinRatio ?? 1.5;
  const rrWarningRatio = config?.rrWarningRatio ?? 1.0;
  const minStrength = config?.minStrength ?? 'moderate';
  const strengthRank: Record<PriceLevel['strength'], number> = {
    strong: 3,
    moderate: 2,
    weak: 1,
  };

  if (!confluentLevels || confluentLevels.length === 0 || currentPrice <= 0) {
    return { value: 0.5, description: 'No key levels', rrRatio: null, rrWarning: false };
  }

  // Find nearest support and resistance
  const supports = confluentLevels
    .filter(l => l.type === 'support' && l.price < currentPrice && l.touches >= minTouches)
    .filter(l => strengthRank[l.strength] >= strengthRank[minStrength])
    .sort((a, b) => b.price - a.price); // closest first

  const resistances = confluentLevels
    .filter(l => l.type === 'resistance' && l.price > currentPrice && l.touches >= minTouches)
    .filter(l => strengthRank[l.strength] >= strengthRank[minStrength])
    .sort((a, b) => a.price - b.price); // closest first

  const nearestSupport = supports[0];
  const nearestResistance = resistances[0];

  let value = 0.5; // neutral baseline
  const descParts: string[] = [];

  if (direction === 'long') {
    // For longs: near support = good (bouncing off support), near resistance = bad (capped upside)
    if (nearestSupport) {
      const distPct = ((currentPrice - nearestSupport.price) / currentPrice) * 100;
      if (distPct <= strongPct) {
        value += 0.35;
        descParts.push(`Near strong support ${nearestSupport.price.toFixed(5)} (${distPct.toFixed(1)}%)`);
      } else if (distPct <= nearPct) {
        value += 0.2;
        descParts.push(`Near support ${nearestSupport.price.toFixed(5)} (${distPct.toFixed(1)}%)`);
      }
      // Strength bonus
      if (nearestSupport.strength === 'strong') value += 0.05;
    }
    if (nearestResistance) {
      const distPct = ((nearestResistance.price - currentPrice) / currentPrice) * 100;
      if (distPct <= strongPct) {
        value -= 0.2; // Very close to resistance = limited upside
        descParts.push(`Resistance overhead ${nearestResistance.price.toFixed(5)} (${distPct.toFixed(1)}%)`);
      }
    }
  } else {
    // For shorts: near resistance = good (rejecting at resistance), near support = bad
    if (nearestResistance) {
      const distPct = ((nearestResistance.price - currentPrice) / currentPrice) * 100;
      if (distPct <= strongPct) {
        value += 0.35;
        descParts.push(`Near strong resistance ${nearestResistance.price.toFixed(5)} (${distPct.toFixed(1)}%)`);
      } else if (distPct <= nearPct) {
        value += 0.2;
        descParts.push(`Near resistance ${nearestResistance.price.toFixed(5)} (${distPct.toFixed(1)}%)`);
      }
      if (nearestResistance.strength === 'strong') value += 0.05;
    }
    if (nearestSupport) {
      const distPct = ((currentPrice - nearestSupport.price) / currentPrice) * 100;
      if (distPct <= strongPct) {
        value -= 0.2;
        descParts.push(`Support below ${nearestSupport.price.toFixed(5)} (${distPct.toFixed(1)}%)`);
      }
    }
  }

  // Calculate RR ratio
  let rrRatio: number | null = null;
  let rrWarning = false;
  let rrBelowMin = false;
  if (direction === 'long' && nearestSupport && nearestResistance) {
    const risk = currentPrice - nearestSupport.price;
    const reward = nearestResistance.price - currentPrice;
    if (risk > 0) {
      rrRatio = reward / risk;
      rrWarning = rrRatio < rrWarningRatio;
      rrBelowMin = rrRatio < rrMinRatio;
      descParts.push(`RR ${rrRatio.toFixed(1)}:1`);
    }
  } else if (direction === 'short' && nearestSupport && nearestResistance) {
    const risk = nearestResistance.price - currentPrice;
    const reward = currentPrice - nearestSupport.price;
    if (risk > 0) {
      rrRatio = reward / risk;
      rrWarning = rrRatio < rrWarningRatio;
      rrBelowMin = rrRatio < rrMinRatio;
      descParts.push(`RR ${rrRatio.toFixed(1)}:1`);
    }
  }

  if (rrBelowMin) {
    value -= 0.2;
    descParts.push(`RR below min ${rrMinRatio.toFixed(1)}:1`);
  }

  value = Math.max(0, Math.min(1, value));
  const description = descParts.length > 0 ? descParts.join(', ') : 'No nearby levels';

  return { value, description, rrRatio, rrWarning };
}

// ============================================================================
// REJECTION DETECTION — composite hard AND gate
// ============================================================================

export interface RejectionResult {
  value: number; // 0-1 signal value (0.5 = neutral)
  detected: boolean;
  rejectedLevel: PriceLevel | null;
  description: string;
  components: {
    levelProximity: { met: boolean; distPct: number; levelPrice: number };
    reversalCandle: { met: boolean; patternName: string; strength: number };
    macdConfirm: { met: boolean; histogram: number };
    volumeConfirm: { met: boolean; volRatio: number };
  } | null;
}

const NEUTRAL_REJECTION: RejectionResult = {
  value: 0.5,
  detected: false,
  rejectedLevel: null,
  description: 'No rejection',
  components: null,
};

/**
 * Evaluate composite S/R rejection signal.
 * Hard AND gate: ALL four conditions must be met for signal to fire.
 * (1) Near strong S/R  (2) Reversal candle  (3) MACD confirms  (4) Volume threshold
 */
export function evaluateRejection(
  direction: 'long' | 'short',
  currentPrice: number,
  confluentLevels: PriceLevel[],
  ind15m: Indicators,
  ind5m: Indicators | null,
  config?: RejectionConfig,
  reversalSignal?: ReversalSignal | null
): RejectionResult {
  if (!config?.enabled) return NEUTRAL_REJECTION;

  const proxPct = config.proximityPct ?? 1.0;
  const minVolRatio = config.minVolumeRatio ?? 1.2;
  const minCandleStr = config.minCandleStrength ?? 0.3;
  const minHistMag = config.minMacdHistMagnitude ?? 0.00005;
  const requireMacdAlign = config.requireMacdAlignment ?? true;
  const minLevelStr = config.minLevelStrength ?? 'moderate';
  const minTouches = config.minLevelTouches ?? 2;
  const confluenceBonus = config.reversalConfluenceBonus ?? 1.2;

  const strengthRank: Record<string, number> = { strong: 3, moderate: 2, weak: 1 };

  // --- 1. Level proximity ---
  // For long: look for support below (bouncing off support)
  // For short: look for resistance above (rejecting at resistance)
  const targetType = direction === 'long' ? 'support' : 'resistance';
  const candidateLevels = confluentLevels
    .filter(l => l.type === targetType && l.touches >= minTouches)
    .filter(l => (strengthRank[l.strength] ?? 0) >= (strengthRank[minLevelStr] ?? 2));

  let nearestLevel: PriceLevel | null = null;
  let nearestDistPct = Infinity;

  for (const lv of candidateLevels) {
    const distPct = Math.abs(currentPrice - lv.price) / currentPrice * 100;
    if (distPct <= proxPct && distPct < nearestDistPct) {
      nearestDistPct = distPct;
      nearestLevel = lv;
    }
  }

  const levelMet = nearestLevel !== null;

  // --- 2. Reversal candle ---
  // Check extendedPatterns on 15m (full weight) and 5m (0.7x weight) for reversal patterns
  const targetPatternType = direction === 'long' ? 'reversal_bullish' : 'reversal_bearish';
  let bestCandleStrength = 0;
  let bestCandleName = '';

  const patterns15m = ind15m.extendedPatterns || [];
  for (const p of patterns15m) {
    if (p.type === targetPatternType && p.strength > bestCandleStrength) {
      bestCandleStrength = p.strength;
      bestCandleName = p.name.replace(/_/g, ' ');
    }
  }

  if (ind5m) {
    const patterns5m = ind5m.extendedPatterns || [];
    for (const p of patterns5m) {
      const adjusted = p.strength * 0.7;
      if (p.type === targetPatternType && adjusted > bestCandleStrength) {
        bestCandleStrength = adjusted;
        bestCandleName = p.name.replace(/_/g, ' ') + ' (5m)';
      }
    }
  }

  const candleMet = bestCandleStrength >= minCandleStr;

  // --- 3. MACD histogram ---
  const histogram = ind15m.histogram ?? 0;
  const histMag = Math.abs(histogram);
  let macdMet = histMag >= minHistMag;
  if (requireMacdAlign && macdMet) {
    // For long rejection (bullish): histogram should be positive or turning positive
    // For short rejection (bearish): histogram should be negative or turning negative
    const alignedDir = direction === 'long' ? histogram > 0 : histogram < 0;
    macdMet = alignedDir;
  }

  // --- 4. Volume ---
  const volRatio = ind15m.volRatio;
  const volumeMet = volRatio >= minVolRatio;

  // --- Hard AND gate ---
  const allMet = levelMet && candleMet && macdMet && volumeMet;

  const components: RejectionResult['components'] = {
    levelProximity: { met: levelMet, distPct: nearestDistPct === Infinity ? -1 : nearestDistPct, levelPrice: nearestLevel?.price ?? 0 },
    reversalCandle: { met: candleMet, patternName: bestCandleName || 'none', strength: bestCandleStrength },
    macdConfirm: { met: macdMet, histogram },
    volumeConfirm: { met: volumeMet, volRatio },
  };

  if (!allMet) {
    const failedParts: string[] = [];
    if (!levelMet) failedParts.push('no level');
    if (!candleMet) failedParts.push('no candle');
    if (!macdMet) failedParts.push('no MACD');
    if (!volumeMet) failedParts.push('no vol');
    return {
      value: 0.5,
      detected: false,
      rejectedLevel: nearestLevel,
      description: `Rejection incomplete: ${failedParts.join(', ')}`,
      components,
    };
  }

  // All conditions met — score from 0.75 to 1.0 based on component strengths
  let compositeStrength = 0.75;

  // Proximity contribution (closer = stronger)
  const proxContrib = Math.max(0, 1 - nearestDistPct / proxPct) * 0.08;
  compositeStrength += proxContrib;

  // Candle strength contribution
  compositeStrength += Math.min(bestCandleStrength, 1) * 0.08;

  // Volume excess contribution
  const volExcess = Math.min((volRatio - minVolRatio) / minVolRatio, 1) * 0.05;
  compositeStrength += volExcess;

  // MACD magnitude contribution
  const macdExcess = Math.min(histMag / (minHistMag * 5), 1) * 0.04;
  compositeStrength += macdExcess;

  // Reversal detector confluence bonus
  if (reversalSignal?.detected) {
    const reversalAligns = (direction === 'long' && reversalSignal.direction === 'bullish')
      || (direction === 'short' && reversalSignal.direction === 'bearish');
    if (reversalAligns) {
      compositeStrength = Math.min(1, compositeStrength * confluenceBonus);
    }
  }

  compositeStrength = Math.min(1, compositeStrength);

  const levelDesc = nearestLevel
    ? `${nearestLevel.type} ${nearestLevel.price.toFixed(5)} (${nearestDistPct.toFixed(2)}%)`
    : '?';

  return {
    value: compositeStrength,
    detected: true,
    rejectedLevel: nearestLevel,
    description: `Rejection at ${levelDesc}, ${bestCandleName}, vol ${volRatio.toFixed(1)}x`,
    components,
  };
}

/**
 * Weighted signal scoring for Martingale-optimized trading
 * Each signal has a weight based on its importance for 15m entries with HTF confirmation
 */
interface SignalWeight {
  name: string;
  weight: number;
  value: number; // 0-1 based on how well condition is met
}

/**
 * Calculate weighted strength score for a direction (0-100)
 * NOW uses proper EMA-based trend analysis instead of mean-reversion signals
 *
 * Professional trading logic:
 * - TREND is determined by price vs EMAs and EMA alignment (NOT RSI/BB)
 * - RSI/BB are for ENTRY TIMING only
 * - EMA slopes show momentum
 */
export function calculateDirectionStrength(
  direction: 'long' | 'short',
  checks: LongChecks | ShortChecks,
  ind4h: Indicators,
  ind1h: Indicators,
  ind15m: Indicators,
  ind5m: Indicators,
  ind1d: Indicators | null,
  btcTrend: 'bull' | 'bear' | 'neut',
  micro: MicrostructureInput | null,
  liq: LiquidationInput | null,
  signalConfig: SignalEvaluationConfig = DEFAULT_STRATEGY.signals,
  reversalSignal?: ReversalSignal | null,
  ohlc4h?: OHLCData[],
  ohlc1h?: OHLCData[],
  confluentLevels?: PriceLevel[],
  currentPrice?: number,
  strategy?: TradingStrategy
): { strength: number; signals: SignalWeight[]; reasons: string[]; warnings: string[] } {
  const signals: SignalWeight[] = [];
  const reasons: string[] = [];
  const warnings: string[] = [];
  const w = signalConfig.directionWeights;

  // === 1. DAILY TREND (weight: 8) - Trend filter (reduced - trader trusts lower TFs) ===
  if (ind1d) {
    let dailyValue = 0.5;

    // Use the new EMA-based trend, not the old mean-reversion bias
    const dailyTrend = ind1d.trend; // Now properly determined by EMAs
    const dailyScore = ind1d.trendScore; // -100 to +100

    if (direction === 'long') {
      if (dailyTrend === 'bullish') {
        // Scale based on trend strength
        dailyValue = 0.7 + (dailyScore / 100) * 0.3; // 0.7 to 1.0
      } else if (dailyTrend === 'neutral') {
        dailyValue = 0.5;
      } else {
        // Bearish - serious warning for longs
        dailyValue = 0.15 + ((100 + dailyScore) / 200) * 0.2; // 0.15 to 0.35
      }
    } else {
      if (dailyTrend === 'bearish') {
        dailyValue = 0.7 + (Math.abs(dailyScore) / 100) * 0.3;
      } else if (dailyTrend === 'neutral') {
        dailyValue = 0.5;
      } else {
        dailyValue = 0.15 + ((100 - dailyScore) / 200) * 0.2;
      }
    }

    // Bonus for perfect EMA alignment
    if (ind1d.emaAlignment === (direction === 'long' ? 'bullish' : 'bearish')) {
      dailyValue = Math.min(1, dailyValue + 0.1);
    }

    signals.push({ name: '1D Trend', weight: w['1dTrend'], value: dailyValue });

    if (dailyValue >= 0.75) {
      reasons.push(`Daily ${dailyTrend} (${dailyScore > 0 ? '+' : ''}${dailyScore})`);
    }
    if (dailyValue < 0.35) {
      warnings.push(`⚠️ COUNTER-TREND: Daily is ${dailyTrend} (score ${dailyScore})`);
    }
  }

  // === 2. 4H TREND (weight: 15) - Trend context ===
  let htfValue = 0.5;
  const htfTrend = ind4h.trend;
  const htfScore = ind4h.trendScore;

  if (direction === 'long') {
    if (htfTrend === 'bullish') {
      htfValue = 0.7 + (htfScore / 100) * 0.3;
    } else if (htfTrend === 'neutral') {
      htfValue = 0.45;
    } else {
      // 4H bearish - strong warning
      htfValue = 0.1 + ((100 + htfScore) / 200) * 0.25;
    }
  } else {
    if (htfTrend === 'bearish') {
      htfValue = 0.7 + (Math.abs(htfScore) / 100) * 0.3;
    } else if (htfTrend === 'neutral') {
      htfValue = 0.45;
    } else {
      htfValue = 0.1 + ((100 - htfScore) / 200) * 0.25;
    }
  }

  // EMA alignment bonus
  if (ind4h.emaAlignment === (direction === 'long' ? 'bullish' : 'bearish')) {
    htfValue = Math.min(1, htfValue + 0.1);
  }

  // EMA slope momentum bonus/penalty
  const slopeAligned = direction === 'long'
    ? ind4h.ema20Slope > 0.05
    : ind4h.ema20Slope < -0.05;
  if (slopeAligned) {
    htfValue = Math.min(1, htfValue + 0.05);
  }

  signals.push({ name: '4H Trend', weight: w['4hTrend'], value: htfValue });

  if (htfValue >= 0.75) {
    const alignStr = ind4h.emaAlignment === (direction === 'long' ? 'bullish' : 'bearish') ? ' ✓EMA' : '';
    reasons.push(`4H ${htfTrend}${alignStr}`);
  }
  if (htfValue < 0.35) {
    warnings.push(`⚠️ 4H opposes: ${htfTrend} (${htfScore})`);
  }

  // === 3. 1H SETUP / BIAS ===
  const isBreakoutStrat = strategy?.meta.type === 'breakout';
  let setupValue = 0.5;

  if (isBreakoutStrat) {
    // Breakout: 1H bias — more permissive, doesn't penalize extended price
    const bias1h = evaluate1hBreakoutBias(ind1h, direction);
    const maxBiasScore = 8;
    setupValue = Math.min(1, bias1h.score / maxBiasScore);
    if (!bias1h.pass) setupValue = Math.min(setupValue, 0.35);

    signals.push({ name: '1H Bias', weight: w['1hSetup'], value: setupValue });
    if (setupValue >= 0.6) reasons.push(`1H bias: ${bias1h.signals.slice(0, 2).join(', ')}`);
  } else {
    // Swing: 1H setup confirmation
    const setupTrend = ind1h.trend;
    if (direction === 'long') {
      if (setupTrend === 'bullish') setupValue = 0.9;
      else if (setupTrend === 'neutral') setupValue = 0.5;
      else setupValue = 0.25;
    } else {
      if (setupTrend === 'bearish') setupValue = 0.9;
      else if (setupTrend === 'neutral') setupValue = 0.5;
      else setupValue = 0.25;
    }

    signals.push({ name: '1H Setup', weight: w['1hSetup'], value: setupValue });
    if (setupValue >= 0.8) reasons.push(`1H confirms ${ind1h.trend}`);
  }

  // === 4. ENTRY (15m for swing, 5m for breakout) ===
  let entryValue: number;
  if (isBreakoutStrat) {
    // Breakout: use 5m breakout entry evaluator
    const entry5m = evaluate5mBreakoutEntry(ind5m, confluentLevels || [], direction, currentPrice || 0);
    const maxEntryScore = 8;
    entryValue = Math.min(1, entry5m.score / maxEntryScore);
    if (!entry5m.pass) entryValue = Math.min(entryValue, 0.35);

    signals.push({ name: '5m Breakout', weight: w['15mEntry'], value: entryValue });
    if (entryValue >= 0.5) reasons.push(`5m breakout: ${entry5m.signals.slice(0, 2).join(', ')}`);
  } else {
    // Swing: 15m multi-signal entry timing
    const entry15m = direction === 'long'
      ? evaluate15mLongEntry(ind15m)
      : evaluate15mShortEntry(ind15m);
    const maxEntryScore = 7.5;
    entryValue = Math.min(1, entry15m.score / maxEntryScore);
    if (!entry15m.pass) entryValue = Math.min(entryValue, 0.35);

    signals.push({ name: '15m Entry', weight: w['15mEntry'], value: entryValue });
    if (entryValue >= 0.6) reasons.push(`15m entry: ${entry15m.signals.slice(0, 2).join(', ')}`);
  }

  // === 5. Volume ===
  let volValue = 0.5;
  if (isBreakoutStrat) {
    // Breakout: always use 'breakout' context with 5m volume
    const volEval = evaluateVolume(ind5m.volRatio, 'breakout');
    if (volEval.pass) {
      volValue = volEval.quality === 'strong' ? 0.95 : volEval.quality === 'moderate' ? 0.7 : 0.5;
    } else {
      volValue = 0.2; // Volume is critical for breakouts — harsher penalty
    }
  } else {
    // Swing: context-aware volume evaluation
    const volContext = determineEntryContext(ind15m, ind1h, direction);
    const volEval = evaluateVolume(ind15m.volRatio, volContext);
    if (volEval.pass) {
      volValue = volEval.quality === 'strong' ? 0.9 : volEval.quality === 'moderate' ? 0.65 : 0.5;
    } else {
      volValue = 0.25;
    }
  }
  signals.push({ name: 'Volume', weight: w.volume, value: volValue });
  if (volValue >= 0.8) reasons.push(`Strong volume`);

  // 6. BTC alignment (weight: 8) - Correlation
  let btcValue = 0.5;
  if (direction === 'long') {
    if (btcTrend === 'bull') btcValue = 1.0;
    else if (btcTrend === 'neut') btcValue = 0.6;
    else btcValue = 0.3;
  } else {
    if (btcTrend === 'bear') btcValue = 1.0;
    else if (btcTrend === 'neut') btcValue = 0.6;
    else btcValue = 0.3;
  }
  signals.push({ name: 'BTC Align', weight: w.btcAlign, value: btcValue });
  if (btcValue >= 0.8) reasons.push(`BTC ${btcTrend}`);
  if (btcValue < 0.4) warnings.push(`⚠️ BTC opposing: ${btcTrend}`);

  // 7. MACD momentum (weight: 6) - Dead-zone-aware evaluation
  const macdEval = evaluateMACDMomentum(direction, ind15m.histogram, ind15m.macd);
  let macdValue = 0.5;
  if (macdEval.pass) {
    macdValue = macdEval.strength === 'strong' ? 0.95
      : macdEval.strength === 'moderate' ? 0.75 : 0.6;
  } else if (macdEval.strength === 'neutral') {
    macdValue = 0.45; // Dead zone - slightly below neutral
  } else {
    macdValue = 0.2; // Opposing momentum
  }
  signals.push({ name: 'MACD Mom', weight: w.macdMom, value: macdValue });
  if (macdValue >= 0.7) reasons.push(`MACD ${macdEval.description}`);

  // 8. Flow/Microstructure (weight: 4) - When available
  if (micro) {
    const flowAnalysis = analyzeFlow(direction, micro);
    let flowValue = 0.5;
    if (flowAnalysis.status === 'aligned') flowValue = 0.9;
    else if (flowAnalysis.status === 'neutral') flowValue = 0.5;
    else flowValue = 0.2;
    signals.push({ name: 'Flow', weight: w.flow, value: flowValue });
    if (flowValue >= 0.8) reasons.push(`Flow aligned (${flowAnalysis.cvdTrend} CVD)`);
    if (flowValue < 0.3) warnings.push(`⚠️ Flow opposing`);
    if (flowAnalysis.hasDivergence) {
      if ((direction === 'long' && flowAnalysis.divergenceType === 'bearish') ||
          (direction === 'short' && flowAnalysis.divergenceType === 'bullish')) {
        warnings.push(`⚠️ ${flowAnalysis.divergenceType} divergence detected`);
      }
    }
  }

  // 9. Liquidation zones + derivatives (weight: liq, default 6) - When available
  // Enhanced with OI trend and funding extreme detection (Phase 2)
  if (liq && liq.currentPrice > 0) {
    const liqAnalysis = analyzeLiquidation(direction, liq);
    let liqValue = 0.5; // Neutral baseline

    // Magnet effect: strong directional pull
    if (liqAnalysis.magnetEffect === 'aligned') liqValue += 0.25;
    else if (liqAnalysis.magnetEffect === 'opposing') liqValue -= 0.2;

    // Wall effect: cascade fuel or blockade
    if (liqAnalysis.wallEffect === 'supporting') liqValue += 0.15;
    else if (liqAnalysis.wallEffect === 'blocking') liqValue -= 0.15;

    // Asymmetry: fuel balance
    if (liqAnalysis.asymmetry === 'strong_aligned') liqValue += 0.15;
    else if (liqAnalysis.asymmetry === 'mild_aligned') liqValue += 0.08;
    else if (liqAnalysis.asymmetry === 'opposing') liqValue -= 0.1;

    // Funding extreme detection (derivatives enhancement)
    const derivConfig = strategy?.derivatives;
    const fundingThreshold = derivConfig?.fundingExtremeThreshold ?? 0.01;
    if (liq.fundingRate !== null) {
      const fr = liq.fundingRate;
      if (direction === 'long' && fr < -fundingThreshold) {
        // Extremely negative funding = shorts paying longs = bullish
        liqValue += 0.1;
        reasons.push(`Funding extreme: ${(fr * 100).toFixed(3)}% (bullish)`);
      } else if (direction === 'long' && fr > fundingThreshold) {
        // Extremely positive funding = longs paying shorts = crowded long = bearish for longs
        liqValue -= 0.1;
      } else if (direction === 'short' && fr > fundingThreshold) {
        // Extremely positive funding = crowded long = good for shorts
        liqValue += 0.1;
        reasons.push(`Funding extreme: +${(fr * 100).toFixed(3)}% (bearish)`);
      } else if (direction === 'short' && fr < -fundingThreshold) {
        liqValue -= 0.1;
      }
    }

    liqValue = Math.max(0, Math.min(1, liqValue));

    signals.push({ name: 'Liq Zones', weight: w.liq ?? 6, value: liqValue });
    if (liqValue >= 0.75) reasons.push(`Liq zones aligned (${liqAnalysis.magnetEffect !== 'none' ? 'magnet' : 'fuel'})`);
    if (liqValue < 0.35) warnings.push(`⚠️ Liq zones opposing`);
  }

  // 10. Candlestick patterns (weight: 8) - 5m and 15m structural patterns
  const candlePatterns5m = ind5m.candlestickPatterns || [];
  const candlePatterns15m = ind15m.candlestickPatterns || [];
  const targetDir = direction === 'long' ? 'bullish' : 'bearish';
  let candleValue = 0.5; // Neutral baseline
  let candleReason = '';

  // 15m patterns weighted 2x vs 5m (more significant timeframe)
  for (const p of candlePatterns15m) {
    if (p.direction === targetDir) {
      candleValue += p.strength * 0.3;
      if (!candleReason) candleReason = p.name.replace(/_/g, ' ');
    } else if (p.direction !== 'neutral') {
      candleValue -= p.strength * 0.2;
    }
  }
  for (const p of candlePatterns5m) {
    if (p.direction === targetDir) {
      candleValue += p.strength * 0.15;
      if (!candleReason) candleReason = p.name.replace(/_/g, ' ');
    } else if (p.direction !== 'neutral') {
      candleValue -= p.strength * 0.1;
    }
  }
  candleValue = Math.max(0, Math.min(1, candleValue));

  signals.push({ name: 'Candles', weight: w.candlestick ?? 4, value: candleValue });
  if (candleValue >= 0.7 && candleReason) reasons.push(`Candle: ${candleReason}`);
  if (candleValue < 0.3) warnings.push(`⚠️ Opposing candlestick pattern`);

  // 11. Reversal / Exhaustion Gate (weight: 12) - "Trade the reversal, not the chase"
  // Boosts the reversal direction and penalizes the exhausted direction
  const reversalWeight = w.reversal ?? 12;
  if (reversalSignal && reversalSignal.detected) {
    let reversalValue = 0.5; // Neutral baseline

    // Does the reversal ALIGN with this direction?
    // E.g., bullish reversal aligns with 'long', bearish reversal aligns with 'short'
    const reversalAligns = (direction === 'long' && reversalSignal.direction === 'bullish')
      || (direction === 'short' && reversalSignal.direction === 'bearish');

    if (reversalAligns) {
      // Reversal supports this direction — BOOST based on confidence and phase
      const phaseMultiplier = {
        exhaustion: 0.3,   // Early — mild boost
        indecision: 0.5,   // Developing
        initiation: 0.7,   // Clear signal
        confirmation: 0.9, // Strong signal
      }[reversalSignal.phase];

      reversalValue = 0.5 + phaseMultiplier * (reversalSignal.confidence / 100) * 0.5;
      reversalValue = Math.min(1, reversalValue);

      // S/R confluence boost: reversal at key level is stronger
      if (confluentLevels && confluentLevels.length > 0 && currentPrice && currentPrice > 0) {
        const klCfg = strategy?.keyLevels;
        const proxPct = klCfg?.reversalAtLevelProximityPct ?? klCfg?.nearProximityPct ?? 1.0;
        const mult = klCfg?.reversalAtLevelMultiplier ?? 1.35;
        const atKeyLevel = confluentLevels.some(lv => {
          const dist = Math.abs(currentPrice - lv.price) / currentPrice * 100;
          if (dist > proxPct) return false;
          return (reversalSignal.direction === 'bullish' && lv.type === 'support')
              || (reversalSignal.direction === 'bearish' && lv.type === 'resistance');
        });
        if (atKeyLevel) {
          reversalValue = Math.min(1, reversalValue * mult);
          reasons.push(`reversal at key ${reversalSignal.direction === 'bullish' ? 'support' : 'resistance'}`);
        }
      }

      if (reversalValue >= 0.7) {
        reasons.push(`↺ ${reversalSignal.phase} reversal (${reversalSignal.confidence}%)`);
      }
    } else {
      // Reversal OPPOSES this direction — this direction is exhausting, PENALIZE
      const phaseMultiplier = {
        exhaustion: 0.15,  // Early — mild penalty
        indecision: 0.25,  // Developing
        initiation: 0.35,  // Clear counter-signal
        confirmation: 0.45,// Strong counter-signal
      }[reversalSignal.phase];

      reversalValue = 0.5 - phaseMultiplier * (reversalSignal.confidence / 100);
      reversalValue = Math.max(0, reversalValue);

      if (reversalValue < 0.3) {
        warnings.push(`⚠️ ${reversalSignal.phase} reversal opposing (${reversalSignal.confidence}%)`);
      }
      if (reversalSignal.exhaustionScore > 60) {
        warnings.push(`⚠️ Direction exhausting (${reversalSignal.exhaustionScore}%)`);
      }
    }

    signals.push({ name: 'Reversal', weight: reversalWeight, value: reversalValue });
  } else {
    // No reversal detected — neutral contribution (doesn't help or hurt)
    signals.push({ name: 'Reversal', weight: reversalWeight, value: 0.5 });
  }

  // 12. Market Structure (weight: configurable, default 10) — HH/HL vs LH/LL swing analysis
  const marketStructureWeight = w.marketStructure ?? 10;
  if (marketStructureWeight > 0 && (ohlc4h || ohlc1h)) {
    const ms = evaluateMarketStructure(direction, ohlc4h, ohlc1h);
    signals.push({ name: 'Structure', weight: marketStructureWeight, value: ms.value });
    if (ms.value >= 0.75) reasons.push(`Structure: ${ms.description}`);
    if (ms.value < 0.3) warnings.push(`⚠️ Structure opposes: ${ms.description}`);
  }

  // 13. Key Level Proximity (weight: configurable, default 8) — S/R distance + RR check
  const keyLevelWeight = w.keyLevelProximity ?? 8;
  if (keyLevelWeight > 0 && confluentLevels && confluentLevels.length > 0 && currentPrice && currentPrice > 0) {
    const klConfig = strategy?.keyLevels;
    const kl = evaluateKeyLevelProximity(direction, currentPrice, confluentLevels, klConfig);
    signals.push({ name: 'Key Levels', weight: keyLevelWeight, value: kl.value });
    if (kl.value >= 0.7) reasons.push(`Levels: ${kl.description}`);
    if (kl.rrWarning) warnings.push(`⚠️ Poor RR: ${kl.description}`);
  }

  // 14. Rejection Signal (weight: configurable, default 0) — composite S/R rejection
  const rejectionWeight = w.rejection ?? 0;
  if (rejectionWeight > 0 && confluentLevels && confluentLevels.length > 0 && currentPrice && currentPrice > 0) {
    const rej = evaluateRejection(direction, currentPrice, confluentLevels, ind15m, ind5m, strategy?.rejection, reversalSignal);
    signals.push({ name: 'Rejection', weight: rejectionWeight, value: rej.value });
    if (rej.detected) reasons.push(`Rejection at ${rej.rejectedLevel?.price.toFixed(5) ?? '?'}`);
  }

  // Calculate weighted strength
  let totalWeight = 0;
  let weightedSum = 0;
  for (const signal of signals) {
    totalWeight += signal.weight;
    weightedSum += signal.weight * signal.value;
  }
  const strength = Math.round((weightedSum / totalWeight) * 100);

  return { strength, signals, reasons, warnings };
}

/**
 * Get letter grade from strength score
 */
export function getGradeFromStrength(
  strength: number,
  thresholds: SignalEvaluationConfig['gradeThresholds'] = DEFAULT_STRATEGY.signals.gradeThresholds
): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (strength >= thresholds.A) return 'A';
  if (strength >= thresholds.B) return 'B';
  if (strength >= thresholds.C) return 'C';
  if (strength >= thresholds.D) return 'D';
  return 'F';
}

/**
 * Detect momentum opportunities (sudden moves for Martingale)
 */
export function detectMomentum(
  ind5m: Indicators,
  ind15m: Indicators,
  ind1h: Indicators
): { direction: 'up' | 'down'; strength: 'strong' | 'moderate'; reason: string } | null {
  // Check for strong momentum conditions
  const vol5m = ind5m.volRatio;
  const vol15m = ind15m.volRatio;

  // Strong upward momentum
  if (ind5m.rsi < 30 && vol5m > 1.8 && ind15m.rsi < 40) {
    return {
      direction: 'up',
      strength: vol5m > 2.5 ? 'strong' : 'moderate',
      reason: `Oversold bounce: 5m RSI ${ind5m.rsi.toFixed(0)}, Vol ${vol5m.toFixed(1)}x`,
    };
  }

  // Strong downward momentum
  if (ind5m.rsi > 70 && vol5m > 1.8 && ind15m.rsi > 60) {
    return {
      direction: 'down',
      strength: vol5m > 2.5 ? 'strong' : 'moderate',
      reason: `Overbought drop: 5m RSI ${ind5m.rsi.toFixed(0)}, Vol ${vol5m.toFixed(1)}x`,
    };
  }

  // Cascade momentum (when 15m and 1h align with 5m spike)
  if (ind5m.volRatio > 2.0) {
    if (ind5m.rsi < 35 && ind15m.macd < 0 && ind1h.macd < 0) {
      return {
        direction: 'down',
        strength: 'strong',
        reason: `Cascade selling: All TFs bearish momentum, Vol ${vol5m.toFixed(1)}x`,
      };
    }
    if (ind5m.rsi > 65 && ind15m.macd > 0 && ind1h.macd > 0) {
      return {
        direction: 'up',
        strength: 'strong',
        reason: `Cascade buying: All TFs bullish momentum, Vol ${vol5m.toFixed(1)}x`,
      };
    }
  }

  return null;
}

/**
 * Apply knife gate to trading action
 * Returns modified action, warnings, size multiplier, and flip suggestion
 */
export function applyKnifeGate(
  action: 'LONG' | 'SHORT' | 'WAIT' | 'SPIKE ↑' | 'SPIKE ↓',
  knife: KnifeAnalysis | null
): {
  gatedAction: 'LONG' | 'SHORT' | 'WAIT' | 'SPIKE ↑' | 'SPIKE ↓';
  warnings: string[];
  sizeMultiplier: number;
  flipSuggestion: boolean;
} {
  if (!knife || !knife.isKnife) {
    return { gatedAction: action, warnings: [], sizeMultiplier: 1.0, flipSuggestion: false };
  }

  // Determine if this is a counter-trend action
  const isCounterTrend =
    (action === 'LONG' && knife.direction === 'falling') ||
    (action === 'SHORT' && knife.direction === 'rising') ||
    (action === 'SPIKE ↑' && knife.direction === 'falling') ||
    (action === 'SPIKE ↓' && knife.direction === 'rising');

  if (!isCounterTrend) {
    // With-trend during capitulation = late entry warning, reduced size
    if (knife.phase === 'capitulation') {
      return {
        gatedAction: action,
        warnings: ['Late trend entry - reduced size'],
        sizeMultiplier: 0.5,
        flipSuggestion: false,
      };
    }
    return { gatedAction: action, warnings: [], sizeMultiplier: 1.0, flipSuggestion: false };
  }

  // Counter-trend gating by phase
  switch (knife.phase) {
    case 'impulse':
    case 'capitulation':
      return {
        gatedAction: 'WAIT',
        warnings: [`🔪 ${knife.direction} knife: ${knife.phase} - BLOCKED`],
        sizeMultiplier: 0,
        flipSuggestion: true,
      };

    case 'stabilizing':
      if (!knife.signals.reclaimed && !knife.signals.microStructureShift) {
        return {
          gatedAction: 'WAIT',
          warnings: ['🔪 Stabilizing, no confirmation yet'],
          sizeMultiplier: 0,
          flipSuggestion: false,
        };
      }
      // Early confirmation - reduced size
      return {
        gatedAction: action,
        warnings: ['🔪 Early confirmation, reduced size'],
        sizeMultiplier: 0.4,
        flipSuggestion: false,
      };

    case 'confirming':
      const mult = knife.signals.retestQuality === 'good' ? 0.8 : 0.5;
      return {
        gatedAction: action,
        warnings: mult < 0.8 ? ['🔪 Awaiting quality retest'] : [],
        sizeMultiplier: mult,
        flipSuggestion: false,
      };

    case 'safe':
      return { gatedAction: action, warnings: [], sizeMultiplier: 1.0, flipSuggestion: false };

    default:
      return { gatedAction: action, warnings: [], sizeMultiplier: 1.0, flipSuggestion: false };
  }
}

/**
 * Generate trading recommendation
 */
export function generateRecommendation(
  tf4h: TimeframeData,
  tf1h: TimeframeData,
  tf15m: TimeframeData,
  tf5m: TimeframeData,
  btcTrend: 'bull' | 'bear' | 'neut',
  btcChange: number,
  micro?: MicrostructureInput | null,
  liq?: LiquidationInput | null,
  tf1d?: TimeframeData | null,
  currentPrice?: number,
  exchange?: string,
  pair?: string,
  strategy?: TradingStrategy
): TradingRecommendation | null {
  const strat = strategy ?? DEFAULT_STRATEGY;
  const signalConfig = strat.signals;
  const spikeConfig = strat.spike;
  const ind4h = tf4h.indicators;
  const ind1h = tf1h.indicators;
  const ind15m = tf15m.indicators;
  const ind5m = tf5m.indicators;
  const ind1d = tf1d?.indicators || null;

  if (!ind4h || !ind1h || !ind15m || !ind5m) {
    return null;
  }

  // Reversal detection — analyze OHLC across available timeframes
  // Build timeframe data dynamically from what's available
  const reversalOhlc: Record<string, typeof tf5m.ohlc> = {};
  const reversalInd: Record<string, Indicators> = {};
  if (tf5m.ohlc?.length >= 5 && ind5m) { reversalOhlc['5'] = tf5m.ohlc; reversalInd['5'] = ind5m; }
  if (tf15m.ohlc?.length >= 5 && ind15m) { reversalOhlc['15'] = tf15m.ohlc; reversalInd['15'] = ind15m; }

  let reversalSignal: ReversalSignal | null = null;
  if (Object.keys(reversalOhlc).length > 0) {
    reversalSignal = detectReversal({
      ohlcByTimeframe: reversalOhlc,
      indicatorsByTimeframe: reversalInd,
      currentDirection: null, // No position context in recommendation engine
      timeframePriority: ['5', '15'],
    });
  }

  // Market regime detection (moved up — needed for Fibonacci regime gating)
  const regimeAnalysis = detectMarketRegime(ind4h, ind1h, strat.regime);

  // Build chart context for market structure + key level analysis
  const ohlcMap: Record<number, OHLCData[]> = {};
  if (tf1d?.ohlc) ohlcMap[1440] = tf1d.ohlc;
  if (tf4h.ohlc) ohlcMap[240] = tf4h.ohlc;
  if (tf1h.ohlc) ohlcMap[60] = tf1h.ohlc;
  if (tf15m.ohlc) ohlcMap[15] = tf15m.ohlc;
  if (tf5m.ohlc) ohlcMap[5] = tf5m.ohlc;
  const chartContext = Object.keys(ohlcMap).length > 0
    ? buildChartContext(ohlcMap, pair || 'XRPEUR', strat.fibonacci, regimeAnalysis.regime)
    : null;
  const confluentLevels = chartContext?.confluentLevels ?? [];
  const effectivePrice = currentPrice ?? (tf15m.ohlc?.[tf15m.ohlc.length - 1]?.close) ?? 0;

  // Evaluate both directions (with microstructure, liquidation, and daily data)
  const longChecks = evaluateLongConditions(ind4h, ind1h, ind15m, btcTrend, micro, liq, ind1d, strat, ind5m, confluentLevels, effectivePrice, tf5m.ohlc);
  const shortChecks = evaluateShortConditions(ind4h, ind1h, ind15m, btcTrend, micro, liq, ind1d, strat, ind5m, confluentLevels, effectivePrice, tf5m.ohlc);

  // Calculate weighted strength scores for BOTH directions (with reversal + structure + levels)
  const longStrengthResult = calculateDirectionStrength('long', longChecks, ind4h, ind1h, ind15m, ind5m, ind1d, btcTrend, micro || null, liq || null, signalConfig, reversalSignal, tf4h.ohlc, tf1h.ohlc, confluentLevels, effectivePrice, strat);
  const shortStrengthResult = calculateDirectionStrength('short', shortChecks, ind4h, ind1h, ind15m, ind5m, ind1d, btcTrend, micro || null, liq || null, signalConfig, reversalSignal, tf4h.ohlc, tf1h.ohlc, confluentLevels, effectivePrice, strat);

  // Base score (6-7 conditions depending on daily availability, excluding flowConfirm and liqBias)
  const longPassed = countPassed(longChecks, false);
  const shortPassed = countPassed(shortChecks, false);

  // Full score including all extras (for display)
  const longPassedFull = countPassed(longChecks, true);
  const shortPassedFull = countPassed(shortChecks, true);

  // Calculate total items in base checklist (core + optional flow/liquidation)
  let totalItems = getTotalBaseConditions(longChecks);
  if (micro) totalItems++;
  if (liq) totalItems++;

  // Format checklists for BOTH directions
  const liqConfig = strat.liquidation;
  const longChecklist = formatChecklist(longChecks, 'long', ind4h, ind1h, ind15m, btcTrend, btcChange, micro, liq, ind1d, liqConfig, reversalSignal, tf4h.ohlc, tf1h.ohlc, confluentLevels, effectivePrice, strat, ind5m, tf5m.ohlc);
  const shortChecklist = formatChecklist(shortChecks, 'short', ind4h, ind1h, ind15m, btcTrend, btcChange, micro, liq, ind1d, liqConfig, reversalSignal, tf4h.ohlc, tf1h.ohlc, confluentLevels, effectivePrice, strat, ind5m, tf5m.ohlc);

  // Determine which setup is stronger (based on weighted strength)
  const bestSetup = longStrengthResult.strength >= shortStrengthResult.strength ? 'long' : 'short';
  const bestChecks = bestSetup === 'long' ? longChecks : shortChecks;

  // Flow analysis for both directions
  const longFlowAnalysis = analyzeFlow('long', micro || null);
  const shortFlowAnalysis = analyzeFlow('short', micro || null);
  const longLiqAnalysis = analyzeLiquidation('long', liq || null, liqConfig);
  const shortLiqAnalysis = analyzeLiquidation('short', liq || null, liqConfig);

  // Build DirectionRecommendation for LONG
  const longRec: DirectionRecommendation = {
    strength: longStrengthResult.strength,
    confidence: Math.round(Math.min(95, Math.max(5, longStrengthResult.strength + longFlowAnalysis.adjustments.total + longLiqAnalysis.adjustments.total))),
    grade: getGradeFromStrength(longStrengthResult.strength, signalConfig.gradeThresholds),
    reasons: longStrengthResult.reasons,
    warnings: [...longStrengthResult.warnings],
    checklist: longChecklist,
    passedCount: longPassedFull,
    totalCount: totalItems,
  };

  // Build DirectionRecommendation for SHORT
  const shortRec: DirectionRecommendation = {
    strength: shortStrengthResult.strength,
    confidence: Math.round(Math.min(95, Math.max(5, shortStrengthResult.strength + shortFlowAnalysis.adjustments.total + shortLiqAnalysis.adjustments.total))),
    grade: getGradeFromStrength(shortStrengthResult.strength, signalConfig.gradeThresholds),
    reasons: shortStrengthResult.reasons,
    warnings: [...shortStrengthResult.warnings],
    checklist: shortChecklist,
    passedCount: shortPassedFull,
    totalCount: totalItems,
  };

  // Add liquidation warnings
  if (liq) {
    if (liq.bias === 'long_squeeze' && liq.biasStrength > 0.3) {
      longRec.warnings.push(`⚠️ Long squeeze risk (${(liq.biasStrength * 100).toFixed(0)}%)`);
    }
    if (liq.bias === 'short_squeeze' && liq.biasStrength > 0.3) {
      shortRec.warnings.push(`⚠️ Short squeeze risk (${(liq.biasStrength * 100).toFixed(0)}%)`);
    }
  }

  // Detect momentum opportunities for Martingale
  const momentum = detectMomentum(ind5m, ind15m, ind1h);

  // Generate primary action recommendation
  let action: TradingRecommendation['action'] = 'WAIT';
  let reason = '';
  let baseConfidence = 0;

  // Use regime-adjusted action threshold instead of fixed strategy value
  const { directionLeadThreshold, sitOnHandsThreshold } = signalConfig;
  const actionThreshold = regimeAnalysis.adjustedActionThreshold;
  const fullConfidenceThreshold = strat.positionSizing.fullEntryConfidence;

  if (longStrengthResult.strength >= actionThreshold && longStrengthResult.strength > shortStrengthResult.strength + directionLeadThreshold) {
    action = 'LONG';
    const confidenceNote = longStrengthResult.strength < fullConfidenceThreshold ? ` (below ${fullConfidenceThreshold}% confidence threshold)` : '';
    reason = `LONG Grade ${longRec.grade} (${longStrengthResult.strength}%): ${longStrengthResult.reasons.slice(0, 3).join(', ')}.${confidenceNote}`;
    baseConfidence = longStrengthResult.strength;
  } else if (shortStrengthResult.strength >= actionThreshold && shortStrengthResult.strength > longStrengthResult.strength + directionLeadThreshold) {
    action = 'SHORT';
    const confidenceNote = shortStrengthResult.strength < fullConfidenceThreshold ? ` (below ${fullConfidenceThreshold}% confidence threshold)` : '';
    reason = `SHORT Grade ${shortRec.grade} (${shortStrengthResult.strength}%): ${shortStrengthResult.reasons.slice(0, 3).join(', ')}.${confidenceNote}`;
    baseConfidence = shortStrengthResult.strength;
  } else if (Math.max(longStrengthResult.strength, shortStrengthResult.strength) >= sitOnHandsThreshold) {
    // Between sitOnHands and action threshold: forming but not actionable
    action = 'WAIT';
    const strongerDir = longStrengthResult.strength >= shortStrengthResult.strength ? 'LONG' : 'SHORT';
    const strongerStrength = Math.max(longStrengthResult.strength, shortStrengthResult.strength);
    reason = `SIT ON HANDS. ${strongerDir} forming (${strongerStrength}%). LONG ${longRec.grade} vs SHORT ${shortRec.grade}. Not yet actionable.`;
    baseConfidence = strongerStrength * 0.7;
  } else {
    action = 'WAIT';
    reason = `SIT ON HANDS. Weak setups. LONG ${longRec.grade} (${longStrengthResult.strength}%), SHORT ${shortRec.grade} (${shortStrengthResult.strength}%). No edge.`;
    baseConfidence = 20;
  }

  // Check for 5m spike — informational only, no longer overrides action
  // Spikes on 5m are too short-lived to drive trade decisions; they appear as warnings instead
  const spike = detectSpike(ind5m, spikeConfig);

  // Knife detection and gating
  let knifeAnalysis: KnifeAnalysis | null = null;
  let knifeSizeMultiplier = 1.0;
  let knifeFlipSuggestion = false;

  if (KNIFE_GATING_ENABLED && tf15m.ohlc && tf5m.ohlc && tf1h.ohlc && tf4h.ohlc) {
    knifeAnalysis = detectKnife(
      tf15m.ohlc,
      tf5m.ohlc,
      tf1h.ohlc,
      tf4h.ohlc,
      exchange || 'kraken',
      pair || 'XRPEUR'
    );

    if (knifeAnalysis.isKnife) {
      const knifeGateResult = applyKnifeGate(action, knifeAnalysis);
      action = knifeGateResult.gatedAction;
      knifeSizeMultiplier = knifeGateResult.sizeMultiplier;
      knifeFlipSuggestion = knifeGateResult.flipSuggestion;

      // Add knife warnings to appropriate direction
      if (knifeAnalysis.direction === 'falling') {
        longRec.warnings.push(...knifeGateResult.warnings);
      } else {
        shortRec.warnings.push(...knifeGateResult.warnings);
      }

      // Update reason if action was blocked
      if (knifeGateResult.gatedAction === 'WAIT' && action !== 'WAIT') {
        reason = `🔪 ${knifeAnalysis.direction} knife (${knifeAnalysis.phase}): ${knifeAnalysis.reasons.join('. ')}`;
      }
    }
  }

  // Collect all warnings
  const allWarnings: string[] = [];
  if (knifeAnalysis?.isKnife) {
    allWarnings.push(`🔪 ${knifeAnalysis.direction} knife: ${knifeAnalysis.phase}`);
    if (knifeAnalysis.waitFor.length > 0) {
      allWarnings.push(`Wait for: ${knifeAnalysis.waitFor.join(', ')}`);
    }
    if (knifeFlipSuggestion) {
      const flipDir = knifeAnalysis.direction === 'falling' ? 'SHORT' : 'LONG';
      allWarnings.push(`💡 Consider ${flipDir} instead (trend-follow)`);
    }
  }
  if (spike.isSpike) {
    const spikeDir = spike.direction === 'long' ? '↑' : '↓';
    allWarnings.push(`⚡ 5m spike ${spikeDir}: RSI ${ind5m.rsi.toFixed(0)}, Vol ${ind5m.volRatio.toFixed(1)}x`);
  }
  if (momentum) {
    allWarnings.push(`🎯 Momentum ${momentum.direction}: ${momentum.reason}`);
  }
  if (ind15m.atr && currentPrice && currentPrice > 0) {
    const atrPercent = (ind15m.atr / currentPrice) * 100;
    if (atrPercent > 3) {
      allWarnings.push(`⚠️ High volatility (ATR ${atrPercent.toFixed(1)}%)`);
    }
  }
  if (longFlowAnalysis.hasDivergence) {
    allWarnings.push(`Divergence: ${longFlowAnalysis.divergenceType}`);
  }
  // Reversal warnings
  if (reversalSignal && reversalSignal.detected && reversalSignal.confidence >= 40) {
    const revDir = reversalSignal.direction === 'bullish' ? '↑ Bullish' : '↓ Bearish';
    allWarnings.push(`↺ ${revDir} reversal ${reversalSignal.phase} (${reversalSignal.confidence}%)`);
    if (reversalSignal.exhaustionScore > 50) {
      allWarnings.push(`⚡ Direction exhaustion: ${reversalSignal.exhaustionScore}%`);
    }
  }

  // Apply adjustments to confidence
  const flowAnalysis = bestSetup === 'long' ? longFlowAnalysis : shortFlowAnalysis;
  const liqAnalysis = bestSetup === 'long' ? longLiqAnalysis : shortLiqAnalysis;
  let confidence = baseConfidence + flowAnalysis.adjustments.total + liqAnalysis.adjustments.total;

  // Reversal confidence adjustment
  // If recommended direction aligns with a developing reversal, boost confidence
  // If entering against a reversal, reduce confidence
  if (reversalSignal && reversalSignal.detected && action !== 'WAIT') {
    const recAligns = (action === 'LONG' && reversalSignal.direction === 'bullish')
      || (action === 'SHORT' && reversalSignal.direction === 'bearish');
    if (recAligns && reversalSignal.confidence >= 50) {
      confidence += Math.round(reversalSignal.confidence / 10); // +5 to +10
    } else if (!recAligns && reversalSignal.confidence >= 40) {
      confidence -= Math.round(reversalSignal.confidence / 8); // -5 to -12
    }
  }

  // Session filter — adjust confidence based on trading session
  const sessionConfig = strat.session;
  if (sessionConfig?.enabled) {
    const session = getTradingSession();
    if (session.isWeekend) {
      confidence += sessionConfig.weekendDiscount;
      allWarnings.push(`Weekend session (${sessionConfig.weekendDiscount})`);
    } else if (session.phase === 'asia') {
      confidence += sessionConfig.asiaDiscount;
    } else if (session.phase === 'transition') {
      confidence += sessionConfig.transitionDiscount;
    } else if (session.phase === 'overlap_europe_us') {
      confidence += sessionConfig.overlapBonus;
    }
  }

  // Spread guardrail — penalize/block when spread is abnormally wide
  const spreadConfig = strat.spreadGuard;
  if (spreadConfig?.enabled && micro && micro.avgSpreadPercent > 0) {
    const spreadRatio = micro.spreadPercent / micro.avgSpreadPercent;
    if (spreadRatio >= spreadConfig.blockMultiplier) {
      confidence += spreadConfig.blockPenalty;
      allWarnings.push(`⚠️ Wide spread ${spreadRatio.toFixed(1)}x avg (${spreadConfig.blockPenalty})`);
    } else if (spreadRatio >= spreadConfig.warnMultiplier) {
      confidence += spreadConfig.warnPenalty;
      allWarnings.push(`Spread ${spreadRatio.toFixed(1)}x avg (${spreadConfig.warnPenalty})`);
    }
  }

  // RR warning from key level analysis
  if (confluentLevels.length > 0 && effectivePrice > 0 && action !== 'WAIT') {
    const rrDir = action === 'LONG' ? 'long' : action === 'SHORT' ? 'short' : null;
    if (rrDir) {
      const rrCheck = evaluateKeyLevelProximity(rrDir, effectivePrice, confluentLevels, strat.keyLevels);
      if (rrCheck.rrWarning && rrCheck.rrRatio !== null) {
        allWarnings.push(`⚠️ Low RR ratio ${rrCheck.rrRatio.toFixed(1)}:1 (min ${strat.keyLevels?.rrWarningRatio ?? 1.0}:1)`);
      }
    }
  }

  // ATR volatility adjustment
  if (ind15m.atr && currentPrice && currentPrice > 0) {
    const atrPercent = (ind15m.atr / currentPrice) * 100;
    if (atrPercent > 3) {
      confidence -= 10;
    } else if (atrPercent < 1.5) {
      confidence += 5;
    }
  }

  // Cap confidence and round to integer
  confidence = Math.round(Math.min(Math.max(confidence, 5), 95));

  // WAIT signals must never pass position sizing gate
  if (action === 'WAIT') {
    confidence = Math.min(confidence, strat.positionSizing.minEntryConfidence - 1);
  }

  return {
    action,
    confidence,
    baseConfidence: Math.round(baseConfidence),
    reason,
    longScore: longPassedFull,
    shortScore: shortPassedFull,
    totalItems,
    long: longRec,
    short: shortRec,
    warnings: allWarnings,
    momentumAlert: momentum || undefined,
    checklist: bestSetup === 'long' ? longChecklist : shortChecklist,
    flowStatus: micro ? {
      status: flowAnalysis.status,
      imbalance: flowAnalysis.imbalance,
      cvdTrend: flowAnalysis.cvdTrend,
      hasDivergence: flowAnalysis.hasDivergence,
      divergenceType: flowAnalysis.divergenceType,
      spreadStatus: flowAnalysis.spreadStatus,
      whaleActivity: flowAnalysis.whaleActivity,
      adjustments: flowAnalysis.adjustments,
    } : undefined,
    liquidationStatus: liq ? {
      bias: liqAnalysis.bias,
      biasStrength: liqAnalysis.biasStrength,
      fundingRate: liqAnalysis.fundingRate,
      nearestTarget: liqAnalysis.nearestTarget,
      aligned: liqAnalysis.aligned,
      magnetEffect: liqAnalysis.magnetEffect,
      wallEffect: liqAnalysis.wallEffect,
      asymmetry: liqAnalysis.asymmetry,
      description: liqAnalysis.description,
      adjustments: liqAnalysis.adjustments,
    } : undefined,
    knifeStatus: knifeAnalysis?.isKnife ? {
      isKnife: true,
      direction: knifeAnalysis.direction,
      phase: knifeAnalysis.phase,
      brokenLevel: knifeAnalysis.brokenLevel,
      knifeScore: knifeAnalysis.knifeScore,
      reversalReadiness: knifeAnalysis.reversalReadiness,
      gateAction: knifeAnalysis.gateAction,
      sizeMultiplier: knifeSizeMultiplier,
      flipSuggestion: knifeFlipSuggestion,
      signals: knifeAnalysis.signals,
      waitFor: knifeAnalysis.waitFor,
      reasons: knifeAnalysis.reasons,
    } : undefined,
    reversalStatus: reversalSignal?.detected ? {
      detected: true,
      phase: reversalSignal.phase,
      direction: reversalSignal.direction,
      confidence: reversalSignal.confidence,
      exhaustionScore: reversalSignal.exhaustionScore,
      urgency: reversalSignal.urgency,
      description: reversalSignal.description,
      patterns: reversalSignal.patterns
        .filter(p => p.type.startsWith('reversal_'))
        .slice(0, 5)
        .map(p => p.name.replace(/_/g, ' ')),
    } : undefined,
    rejectionStatus: (() => {
      if (!strat.rejection?.enabled || !confluentLevels.length || effectivePrice <= 0) return undefined;
      // Evaluate rejection for both directions, return the one that detected
      for (const dir of ['long', 'short'] as const) {
        const rej = evaluateRejection(dir, effectivePrice, confluentLevels, ind15m, ind5m, strat.rejection, reversalSignal);
        if (rej.detected) {
          return {
            detected: true,
            direction: (dir === 'long' ? 'bullish' : 'bearish') as 'bullish' | 'bearish',
            description: rej.description,
            rejectedLevel: rej.rejectedLevel ? {
              price: rej.rejectedLevel.price,
              type: rej.rejectedLevel.type,
              strength: rej.rejectedLevel.strength,
            } : undefined,
            components: rej.components,
          };
        }
      }
      return undefined;
    })(),
    regimeStatus: {
      regime: regimeAnalysis.regime,
      confidence: regimeAnalysis.confidence,
      adx: regimeAnalysis.adx,
      bbWidthPercent: regimeAnalysis.bbWidthPercent,
      adjustedActionThreshold: regimeAnalysis.adjustedActionThreshold,
      adjustedTimeboxMaxHours: regimeAnalysis.adjustedTimeboxMaxHours,
      description: regimeAnalysis.description,
    },
  };
}

/**
 * Calculate position sizing (v2)
 *
 * v2 changes:
 * - No stop loss (trader accepts liquidation risk)
 * - No fixed take-profit (exit signals handle this)
 * - DCA levels are dynamic (triggered by momentum exhaustion, not fixed %)
 * - Shows estimated liquidation price based on margin/leverage
 */
export function calculatePosition(
  capital: number,
  currentPrice: number,
  direction: 'long' | 'short' = 'long',
  strategy: TradingStrategy = DEFAULT_STRATEGY
): {
  positionSize: number;
  marginUsed: number;
  estimatedLiquidation: number;
  liquidationDistancePercent: number;
  dcaCapacity: { dcasRemaining: number; marginPerDCA: number; maxTotalMargin: number };
} {
  const { leverage, maxTotalMarginPercent, dcaMarginPercent, maxDCACount } = strategy.positionSizing;
  const positionSize = capital * leverage;
  const marginUsed = capital;

  // Estimated liquidation based on leverage from strategy
  // Kraken's maintenance margin is roughly 40% of initial margin
  // Liquidation occurs when equity falls below maintenance margin
  const liquidationMove = (1 / leverage) * 0.8;
  const estimatedLiquidation = direction === 'long'
    ? currentPrice * (1 - liquidationMove)
    : currentPrice * (1 + liquidationMove);
  const liquidationDistancePercent = liquidationMove * 100;

  // DCA capacity from strategy config
  const currentMarginPercent = (capital / (capital / 0.2)) * 100; // Approximate
  const remainingMarginPercent = maxTotalMarginPercent - Math.min(currentMarginPercent, maxTotalMarginPercent);
  const dcasRemaining = Math.min(maxDCACount, Math.floor(remainingMarginPercent / dcaMarginPercent));
  const marginPerDCA = capital * (dcaMarginPercent / 100);

  return {
    positionSize,
    marginUsed,
    estimatedLiquidation,
    liquidationDistancePercent,
    dcaCapacity: {
      dcasRemaining,
      marginPerDCA,
      maxTotalMargin: capital * (maxTotalMarginPercent / 100),
    },
  };
}

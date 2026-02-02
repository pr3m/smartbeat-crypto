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
import { detectKnife, KNIFE_GATING_ENABLED, type KnifeAnalysis } from './knife-detection';

export interface TimeframeWeights {
  '1d': number;
  '4h': number;
  '1h': number;
  '15m': number;
  '5m': number;
}

export const DEFAULT_WEIGHTS: TimeframeWeights = {
  '1d': 35, // Primary trend filter (NEW)
  '4h': 30, // Trend determination (reduced from 40)
  '1h': 20, // Setup confirmation (reduced from 30)
  '15m': 10, // Entry timing (reduced from 20)
  '5m': 5,  // Spike detection (reduced from 10)
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
 * Analyze liquidation data for a direction
 */
export function analyzeLiquidation(
  direction: 'long' | 'short',
  liq: LiquidationInput | null
): {
  aligned: boolean;
  bias: 'long_squeeze' | 'short_squeeze' | 'neutral';
  biasStrength: number;
  fundingRate: number | null;
  nearestTarget: number | null;
  adjustments: {
    liqAligned: number;
    fundingConfirm: number;
    total: number;
  };
} {
  if (!liq) {
    return {
      aligned: true, // Pass by default when no data
      bias: 'neutral',
      biasStrength: 0,
      fundingRate: null,
      nearestTarget: null,
      adjustments: { liqAligned: 0, fundingConfirm: 0, total: 0 },
    };
  }

  // Determine alignment
  // For LONG: short_squeeze is aligned (shorts will be liquidated above = upward fuel)
  // For SHORT: long_squeeze is aligned (longs will be liquidated below = downward fuel)
  const aligned =
    (direction === 'long' && liq.bias === 'short_squeeze') ||
    (direction === 'short' && liq.bias === 'long_squeeze') ||
    liq.bias === 'neutral';

  const nearestTarget =
    direction === 'long' ? liq.nearestUpside : liq.nearestDownside;

  // Calculate adjustments
  const adjustments = {
    // Liquidation structure supports direction
    liqAligned: aligned && liq.biasStrength > 0.3 ? 10 : 0,
    // Funding rate confirms direction
    // For LONG: negative funding is bullish (shorts are crowded, paying longs)
    // For SHORT: positive funding is bearish (longs are crowded, paying shorts)
    fundingConfirm:
      liq.fundingRate !== null
        ? (direction === 'long' && liq.fundingRate < -0.0001) ||
          (direction === 'short' && liq.fundingRate > 0.0001)
          ? 5
          : 0
        : 0,
    total: 0,
  };
  adjustments.total = adjustments.liqAligned + adjustments.fundingConfirm;

  return {
    aligned,
    bias: liq.bias,
    biasStrength: liq.biasStrength,
    fundingRate: liq.fundingRate,
    nearestTarget,
    adjustments,
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
  ind1d?: Indicators | null
): LongChecks {
  const flowAnalysis = analyzeFlow('long', micro || null);
  const liqAnalysis = analyzeLiquidation('long', liq || null);
  const entry15m = evaluate15mLongEntry(ind15m);
  const setup1h = evaluate1hLongSetup(ind1h);

  // Determine context for volume evaluation
  const context = determineEntryContext(ind15m, ind1h, 'long');
  const volumeEval = evaluateVolume(ind15m.volRatio, context);

  // MACD with dead zone
  const macdEval = evaluateMACDMomentum('long', ind15m.histogram, ind15m.macd);

  // BTC alignment with setup strength context
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
  ind1d?: Indicators | null
): ShortChecks {
  const flowAnalysis = analyzeFlow('short', micro || null);
  const liqAnalysis = analyzeLiquidation('short', liq || null);
  const entry15m = evaluate15mShortEntry(ind15m);
  const setup1h = evaluate1hShortSetup(ind1h);

  // Determine context for volume evaluation
  const context = determineEntryContext(ind15m, ind1h, 'short');
  const volumeEval = evaluateVolume(ind15m.volRatio, context);

  // MACD with dead zone
  const macdEval = evaluateMACDMomentum('short', ind15m.histogram, ind15m.macd);

  // BTC alignment with setup strength context
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
export function detectSpike(ind5m: Indicators): {
  isSpike: boolean;
  direction: 'long' | 'short' | null;
} {
  const hasVolumeSpike = ind5m.volRatio > 2;
  const isOversold = ind5m.rsi < 25;
  const isOverbought = ind5m.rsi > 75;

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
  ind1d?: Indicators | null
): TradingRecommendation['checklist'] {
  const flowAnalysis = micro ? analyzeFlow(direction, micro) : null;
  const liqAnalysis = liq ? analyzeLiquidation(direction, liq) : null;

  // Format 4H trend with EMA info
  const trend4hValue = formatEMAInfo(ind4h);

  const checklist: TradingRecommendation['checklist'] = {
    trend4h: {
      pass: checks.trend4h,
      value: trend4hValue + (ind4h.trendStrength === 'strong' ? ' ★' : ''),
    },
    setup1h: {
      pass: checks.setup1h,
      value: format1hSetupValue(direction, ind1h),
    },
    entry15m: {
      pass: checks.entry15m,
      value: formatEntry15mValue(direction, ind15m),
    },
    volume: {
      pass: checks.volume,
      value: formatVolumeValue(direction, ind15m, ind1h),
    },
    btcAlign: {
      pass: checks.btcAlign,
      value: formatBTCValue(
        direction,
        btcTrend,
        btcChange,
        (direction === 'long' ? evaluate1hLongSetup(ind1h) : evaluate1hShortSetup(ind1h)).quality
      ),
    },
    macdMomentum: {
      pass: checks.macdMomentum,
      value: formatMACDValue(direction, ind15m),
    },
  };

  // Add daily trend if available with EMA info
  if (ind1d && checks.trend1d !== undefined) {
    checklist.trend1d = {
      pass: checks.trend1d,
      value: formatEMAInfo(ind1d) + (ind1d.trendStrength === 'strong' ? ' ★' : ''),
    };
  }

  // Option B: Add flow confirmation to checklist when microstructure data available
  if (flowAnalysis) {
    const imbalanceStr = `${(flowAnalysis.imbalance * 100).toFixed(0)}%`;
    const cvdStr = flowAnalysis.cvdTrend;
    checklist.flowConfirm = {
      pass: checks.flowConfirm ?? true,
      value: `Imb ${imbalanceStr}, CVD ${cvdStr}`,
    };
  }

  // Add liquidation bias to checklist when liquidation data available
  // LOGIC: short_squeeze = bullish (favors LONG), long_squeeze = bearish (favors SHORT)
  if (liqAnalysis) {
    // Show direction-aware label
    const biasStr = liqAnalysis.bias === 'short_squeeze'
      ? (direction === 'long' ? '↑ Short sq.' : '↑ Short sq. ⚠️')  // Bullish - good for long, bad for short
      : liqAnalysis.bias === 'long_squeeze'
      ? (direction === 'short' ? '↓ Long sq.' : '↓ Long sq. ⚠️')   // Bearish - good for short, bad for long
      : '— Neutral';
    const fundingStr = liqAnalysis.fundingRate !== null
      ? ` FR: ${(liqAnalysis.fundingRate * 100).toFixed(3)}%`
      : '';
    checklist.liqBias = {
      pass: checks.liqBias ?? true,
      value: `${biasStr}${fundingStr}`,
    };
  }

  return checklist;
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
  liq: LiquidationInput | null
): { strength: number; signals: SignalWeight[]; reasons: string[]; warnings: string[] } {
  const signals: SignalWeight[] = [];
  const reasons: string[] = [];
  const warnings: string[] = [];

  // === 1. DAILY TREND (weight: 22) - Primary filter using EMA-based trend ===
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

    signals.push({ name: '1D Trend', weight: 22, value: dailyValue });

    if (dailyValue >= 0.75) {
      reasons.push(`Daily ${dailyTrend} (${dailyScore > 0 ? '+' : ''}${dailyScore})`);
    }
    if (dailyValue < 0.35) {
      warnings.push(`⚠️ COUNTER-TREND: Daily is ${dailyTrend} (score ${dailyScore})`);
    }
  }

  // === 2. 4H TREND (weight: 20) - Main trend using EMA structure ===
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

  signals.push({ name: '4H Trend', weight: 20, value: htfValue });

  if (htfValue >= 0.75) {
    const alignStr = ind4h.emaAlignment === (direction === 'long' ? 'bullish' : 'bearish') ? ' ✓EMA' : '';
    reasons.push(`4H ${htfTrend}${alignStr}`);
  }
  if (htfValue < 0.35) {
    warnings.push(`⚠️ 4H opposes: ${htfTrend} (${htfScore})`);
  }

  // === 3. 1H SETUP (weight: 15) - Setup confirmation ===
  let setupValue = 0.5;
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

  signals.push({ name: '1H Setup', weight: 15, value: setupValue });
  if (setupValue >= 0.8) reasons.push(`1H confirms ${setupTrend}`);

  // 4. 15m RSI entry (weight: 15) - Entry timing
  let rsiValue = 0;
  if (direction === 'long') {
    // Ideal: RSI 25-40, acceptable: 20-50
    if (ind15m.rsi >= 20 && ind15m.rsi <= 35) rsiValue = 1.0;
    else if (ind15m.rsi > 35 && ind15m.rsi <= 45) rsiValue = 0.7;
    else if (ind15m.rsi > 45 && ind15m.rsi <= 50) rsiValue = 0.4;
    else if (ind15m.rsi < 20) rsiValue = 0.8; // Very oversold - slightly reduced (may be dumping)
    else rsiValue = 0.2;
  } else {
    // Ideal: RSI 60-75, acceptable: 50-80
    if (ind15m.rsi >= 65 && ind15m.rsi <= 80) rsiValue = 1.0;
    else if (ind15m.rsi >= 55 && ind15m.rsi < 65) rsiValue = 0.7;
    else if (ind15m.rsi >= 50 && ind15m.rsi < 55) rsiValue = 0.4;
    else if (ind15m.rsi > 80) rsiValue = 0.8; // Very overbought
    else rsiValue = 0.2;
  }
  signals.push({ name: '15m RSI', weight: 15, value: rsiValue });
  if (rsiValue >= 0.8) reasons.push(`RSI ${ind15m.rsi.toFixed(0)} ${direction === 'long' ? 'oversold' : 'overbought'}`);

  // 5. Volume (weight: 12) - Confirmation
  let volValue = 0.3;
  if (ind15m.volRatio >= 2.0) volValue = 1.0;
  else if (ind15m.volRatio >= 1.5) volValue = 0.8;
  else if (ind15m.volRatio >= 1.3) volValue = 0.6;
  else if (ind15m.volRatio >= 1.0) volValue = 0.4;
  signals.push({ name: 'Volume', weight: 12, value: volValue });
  if (volValue >= 0.8) reasons.push(`Volume ${ind15m.volRatio.toFixed(1)}x`);

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
  signals.push({ name: 'BTC Align', weight: 8, value: btcValue });
  if (btcValue >= 0.8) reasons.push(`BTC ${btcTrend}`);
  if (btcValue < 0.4) warnings.push(`⚠️ BTC opposing: ${btcTrend}`);

  // 7. MACD momentum (weight: 8) - Momentum confirmation
  let macdValue = 0.5;
  const hist = ind15m.histogram ?? 0;
  if (direction === 'long') {
    if (hist > 0) macdValue = Math.min(1, 0.6 + Math.abs(hist) * 1000);
    else macdValue = Math.max(0.1, 0.4 - Math.abs(hist) * 500);
  } else {
    if (hist < 0) macdValue = Math.min(1, 0.6 + Math.abs(hist) * 1000);
    else macdValue = Math.max(0.1, 0.4 - Math.abs(hist) * 500);
  }
  signals.push({ name: 'MACD Mom', weight: 8, value: macdValue });
  if (macdValue >= 0.7) reasons.push(`MACD histogram ${hist > 0 ? '+' : ''}${hist.toFixed(5)}`);

  // 8. Flow/Microstructure (weight: 4) - When available
  if (micro) {
    const flowAnalysis = analyzeFlow(direction, micro);
    let flowValue = 0.5;
    if (flowAnalysis.status === 'aligned') flowValue = 0.9;
    else if (flowAnalysis.status === 'neutral') flowValue = 0.5;
    else flowValue = 0.2;
    signals.push({ name: 'Flow', weight: 4, value: flowValue });
    if (flowValue >= 0.8) reasons.push(`Flow aligned (${flowAnalysis.cvdTrend} CVD)`);
    if (flowValue < 0.3) warnings.push(`⚠️ Flow opposing`);
    if (flowAnalysis.hasDivergence) {
      if ((direction === 'long' && flowAnalysis.divergenceType === 'bearish') ||
          (direction === 'short' && flowAnalysis.divergenceType === 'bullish')) {
        warnings.push(`⚠️ ${flowAnalysis.divergenceType} divergence detected`);
      }
    }
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
export function getGradeFromStrength(strength: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (strength >= 80) return 'A';
  if (strength >= 65) return 'B';
  if (strength >= 50) return 'C';
  if (strength >= 35) return 'D';
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
  pair?: string
): TradingRecommendation | null {
  const ind4h = tf4h.indicators;
  const ind1h = tf1h.indicators;
  const ind15m = tf15m.indicators;
  const ind5m = tf5m.indicators;
  const ind1d = tf1d?.indicators || null;

  if (!ind4h || !ind1h || !ind15m || !ind5m) {
    return null;
  }

  // Evaluate both directions (with microstructure, liquidation, and daily data)
  const longChecks = evaluateLongConditions(ind4h, ind1h, ind15m, btcTrend, micro, liq, ind1d);
  const shortChecks = evaluateShortConditions(ind4h, ind1h, ind15m, btcTrend, micro, liq, ind1d);

  // Calculate weighted strength scores for BOTH directions
  const longStrengthResult = calculateDirectionStrength('long', longChecks, ind4h, ind1h, ind15m, ind5m, ind1d, btcTrend, micro || null, liq || null);
  const shortStrengthResult = calculateDirectionStrength('short', shortChecks, ind4h, ind1h, ind15m, ind5m, ind1d, btcTrend, micro || null, liq || null);

  // Base score (6-7 conditions depending on daily availability, excluding flowConfirm and liqBias)
  const longPassed = countPassed(longChecks, false);
  const shortPassed = countPassed(shortChecks, false);

  // Full score including all extras (for display)
  const longPassedFull = countPassed(longChecks, true);
  const shortPassedFull = countPassed(shortChecks, true);

  // Calculate total items in checklist (6-7 base + extras if available)
  let totalItems = getTotalBaseConditions(longChecks);
  if (micro) totalItems++;
  if (liq) totalItems++;

  // Format checklists for BOTH directions
  const longChecklist = formatChecklist(longChecks, 'long', ind4h, ind1h, ind15m, btcTrend, btcChange, micro, liq, ind1d);
  const shortChecklist = formatChecklist(shortChecks, 'short', ind4h, ind1h, ind15m, btcTrend, btcChange, micro, liq, ind1d);

  // Determine which setup is stronger (based on weighted strength)
  const bestSetup = longStrengthResult.strength >= shortStrengthResult.strength ? 'long' : 'short';
  const bestChecks = bestSetup === 'long' ? longChecks : shortChecks;

  // Flow analysis for both directions
  const longFlowAnalysis = analyzeFlow('long', micro || null);
  const shortFlowAnalysis = analyzeFlow('short', micro || null);
  const longLiqAnalysis = analyzeLiquidation('long', liq || null);
  const shortLiqAnalysis = analyzeLiquidation('short', liq || null);

  // Build DirectionRecommendation for LONG
  const longRec: DirectionRecommendation = {
    strength: longStrengthResult.strength,
    confidence: Math.round(Math.min(95, Math.max(5, longStrengthResult.strength + longFlowAnalysis.adjustments.total + longLiqAnalysis.adjustments.total))),
    grade: getGradeFromStrength(longStrengthResult.strength),
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
    grade: getGradeFromStrength(shortStrengthResult.strength),
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

  // Use strength-based thresholds instead of binary pass/fail
  if (longStrengthResult.strength >= 70 && longStrengthResult.strength > shortStrengthResult.strength + 15) {
    action = 'LONG';
    reason = `LONG Grade ${longRec.grade} (${longStrengthResult.strength}%): ${longStrengthResult.reasons.slice(0, 3).join(', ')}.`;
    baseConfidence = longStrengthResult.strength;
  } else if (shortStrengthResult.strength >= 70 && shortStrengthResult.strength > longStrengthResult.strength + 15) {
    action = 'SHORT';
    reason = `SHORT Grade ${shortRec.grade} (${shortStrengthResult.strength}%): ${shortStrengthResult.reasons.slice(0, 3).join(', ')}.`;
    baseConfidence = shortStrengthResult.strength;
  } else if (Math.max(longStrengthResult.strength, shortStrengthResult.strength) >= 55) {
    action = 'WAIT';
    const strongerDir = longStrengthResult.strength >= shortStrengthResult.strength ? 'LONG' : 'SHORT';
    const strongerStrength = Math.max(longStrengthResult.strength, shortStrengthResult.strength);
    reason = `${strongerDir} forming (${strongerStrength}%). Both: LONG ${longRec.grade} vs SHORT ${shortRec.grade}. Wait for stronger signal.`;
    baseConfidence = strongerStrength * 0.7;
  } else {
    action = 'WAIT';
    reason = `Weak setups. LONG ${longRec.grade} (${longStrengthResult.strength}%), SHORT ${shortRec.grade} (${shortStrengthResult.strength}%). Wait for better entry.`;
    baseConfidence = 20;
  }

  // Check for 5m spike - for Martingale, allow spikes even against weak HTF
  const spike = detectSpike(ind5m);
  if (spike.isSpike && action === 'WAIT') {
    // For Martingale, spikes are opportunities even against trend (with warnings)
    const htfAllowsLongSpike = ind4h.bias !== 'bearish' && (ind1d ? ind1d.bias !== 'bearish' : true);
    const htfAllowsShortSpike = ind4h.bias !== 'bullish' && (ind1d ? ind1d.bias !== 'bullish' : true);

    if (spike.direction === 'long') {
      action = 'SPIKE ↑';
      reason = `⚡ SPIKE opportunity: RSI ${ind5m.rsi.toFixed(0)}, Vol ${ind5m.volRatio.toFixed(1)}x.`;
      baseConfidence = htfAllowsLongSpike ? 60 : 45;
      if (!htfAllowsLongSpike) {
        reason += ' ⚠️ Counter-trend - tight stops!';
        longRec.warnings.push('Counter-trend spike - use tight stops');
      }
    } else {
      action = 'SPIKE ↓';
      reason = `⚡ SPIKE opportunity: RSI ${ind5m.rsi.toFixed(0)}, Vol ${ind5m.volRatio.toFixed(1)}x.`;
      baseConfidence = htfAllowsShortSpike ? 60 : 45;
      if (!htfAllowsShortSpike) {
        reason += ' ⚠️ Counter-trend - tight stops!';
        shortRec.warnings.push('Counter-trend spike - use tight stops');
      }
    }
  }

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

  // Apply adjustments to confidence
  const flowAnalysis = bestSetup === 'long' ? longFlowAnalysis : shortFlowAnalysis;
  const liqAnalysis = bestSetup === 'long' ? longLiqAnalysis : shortLiqAnalysis;
  let confidence = baseConfidence + flowAnalysis.adjustments.total + liqAnalysis.adjustments.total;

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
  };
}

/**
 * Calculate position sizing
 */
export function calculatePosition(
  capital: number,
  targetProfit: number,
  leverage = 10,
  currentPrice: number
): {
  positionSize: number;
  moveNeeded: number;
  takeProfit: number;
  stopLoss: number;
  dcaLevels: { level: string; trigger: string; amount: number; price: number }[];
} {
  const positionSize = capital * leverage;
  const moveNeeded = (targetProfit / positionSize) * 100;
  const takeProfit = currentPrice * (1 + moveNeeded / 100);
  const stopLoss = currentPrice * 0.92; // -8% hard stop

  // DCA levels
  const dcaLevels = [
    { level: 'Entry', trigger: 'Signal', amount: capital * 0.2, price: currentPrice },
    { level: 'DCA 1', trigger: '-3%', amount: capital * 0.15, price: currentPrice * 0.97 },
    { level: 'DCA 2', trigger: '-5%', amount: capital * 0.25, price: currentPrice * 0.95 },
    { level: 'STOP', trigger: '-8%', amount: 0, price: currentPrice * 0.92 },
  ];

  return {
    positionSize,
    moveNeeded,
    takeProfit,
    stopLoss,
    dcaLevels,
  };
}

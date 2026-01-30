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
} from '@/lib/kraken/types';

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
  return {
    trend1d: ind1d ? ind1d.bias !== 'bearish' : undefined, // Daily not bearish (NEW)
    trend4h: ind4h.bias === 'bullish',
    setup1h: ind1h.bias === 'bullish',
    entry15m: ind15m.rsi < 45 && ind15m.rsi > 20, // Oversold zone 20-45 (was <35)
    volume: ind15m.volRatio > 1.3,
    btcAlign: btcTrend === 'bull' || (btcTrend === 'neut' && ind4h.bias === 'bullish'), // Stricter BTC alignment
    macdMomentum: ind15m.histogram !== undefined && ind15m.histogram > 0, // Replaces rsiExtreme
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
  return {
    trend1d: ind1d ? ind1d.bias !== 'bullish' : undefined, // Daily not bullish (NEW)
    trend4h: ind4h.bias === 'bearish',
    setup1h: ind1h.bias === 'bearish',
    entry15m: ind15m.rsi > 55 && ind15m.rsi < 80, // Overbought zone 55-80 (was >65)
    volume: ind15m.volRatio > 1.3,
    btcAlign: btcTrend === 'bear' || (btcTrend === 'neut' && ind4h.bias === 'bearish'), // Stricter BTC alignment
    macdMomentum: ind15m.histogram !== undefined && ind15m.histogram < 0, // Replaces rsiExtreme
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
  if (!checks.entry15m)
    missing.push(direction === 'long' ? '15m RSI oversold (20-45)' : '15m RSI overbought (55-80)');
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

  const checklist: TradingRecommendation['checklist'] = {
    trend4h: {
      pass: checks.trend4h,
      value: ind4h.bias + (ind4h.trendStrength === 'strong' ? ' ★' : checks.trend4h ? ' ✓' : ''),
    },
    setup1h: {
      pass: checks.setup1h,
      value: ind1h.bias + (checks.setup1h ? ' ✓' : ''),
    },
    entry15m: {
      pass: checks.entry15m,
      value: `RSI ${ind15m.rsi.toFixed(0)} (need ${direction === 'long' ? '20-45' : '55-80'})`,
    },
    volume: {
      pass: checks.volume,
      value: `${ind15m.volRatio.toFixed(2)}x`,
    },
    btcAlign: {
      pass: checks.btcAlign,
      value: `${btcTrend} ${btcChange.toFixed(1)}%`,
    },
    macdMomentum: {
      pass: checks.macdMomentum,
      value: ind15m.histogram !== undefined
        ? `Hist ${ind15m.histogram > 0 ? '+' : ''}${ind15m.histogram.toFixed(5)}`
        : 'N/A',
    },
  };

  // Add daily trend if available
  if (ind1d && checks.trend1d !== undefined) {
    checklist.trend1d = {
      pass: checks.trend1d,
      value: ind1d.bias + (ind1d.trendStrength === 'strong' ? ' ★' : checks.trend1d ? ' ✓' : ''),
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
  if (liqAnalysis) {
    const biasStr = liqAnalysis.bias === 'short_squeeze' ? '↑ Short sq.' :
                    liqAnalysis.bias === 'long_squeeze' ? '↓ Long sq.' : '— Neutral';
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
 * Considers both binary pass/fail AND how strongly the condition is met
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

  // 1. Daily trend (weight: 20) - Primary filter
  if (ind1d) {
    let dailyValue = 0.5; // neutral
    if (direction === 'long') {
      if (ind1d.bias === 'bullish') dailyValue = 1.0;
      else if (ind1d.bias === 'neutral') dailyValue = 0.6;
      else dailyValue = 0.2; // bearish - warning but not zero
    } else {
      if (ind1d.bias === 'bearish') dailyValue = 1.0;
      else if (ind1d.bias === 'neutral') dailyValue = 0.6;
      else dailyValue = 0.2; // bullish
    }
    // Boost for strong trend
    if (ind1d.trendStrength === 'strong' && dailyValue >= 0.6) dailyValue = Math.min(1, dailyValue + 0.1);
    signals.push({ name: '1D Trend', weight: 20, value: dailyValue });
    if (dailyValue >= 0.8) reasons.push(`Daily ${ind1d.bias}${ind1d.trendStrength === 'strong' ? ' (strong)' : ''}`);
    if (dailyValue < 0.4) warnings.push(`⚠️ Counter-trend: Daily is ${ind1d.bias}`);
  }

  // 2. 4H trend (weight: 18) - Main trend
  let htfValue = 0.5;
  if (direction === 'long') {
    if (ind4h.bias === 'bullish') htfValue = 1.0;
    else if (ind4h.bias === 'neutral') htfValue = 0.5;
    else htfValue = 0.2;
  } else {
    if (ind4h.bias === 'bearish') htfValue = 1.0;
    else if (ind4h.bias === 'neutral') htfValue = 0.5;
    else htfValue = 0.2;
  }
  if (ind4h.trendStrength === 'strong' && htfValue >= 0.5) htfValue = Math.min(1, htfValue + 0.15);
  signals.push({ name: '4H Trend', weight: 18, value: htfValue });
  if (htfValue >= 0.8) reasons.push(`4H ${ind4h.bias}${ind4h.trendStrength === 'strong' ? ' (strong)' : ''}`);
  if (htfValue < 0.4) warnings.push(`⚠️ 4H opposes: ${ind4h.bias}`);

  // 3. 1H setup (weight: 15) - Setup confirmation
  let setupValue = 0.5;
  if (direction === 'long') {
    if (ind1h.bias === 'bullish') setupValue = 1.0;
    else if (ind1h.bias === 'neutral') setupValue = 0.5;
    else setupValue = 0.3;
  } else {
    if (ind1h.bias === 'bearish') setupValue = 1.0;
    else if (ind1h.bias === 'neutral') setupValue = 0.5;
    else setupValue = 0.3;
  }
  signals.push({ name: '1H Setup', weight: 15, value: setupValue });
  if (setupValue >= 0.8) reasons.push(`1H confirms ${ind1h.bias}`);

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
  currentPrice?: number
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
    confidence: Math.min(95, Math.max(5, longStrengthResult.strength + longFlowAnalysis.adjustments.total + longLiqAnalysis.adjustments.total)),
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
    confidence: Math.min(95, Math.max(5, shortStrengthResult.strength + shortFlowAnalysis.adjustments.total + shortLiqAnalysis.adjustments.total)),
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

  // Collect all warnings
  const allWarnings: string[] = [];
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

  // Cap confidence
  confidence = Math.min(Math.max(confidence, 5), 95);

  return {
    action,
    confidence,
    baseConfidence,
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

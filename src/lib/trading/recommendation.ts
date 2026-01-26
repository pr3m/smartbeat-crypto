/**
 * Trading Recommendation Engine
 * Multi-timeframe analysis and signal generation
 * Migrated from xrp-dashboard-v9-mtf.html
 */

import type {
  Indicators,
  TradingRecommendation,
  TimeframeData,
  ChecklistItem,
  MicrostructureInput,
  LiquidationInput,
} from '@/lib/kraken/types';

export interface TimeframeWeights {
  '4h': number;
  '1h': number;
  '15m': number;
  '5m': number;
}

export const DEFAULT_WEIGHTS: TimeframeWeights = {
  '4h': 40, // Trend determination
  '1h': 30, // Setup confirmation
  '15m': 20, // Entry timing
  '5m': 10, // Spike detection
};

export interface LongChecks {
  trend4h: boolean;
  setup1h: boolean;
  entry15m: boolean;
  volume: boolean;
  btcAlign: boolean;
  rsiExtreme: boolean;
  flowConfirm?: boolean; // Option B: Flow confirmation
  liqBias?: boolean; // Liquidation bias alignment
}

export interface ShortChecks {
  trend4h: boolean;
  setup1h: boolean;
  entry15m: boolean;
  volume: boolean;
  btcAlign: boolean;
  rsiExtreme: boolean;
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
  liq?: LiquidationInput | null
): LongChecks {
  const flowAnalysis = analyzeFlow('long', micro || null);
  const liqAnalysis = analyzeLiquidation('long', liq || null);
  return {
    trend4h: ind4h.bias === 'bullish',
    setup1h: ind1h.bias === 'bullish',
    entry15m: ind15m.rsi < 35, // Oversold = buy signal
    volume: ind15m.volRatio > 1.3,
    btcAlign: btcTrend !== 'bear',
    rsiExtreme: ind15m.rsi < 35,
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
  liq?: LiquidationInput | null
): ShortChecks {
  const flowAnalysis = analyzeFlow('short', micro || null);
  const liqAnalysis = analyzeLiquidation('short', liq || null);
  return {
    trend4h: ind4h.bias === 'bearish',
    setup1h: ind1h.bias === 'bearish',
    entry15m: ind15m.rsi > 65, // Overbought = sell signal
    volume: ind15m.volRatio > 1.3,
    btcAlign: btcTrend !== 'bull',
    rsiExtreme: ind15m.rsi > 65,
    flowConfirm: flowAnalysis.flowConfirmPass,
    liqBias: liqAnalysis.aligned,
  };
}

/**
 * Count passing conditions (excluding flowConfirm and liqBias for base score)
 */
export function countPassed(checks: LongChecks | ShortChecks, includeExtras = false): number {
  const { flowConfirm, liqBias, ...baseChecks } = checks;
  const baseCount = Object.values(baseChecks).filter(Boolean).length;
  if (includeExtras) {
    let extras = 0;
    if (flowConfirm !== undefined && flowConfirm) extras++;
    if (liqBias !== undefined && liqBias) extras++;
    return baseCount + extras;
  }
  return baseCount;
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
  if (!checks.trend4h) missing.push('4H trend');
  if (!checks.setup1h) missing.push('1H setup');
  if (!checks.entry15m)
    missing.push(direction === 'long' ? '15m RSI oversold' : '15m RSI overbought');
  if (!checks.volume) missing.push('volume confirmation');
  if (!checks.btcAlign) missing.push('BTC alignment');
  if (!checks.rsiExtreme)
    missing.push(direction === 'long' ? 'RSI < 35' : 'RSI > 65');
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
  liq?: LiquidationInput | null
): TradingRecommendation['checklist'] {
  const flowAnalysis = micro ? analyzeFlow(direction, micro) : null;
  const liqAnalysis = liq ? analyzeLiquidation(direction, liq) : null;

  const checklist: TradingRecommendation['checklist'] = {
    trend4h: {
      pass: checks.trend4h,
      value: ind4h.bias + (checks.trend4h ? ' ✓' : ''),
    },
    setup1h: {
      pass: checks.setup1h,
      value: ind1h.bias + (checks.setup1h ? ' ✓' : ''),
    },
    entry15m: {
      pass: checks.entry15m,
      value: `RSI ${ind15m.rsi.toFixed(0)} (need ${direction === 'long' ? '<35' : '>65'})`,
    },
    volume: {
      pass: checks.volume,
      value: `${ind15m.volRatio.toFixed(2)}x`,
    },
    btcAlign: {
      pass: checks.btcAlign,
      value: `${btcTrend} ${btcChange.toFixed(1)}%`,
    },
    rsiExtreme: {
      pass: checks.rsiExtreme,
      value: ind15m.rsi.toFixed(0),
    },
  };

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
  liq?: LiquidationInput | null
): TradingRecommendation | null {
  const ind4h = tf4h.indicators;
  const ind1h = tf1h.indicators;
  const ind15m = tf15m.indicators;
  const ind5m = tf5m.indicators;

  if (!ind4h || !ind1h || !ind15m || !ind5m) {
    return null;
  }

  // Evaluate both directions (with microstructure and liquidation data)
  const longChecks = evaluateLongConditions(ind4h, ind1h, ind15m, btcTrend, micro, liq);
  const shortChecks = evaluateShortConditions(ind4h, ind1h, ind15m, btcTrend, micro, liq);

  // Base score (6 conditions, excluding flowConfirm and liqBias)
  const longPassed = countPassed(longChecks, false);
  const shortPassed = countPassed(shortChecks, false);

  // Full score including all extras (for display)
  const longPassedFull = countPassed(longChecks, true);
  const shortPassedFull = countPassed(shortChecks, true);

  // Calculate total items in checklist (6 base + extras if available)
  let totalItems = 6;
  if (micro) totalItems++;
  if (liq) totalItems++;

  // Determine which setup is stronger (based on base score)
  const bestSetup = longPassed >= shortPassed ? 'long' : 'short';
  const bestChecks = bestSetup === 'long' ? longChecks : shortChecks;
  const bestPassed = Math.max(longPassed, shortPassed);
  const bestPassedFull = bestSetup === 'long' ? longPassedFull : shortPassedFull;

  // Format checklist for UI (includes flowConfirm and liqBias when data available)
  const checklist = formatChecklist(
    bestChecks,
    bestSetup,
    ind4h,
    ind1h,
    ind15m,
    btcTrend,
    btcChange,
    micro,
    liq
  );

  // Generate base recommendation
  let action: TradingRecommendation['action'] = 'WAIT';
  let reason = '';
  let baseConfidence = 0;

  if (longPassed >= 5) {
    action = 'LONG';
    reason = `Strong LONG setup: 4H bullish, 1H confirms, 15m RSI oversold at ${ind15m.rsi.toFixed(0)}. Volume ${ind15m.volRatio.toFixed(1)}x.`;
    baseConfidence = 50 + longPassed * 8;
  } else if (shortPassed >= 5) {
    action = 'SHORT';
    reason = `Strong SHORT setup: 4H bearish, 1H confirms, 15m RSI overbought at ${ind15m.rsi.toFixed(0)}. Volume ${ind15m.volRatio.toFixed(1)}x.`;
    baseConfidence = 50 + shortPassed * 8;
  } else if (bestPassed >= 4) {
    action = 'WAIT';
    const missing = getMissingConditions(bestChecks, bestSetup, !!(micro || liq));
    reason = `${bestSetup.toUpperCase()} setup at ${bestPassedFull}/${totalItems}. Missing: ${missing.join(', ')}. Wait for confirmation.`;
    baseConfidence = 30 + bestPassed * 5;
  } else {
    action = 'WAIT';
    reason = `No clear setup. LONG: ${longPassedFull}/${totalItems}, SHORT: ${shortPassedFull}/${totalItems}. Wait for timeframes to align.`;
    baseConfidence = 10 + bestPassed * 5;
  }

  // Check for 5m spike (can override WAIT)
  const spike = detectSpike(ind5m);
  if (spike.isSpike && action === 'WAIT') {
    if (spike.direction === 'long') {
      action = 'SPIKE ↑';
      reason = `⚡ 5m spike: RSI ${ind5m.rsi.toFixed(0)}, Volume ${ind5m.volRatio.toFixed(1)}x. Quick long with tight stop!`;
    } else {
      action = 'SPIKE ↓';
      reason = `⚡ 5m spike: RSI ${ind5m.rsi.toFixed(0)}, Volume ${ind5m.volRatio.toFixed(1)}x. Quick short with tight stop!`;
    }
    baseConfidence = 55;
  }

  // Option A: Analyze flow and calculate adjustments
  const direction = action === 'LONG' || action === 'SPIKE ↑' ? 'long' :
                    action === 'SHORT' || action === 'SPIKE ↓' ? 'short' : bestSetup;
  const flowAnalysis = analyzeFlow(direction, micro || null);
  const liqAnalysis = analyzeLiquidation(direction, liq || null);

  // Apply flow and liquidation adjustments to confidence
  let confidence = baseConfidence + flowAnalysis.adjustments.total + liqAnalysis.adjustments.total;

  // Add flow context to reason if we have microstructure data
  if (micro && action !== 'WAIT') {
    if (flowAnalysis.status === 'aligned') {
      reason += ` Flow aligned (${flowAnalysis.cvdTrend} CVD).`;
    } else if (flowAnalysis.status === 'opposing') {
      reason += ` ⚠️ Flow opposing - reduce size.`;
    }
    if (flowAnalysis.hasDivergence) {
      reason += ` Divergence: ${flowAnalysis.divergenceType}.`;
    }
    if (flowAnalysis.spreadStatus === 'wide') {
      reason += ` Wide spread - expect slippage.`;
    }
  }

  // Add liquidation context to reason if we have liquidation data
  if (liq && action !== 'WAIT') {
    if (liqAnalysis.aligned && liqAnalysis.biasStrength > 0.3) {
      const targetStr = liqAnalysis.nearestTarget
        ? ` Target: €${liqAnalysis.nearestTarget.toFixed(4)}`
        : '';
      reason += ` Liq bias aligned (${liqAnalysis.bias}).${targetStr}`;
    } else if (!liqAnalysis.aligned) {
      reason += ` ⚠️ Liq bias opposing (${liqAnalysis.bias}).`;
    }
  }

  // Cap confidence at 95%, floor at 5%
  confidence = Math.min(Math.max(confidence, 5), 95);

  return {
    action,
    confidence,
    baseConfidence,
    reason,
    longScore: longPassedFull,
    shortScore: shortPassedFull,
    totalItems,
    checklist,
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

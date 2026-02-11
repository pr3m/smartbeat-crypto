/**
 * Market Regime Detection
 *
 * Classifies current market conditions using ADX (trend strength) and
 * Bollinger Band width (volatility). The regime determines:
 * - Action threshold (easier to enter in strong trends)
 * - Timebox duration (hold longer in trends, shorter in ranges)
 * - Timebox weight in exit pressure (backstop, not driver)
 */

import type { Indicators } from '@/lib/kraken/types';

// ============================================================================
// TYPES
// ============================================================================

export type MarketRegime = 'strong_trend' | 'trending' | 'ranging' | 'low_volatility';

export interface MarketRegimeAnalysis {
  regime: MarketRegime;
  confidence: number;
  adx: number;
  bbWidthPercent: number;
  description: string;
  adjustedActionThreshold: number;
  adjustedTimeboxMaxHours: number;
  adjustedTimeboxWeight: number;
}

export interface MarketRegimeConfig {
  /** ADX threshold for strong trend (4H) */
  strongTrendADX: number;
  /** ADX threshold for trending (4H) */
  trendingADX: number;
  /** BB width below this = low volatility */
  lowVolBBWidth: number;
  /** BB width above this = high volatility */
  highVolBBWidth: number;
  /** Action threshold in ranging/low-vol regimes */
  rangingActionThreshold: number;
  /** Action threshold in strong trend regime */
  strongTrendActionThreshold: number;
  /** Action threshold in trending regime */
  trendingActionThreshold: number;
  /** Max timebox hours in strong trend */
  strongTrendMaxHours: number;
  /** Max timebox hours in trending */
  trendingMaxHours: number;
  /** Max timebox hours in ranging/low-vol */
  rangingMaxHours: number;
  /** Timebox weight in strong trend (low = backstop only) */
  strongTrendTimeboxWeight: number;
  /** Timebox weight in trending */
  trendingTimeboxWeight: number;
  /** Timebox weight in ranging */
  rangingTimeboxWeight: number;
}

export const DEFAULT_REGIME_CONFIG: MarketRegimeConfig = {
  strongTrendADX: 35,
  trendingADX: 20,
  lowVolBBWidth: 0.8,
  highVolBBWidth: 2.5,
  rangingActionThreshold: 75,
  strongTrendActionThreshold: 60,
  trendingActionThreshold: 68,
  strongTrendMaxHours: 72,
  trendingMaxHours: 48,
  rangingMaxHours: 36,
  strongTrendTimeboxWeight: 0.05,
  trendingTimeboxWeight: 0.10,
  rangingTimeboxWeight: 0.20,
};

// ============================================================================
// DETECTION
// ============================================================================

/**
 * Detect the current market regime from 4H and 1H indicators.
 *
 * Classification:
 * - strong_trend: ADX 4H >= 35 AND BB width 1H >= 2.0
 * - trending: ADX 4H >= 20 OR (ADX 1H >= 25 AND BB width >= 1.2)
 * - low_volatility: ADX 4H < 15 AND BB width < 0.8
 * - ranging: everything else
 */
export function detectMarketRegime(
  ind4h: Indicators | null,
  ind1h: Indicators | null,
  config: MarketRegimeConfig = DEFAULT_REGIME_CONFIG
): MarketRegimeAnalysis {
  const adx4h = ind4h?.adx ?? 0;
  const adx1h = ind1h?.adx ?? 0;
  const bbWidth1h = ind1h?.bbWidth ?? 1.5; // Default to middle range if unavailable

  let regime: MarketRegime;
  let confidence: number;
  let description: string;

  // Strong trend: ADX 4H >= 35 AND BB width 1H >= 2.0
  if (adx4h >= config.strongTrendADX && bbWidth1h >= 2.0) {
    regime = 'strong_trend';
    // Confidence scales with how far above thresholds
    confidence = Math.min(95, 60 + (adx4h - config.strongTrendADX) + (bbWidth1h - 2.0) * 10);
    description = `Strong trend: ADX ${adx4h.toFixed(0)} with ${bbWidth1h.toFixed(1)}% BB width`;
  }
  // Low volatility: ADX 4H < 15 AND BB width < 0.8
  else if (adx4h < 15 && bbWidth1h < config.lowVolBBWidth) {
    regime = 'low_volatility';
    confidence = Math.min(90, 50 + (15 - adx4h) * 2 + (config.lowVolBBWidth - bbWidth1h) * 20);
    description = `Low volatility: ADX ${adx4h.toFixed(0)}, BB width ${bbWidth1h.toFixed(1)}% - tight range`;
  }
  // Trending: ADX 4H >= 20 OR (ADX 1H >= 25 AND BB width >= 1.2)
  else if (adx4h >= config.trendingADX || (adx1h >= 25 && bbWidth1h >= 1.2)) {
    regime = 'trending';
    const adxContrib = adx4h >= config.trendingADX ? (adx4h - config.trendingADX) * 2 : 0;
    const altContrib = (adx1h >= 25 && bbWidth1h >= 1.2) ? 15 : 0;
    confidence = Math.min(85, 50 + adxContrib + altContrib);
    description = `Trending: ADX 4H=${adx4h.toFixed(0)}, 1H=${adx1h.toFixed(0)}, BB width ${bbWidth1h.toFixed(1)}%`;
  }
  // Ranging: everything else
  else {
    regime = 'ranging';
    confidence = Math.min(80, 40 + Math.abs(20 - adx4h) * 2);
    description = `Ranging: ADX ${adx4h.toFixed(0)}, BB width ${bbWidth1h.toFixed(1)}% - no clear trend`;
  }

  // Look up regime-specific parameters
  let adjustedActionThreshold: number;
  let adjustedTimeboxMaxHours: number;
  let adjustedTimeboxWeight: number;

  switch (regime) {
    case 'strong_trend':
      adjustedActionThreshold = config.strongTrendActionThreshold;
      adjustedTimeboxMaxHours = config.strongTrendMaxHours;
      adjustedTimeboxWeight = config.strongTrendTimeboxWeight;
      break;
    case 'trending':
      adjustedActionThreshold = config.trendingActionThreshold;
      adjustedTimeboxMaxHours = config.trendingMaxHours;
      adjustedTimeboxWeight = config.trendingTimeboxWeight;
      break;
    case 'low_volatility':
    case 'ranging':
    default:
      adjustedActionThreshold = config.rangingActionThreshold;
      adjustedTimeboxMaxHours = config.rangingMaxHours;
      adjustedTimeboxWeight = config.rangingTimeboxWeight;
      break;
  }

  return {
    regime,
    confidence,
    adx: adx4h,
    bbWidthPercent: bbWidth1h,
    description,
    adjustedActionThreshold,
    adjustedTimeboxMaxHours,
    adjustedTimeboxWeight,
  };
}

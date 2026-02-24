/**
 * Liquidation Heatmap Engine
 *
 * Builds a composite probability heatmap of where liquidation clusters
 * are likely sitting, by fusing multiple data signals:
 *
 * 1. Volume Profile Nodes — high-volume price levels = entry clusters
 *    → Estimate liq prices at standard leverage tiers
 * 2. Order Book Depth Walls — large resting orders = defense/attack levels
 * 3. Round Number Gravity — psychological magnets where retail clusters
 * 4. Open Interest × Funding Rate — directional crowding
 * 5. Trade Cascade Detection — past liquidation events leave scars
 * 6. ATR-Scaled Leverage Mapping — volatility-adjusted liq estimation
 * 7. Multi-Timeframe Confluence — zones that appear on multiple TFs
 *
 * Output: price-level → probability score (0-100) with metadata,
 *         ready for signal engine, position monitor, and AI chat.
 */

import type { OHLCData } from '@/lib/kraken/types';
import {
  buildVolumeProfile,
  estimateLiquidationLevels,
  groupIntoZones,
  type LiquidationLevel,
  type LiquidationZone,
} from './liquidation';

// ============================================================================
// TYPES
// ============================================================================

/** A single price zone with a composite liquidation probability */
export interface HeatmapZone {
  /** Price range */
  priceFrom: number;
  priceTo: number;
  /** Mid-price of the zone */
  priceMid: number;
  /** Composite probability score (0-100) */
  score: number;
  /** Type: long positions liquidate below, short above */
  type: 'long_liquidation' | 'short_liquidation';
  /** Distance from current price (%) */
  distancePercent: number;
  /** Contributing signals (what built this score) */
  signals: HeatmapSignal[];
  /** Whether this zone has been recently swept (cascades detected) */
  recentlySweep: boolean;
  /** Leverage tiers most likely to cluster here */
  dominantLeverages: number[];
  /** Estimated EUR value at risk (if order book data available) */
  estimatedValueAtRisk?: number;
}

/** Individual signal contributing to a heatmap zone */
export interface HeatmapSignal {
  source: HeatmapSignalSource;
  contribution: number; // 0-100 how much this signal adds
  detail: string;
}

export type HeatmapSignalSource =
  | 'volume_profile'      // High-volume node → entry cluster
  | 'order_book_wall'     // Large resting order
  | 'round_number'        // Psychological level
  | 'oi_funding_bias'     // OI + funding rate implication
  | 'cascade_scar'        // Past liquidation cascade at this level
  | 'atr_leverage_map'    // Volatility-adjusted liq estimate
  | 'multi_tf_confluence' // Appears on multiple timeframes
  | 'swing_level';        // Prior swing high/low (structure)

/** Full heatmap result */
export interface LiquidationHeatmap {
  currentPrice: number;
  pair: string;
  timestamp: number;
  /** All zones above current price (short liquidation fuel) */
  aboveZones: HeatmapZone[];
  /** All zones below current price (long liquidation fuel) */
  belowZones: HeatmapZone[];
  /** Top 3 highest-probability zones overall */
  topMagnets: HeatmapZone[];
  /** Nearest high-score zone direction */
  magnetDirection: 'up' | 'down' | 'balanced';
  /** Asymmetry: ratio of above fuel vs below fuel */
  asymmetryRatio: number;
  /** Overall sweep risk assessment */
  sweepRisk: 'high' | 'medium' | 'low';
  /** Summary for AI consumption */
  summary: string;
  /** Data freshness */
  dataAge: {
    volumeProfile: number; // ms since data
    orderBook: number;
    trades: number;
    futures: number;
  };
}

/** Input data for the heatmap builder */
export interface HeatmapInput {
  pair: string;
  currentPrice: number;
  /** OHLC data per timeframe (key = interval in minutes) */
  ohlcByTimeframe: Record<number, OHLCData[]>;
  /** Order book depth data (optional) */
  orderBook?: {
    walls: Array<{
      side: 'bid' | 'ask';
      price: number;
      eurValue: number;
      relativeSize: number;
      distancePercent: number;
    }>;
    bidTotalEur: number;
    askTotalEur: number;
    imbalance: number;
    timestamp: number;
  };
  /** Recent trades data (optional) */
  recentTrades?: {
    cascades: Array<{
      side: 'buy' | 'sell';
      priceStart: number;
      priceEnd: number;
      priceImpactPercent: number;
      totalEurValue: number;
      intensity: number;
      startTime: number;
    }>;
    largeTrades: Array<{
      price: number;
      volume: number;
      side: 'buy' | 'sell';
      eurValue: number;
      time: number;
    }>;
    timestamp: number;
  };
  /** Kraken Futures data (optional) */
  futures?: {
    xrpFundingRate: number;
    xrpOpenInterest: number;
    xrpOpenInterestUsd: number;
    btcFundingRate: number;
    marketBias: { direction: 'bullish' | 'bearish' | 'neutral'; strength: number };
    timestamp: number;
  };
  /** Range above/below current price to analyze (%) */
  rangePercent?: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Weight for each signal source in the composite score */
const SIGNAL_WEIGHTS: Record<HeatmapSignalSource, number> = {
  volume_profile: 30,
  order_book_wall: 20,
  round_number: 10,
  oi_funding_bias: 15,
  cascade_scar: 10,
  atr_leverage_map: 5,
  multi_tf_confluence: 7,
  swing_level: 3,
};

/** Zone resolution: price bucket size as % of current price */
const ZONE_SIZE_PERCENT = 0.5;

/** Minimum score to include a zone in output */
const MIN_ZONE_SCORE = 5;

/** Round number levels to check (multiplied by price magnitude) */
const ROUND_FACTORS = [0.01, 0.05, 0.10, 0.25, 0.50, 1.00];

/** Common leverage tiers */
const LEVERAGE_TIERS = [3, 5, 10, 25, 50, 100] as const;

// ============================================================================
// MAIN BUILDER
// ============================================================================

/**
 * Build a composite liquidation heatmap from all available data sources.
 * Each source contributes independently; missing sources reduce accuracy
 * but don't prevent generation.
 */
export function buildLiquidationHeatmap(input: HeatmapInput): LiquidationHeatmap {
  const {
    pair,
    currentPrice,
    ohlcByTimeframe,
    orderBook,
    recentTrades,
    futures,
    rangePercent = 15,
  } = input;

  const now = Date.now();
  const priceHigh = currentPrice * (1 + rangePercent / 100);
  const priceLow = currentPrice * (1 - rangePercent / 100);
  const zoneSize = currentPrice * (ZONE_SIZE_PERCENT / 100);

  // Build zone grid
  const numZones = Math.ceil((priceHigh - priceLow) / zoneSize);
  const zoneGrid: Map<number, {
    signals: HeatmapSignal[];
    type: 'long_liquidation' | 'short_liquidation';
    recentlySweep: boolean;
    leverages: Set<number>;
    eurAtRisk: number;
  }> = new Map();

  for (let i = 0; i < numZones; i++) {
    const zoneMid = priceLow + (i + 0.5) * zoneSize;
    zoneGrid.set(i, {
      signals: [],
      type: zoneMid < currentPrice ? 'long_liquidation' : 'short_liquidation',
      recentlySweep: false,
      leverages: new Set(),
      eurAtRisk: 0,
    });
  }

  const priceToZoneIndex = (price: number): number => {
    return Math.min(numZones - 1, Math.max(0, Math.floor((price - priceLow) / zoneSize)));
  };

  // --- Signal 1: Volume Profile Liquidation Estimates (per timeframe) ---
  const timeframes = Object.keys(ohlcByTimeframe).map(Number);
  const tfContributions = new Map<number, Set<number>>(); // zoneIdx → set of timeframes

  for (const tf of timeframes) {
    const candles = ohlcByTimeframe[tf];
    if (!candles || candles.length < 10) continue;

    const volumeProfile = buildVolumeProfile(candles, 80);
    const levels = estimateLiquidationLevels(volumeProfile, currentPrice, LEVERAGE_TIERS);

    for (const level of levels) {
      if (level.price < priceLow || level.price > priceHigh) continue;
      const idx = priceToZoneIndex(level.price);
      const zone = zoneGrid.get(idx);
      if (!zone) continue;

      // Scale contribution by volume strength and leverage probability
      // Lower leverage = more common = higher weight
      const leverageWeight = level.leverage <= 10 ? 1.0
        : level.leverage <= 25 ? 0.6
        : level.leverage <= 50 ? 0.3
        : 0.15;
      const contribution = level.strength * leverageWeight * 100;

      zone.signals.push({
        source: 'volume_profile',
        contribution: Math.min(100, contribution),
        detail: `${tf >= 60 ? `${tf / 60}h` : `${tf}m`} vol node at €${level.entryPrice.toFixed(4)} → ${level.leverage}x ${level.type} liq`,
      });
      zone.leverages.add(level.leverage);

      // Track multi-TF confluence
      if (!tfContributions.has(idx)) tfContributions.set(idx, new Set());
      tfContributions.get(idx)!.add(tf);
    }
  }

  // --- Signal 2: Multi-Timeframe Confluence Bonus ---
  for (const [idx, tfs] of tfContributions) {
    if (tfs.size >= 2) {
      const zone = zoneGrid.get(idx);
      if (!zone) continue;
      const confluenceBonus = Math.min(100, (tfs.size - 1) * 30);
      zone.signals.push({
        source: 'multi_tf_confluence',
        contribution: confluenceBonus,
        detail: `Confirmed on ${tfs.size} timeframes: ${[...tfs].map(t => t >= 60 ? `${t / 60}h` : `${t}m`).join(', ')}`,
      });
    }
  }

  // --- Signal 3: Order Book Walls ---
  if (orderBook) {
    for (const wall of orderBook.walls) {
      if (wall.price < priceLow || wall.price > priceHigh) continue;
      const idx = priceToZoneIndex(wall.price);
      const zone = zoneGrid.get(idx);
      if (!zone) continue;

      // Walls act as both defense (bounce off) and attack targets (sweep through)
      // Closer walls with larger size get higher scores
      const sizeScore = Math.min(100, wall.relativeSize * 15);
      const proximityBonus = wall.distancePercent < 2 ? 20 : wall.distancePercent < 5 ? 10 : 0;

      zone.signals.push({
        source: 'order_book_wall',
        contribution: Math.min(100, sizeScore + proximityBonus),
        detail: `${wall.side} wall €${wall.eurValue.toFixed(0)} (${wall.relativeSize.toFixed(1)}x avg) at €${wall.price.toFixed(4)}`,
      });
      zone.eurAtRisk += wall.eurValue;
    }
  }

  // --- Signal 4: Round Number Gravity ---
  {
    // Determine price magnitude for round number detection
    const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));

    for (const factor of ROUND_FACTORS) {
      const roundStep = magnitude * factor;
      const roundLow = Math.ceil(priceLow / roundStep) * roundStep;

      for (let rp = roundLow; rp <= priceHigh; rp += roundStep) {
        const idx = priceToZoneIndex(rp);
        const zone = zoneGrid.get(idx);
        if (!zone) continue;

        // Bigger round numbers get higher scores
        const roundness = factor >= 1.0 ? 100 : factor >= 0.50 ? 70 : factor >= 0.10 ? 50 : factor >= 0.05 ? 30 : 15;
        // Avoid double-counting: only keep the highest round number score per zone
        const existingRound = zone.signals.find(s => s.source === 'round_number');
        if (existingRound && existingRound.contribution >= roundness) continue;
        if (existingRound) {
          zone.signals = zone.signals.filter(s => s.source !== 'round_number');
        }

        zone.signals.push({
          source: 'round_number',
          contribution: roundness,
          detail: `€${rp.toFixed(rp >= 1 ? 2 : 4)} psychological level`,
        });
      }
    }
  }

  // --- Signal 5: OI + Funding Rate Directional Bias ---
  if (futures) {
    const { xrpFundingRate, xrpOpenInterestUsd, marketBias } = futures;

    // Positive funding = longs crowded → their liquidations are BELOW current price
    // Negative funding = shorts crowded → their liquidations are ABOVE current price
    const isLongCrowded = xrpFundingRate > 0.00005;
    const isShortCrowded = xrpFundingRate < -0.00005;
    const crowdingStrength = Math.min(100, Math.abs(xrpFundingRate) * 100000);

    // OI magnitude affects how much capital is at risk
    const oiScale = xrpOpenInterestUsd > 100_000_000 ? 1.0
      : xrpOpenInterestUsd > 50_000_000 ? 0.7
      : xrpOpenInterestUsd > 10_000_000 ? 0.4
      : 0.2;

    const biasContribution = Math.min(100, crowdingStrength * oiScale);

    // Apply bias to all zones on the crowded side
    for (const [idx, zone] of zoneGrid) {
      const zoneMid = priceLow + (idx + 0.5) * zoneSize;
      if (isLongCrowded && zoneMid < currentPrice) {
        zone.signals.push({
          source: 'oi_funding_bias',
          contribution: biasContribution,
          detail: `Longs crowded (funding ${(xrpFundingRate * 100).toFixed(4)}%, OI $${(xrpOpenInterestUsd / 1e6).toFixed(1)}M) → liq fuel below`,
        });
      } else if (isShortCrowded && zoneMid > currentPrice) {
        zone.signals.push({
          source: 'oi_funding_bias',
          contribution: biasContribution,
          detail: `Shorts crowded (funding ${(xrpFundingRate * 100).toFixed(4)}%, OI $${(xrpOpenInterestUsd / 1e6).toFixed(1)}M) → liq fuel above`,
        });
      }

      // Market-wide bias from BTC adds a mild directional tilt
      if (marketBias.direction !== 'neutral' && marketBias.strength > 0.2) {
        const mktContribution = Math.min(30, marketBias.strength * 40);
        if (marketBias.direction === 'bearish' && zoneMid < currentPrice) {
          zone.signals.push({
            source: 'oi_funding_bias',
            contribution: mktContribution,
            detail: `BTC bearish bias (${(marketBias.strength * 100).toFixed(0)}%) adds downside liq pressure`,
          });
        } else if (marketBias.direction === 'bullish' && zoneMid > currentPrice) {
          zone.signals.push({
            source: 'oi_funding_bias',
            contribution: mktContribution,
            detail: `BTC bullish bias (${(marketBias.strength * 100).toFixed(0)}%) adds upside liq pressure`,
          });
        }
      }
    }
  }

  // --- Signal 6: Cascade Scars (recent liquidation events) ---
  if (recentTrades) {
    for (const cascade of recentTrades.cascades) {
      const cascadeLow = Math.min(cascade.priceStart, cascade.priceEnd);
      const cascadeHigh = Math.max(cascade.priceStart, cascade.priceEnd);

      const lowIdx = priceToZoneIndex(cascadeLow);
      const highIdx = priceToZoneIndex(cascadeHigh);

      for (let idx = lowIdx; idx <= highIdx; idx++) {
        const zone = zoneGrid.get(idx);
        if (!zone) continue;

        // Recent cascades indicate these levels were SWEPT — less fuel remaining
        // But they also show where market makers know liquidations cluster
        const recency = (now - cascade.startTime) / (24 * 60 * 60 * 1000); // days ago
        const recencyDecay = Math.max(0.1, 1 - recency / 7); // Decays over 7 days
        const scarScore = Math.min(100, cascade.intensity * 100 * recencyDecay);

        zone.recentlySweep = true;
        zone.signals.push({
          source: 'cascade_scar',
          contribution: scarScore * 0.5, // Reduced weight since already swept
          detail: `Cascade ${cascade.side} (${cascade.priceImpactPercent.toFixed(2)}% impact, €${cascade.totalEurValue.toFixed(0)}) — partially swept`,
        });
      }
    }
  }

  // --- Signal 7: Swing Level Structure ---
  for (const tf of timeframes) {
    const candles = ohlcByTimeframe[tf];
    if (!candles || candles.length < 20) continue;

    const swingLevels = detectSwingLevels(candles, 5);
    for (const swing of swingLevels) {
      if (swing.price < priceLow || swing.price > priceHigh) continue;
      const idx = priceToZoneIndex(swing.price);
      const zone = zoneGrid.get(idx);
      if (!zone) continue;

      zone.signals.push({
        source: 'swing_level',
        contribution: Math.min(80, swing.touches * 20),
        detail: `${swing.type} at €${swing.price.toFixed(4)} (${swing.touches} touches)`,
      });
    }
  }

  // --- Signal 8: ATR-Scaled Leverage Mapping ---
  {
    // Use 1h candles if available, else longest available TF
    const atrTf = ohlcByTimeframe[60] || ohlcByTimeframe[timeframes[timeframes.length - 1]] || [];
    if (atrTf.length >= 14) {
      const atr = calculateATR(atrTf, 14);
      const atrPercent = (atr / currentPrice) * 100;

      // Map volatility to likely liquidation distances
      // In high volatility, even low leverage positions get caught
      for (const leverage of LEVERAGE_TIERS) {
        const liqDistanceLong = currentPrice * (1 - 0.8 / leverage); // ~80% of margin consumed
        const liqDistanceShort = currentPrice * (1 + 0.8 / leverage);

        // If ATR can reach the liq distance in ~3 periods, it's a realistic target
        const periodsToReach = Math.abs(currentPrice - liqDistanceLong) / atr;
        if (periodsToReach <= 6 && liqDistanceLong > priceLow) {
          const idx = priceToZoneIndex(liqDistanceLong);
          const zone = zoneGrid.get(idx);
          if (zone) {
            const reachability = Math.min(100, (1 / periodsToReach) * 50);
            zone.signals.push({
              source: 'atr_leverage_map',
              contribution: reachability,
              detail: `${leverage}x longs reachable in ~${periodsToReach.toFixed(1)} ATR periods (ATR ${atrPercent.toFixed(2)}%)`,
            });
            zone.leverages.add(leverage);
          }
        }
        if (periodsToReach <= 6 && liqDistanceShort < priceHigh) {
          const idx = priceToZoneIndex(liqDistanceShort);
          const zone = zoneGrid.get(idx);
          if (zone) {
            const reachability = Math.min(100, (1 / periodsToReach) * 50);
            zone.signals.push({
              source: 'atr_leverage_map',
              contribution: reachability,
              detail: `${leverage}x shorts reachable in ~${periodsToReach.toFixed(1)} ATR periods (ATR ${atrPercent.toFixed(2)}%)`,
            });
            zone.leverages.add(leverage);
          }
        }
      }
    }
  }

  // ============================================================================
  // COMPOSITE SCORING
  // ============================================================================

  const allZones: HeatmapZone[] = [];

  for (const [idx, zone] of zoneGrid) {
    if (zone.signals.length === 0) continue;

    const zoneMid = priceLow + (idx + 0.5) * zoneSize;
    const zoneFrom = priceLow + idx * zoneSize;
    const zoneTo = zoneFrom + zoneSize;

    // Weighted composite score
    let totalWeightedScore = 0;
    let totalWeight = 0;

    // Group signals by source and take the max contribution per source
    const bySource = new Map<HeatmapSignalSource, number>();
    for (const signal of zone.signals) {
      const current = bySource.get(signal.source) || 0;
      bySource.set(signal.source, Math.max(current, signal.contribution));
    }

    for (const [source, contribution] of bySource) {
      const weight = SIGNAL_WEIGHTS[source];
      totalWeightedScore += contribution * weight;
      totalWeight += weight * 100; // Normalize against max possible
    }

    const compositeScore = totalWeight > 0
      ? Math.min(100, (totalWeightedScore / totalWeight) * 100)
      : 0;

    if (compositeScore < MIN_ZONE_SCORE) continue;

    const distancePercent = ((zoneMid - currentPrice) / currentPrice) * 100;

    allZones.push({
      priceFrom: zoneFrom,
      priceTo: zoneTo,
      priceMid: zoneMid,
      score: Math.round(compositeScore * 10) / 10,
      type: zone.type,
      distancePercent: Math.round(distancePercent * 100) / 100,
      signals: zone.signals,
      recentlySweep: zone.recentlySweep,
      dominantLeverages: [...zone.leverages].sort((a, b) => a - b),
      estimatedValueAtRisk: zone.eurAtRisk > 0 ? zone.eurAtRisk : undefined,
    });
  }

  // Sort by score descending
  allZones.sort((a, b) => b.score - a.score);

  const aboveZones = allZones
    .filter(z => z.type === 'short_liquidation')
    .sort((a, b) => a.distancePercent - b.distancePercent);
  const belowZones = allZones
    .filter(z => z.type === 'long_liquidation')
    .sort((a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent));

  const topMagnets = allZones.slice(0, 3);

  // Asymmetry
  const aboveTotal = aboveZones.reduce((s, z) => s + z.score, 0);
  const belowTotal = belowZones.reduce((s, z) => s + z.score, 0);
  const asymmetryRatio = belowTotal > 0 ? aboveTotal / belowTotal : aboveTotal > 0 ? 999 : 1;

  // Magnet direction
  const nearestAbove = aboveZones[0];
  const nearestBelow = belowZones[0];
  let magnetDirection: 'up' | 'down' | 'balanced' = 'balanced';
  if (nearestAbove && nearestBelow) {
    const aboveStrength = nearestAbove.score / Math.max(1, Math.abs(nearestAbove.distancePercent));
    const belowStrength = nearestBelow.score / Math.max(1, Math.abs(nearestBelow.distancePercent));
    magnetDirection = aboveStrength > belowStrength * 1.3 ? 'up'
      : belowStrength > aboveStrength * 1.3 ? 'down'
      : 'balanced';
  } else if (nearestAbove) {
    magnetDirection = 'up';
  } else if (nearestBelow) {
    magnetDirection = 'down';
  }

  // Sweep risk
  const maxScore = topMagnets[0]?.score || 0;
  const nearestScore = Math.max(nearestAbove?.score || 0, nearestBelow?.score || 0);
  const nearestDist = Math.min(
    Math.abs(nearestAbove?.distancePercent || 999),
    Math.abs(nearestBelow?.distancePercent || 999)
  );
  const sweepRisk: 'high' | 'medium' | 'low' =
    nearestScore > 60 && nearestDist < 3 ? 'high'
    : nearestScore > 40 && nearestDist < 5 ? 'medium'
    : 'low';

  // Summary
  const summary = buildSummary(currentPrice, topMagnets, magnetDirection, sweepRisk, asymmetryRatio, futures);

  return {
    currentPrice,
    pair,
    timestamp: now,
    aboveZones,
    belowZones,
    topMagnets,
    magnetDirection,
    asymmetryRatio: Math.round(asymmetryRatio * 100) / 100,
    sweepRisk,
    summary,
    dataAge: {
      volumeProfile: 0, // Always fresh (computed from OHLC)
      orderBook: orderBook ? now - orderBook.timestamp : -1,
      trades: recentTrades ? now - recentTrades.timestamp : -1,
      futures: futures ? now - futures.timestamp : -1,
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Detect swing highs and lows from OHLC data */
function detectSwingLevels(
  candles: OHLCData[],
  lookback: number
): Array<{ price: number; type: 'swing_high' | 'swing_low'; touches: number }> {
  const levels: Array<{ price: number; type: 'swing_high' | 'swing_low'; touches: number }> = [];
  const tolerance = 0.002; // 0.2% tolerance for "same level"

  for (let i = lookback; i < candles.length - lookback; i++) {
    // Swing high
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= candles[i].high || candles[i + j].high >= candles[i].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      // Check if near existing level
      const existing = levels.find(l =>
        l.type === 'swing_high' && Math.abs(l.price - candles[i].high) / candles[i].high < tolerance
      );
      if (existing) {
        existing.touches++;
        existing.price = (existing.price + candles[i].high) / 2; // Average
      } else {
        levels.push({ price: candles[i].high, type: 'swing_high', touches: 1 });
      }
    }

    // Swing low
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low <= candles[i].low || candles[i + j].low <= candles[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      const existing = levels.find(l =>
        l.type === 'swing_low' && Math.abs(l.price - candles[i].low) / candles[i].low < tolerance
      );
      if (existing) {
        existing.touches++;
        existing.price = (existing.price + candles[i].low) / 2;
      } else {
        levels.push({ price: candles[i].low, type: 'swing_low', touches: 1 });
      }
    }
  }

  return levels;
}

/** Calculate ATR from candles */
function calculateATR(candles: OHLCData[], period: number): number {
  if (candles.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }

  // Wilder's smoothing
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

/** Build human-readable summary */
function buildSummary(
  currentPrice: number,
  topMagnets: HeatmapZone[],
  magnetDirection: string,
  sweepRisk: string,
  asymmetryRatio: number,
  futures?: HeatmapInput['futures']
): string {
  const parts: string[] = [];

  parts.push(`Price: €${currentPrice.toFixed(4)}.`);

  if (topMagnets.length > 0) {
    const top = topMagnets[0];
    const dirLabel = top.type === 'long_liquidation' ? 'below (long liq)' : 'above (short liq)';
    parts.push(
      `Strongest cluster: €${top.priceMid.toFixed(4)} ${dirLabel} (score ${top.score}, ${Math.abs(top.distancePercent).toFixed(1)}% away).`
    );
  }

  if (magnetDirection !== 'balanced') {
    parts.push(
      `Price magnet pulls ${magnetDirection === 'up' ? 'UP (short squeeze fuel above)' : 'DOWN (long liquidation fuel below)'}.`
    );
  }

  if (asymmetryRatio > 1.5) {
    parts.push('More liquidation fuel above → bullish asymmetry.');
  } else if (asymmetryRatio < 0.67) {
    parts.push('More liquidation fuel below → bearish asymmetry.');
  }

  parts.push(`Sweep risk: ${sweepRisk}.`);

  if (futures) {
    const fr = futures.xrpFundingRate;
    if (Math.abs(fr) > 0.00005) {
      parts.push(
        `Funding: ${fr > 0 ? 'longs pay shorts' : 'shorts pay longs'} (${(fr * 100).toFixed(4)}%).`
      );
    }
  }

  return parts.join(' ');
}

// ============================================================================
// CONVENIENCE: Fetch all data and build heatmap
// ============================================================================

/**
 * Build heatmap from API responses. Call this from the tool handler.
 * Fetches OHLC data internally for multiple timeframes.
 */
export async function buildHeatmapFromAPIs(
  pair: string,
  currentPrice: number,
  baseUrl: string,
  timeframes: number[] = [15, 60, 240],
  rangePercent: number = 15
): Promise<LiquidationHeatmap> {
  const fetchWithTimeout = async (url: string, ms = 12000): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  // Fetch all data in parallel
  const [ohlcResults, depthRes, tradesRes, futuresRes] = await Promise.allSettled([
    // OHLC for multiple timeframes
    Promise.all(
      timeframes.map(async (tf) => {
        const res = await fetchWithTimeout(`${baseUrl}/api/kraken/public/ohlc?pair=${pair}&interval=${tf}`);
        if (!res.ok) return { tf, data: [] as OHLCData[] };
        const json = await res.json();
        return { tf, data: (json.data || []) as OHLCData[] };
      })
    ),
    // Order book depth
    fetchWithTimeout(`${baseUrl}/api/kraken/public/depth?pair=${pair}&count=500`),
    // Recent trades
    fetchWithTimeout(`${baseUrl}/api/kraken/public/trades?pair=${pair}`),
    // Futures data
    fetchWithTimeout(`${baseUrl}/api/liquidation`),
  ]);

  // Parse OHLC
  const ohlcByTimeframe: Record<number, OHLCData[]> = {};
  if (ohlcResults.status === 'fulfilled') {
    for (const { tf, data } of ohlcResults.value) {
      if (data.length > 0) ohlcByTimeframe[tf] = data;
    }
  }

  // Parse depth
  let orderBook: HeatmapInput['orderBook'];
  if (depthRes.status === 'fulfilled' && depthRes.value.ok) {
    try {
      const d = await depthRes.value.json();
      if (d.walls) {
        orderBook = {
          walls: d.walls,
          bidTotalEur: d.bidTotalEur,
          askTotalEur: d.askTotalEur,
          imbalance: d.imbalance,
          timestamp: d.timestamp,
        };
      }
    } catch { /* ignore parse errors */ }
  }

  // Parse trades
  let recentTrades: HeatmapInput['recentTrades'];
  if (tradesRes.status === 'fulfilled' && tradesRes.value.ok) {
    try {
      const t = await tradesRes.value.json();
      if (t.cascades) {
        recentTrades = {
          cascades: t.cascades,
          largeTrades: t.largeTrades || [],
          timestamp: t.timestamp,
        };
      }
    } catch { /* ignore parse errors */ }
  }

  // Parse futures
  let futures: HeatmapInput['futures'];
  if (futuresRes.status === 'fulfilled' && futuresRes.value.ok) {
    try {
      const f = await futuresRes.value.json();
      if (f.xrp) {
        futures = {
          xrpFundingRate: f.xrp.fundingRate,
          xrpOpenInterest: f.xrp.openInterest,
          xrpOpenInterestUsd: f.xrp.openInterestUsd,
          btcFundingRate: f.btc?.fundingRate || 0,
          marketBias: f.marketBias || { direction: 'neutral', strength: 0 },
          timestamp: f.timestamp || Date.now(),
        };
      }
    } catch { /* ignore parse errors */ }
  }

  return buildLiquidationHeatmap({
    pair,
    currentPrice,
    ohlcByTimeframe,
    orderBook,
    recentTrades,
    futures,
    rangePercent,
  });
}

'use client';

/**
 * useV2Engine - Bridge between TradingDataProvider and v2 engine modules.
 *
 * Consumes existing position/balance/indicator data from the provider and
 * runs the v2 engine logic (position sizing, DCA signals, exit signals)
 * to produce EngineOutput for the PositionDashboard.
 *
 * This hook does NOT modify the provider - it reads from it and computes
 * derived v2 state on each tick.
 */

import { useMemo, useRef } from 'react';
import { useTradingData } from '@/components/TradingDataProvider';
import type { RawPositionEntry } from '@/components/TradingDataProvider';
import type { TradingRecommendation } from '@/lib/kraken/types';
import type {
  PositionState,
  EngineOutput,
  EngineSummary,
  TradingEngineConfig,
  TradingStrategy,
  TradeDirection,
  EntryRecord,
} from '@/lib/trading/v2-types';
import {
  EMPTY_POSITION_STATE,
  DEFAULT_STRATEGY,
} from '@/lib/trading/v2-types';
import { updatePositionState, calculateEntrySize } from '@/lib/trading/position-sizing';
import { calculateKrakenLiquidationPrice } from '@/lib/trading/position-health';
import { analyzeDCAOpportunity } from '@/lib/trading/dca-signals';
import { analyzeExitConditions, getExitStatusSummary } from '@/lib/trading/exit-signals';
import { detectReversal, type ReversalSignal } from '@/lib/trading/reversal-detector';
import { detectMarketRegime } from '@/lib/trading/market-regime';

// ============================================================================
// BRIDGE: Kraken positions -> PositionState
// ============================================================================

/**
 * Group raw position entries by ordertxid to collapse partial fills,
 * then sort by timestamp to identify initial entry vs DCA entries.
 */
function groupRawEntries(rawEntries: RawPositionEntry[]): Array<{
  ordertxid: string;
  price: number;
  volume: number;
  cost: number;
  fee: number;
  margin: number;
  timestamp: number;
}> {
  const grouped = new Map<string, {
    ordertxid: string;
    totalCost: number;
    totalVolume: number;
    totalFee: number;
    totalMargin: number;
    earliestTimestamp: number;
  }>();

  for (const entry of rawEntries) {
    const key = entry.ordertxid || entry.id; // Fallback to id if no ordertxid
    const existing = grouped.get(key);
    if (existing) {
      existing.totalCost += entry.cost;
      existing.totalVolume += entry.volume;
      existing.totalFee += entry.fee;
      existing.totalMargin += entry.margin;
      existing.earliestTimestamp = Math.min(existing.earliestTimestamp, entry.timestamp);
    } else {
      grouped.set(key, {
        ordertxid: key,
        totalCost: entry.cost,
        totalVolume: entry.volume,
        totalFee: entry.fee,
        totalMargin: entry.margin,
        earliestTimestamp: entry.timestamp,
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.earliestTimestamp - b.earliestTimestamp)
    .map(g => ({
      ordertxid: g.ordertxid,
      price: g.totalVolume > 0 ? g.totalCost / g.totalVolume : 0,
      volume: g.totalVolume,
      cost: g.totalCost,
      fee: g.totalFee,
      margin: g.totalMargin,
      timestamp: g.earliestTimestamp,
    }));
}

function bridgeToPositionState(
  positions: Array<{
    pair: string;
    type?: 'buy' | 'sell';
    side?: 'long' | 'short';
    cost: number;
    fee: number;
    volume: number;
    margin: number;
    leverage: number;
    openTime?: number;
    openedAt?: string;
    actualRolloverCost?: number;
    avgEntryPrice?: number;
    totalCost?: number;
    totalFees?: number;
    unrealizedPnl?: number;
    unrealizedPnlPercent?: number;
    unrealizedPnlLevered?: number;
    unrealizedPnlLeveredPercent?: number;
    liquidationPrice?: number;
    marginUsed?: number;
    rawEntries?: RawPositionEntry[];
  }>,
  currentPrice: number,
  availableMargin: number,
  isSimulated: boolean,
  tradeBalance: { e: string; tb: string } | null,
  timeboxMaxHours: number,
  maxDCACount: number
): PositionState {
  if (positions.length === 0) {
    return EMPTY_POSITION_STATE;
  }

  // Use the first XRP position
  const pos = positions[0];

  // Determine direction
  let direction: TradeDirection;
  if (isSimulated) {
    direction = (pos.side === 'short') ? 'short' : 'long';
  } else {
    direction = (pos.type === 'sell') ? 'short' : 'long';
  }

  // Entry price
  const avgPrice = isSimulated && pos.avgEntryPrice
    ? pos.avgEntryPrice
    : pos.volume > 0 ? pos.cost / pos.volume : 0;

  // Open timestamp
  let openedAt: number;
  if (isSimulated && pos.openedAt) {
    openedAt = new Date(pos.openedAt).getTime();
  } else if (pos.openTime) {
    openedAt = pos.openTime;
  } else {
    openedAt = Date.now();
  }

  const volume = pos.volume || 0;
  const marginUsed = isSimulated ? (pos.marginUsed ?? pos.margin ?? 0) : (pos.margin ?? 0);
  const leverage = pos.leverage || 10;
  const fees = isSimulated ? (pos.totalFees ?? pos.fee ?? 0) : (pos.fee ?? 0);
  const rolloverCost = pos.actualRolloverCost ?? 0;

  // Calculate margin percent
  const totalEquity = marginUsed + availableMargin;
  const marginPercent = totalEquity > 0 ? (marginUsed / totalEquity) * 100 : 0;

  // Time tracking
  const now = Date.now();
  const timeInTradeMs = now - openedAt;
  const hoursInTrade = timeInTradeMs / (1000 * 60 * 60);
  const hoursRemaining = Math.max(0, timeboxMaxHours - hoursInTrade);
  const timeboxProgress = Math.min(1, hoursInTrade / timeboxMaxHours);

  // Build entry records from raw entries (DCA detection)
  let entries: EntryRecord[];
  let dcaCount: number;

  if (!isSimulated && pos.rawEntries && pos.rawEntries.length > 0) {
    // Group by ordertxid to collapse partial fills into logical entries
    const grouped = groupRawEntries(pos.rawEntries);

    entries = grouped.map((g, idx) => {
      const entryMarginPercent = totalEquity > 0 ? (g.margin / totalEquity) * 100 : 0;
      return {
        id: idx === 0 ? 'initial' : `dca-${idx}`,
        type: (idx === 0 ? 'initial' : 'dca') as 'initial' | 'dca',
        dcaLevel: idx,
        price: g.price,
        volume: g.volume,
        marginUsed: g.margin,
        marginPercent: entryMarginPercent,
        timestamp: g.timestamp,
        confidence: 75,
        entryMode: 'full' as const,
        reason: idx === 0 ? 'Initial entry' : `DCA entry #${idx}`,
      };
    });
    dcaCount = Math.min(entries.length - 1, maxDCACount);
  } else {
    // Simulated or no raw entries — single synthetic entry
    entries = [{
      id: 'initial',
      type: 'initial',
      dcaLevel: 0,
      price: avgPrice,
      volume,
      marginUsed,
      marginPercent,
      timestamp: openedAt,
      confidence: 75,
      entryMode: 'full',
      reason: 'Existing position',
    }];
    dcaCount = 0;
  }

  // Liquidation price - use Kraken's proper formula when account data is available
  const equity = tradeBalance ? parseFloat(tradeBalance.e || '0') : 0;
  const tb = tradeBalance ? parseFloat(tradeBalance.tb || '0') : 0;

  let liquidationPrice: number;
  if (equity > 0 && volume > 0 && avgPrice > 0) {
    // Use the proper Kraken formula that accounts for total account equity (cross-margin)
    liquidationPrice = calculateKrakenLiquidationPrice({
      side: direction === 'long' ? 'long' : 'short',
      entryPrice: avgPrice,
      volume,
      marginUsed,
      leverage,
      equity,
      tradeBalance: tb,
    });
  } else {
    // Fallback: simple estimate when no account data
    const liquidationMovePercent = 0.6 / leverage;
    liquidationPrice = direction === 'long'
      ? avgPrice * (1 - liquidationMovePercent)
      : avgPrice * (1 + liquidationMovePercent);
  }

  // Use provided P&L if available, else compute
  let unrealizedPnL = 0;
  let unrealizedPnLPercent = 0;
  let unrealizedPnLLevered = 0;
  let unrealizedPnLLeveredPercent = 0;

  if (isSimulated && pos.unrealizedPnl !== undefined) {
    unrealizedPnL = pos.unrealizedPnl;
    unrealizedPnLPercent = pos.unrealizedPnlPercent ?? 0;
    unrealizedPnLLevered = pos.unrealizedPnlLevered ?? unrealizedPnL;
    unrealizedPnLLeveredPercent = pos.unrealizedPnlLeveredPercent ?? (marginUsed > 0 ? (unrealizedPnL / marginUsed) * 100 : 0);
  } else if (avgPrice > 0 && volume > 0) {
    const priceDiff = direction === 'long'
      ? currentPrice - avgPrice
      : avgPrice - currentPrice;
    // Gross P&L (fees subtracted later by updatePositionState)
    unrealizedPnL = priceDiff * volume;
    const notional = avgPrice * volume;
    unrealizedPnLPercent = notional > 0 ? (unrealizedPnL / notional) * 100 : 0;
    unrealizedPnLLevered = unrealizedPnL;
    unrealizedPnLLeveredPercent = marginUsed > 0 ? (unrealizedPnL / marginUsed) * 100 : 0;
  }

  // Liquidation distance from current price
  let liquidationDistancePercent: number;
  if (liquidationPrice <= 0) {
    liquidationDistancePercent = 100; // Effectively safe
  } else if (direction === 'long') {
    liquidationDistancePercent = ((currentPrice - liquidationPrice) / currentPrice) * 100;
  } else {
    liquidationDistancePercent = ((liquidationPrice - currentPrice) / currentPrice) * 100;
  }

  // Rollover cost per 4h (estimate from actual if available)
  const hours = hoursInTrade || 1;
  const rolloverPer4h = rolloverCost > 0 ? (rolloverCost / hours) * 4 : 0;

  return {
    isOpen: true,
    direction,
    phase: 'entry', // Will be refined by engine tick
    entries,
    avgPrice,
    totalVolume: volume,
    totalMarginUsed: marginUsed,
    totalMarginPercent: marginPercent,
    dcaCount,
    unrealizedPnL,
    unrealizedPnLPercent,
    unrealizedPnLLevered,
    unrealizedPnLLeveredPercent,
    highWaterMarkPnL: Math.max(0, unrealizedPnL), // Start HWM at current
    drawdownFromHWM: 0,
    drawdownFromHWMPercent: 0,
    openedAt,
    timeInTradeMs,
    hoursRemaining,
    timeboxProgress,
    liquidationPrice,
    liquidationDistancePercent,
    leverage,
    totalFees: fees + rolloverCost,
    rolloverCostPer4h: rolloverPer4h,
  };
}

// ============================================================================
// SUMMARY BUILDER
// ============================================================================

function buildEngineSummary(
  position: PositionState,
  config: TradingEngineConfig,
  recommendation: TradingRecommendation | null,
  exitSignal: ReturnType<typeof analyzeExitConditions> | null,
  dcaSignal: ReturnType<typeof analyzeDCAOpportunity> | null
): EngineSummary {
  // Idle state
  if (!position.isOpen || position.phase === 'idle') {
    const hasSignal = recommendation && recommendation.action !== 'WAIT';
    return {
      headline: hasSignal
        ? `Signal: ${recommendation!.action} (${recommendation!.confidence}%)`
        : 'Waiting for setup',
      statusColor: hasSignal ? 'yellow' : 'gray',
      metrics: recommendation ? [
        { label: 'Long', value: `${recommendation.longScore}/${recommendation.totalItems}` },
        { label: 'Short', value: `${recommendation.shortScore}/${recommendation.totalItems}` },
      ] : [],
      alerts: [],
    };
  }

  // Active position
  const hoursElapsed = position.timeInTradeMs / (1000 * 60 * 60);
  const maxHours = config.timebox.maxHours;
  const isOverdue = hoursElapsed >= maxHours;
  const isProfitable = position.unrealizedPnL >= 0;

  // Determine status color from exit urgency + time
  let statusColor: EngineSummary['statusColor'] = 'green';
  if (exitSignal?.shouldExit) {
    statusColor = 'red';
  } else if (exitSignal && exitSignal.urgency === 'soon') {
    statusColor = 'orange';
  } else if (exitSignal && exitSignal.urgency === 'consider') {
    statusColor = 'yellow';
  } else if (isOverdue) {
    statusColor = 'red';
  } else if (hoursElapsed >= maxHours * 0.75) {
    statusColor = 'orange';
  } else if (hoursElapsed >= maxHours * 0.5) {
    statusColor = 'yellow';
  }

  // Headline
  let headline: string;
  if (exitSignal?.shouldExit) {
    const exitStatus = getExitStatusSummary(exitSignal);
    headline = `${exitStatus.label} - ${exitSignal.explanation.split('.')[0]}`;
  } else if (dcaSignal?.shouldDCA) {
    headline = `DCA Signal Active (Level ${dcaSignal.dcaLevel})`;
  } else if (isOverdue) {
    headline = `Timebox Expired - ${isProfitable ? 'Exit on green' : 'Holding at loss'}`;
  } else {
    headline = `${position.direction.toUpperCase()} Position Active`;
  }

  // Metrics
  const metrics: EngineSummary['metrics'] = [
    {
      label: 'P&L',
      value: `${position.unrealizedPnL >= 0 ? '+' : ''}${position.unrealizedPnL.toFixed(2)}`,
      color: isProfitable ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'Time',
      value: `${hoursElapsed.toFixed(1)}h / ${maxHours}h`,
    },
    {
      label: 'Margin',
      value: `${position.totalMarginPercent.toFixed(0)}%`,
    },
  ];

  if (exitSignal && exitSignal.totalPressure > 0) {
    metrics.push({
      label: 'Exit Pressure',
      value: `${exitSignal.totalPressure}%`,
      color: exitSignal.totalPressure >= 60 ? 'text-red-400' : exitSignal.totalPressure >= 30 ? 'text-yellow-400' : undefined,
    });
  }

  // Alerts
  const alerts: string[] = [];
  if (isOverdue) {
    alerts.push(`Timebox expired (${hoursElapsed.toFixed(1)}h). Exit on any profit.`);
  }
  if (exitSignal?.shouldExit) {
    alerts.push(exitSignal.explanation);
  }
  if (dcaSignal?.shouldDCA) {
    alerts.push(dcaSignal.reason);
  }
  if (dcaSignal && dcaSignal.warnings.length > 0) {
    alerts.push(...dcaSignal.warnings);
  }
  if (position.liquidationDistancePercent < 5) {
    alerts.push(`Liquidation risk: only ${position.liquidationDistancePercent.toFixed(1)}% away`);
  }

  return { headline, statusColor, metrics, alerts };
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export interface V2EngineResult {
  /** v2 position state (bridged from existing data) */
  position: PositionState;
  /** Engine output with all signals */
  output: EngineOutput;
  /** Whether a position is currently tracked */
  hasPosition: boolean;
  /** Strategy name for display */
  strategyName: string;
  /** Engine config in use */
  config: TradingEngineConfig;
}

export function useV2Engine(
  recommendation: TradingRecommendation | null,
  strategy: TradingStrategy = DEFAULT_STRATEGY
): V2EngineResult {
  const {
    price,
    tfData,
    tradeBalance,
    openPositions,
    simulatedPositions,
  } = useTradingData();

  // Track HWM across renders (persists between ticks)
  const hwmRef = useRef(0);

  // Determine if we're in test mode by checking which positions are populated
  const isSimulated = simulatedPositions.length > 0;
  const positions = isSimulated ? simulatedPositions : openPositions;

  // Available margin from trade balance
  const availableMargin = tradeBalance
    ? parseFloat(tradeBalance.mf || '0')
    : 0;

  const config: TradingEngineConfig = useMemo(() => ({
    positionSizing: strategy.positionSizing,
    antiGreed: strategy.antiGreed,
    timebox: strategy.timebox,
    timeframeWeights: strategy.timeframeWeights,
    dca: strategy.dca,
    exit: strategy.exit,
  }), [strategy]);

  // Build the full v2 engine output
  const result = useMemo<V2EngineResult>(() => {
    // Bridge existing position data to v2 PositionState
    let positionState = bridgeToPositionState(
      positions as any[], // Both types are compatible with our bridge
      price,
      availableMargin,
      isSimulated,
      tradeBalance,
      strategy.timebox.maxHours,
      strategy.positionSizing.maxDCACount
    );

    // Persist HWM across ticks
    if (positionState.isOpen) {
      hwmRef.current = Math.max(hwmRef.current, positionState.unrealizedPnL);
      positionState = {
        ...positionState,
        highWaterMarkPnL: hwmRef.current,
        drawdownFromHWM: hwmRef.current > 0 ? hwmRef.current - positionState.unrealizedPnL : 0,
        drawdownFromHWMPercent: hwmRef.current > 0
          ? ((hwmRef.current - positionState.unrealizedPnL) / hwmRef.current) * 100
          : 0,
      };
    } else {
      hwmRef.current = 0;
    }

    // Update position state with current price (updates P&L, time, liq distance)
    if (positionState.isOpen && price > 0) {
      positionState = updatePositionState(positionState, price, Date.now(), strategy.timebox.maxHours);
      // Re-apply HWM from ref (updatePositionState might reset it)
      positionState = {
        ...positionState,
        highWaterMarkPnL: hwmRef.current,
        drawdownFromHWM: hwmRef.current > 0 ? hwmRef.current - positionState.unrealizedPnL : 0,
        drawdownFromHWMPercent: hwmRef.current > 0
          ? ((hwmRef.current - positionState.unrealizedPnL) / hwmRef.current) * 100
          : 0,
      };
    }

    // Determine phase from signals
    const ind15m = tfData[15]?.indicators ?? null;
    const ind1h = tfData[60]?.indicators ?? null;
    const ind5m = tfData[5]?.indicators ?? null;
    const ohlc5m = tfData[5]?.ohlc ?? [];

    // DCA signal (only when position is open)
    let dcaSignal = null;
    if (positionState.isOpen && ind15m && ind1h && ind5m) {
      dcaSignal = analyzeDCAOpportunity(
        positionState,
        ind15m,
        ind1h,
        ind5m,
        ohlc5m,
        price,
        config.dca
      );
    }

    // Reversal detection for exit signal enhancement
    const ohlc15m = tfData[15]?.ohlc ?? [];
    let positionReversalSignal: ReversalSignal | null = null;
    if (positionState.isOpen && ind5m && ind15m && ohlc5m.length >= 5 && ohlc15m.length >= 5) {
      positionReversalSignal = detectReversal({
        ohlcByTimeframe: { '5': ohlc5m, '15': ohlc15m },
        indicatorsByTimeframe: { '5': ind5m, '15': ind15m },
        currentDirection: positionState.direction,
        timeframePriority: ['5', '15'],
      });
    }

    // Exit signal (only when position is open)
    let exitSignal = null;
    if (positionState.isOpen && ind15m && ind1h && ind5m) {
      // Market regime detection for exit adjustments
      const ind4h = tfData[240]?.indicators ?? null;
      const exitRegimeAnalysis = detectMarketRegime(ind4h, ind1h, strategy.regime);

      exitSignal = analyzeExitConditions(
        positionState,
        ind15m,
        ind1h,
        ind5m,
        price,
        Date.now(),
        strategy,
        positionReversalSignal,
        recommendation?.knifeStatus ?? null,
        exitRegimeAnalysis,
        null, // micro: not available from context yet
        ind4h
      );
    }

    // Position sizing (when no position, show what entry would look like)
    let sizing = null;
    if (!positionState.isOpen && recommendation && (recommendation.action === 'LONG' || recommendation.action === 'SHORT')) {
      sizing = calculateEntrySize(
        recommendation.confidence,
        price,
        availableMargin,
        config.positionSizing
      );
    }

    // Refine phase based on signals
    if (positionState.isOpen) {
      if (exitSignal?.shouldExit) {
        positionState = { ...positionState, phase: 'exiting' };
      } else if (exitSignal && exitSignal.totalPressure >= 30) {
        positionState = { ...positionState, phase: 'exit_watch' };
      } else if (dcaSignal?.shouldDCA) {
        positionState = { ...positionState, phase: 'in_dca' };
      } else if (positionState.dcaCount === 0 && positionState.unrealizedPnL < 0) {
        positionState = { ...positionState, phase: 'dca_watch' };
      } else {
        positionState = { ...positionState, phase: 'entry' };
      }
    }

    // Build summary
    const summary = buildEngineSummary(positionState, config, recommendation, exitSignal, dcaSignal);

    return {
      position: positionState,
      output: {
        position: positionState,
        sizing,
        dcaSignal,
        exitSignal,
        summary,
      },
      hasPosition: positionState.isOpen,
      strategyName: strategy.meta.name,
      config,
    };
  }, [positions, price, availableMargin, isSimulated, tradeBalance, tfData, config, recommendation, strategy]);

  return result;
}

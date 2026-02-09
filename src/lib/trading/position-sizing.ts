/**
 * Position Sizing Engine v2
 *
 * Replaces the old calculatePosition() in recommendation.ts with a proper
 * margin-aware position sizing engine that matches the trader's rules:
 *
 * - First entry: 10-20% of available margin based on confidence
 * - 80%+ confidence = full entry (20%)
 * - 65-79% confidence = cautious entry (10%)
 * - Below 65% = skip
 * - Max 3 DCA levels, total max 80% margin
 * - Always keep 20% margin free
 * - No stop losses (willing to be liquidated)
 * - 10x leverage on Kraken
 */

import type {
  PositionState,
  PositionSizingConfig,
  PositionSizingResult,
  EntryRecord,
  TradeDirection,
} from './v2-types';
import {
  DEFAULT_POSITION_SIZING,
  EMPTY_POSITION_STATE,
  DEFAULT_TIMEBOX,
} from './v2-types';

// ============================================================================
// ENTRY SIZE CALCULATION
// ============================================================================

/**
 * Calculate position size for initial entry.
 *
 * @param confidence - Signal confidence (0-100)
 * @param currentPrice - Current asset price
 * @param availableMargin - Free margin available (EUR)
 * @param config - Position sizing config
 * @returns Sizing result with volume, margin, and DCA capacity
 */
export function calculateEntrySize(
  confidence: number,
  currentPrice: number,
  availableMargin: number,
  config: PositionSizingConfig = DEFAULT_POSITION_SIZING
): PositionSizingResult {
  // Below minimum confidence - skip
  if (confidence < config.minEntryConfidence) {
    return {
      shouldEnter: false,
      entryMode: 'skip',
      skipReason: `Confidence ${confidence}% below minimum ${config.minEntryConfidence}%`,
      marginToUse: 0,
      marginPercent: 0,
      positionValue: 0,
      volume: 0,
      remainingDCACapacity: calculateDCACapacity(0, availableMargin, config),
    };
  }

  // Determine entry mode and margin %
  const isFull = confidence >= config.fullEntryConfidence;
  const entryMode: 'full' | 'cautious' = isFull ? 'full' : 'cautious';
  const targetMarginPercent = isFull
    ? config.fullEntryMarginPercent
    : config.cautiousEntryMarginPercent;

  // Calculate actual margin to use
  const marginToUse = (availableMargin * targetMarginPercent) / 100;

  // Ensure we keep enough free margin
  const maxAllowedMargin = availableMargin * (1 - config.minFreeMarginPercent / 100);
  const clampedMargin = Math.min(marginToUse, maxAllowedMargin);

  if (clampedMargin <= 0) {
    return {
      shouldEnter: false,
      entryMode: 'skip',
      skipReason: 'Insufficient free margin',
      marginToUse: 0,
      marginPercent: 0,
      positionValue: 0,
      volume: 0,
      remainingDCACapacity: calculateDCACapacity(0, availableMargin, config),
    };
  }

  // Calculate position value and volume
  const positionValue = clampedMargin * config.leverage;
  const volume = currentPrice > 0 ? positionValue / currentPrice : 0;
  const actualMarginPercent = availableMargin > 0
    ? (clampedMargin / availableMargin) * 100
    : 0;

  return {
    shouldEnter: true,
    entryMode,
    marginToUse: clampedMargin,
    marginPercent: actualMarginPercent,
    positionValue,
    volume,
    remainingDCACapacity: calculateDCACapacity(clampedMargin, availableMargin, config),
  };
}

// ============================================================================
// DCA SIZE CALCULATION
// ============================================================================

/**
 * Calculate position size for a DCA entry.
 *
 * @param dcaLevel - Which DCA this is (1, 2, or 3)
 * @param currentPrice - Current asset price
 * @param position - Current position state
 * @param availableMargin - Free margin available (EUR)
 * @param config - Position sizing config
 * @returns Sizing result for the DCA
 */
export function calculateDCASize(
  dcaLevel: 1 | 2 | 3,
  currentPrice: number,
  position: PositionState,
  availableMargin: number,
  config: PositionSizingConfig = DEFAULT_POSITION_SIZING
): PositionSizingResult {
  // Validate DCA level
  if (dcaLevel > config.maxDCACount) {
    return {
      shouldEnter: false,
      entryMode: 'skip',
      skipReason: `Max ${config.maxDCACount} DCAs reached`,
      marginToUse: 0,
      marginPercent: 0,
      positionValue: 0,
      volume: 0,
      remainingDCACapacity: { dcasRemaining: 0, marginAvailable: 0, marginPerDCA: 0 },
    };
  }

  // Check if we've already used too much margin
  const totalEquity = availableMargin + position.totalMarginUsed;
  const currentUtilization = totalEquity > 0
    ? (position.totalMarginUsed / totalEquity) * 100
    : 0;

  if (currentUtilization >= config.maxTotalMarginPercent) {
    return {
      shouldEnter: false,
      entryMode: 'skip',
      skipReason: `Margin utilization ${currentUtilization.toFixed(0)}% exceeds max ${config.maxTotalMarginPercent}%`,
      marginToUse: 0,
      marginPercent: 0,
      positionValue: 0,
      volume: 0,
      remainingDCACapacity: { dcasRemaining: 0, marginAvailable: 0, marginPerDCA: 0 },
    };
  }

  // Calculate DCA margin
  const targetDCAMargin = (totalEquity * config.dcaMarginPercent) / 100;

  // Cap by max total margin and free margin constraints
  const maxAdditionalMargin = Math.min(
    (totalEquity * config.maxTotalMarginPercent / 100) - position.totalMarginUsed,
    availableMargin * (1 - config.minFreeMarginPercent / 100)
  );

  const clampedMargin = Math.min(targetDCAMargin, maxAdditionalMargin);

  if (clampedMargin <= 0) {
    return {
      shouldEnter: false,
      entryMode: 'skip',
      skipReason: 'Insufficient margin for DCA',
      marginToUse: 0,
      marginPercent: 0,
      positionValue: 0,
      volume: 0,
      remainingDCACapacity: { dcasRemaining: 0, marginAvailable: 0, marginPerDCA: 0 },
    };
  }

  const positionValue = clampedMargin * config.leverage;
  const volume = currentPrice > 0 ? positionValue / currentPrice : 0;
  const actualMarginPercent = totalEquity > 0
    ? (clampedMargin / totalEquity) * 100
    : 0;

  const newTotalMargin = position.totalMarginUsed + clampedMargin;
  const remainingCapacity = calculateDCACapacity(newTotalMargin, availableMargin - clampedMargin, config);
  // Reduce remaining count based on this DCA
  remainingCapacity.dcasRemaining = Math.max(0, config.maxDCACount - dcaLevel);

  return {
    shouldEnter: true,
    entryMode: 'full', // DCAs are always "full" for their level
    marginToUse: clampedMargin,
    marginPercent: actualMarginPercent,
    positionValue,
    volume,
    remainingDCACapacity: remainingCapacity,
  };
}

// ============================================================================
// LIQUIDATION PRICE
// ============================================================================

/**
 * Estimate liquidation price for a margin position.
 *
 * On Kraken with 10x leverage:
 * - Long liquidation: entryPrice * (1 - 1/leverage + buffer)
 * - Short liquidation: entryPrice * (1 + 1/leverage - buffer)
 *
 * Kraken's actual liquidation is at ~80% margin level, so we use
 * a conservative estimate. The margin maintenance is roughly the
 * inverse of leverage minus a small buffer.
 *
 * @param avgEntryPrice - Volume-weighted average entry price
 * @param totalMarginUsed - Total EUR margin committed
 * @param positionValue - Total position notional value (margin * leverage)
 * @param direction - Trade direction
 * @param leverage - Leverage multiplier
 * @returns Liquidation price and distance metrics
 */
export function calculateLiquidationPrice(
  avgEntryPrice: number,
  totalMarginUsed: number,
  positionValue: number,
  direction: TradeDirection,
  leverage: number = 10
): {
  liquidationPrice: number;
  distancePercent: number;
} {
  if (avgEntryPrice <= 0 || totalMarginUsed <= 0 || positionValue <= 0) {
    return { liquidationPrice: 0, distancePercent: 0 };
  }

  // Kraken liquidates at ~80% margin level for retail accounts
  // margin level = (equity / marginUsed) * 100
  // At liquidation: equity = 0.8 * marginUsed
  // equity = marginUsed + unrealizedPnL → unrealizedPnL = -0.2 * marginUsed
  // pnl = movePercent * notional = movePercent * marginUsed * leverage
  // -0.2 * marginUsed = movePercent * marginUsed * leverage
  // movePercent = -0.2 / leverage (2% for 10x)
  const liquidationMovePercent = 0.2 / leverage; // ~2% for 10x

  let liquidationPrice: number;
  if (direction === 'long') {
    // Long liquidated when price drops ~2% from entry (10x)
    liquidationPrice = avgEntryPrice * (1 - liquidationMovePercent);
  } else {
    // Short liquidated when price rises ~2% from entry (10x)
    liquidationPrice = avgEntryPrice * (1 + liquidationMovePercent);
  }

  const distancePercent = Math.abs(
    ((avgEntryPrice - liquidationPrice) / avgEntryPrice) * 100
  );

  return { liquidationPrice, distancePercent };
}

// ============================================================================
// AVERAGE PRICE CALCULATION
// ============================================================================

/**
 * Calculate volume-weighted average entry price from entries.
 */
export function calculateAvgEntryPrice(entries: EntryRecord[]): number {
  if (entries.length === 0) return 0;

  let totalCost = 0;
  let totalVolume = 0;

  for (const entry of entries) {
    totalCost += entry.price * entry.volume;
    totalVolume += entry.volume;
  }

  return totalVolume > 0 ? totalCost / totalVolume : 0;
}

/**
 * Calculate what the new average price would be after adding a DCA entry.
 */
export function calculateNewAvgPrice(
  currentAvgPrice: number,
  currentVolume: number,
  dcaPrice: number,
  dcaVolume: number
): number {
  const totalCost = (currentAvgPrice * currentVolume) + (dcaPrice * dcaVolume);
  const totalVolume = currentVolume + dcaVolume;
  return totalVolume > 0 ? totalCost / totalVolume : 0;
}

// ============================================================================
// UNREALIZED P&L
// ============================================================================

/**
 * Calculate unrealized P&L for an open position.
 *
 * @param currentPrice - Current market price
 * @param avgEntryPrice - Volume-weighted average entry price
 * @param totalVolume - Total position volume in base currency
 * @param direction - Trade direction
 * @param leverage - Leverage multiplier
 * @param totalMarginUsed - Total margin committed (for % calculations)
 * @returns P&L metrics
 */
export function calculateUnrealizedPnL(
  currentPrice: number,
  avgEntryPrice: number,
  totalVolume: number,
  direction: TradeDirection,
  leverage: number,
  totalMarginUsed: number
): {
  pnl: number;
  pnlPercent: number;
  pnlLevered: number;
  pnlLeveredPercent: number;
} {
  if (avgEntryPrice <= 0 || totalVolume <= 0) {
    return { pnl: 0, pnlPercent: 0, pnlLevered: 0, pnlLeveredPercent: 0 };
  }

  // Price P&L (unleveraged, based on margin)
  const priceDiff = direction === 'long'
    ? currentPrice - avgEntryPrice
    : avgEntryPrice - currentPrice;

  // Total P&L in EUR
  const pnl = priceDiff * totalVolume;

  // P&L as % of position notional value
  const notionalValue = avgEntryPrice * totalVolume;
  const pnlPercent = notionalValue > 0 ? (pnl / notionalValue) * 100 : 0;

  // Leveraged P&L (what the trader actually gains/loses on their margin)
  // Same EUR amount but measured against margin invested
  const pnlLevered = pnl;
  const pnlLeveredPercent = totalMarginUsed > 0 ? (pnl / totalMarginUsed) * 100 : 0;

  return { pnl, pnlPercent, pnlLevered, pnlLeveredPercent };
}

// ============================================================================
// POSITION STATE MANAGEMENT
// ============================================================================

/**
 * Create initial position state from a new entry.
 */
export function createPositionFromEntry(
  direction: TradeDirection,
  entry: EntryRecord,
  leverage: number,
  currentPrice: number
): PositionState {
  const { liquidationPrice, distancePercent } = calculateLiquidationPrice(
    entry.price,
    entry.marginUsed,
    entry.marginUsed * leverage,
    direction,
    leverage
  );

  return {
    isOpen: true,
    direction,
    phase: 'entry',
    entries: [entry],
    avgPrice: entry.price,
    totalVolume: entry.volume,
    totalMarginUsed: entry.marginUsed,
    totalMarginPercent: entry.marginPercent,
    dcaCount: 0,
    unrealizedPnL: 0,
    unrealizedPnLPercent: 0,
    unrealizedPnLLevered: 0,
    unrealizedPnLLeveredPercent: 0,
    highWaterMarkPnL: 0,
    drawdownFromHWM: 0,
    drawdownFromHWMPercent: 0,
    openedAt: entry.timestamp,
    timeInTradeMs: 0,
    hoursRemaining: 48,
    timeboxProgress: 0,
    liquidationPrice,
    liquidationDistancePercent: distancePercent,
    leverage,
    totalFees: 0,
    rolloverCostPer4h: 0,
  };
}

/**
 * Update position state with a new DCA entry.
 * Recalculates average price, liquidation, and margin usage.
 */
export function addDCAToPosition(
  position: PositionState,
  dcaEntry: EntryRecord,
  availableMarginBeforeDCA: number
): PositionState {
  const entries = [...position.entries, dcaEntry];
  const avgPrice = calculateAvgEntryPrice(entries);
  const totalVolume = entries.reduce((sum, e) => sum + e.volume, 0);
  const totalMarginUsed = entries.reduce((sum, e) => sum + e.marginUsed, 0);

  const totalEquity = availableMarginBeforeDCA + position.totalMarginUsed;
  const totalMarginPercent = totalEquity > 0
    ? (totalMarginUsed / totalEquity) * 100
    : 0;

  const { liquidationPrice, distancePercent } = calculateLiquidationPrice(
    avgPrice,
    totalMarginUsed,
    totalMarginUsed * position.leverage,
    position.direction,
    position.leverage
  );

  return {
    ...position,
    phase: 'in_dca',
    entries,
    avgPrice,
    totalVolume,
    totalMarginUsed,
    totalMarginPercent,
    dcaCount: position.dcaCount + 1,
    liquidationPrice,
    liquidationDistancePercent: distancePercent,
  };
}

/**
 * Update position state with current market data (called every tick).
 * Updates P&L, HWM, timebox, and liquidation distance.
 *
 * @param position - Current position state
 * @param currentPrice - Current market price
 * @param now - Current timestamp (defaults to Date.now())
 * @param timeboxMaxHours - Timebox max hours from strategy
 */
export function updatePositionState(
  position: PositionState,
  currentPrice: number,
  now: number = Date.now(),
  timeboxMaxHours: number = DEFAULT_TIMEBOX.maxHours
): PositionState {
  if (!position.isOpen) return position;

  // Update P&L (gross price movement)
  const pnl = calculateUnrealizedPnL(
    currentPrice,
    position.avgPrice,
    position.totalVolume,
    position.direction,
    position.leverage,
    position.totalMarginUsed
  );

  // Subtract fees+rollover so P&L matches what the trader actually nets
  const totalCosts = position.totalFees;
  pnl.pnl -= totalCosts;
  pnl.pnlLevered -= totalCosts;
  const notionalValue = position.avgPrice * position.totalVolume;
  pnl.pnlPercent = notionalValue > 0 ? (pnl.pnl / notionalValue) * 100 : 0;
  pnl.pnlLeveredPercent = position.totalMarginUsed > 0 ? (pnl.pnlLevered / position.totalMarginUsed) * 100 : 0;

  // Update high water mark
  const highWaterMarkPnL = Math.max(position.highWaterMarkPnL, pnl.pnlLevered);
  const drawdownFromHWM = highWaterMarkPnL > 0
    ? highWaterMarkPnL - pnl.pnlLevered
    : 0;
  const drawdownFromHWMPercent = highWaterMarkPnL > 0
    ? (drawdownFromHWM / highWaterMarkPnL) * 100
    : 0;

  // Update time tracking (timebox hours from strategy config)
  const timeInTradeMs = now - position.openedAt;
  const hoursInTrade = timeInTradeMs / (1000 * 60 * 60);
  const hoursRemaining = Math.max(0, timeboxMaxHours - hoursInTrade);
  const timeboxProgress = Math.min(1, hoursInTrade / timeboxMaxHours);

  // Update liquidation distance from current price (direction-aware)
  let liquidationDistancePercent: number;
  if (position.liquidationPrice <= 0 || currentPrice <= 0) {
    liquidationDistancePercent = 100; // Effectively safe
  } else if (position.direction === 'long') {
    liquidationDistancePercent = ((currentPrice - position.liquidationPrice) / currentPrice) * 100;
  } else {
    liquidationDistancePercent = ((position.liquidationPrice - currentPrice) / currentPrice) * 100;
  }

  return {
    ...position,
    unrealizedPnL: pnl.pnl,
    unrealizedPnLPercent: pnl.pnlPercent,
    unrealizedPnLLevered: pnl.pnlLevered,
    unrealizedPnLLeveredPercent: pnl.pnlLeveredPercent,
    highWaterMarkPnL,
    drawdownFromHWM,
    drawdownFromHWMPercent,
    timeInTradeMs,
    hoursRemaining,
    timeboxProgress,
    liquidationDistancePercent,
  };
}

/**
 * Close a position and return final state.
 */
export function closePosition(position: PositionState): PositionState {
  return {
    ...position,
    isOpen: false,
    phase: 'closed',
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calculate remaining DCA capacity given current margin usage.
 */
function calculateDCACapacity(
  currentMarginUsed: number,
  freeMargin: number,
  config: PositionSizingConfig
): {
  dcasRemaining: number;
  marginAvailable: number;
  marginPerDCA: number;
} {
  const totalEquity = currentMarginUsed + freeMargin;
  const maxMargin = (totalEquity * config.maxTotalMarginPercent) / 100;
  const marginAvailable = Math.max(0, maxMargin - currentMarginUsed);
  const dcaMargin = (totalEquity * config.dcaMarginPercent) / 100;

  // How many DCAs can fit in remaining margin?
  const dcasRemaining = dcaMargin > 0
    ? Math.min(config.maxDCACount, Math.floor(marginAvailable / dcaMargin))
    : 0;

  return {
    dcasRemaining,
    marginAvailable,
    marginPerDCA: dcaMargin,
  };
}

/**
 * Format margin info for display.
 */
export function formatMarginInfo(
  position: PositionState,
  availableMargin: number,
  config: PositionSizingConfig = DEFAULT_POSITION_SIZING
): {
  utilizationPercent: number;
  freeMarginEUR: number;
  dcaCapacity: ReturnType<typeof calculateDCACapacity>;
  status: 'healthy' | 'moderate' | 'high' | 'critical';
} {
  const totalEquity = position.totalMarginUsed + availableMargin;
  const utilizationPercent = totalEquity > 0
    ? (position.totalMarginUsed / totalEquity) * 100
    : 0;

  const dcaCapacity = calculateDCACapacity(
    position.totalMarginUsed,
    availableMargin,
    config
  );

  const status =
    utilizationPercent >= 80 ? 'critical' :
    utilizationPercent >= 60 ? 'high' :
    utilizationPercent >= 30 ? 'moderate' : 'healthy';

  return {
    utilizationPercent,
    freeMarginEUR: availableMargin,
    dcaCapacity,
    status,
  };
}

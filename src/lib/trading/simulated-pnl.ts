/**
 * Simulated Trading P&L Calculations
 *
 * Utilities for calculating P&L on simulated positions
 */

import { FEE_RATES } from './trade-calculations';

export interface SimulatedPnLResult {
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  unrealizedPnlLevered: number;
  unrealizedPnlLeveredPercent: number;
  liquidationPrice: number;
  marginUsed: number;
  currentValue: number;
  costBasis: number;
}

/**
 * Calculate unrealized P&L for a simulated position
 * @param entryPrice - Average entry price
 * @param currentPrice - Current market price
 * @param volume - Position volume (always positive)
 * @param side - 'long' or 'short'
 * @param leverage - Leverage multiplier
 * @param totalFees - Total fees paid
 * @param equity - Total account equity (optional, for accurate Kraken liquidation calc)
 */
export function calculateSimulatedPnL(
  entryPrice: number,
  currentPrice: number,
  volume: number,
  side: 'long' | 'short',
  leverage: number,
  totalFees: number,
  equity?: number
): SimulatedPnLResult {
  // Calculate position values
  const costBasis = entryPrice * volume;
  const currentValue = currentPrice * volume;

  // Calculate raw P&L based on side
  let rawPnl: number;
  if (side === 'long') {
    rawPnl = currentValue - costBasis;
  } else {
    rawPnl = costBasis - currentValue;
  }

  // Unrealized P&L (before fees)
  const unrealizedPnl = rawPnl;
  const unrealizedPnlPercent = costBasis > 0 ? (rawPnl / costBasis) * 100 : 0;

  // Levered P&L (actual return on margin)
  const marginUsed = costBasis / leverage;
  const unrealizedPnlLevered = rawPnl - totalFees;
  const unrealizedPnlLeveredPercent = marginUsed > 0 ? (unrealizedPnlLevered / marginUsed) * 100 : 0;

  // Calculate liquidation price using Kraken's actual formula
  // Kraken liquidates at ~40% margin level, considering total account equity
  // Formula from Kraken docs:
  // Long: Liquidation Price = Entry Price - ((Equity - (Used Margin × 0.4)) / Volume)
  // Short: Liquidation Price = Leverage × (Trade Balance + (Entry × Volume)) / (Volume × (0.4 + Leverage))
  const accountEquity = equity ?? marginUsed; // Use position margin if no equity provided
  let liquidationPrice: number;

  if (side === 'long') {
    // Long: price drops until equity reaches 40% of margin
    liquidationPrice = entryPrice - ((accountEquity - (marginUsed * 0.4)) / volume);
  } else {
    // Short: price rises until equity reaches 40% of margin
    // Using simplified formula: entry + ((equity - margin*0.4) / volume)
    liquidationPrice = entryPrice + ((accountEquity - (marginUsed * 0.4)) / volume);
  }

  // Ensure liquidation price is positive
  liquidationPrice = Math.max(0, liquidationPrice);

  return {
    unrealizedPnl,
    unrealizedPnlPercent,
    unrealizedPnlLevered,
    unrealizedPnlLeveredPercent,
    liquidationPrice,
    marginUsed,
    currentValue,
    costBasis,
  };
}

/**
 * Calculate fees for a simulated trade
 * @param volume - Position volume
 * @param price - Execution price
 * @param orderType - 'market' or 'limit'
 * @param isMargin - Whether this is a margin trade
 */
export function calculateSimulatedFees(
  volume: number,
  price: number,
  orderType: 'market' | 'limit',
  isMargin: boolean
): number {
  const notionalValue = volume * price;
  const tradingFeeRate = orderType === 'market' ? FEE_RATES.taker : FEE_RATES.maker;
  const tradingFee = notionalValue * tradingFeeRate;

  const marginOpenFee = isMargin ? notionalValue * FEE_RATES.marginOpen : 0;

  return tradingFee + marginOpenFee;
}

/**
 * Calculate margin required for a position
 */
export function calculateMarginRequired(
  volume: number,
  price: number,
  leverage: number
): number {
  const notionalValue = volume * price;
  return notionalValue / leverage;
}

/**
 * Check if a position would be liquidated at a given price
 */
export function isLiquidated(
  entryPrice: number,
  currentPrice: number,
  side: 'long' | 'short',
  leverage: number
): boolean {
  const movePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  const liquidationThreshold = 100 / leverage; // e.g., 10% for 10x leverage

  if (side === 'long') {
    return movePercent <= -liquidationThreshold;
  } else {
    return movePercent >= liquidationThreshold;
  }
}

/**
 * Calculate realized P&L when closing a position
 */
export function calculateRealizedPnL(
  entryPrice: number,
  exitPrice: number,
  volume: number,
  side: 'long' | 'short',
  totalFees: number
): number {
  let rawPnl: number;
  if (side === 'long') {
    rawPnl = (exitPrice - entryPrice) * volume;
  } else {
    rawPnl = (entryPrice - exitPrice) * volume;
  }

  return rawPnl - totalFees;
}

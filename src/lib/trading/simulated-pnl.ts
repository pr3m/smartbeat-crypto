/**
 * Simulated Trading P&L Calculations
 *
 * Utilities for calculating P&L on simulated positions.
 * All P&L values are NET (after fees + rollover), matching Kraken's reporting.
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
  rolloverFee: number;
  totalFeesIncRollover: number;
}

/**
 * Calculate unrealized P&L for a simulated position.
 *
 * P&L is NET of all fees (entry + estimated rollover), matching Kraken's display.
 *
 * @param entryPrice - Average entry price
 * @param currentPrice - Current market price
 * @param volume - Position volume (always positive)
 * @param side - 'long' or 'short'
 * @param leverage - Leverage multiplier
 * @param totalFees - Total fees paid at entry
 * @param equity - Total account equity (for Kraken liquidation calc)
 * @param openedAt - Position open timestamp (for rollover calculation)
 */
export function calculateSimulatedPnL(
  entryPrice: number,
  currentPrice: number,
  volume: number,
  side: 'long' | 'short',
  leverage: number,
  totalFees: number,
  equity?: number,
  openedAt?: number
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

  // Estimate rollover fee: 0.02% of notional per 4 hours
  let rolloverFee = 0;
  if (openedAt && openedAt > 0) {
    const hoursOpen = (Date.now() - openedAt) / (1000 * 60 * 60);
    const rolloverPeriods = Math.floor(hoursOpen / 4);
    rolloverFee = costBasis * FEE_RATES.marginRollover * rolloverPeriods;
  }

  const totalFeesIncRollover = totalFees + rolloverFee;

  // Unrealized P&L is NET (after all fees) — matches Kraken's display
  const unrealizedPnl = rawPnl - totalFeesIncRollover;
  const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

  // Levered P&L = same EUR value but as % of margin invested
  const marginUsed = costBasis / leverage;
  const unrealizedPnlLevered = unrealizedPnl;
  const unrealizedPnlLeveredPercent = marginUsed > 0 ? (unrealizedPnlLevered / marginUsed) * 100 : 0;

  // Calculate liquidation price using Kraken's formula
  // Kraken liquidates at ~80% margin level
  // For a single position: price where equity drops to 80% of margin
  const accountEquity = equity ?? marginUsed;
  let liquidationPrice: number;

  if (side === 'long') {
    // Long: price drops until equity reaches 80% of margin
    liquidationPrice = entryPrice - ((accountEquity - (marginUsed * 0.8)) / volume);
  } else {
    // Short: price rises until equity reaches 80% of margin
    liquidationPrice = entryPrice + ((accountEquity - (marginUsed * 0.8)) / volume);
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
    rolloverFee,
    totalFeesIncRollover,
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
 * Check if a position would be liquidated at a given price.
 * Uses margin level check: liquidate when equity < 80% of margin used.
 */
export function isLiquidated(
  entryPrice: number,
  currentPrice: number,
  side: 'long' | 'short',
  leverage: number
): boolean {
  // Calculate P&L as fraction of margin
  const movePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  // With 10x leverage, 8% move wipes 80% of margin → liquidation at ~80% margin level
  // margin level = (margin + pnl) / margin * 100
  // liquidation when margin level < 80: pnl < -0.2 * margin = -0.2 * (notional/leverage)
  // pnl = movePercent/100 * notional → movePercent/100 * notional < -0.2 * notional / leverage
  // movePercent < -20/leverage (for long)
  const liquidationThreshold = 20 / leverage; // 2% for 10x

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

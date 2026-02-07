/**
 * Trade Execution Calculations
 *
 * Utilities for calculating margin requirements, projected margin levels,
 * fee estimates, and risk assessments.
 */

import { calculateLiquidationPrice as calculateUserLiquidationPrice } from './position-sizing';

/**
 * Calculate required margin for a position
 * @param orderSize - Total position size in quote currency (EUR)
 * @param leverage - Leverage multiplier (e.g., 10 for 10x)
 * @returns Required margin in quote currency
 */
export function calculateRequiredMargin(orderSize: number, leverage: number): number {
  if (leverage <= 0) return orderSize;
  return orderSize / leverage;
}

/**
 * Calculate projected margin level after opening a new position
 * Kraken margin level = (equity / margin used) * 100
 * @param currentEquity - Current account equity (trade balance + unrealized P&L)
 * @param currentMarginUsed - Current margin in use
 * @param newPositionMargin - Margin required for the new position
 * @returns Projected margin level as a percentage
 */
export function calculateProjectedMarginLevel(
  currentEquity: number,
  currentMarginUsed: number,
  newPositionMargin: number
): number {
  const totalMarginUsed = currentMarginUsed + newPositionMargin;
  if (totalMarginUsed <= 0) return Infinity;
  return (currentEquity / totalMarginUsed) * 100;
}

/**
 * Fee schedule for XRP/EUR on Kraken
 * Fees depend on 30-day volume, using default tier
 */
export const FEE_RATES = {
  taker: 0.0026, // 0.26% for market orders
  maker: 0.0016, // 0.16% for limit orders
  marginOpen: 0.0002, // 0.02% margin opening fee
  marginRollover: 0.0002, // 0.02% per 4 hours
} as const;

export interface FeeEstimate {
  tradingFee: number;
  marginOpenFee: number;
  rolloverPer4h: number;
  total: number;
}

/**
 * Estimate fees for an order
 * @param orderSize - Position size in quote currency (EUR)
 * @param orderType - 'market' or 'limit'
 * @param leverage - Leverage multiplier (0 for spot)
 * @returns Fee estimates
 */
export function estimateFees(
  orderSize: number,
  orderType: 'market' | 'limit',
  leverage: number
): FeeEstimate {
  const tradingFeeRate = orderType === 'market' ? FEE_RATES.taker : FEE_RATES.maker;
  const tradingFee = orderSize * tradingFeeRate;

  // Margin fees only apply with leverage
  const isMargin = leverage > 0;
  const marginOpenFee = isMargin ? orderSize * FEE_RATES.marginOpen : 0;
  const rolloverPer4h = isMargin ? orderSize * FEE_RATES.marginRollover : 0;

  return {
    tradingFee,
    marginOpenFee,
    rolloverPer4h,
    total: tradingFee + marginOpenFee,
  };
}

export interface RiskAssessment {
  isRisky: boolean;
  isCritical: boolean;
  percentage: number;
  marginLevelAfter: number;
  messages: string[];
}

/**
 * Check margin risk against user's 10% rule and Kraken's margin requirements
 * @param requiredMargin - Margin required for the order
 * @param freeMargin - Available margin (mf from trade balance)
 * @param currentEquity - Current account equity
 * @param currentMarginUsed - Current margin in use
 * @returns Risk assessment with messages
 */
export function assessMarginRisk(
  requiredMargin: number,
  freeMargin: number,
  currentEquity: number,
  currentMarginUsed: number
): RiskAssessment {
  const messages: string[] = [];
  let isRisky = false;
  let isCritical = false;

  // Calculate what percentage of free margin this order uses
  const percentage = freeMargin > 0 ? (requiredMargin / freeMargin) * 100 : 100;

  // User's personal rule: don't use more than 10% per trade
  if (percentage > 10) {
    isRisky = true;
    messages.push(`Order uses ${percentage.toFixed(1)}% of available margin (>10% rule)`);
  }

  // Calculate projected margin level
  const marginLevelAfter = calculateProjectedMarginLevel(
    currentEquity,
    currentMarginUsed,
    requiredMargin
  );

  // Warning levels
  if (marginLevelAfter < 150) {
    isCritical = true;
    messages.push(`Projected margin level ${marginLevelAfter.toFixed(0)}% is below 150% (high risk)`);
  } else if (marginLevelAfter < 200) {
    isRisky = true;
    messages.push(`Projected margin level ${marginLevelAfter.toFixed(0)}% is approaching danger zone`);
  }

  // Check if order exceeds available margin
  if (requiredMargin > freeMargin) {
    isCritical = true;
    messages.push('Insufficient margin for this order');
  }

  return {
    isRisky,
    isCritical,
    percentage,
    marginLevelAfter,
    messages,
  };
}

export interface OrderPreview {
  side: 'buy' | 'sell';
  amount: number; // XRP
  price: number; // EUR per XRP
  total: number; // EUR
  leverage: number;
  requiredMargin: number;
  projectedMarginLevel: number;
  liquidationPrice: number;
  fees: FeeEstimate;
  risk: RiskAssessment;
}

/**
 * Generate a complete order preview with all calculations
 */
export function generateOrderPreview(
  side: 'buy' | 'sell',
  amount: number,
  price: number,
  leverage: number,
  orderType: 'market' | 'limit',
  tradeBalance: {
    equity: number;
    marginUsed: number;
    freeMargin: number;
  }
): OrderPreview {
  const total = amount * price;
  const requiredMargin = calculateRequiredMargin(total, leverage);
  const fees = estimateFees(total, orderType, leverage);
  const risk = assessMarginRisk(
    requiredMargin,
    tradeBalance.freeMargin,
    tradeBalance.equity,
    tradeBalance.marginUsed
  );
  const projectedMarginLevel = calculateProjectedMarginLevel(
    tradeBalance.equity,
    tradeBalance.marginUsed,
    requiredMargin
  );
  const direction = side === 'buy' ? 'long' : 'short';
  const { liquidationPrice } = calculateUserLiquidationPrice(
    price,
    requiredMargin,
    total,
    direction as 'long' | 'short',
    leverage
  );

  return {
    side,
    amount,
    price,
    total,
    leverage,
    requiredMargin,
    projectedMarginLevel,
    liquidationPrice,
    fees,
    risk,
  };
}

/**
 * Format price according to Kraken's requirements
 * XRP/EUR uses 5 decimal places
 */
export function formatKrakenPrice(price: number): string {
  return price.toFixed(5);
}

/**
 * Format volume according to Kraken's requirements
 * XRP uses 8 decimal places max, but typically 0 for whole numbers
 */
export function formatKrakenVolume(volume: number): string {
  // Use reasonable precision - 4 decimals for XRP
  return volume.toFixed(4);
}

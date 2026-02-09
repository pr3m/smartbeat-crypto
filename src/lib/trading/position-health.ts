/**
 * Position Health Calculator
 * Calculates health metrics for open positions
 *
 * Kraken Liquidation Formulas (from Kraken support docs):
 * - Margin Level = (Equity / Used Margin) × 100
 * - Liquidation occurs at ~40% margin level
 *
 * Long:  Liquidation Price = Entry Price - ((Trade Balance - (Used Margin × 0.4)) / Volume)
 * Short: Liquidation Price = Leverage × (Trade Balance + (Entry × Volume)) / (Volume × (0.4 + Leverage))
 *
 * IMPORTANT: Both formulas use Trade Balance (tb), NOT Equity (e).
 * Trade Balance = account value excluding unrealized P&L.
 * Equity = Trade Balance + unrealized P&L (changes with price, not suitable for static liq calc).
 *
 * These are CROSS-MARGIN formulas: the entire account balance supports all positions.
 * A large account balance relative to position size → liquidation price far from entry.
 */

/**
 * Calculate the correct liquidation price based on Kraken's formula.
 * Uses cross-margin model: entire account trade balance supports the position.
 */
export function calculateKrakenLiquidationPrice(params: {
  side: 'long' | 'short';
  entryPrice: number;
  volume: number;
  marginUsed: number;
  leverage: number;
  equity: number; // Total account equity (tradeBalance.e) — used by health metrics, not liq calc
  tradeBalance: number; // Trade balance (tradeBalance.tb) — used for liquidation calculation
}): number {
  const { side, entryPrice, volume, marginUsed, leverage, tradeBalance } = params;

  if (side === 'long') {
    // Long: Liquidation Price = Entry Price - ((Trade Balance - (Used Margin × 0.4)) / Volume)
    const liqPrice = entryPrice - ((tradeBalance - (marginUsed * 0.4)) / volume);
    // Liquidation price can't be negative
    return Math.max(0, liqPrice);
  } else {
    // Short: Liquidation Price = Leverage × (Trade Balance + (Entry × Volume)) / (Volume × (0.4 + Leverage))
    const liqPrice = (leverage * (tradeBalance + (entryPrice * volume))) / (volume * (0.4 + leverage));
    return liqPrice;
  }
}

export interface PositionHealthInput {
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  liquidationPrice: number;
  leverage: number;
  marginUsed: number;
  equity: number;
  openedAt: Date | string;
}

export interface PositionHealthMetrics {
  liquidationDistance: number; // % from current to liq price
  liquidationStatus: 'danger' | 'warning' | 'safe';
  marginLevel: number; // (equity/margin) * 100
  marginStatus: 'critical' | 'low' | 'healthy';
  hoursOpen: number;
  timeStatus: 'overdue' | 'approaching' | null;
  estimatedRolloverFee: number;
  riskLevel: 'extreme' | 'high' | 'medium' | 'low';
  riskFactors: string[];
}

/**
 * Calculate position health metrics
 */
export function calculatePositionHealth(input: PositionHealthInput): PositionHealthMetrics {
  const {
    side,
    entryPrice,
    currentPrice,
    liquidationPrice,
    leverage,
    marginUsed,
    equity,
    openedAt,
  } = input;

  // Calculate liquidation distance
  let liquidationDistance: number;
  if (liquidationPrice <= 0) {
    // If liquidation price is 0 or negative, liquidation is practically impossible
    // This happens when account equity is high relative to position margin
    liquidationDistance = 100; // Effectively "safe" - price would need to go to 0
  } else if (side === 'long') {
    // For longs, liquidation is below current price
    liquidationDistance = ((currentPrice - liquidationPrice) / currentPrice) * 100;
  } else {
    // For shorts, liquidation is above current price
    liquidationDistance = ((liquidationPrice - currentPrice) / currentPrice) * 100;
  }

  // Determine liquidation status
  let liquidationStatus: 'danger' | 'warning' | 'safe';
  if (liquidationDistance < 5) {
    liquidationStatus = 'danger';
  } else if (liquidationDistance < 10) {
    liquidationStatus = 'warning';
  } else {
    liquidationStatus = 'safe';
  }

  // Calculate margin level (equity/margin * 100)
  const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : 1000;

  // Determine margin status
  let marginStatus: 'critical' | 'low' | 'healthy';
  if (marginLevel < 120) {
    marginStatus = 'critical';
  } else if (marginLevel < 200) {
    marginStatus = 'low';
  } else {
    marginStatus = 'healthy';
  }

  // Calculate hours open
  const openTime = typeof openedAt === 'string' ? new Date(openedAt) : openedAt;
  const hoursOpen = (Date.now() - openTime.getTime()) / (1000 * 60 * 60);

  // Determine time status
  let timeStatus: 'overdue' | 'approaching' | null = null;
  if (hoursOpen > 72) {
    timeStatus = 'overdue';
  } else if (hoursOpen > 48) {
    timeStatus = 'approaching';
  }

  // Estimate rollover fees (Kraken charges ~0.01-0.02% per 4 hours)
  const rolloverPeriods = Math.floor(hoursOpen / 4);
  const notionalValue = marginUsed * leverage;
  const estimatedRolloverFee = notionalValue * 0.00015 * rolloverPeriods;

  // Calculate overall risk level and factors
  const riskFactors: string[] = [];

  if (liquidationStatus === 'danger') {
    riskFactors.push(`Liquidation only ${liquidationDistance.toFixed(1)}% away`);
  } else if (liquidationStatus === 'warning') {
    riskFactors.push(`Liquidation at ${liquidationDistance.toFixed(1)}% distance`);
  }

  if (marginStatus === 'critical') {
    riskFactors.push(`Margin level critical (${marginLevel.toFixed(0)}%)`);
  } else if (marginStatus === 'low') {
    riskFactors.push(`Margin level low (${marginLevel.toFixed(0)}%)`);
  }

  if (timeStatus === 'overdue') {
    riskFactors.push(`Position overdue (${hoursOpen.toFixed(0)}h open)`);
  } else if (timeStatus === 'approaching') {
    riskFactors.push(`Position aging (${hoursOpen.toFixed(0)}h open)`);
  }

  if (estimatedRolloverFee > marginUsed * 0.05) {
    riskFactors.push(`High rollover fees (~€${estimatedRolloverFee.toFixed(2)})`);
  }

  // Calculate P&L risk
  const pnlPercent = side === 'long'
    ? ((currentPrice - entryPrice) / entryPrice) * 100 * leverage
    : ((entryPrice - currentPrice) / entryPrice) * 100 * leverage;

  if (pnlPercent < -50) {
    riskFactors.push(`Heavy loss (${pnlPercent.toFixed(1)}% levered)`);
  } else if (pnlPercent < -25) {
    riskFactors.push(`Significant loss (${pnlPercent.toFixed(1)}% levered)`);
  }

  // Determine overall risk level
  let riskLevel: 'extreme' | 'high' | 'medium' | 'low';
  if (
    liquidationStatus === 'danger' ||
    marginStatus === 'critical' ||
    riskFactors.length >= 4
  ) {
    riskLevel = 'extreme';
  } else if (
    liquidationStatus === 'warning' ||
    marginStatus === 'low' ||
    timeStatus === 'overdue' ||
    riskFactors.length >= 3
  ) {
    riskLevel = 'high';
  } else if (
    timeStatus === 'approaching' ||
    riskFactors.length >= 2
  ) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  return {
    liquidationDistance,
    liquidationStatus,
    marginLevel,
    marginStatus,
    hoursOpen,
    timeStatus,
    estimatedRolloverFee,
    riskLevel,
    riskFactors,
  };
}

/**
 * Get color classes for risk level
 */
export function getRiskLevelColors(level: 'extreme' | 'high' | 'medium' | 'low'): {
  bg: string;
  text: string;
  border: string;
} {
  switch (level) {
    case 'extreme':
      return { bg: 'bg-red-500/30', text: 'text-red-400', border: 'border-red-500' };
    case 'high':
      return { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500' };
    case 'medium':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500' };
    case 'low':
      return { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500' };
  }
}

/**
 * Get color classes for liquidation status
 */
export function getLiquidationStatusColors(status: 'danger' | 'warning' | 'safe'): {
  bg: string;
  text: string;
} {
  switch (status) {
    case 'danger':
      return { bg: 'bg-red-500/30', text: 'text-red-400' };
    case 'warning':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-400' };
    case 'safe':
      return { bg: 'bg-green-500/20', text: 'text-green-400' };
  }
}

/**
 * Get color classes for margin status
 */
export function getMarginStatusColors(status: 'critical' | 'low' | 'healthy'): {
  bg: string;
  text: string;
} {
  switch (status) {
    case 'critical':
      return { bg: 'bg-red-500/30', text: 'text-red-400' };
    case 'low':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-400' };
    case 'healthy':
      return { bg: 'bg-green-500/20', text: 'text-green-400' };
  }
}

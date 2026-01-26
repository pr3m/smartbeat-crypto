/**
 * Market Microstructure Utility Functions
 * Calculations for order flow analysis and trading signals
 */

import type { WSv2BookLevel, TradeEntry } from '@/lib/kraken/types';

/**
 * Calculate order book imbalance
 * @param bids - Array of bid levels
 * @param asks - Array of ask levels
 * @returns Imbalance from -1 (ask heavy) to 1 (bid heavy)
 */
export function calculateImbalance(
  bids: WSv2BookLevel[],
  asks: WSv2BookLevel[]
): number {
  if (bids.length === 0 || asks.length === 0) return 0;

  const bidVolume = bids.reduce((sum, l) => sum + l.qty * l.price, 0);
  const askVolume = asks.reduce((sum, l) => sum + l.qty * l.price, 0);
  const total = bidVolume + askVolume;

  return total > 0 ? (bidVolume - askVolume) / total : 0;
}

/**
 * Calculate cumulative depth at each price level
 * @param levels - Order book levels
 * @returns Levels with cumulative quantities
 */
export function calculateCumulativeDepth(
  levels: WSv2BookLevel[]
): Array<WSv2BookLevel & { cumulative: number; cumulativeEur: number }> {
  let cumulative = 0;
  let cumulativeEur = 0;

  return levels.map(level => {
    cumulative += level.qty;
    cumulativeEur += level.qty * level.price;
    return {
      ...level,
      cumulative,
      cumulativeEur,
    };
  });
}

/**
 * Detect if a trade is considered "large" based on recent history
 * @param trade - The trade to evaluate
 * @param recentTrades - Recent trade history
 * @param config - Detection configuration
 * @returns Whether the trade is large
 */
export function detectLargeOrder(
  trade: TradeEntry,
  recentTrades: TradeEntry[],
  config: { absoluteThreshold: number; stdDevMultiplier: number }
): boolean {
  // Check absolute threshold first
  if (trade.eurValue >= config.absoluteThreshold) {
    return true;
  }

  // Calculate standard deviation of recent trades
  if (recentTrades.length < 20) {
    return false;
  }

  const values = recentTrades.slice(0, 100).map(t => t.eurValue);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return trade.eurValue > mean + stdDev * config.stdDevMultiplier;
}

/**
 * Calculate volume delta from trades
 * @param trades - Array of trades
 * @returns Net delta (positive = net buying)
 */
export function calculateVolumeDelta(trades: TradeEntry[]): number {
  return trades.reduce((delta, trade) => {
    return delta + (trade.side === 'buy' ? trade.eurValue : -trade.eurValue);
  }, 0);
}

/**
 * Detect CVD divergence with price
 * @param priceHistory - Recent prices
 * @param cvdHistory - CVD values corresponding to prices
 * @returns Divergence signal
 */
export function detectCVDDivergence(
  priceHistory: Array<{ time: number; price: number }>,
  cvdHistory: Array<{ time: number; value: number }>
): { type: 'bullish' | 'bearish' | 'none'; strength: number } {
  if (priceHistory.length < 20 || cvdHistory.length < 20) {
    return { type: 'none', strength: 0 };
  }

  // Get recent window
  const recent = 20;
  const recentPrices = priceHistory.slice(-recent);
  const recentCVD = cvdHistory.slice(-recent);

  // Calculate price trend (simple linear regression slope)
  const priceTrend = calculateTrend(recentPrices.map((p, i) => ({ x: i, y: p.price })));
  const cvdTrend = calculateTrend(recentCVD.map((c, i) => ({ x: i, y: c.value })));

  // Normalize trends
  const priceRange = Math.max(...recentPrices.map(p => p.price)) - Math.min(...recentPrices.map(p => p.price));
  const cvdRange = Math.max(...recentCVD.map(c => c.value)) - Math.min(...recentCVD.map(c => c.value));

  const normalizedPriceTrend = priceRange > 0 ? priceTrend / priceRange : 0;
  const normalizedCVDTrend = cvdRange > 0 ? cvdTrend / cvdRange : 0;

  // Detect divergence
  const divergenceThreshold = 0.3;

  // Bullish divergence: price falling, CVD rising (accumulation)
  if (normalizedPriceTrend < -divergenceThreshold && normalizedCVDTrend > divergenceThreshold) {
    return {
      type: 'bullish',
      strength: Math.min(Math.abs(normalizedPriceTrend - normalizedCVDTrend), 1),
    };
  }

  // Bearish divergence: price rising, CVD falling (distribution)
  if (normalizedPriceTrend > divergenceThreshold && normalizedCVDTrend < -divergenceThreshold) {
    return {
      type: 'bearish',
      strength: Math.min(Math.abs(normalizedPriceTrend - normalizedCVDTrend), 1),
    };
  }

  return { type: 'none', strength: 0 };
}

/**
 * Calculate linear regression trend
 */
function calculateTrend(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Calculate average spread from history
 * @param spreadHistory - Historical spread values
 * @returns Average spread in percentage
 */
export function calculateAverageSpread(
  spreadHistory: Array<{ spread: number; spreadPercent: number }>
): { avgSpread: number; avgSpreadPercent: number } {
  if (spreadHistory.length === 0) {
    return { avgSpread: 0, avgSpreadPercent: 0 };
  }

  const avgSpread = spreadHistory.reduce((s, h) => s + h.spread, 0) / spreadHistory.length;
  const avgSpreadPercent = spreadHistory.reduce((s, h) => s + h.spreadPercent, 0) / spreadHistory.length;

  return { avgSpread, avgSpreadPercent };
}

/**
 * Identify large order clusters (multiple large orders in short time)
 * @param largeOrders - Recent large orders
 * @param windowMs - Time window in milliseconds
 * @returns Cluster information
 */
export function identifyOrderClusters(
  largeOrders: TradeEntry[],
  windowMs: number = 60000
): Array<{
  side: 'buy' | 'sell';
  count: number;
  totalVolume: number;
  startTime: number;
  endTime: number;
}> {
  if (largeOrders.length < 2) return [];

  const clusters: Array<{
    side: 'buy' | 'sell';
    count: number;
    totalVolume: number;
    startTime: number;
    endTime: number;
  }> = [];

  let currentCluster: typeof clusters[0] | null = null;

  for (const order of largeOrders) {
    if (!currentCluster) {
      currentCluster = {
        side: order.side,
        count: 1,
        totalVolume: order.eurValue,
        startTime: order.timestamp,
        endTime: order.timestamp,
      };
    } else if (
      order.side === currentCluster.side &&
      currentCluster.startTime - order.timestamp <= windowMs
    ) {
      currentCluster.count++;
      currentCluster.totalVolume += order.eurValue;
      currentCluster.endTime = order.timestamp;
    } else {
      if (currentCluster.count >= 2) {
        clusters.push(currentCluster);
      }
      currentCluster = {
        side: order.side,
        count: 1,
        totalVolume: order.eurValue,
        startTime: order.timestamp,
        endTime: order.timestamp,
      };
    }
  }

  if (currentCluster && currentCluster.count >= 2) {
    clusters.push(currentCluster);
  }

  return clusters;
}

/**
 * Format EUR value for display
 */
export function formatEurValue(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  }
  if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  return value.toFixed(0);
}

/**
 * Format quantity for display
 */
export function formatQty(qty: number): string {
  if (qty >= 1000000) {
    return (qty / 1000000).toFixed(2) + 'M';
  }
  if (qty >= 1000) {
    return (qty / 1000).toFixed(2) + 'K';
  }
  return qty.toFixed(2);
}

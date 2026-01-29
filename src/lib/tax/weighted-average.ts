/**
 * Weighted Average Cost Basis Calculator
 *
 * Alternative to FIFO - calculates average cost across all holdings.
 * Simpler but may result in different tax outcomes.
 */

export interface AssetPosition {
  asset: string;
  totalAmount: number;
  totalCost: number;
  averageCost: number;
}

export interface WADisposalResult {
  asset: string;
  disposalAmount: number;
  disposalProceeds: number;
  costBasis: number;
  gain: number;
  averageCostUsed: number;
}

export class WeightedAverageCalculator {
  private positions: Map<string, AssetPosition> = new Map();

  constructor(initialPositions?: AssetPosition[]) {
    if (initialPositions) {
      for (const pos of initialPositions) {
        this.positions.set(pos.asset, pos);
      }
    }
  }

  /**
   * Add an acquisition (buy, deposit, etc.)
   */
  addAcquisition(
    asset: string,
    amount: number,
    cost: number
  ): AssetPosition {
    const existing = this.positions.get(asset);

    if (existing) {
      // Update weighted average
      const newTotalAmount = existing.totalAmount + amount;
      const newTotalCost = existing.totalCost + cost;
      const newAverageCost = newTotalAmount > 0 ? newTotalCost / newTotalAmount : 0;

      const updated: AssetPosition = {
        asset,
        totalAmount: newTotalAmount,
        totalCost: newTotalCost,
        averageCost: newAverageCost,
      };

      this.positions.set(asset, updated);
      return updated;
    }

    // New position
    const position: AssetPosition = {
      asset,
      totalAmount: amount,
      totalCost: cost,
      averageCost: amount > 0 ? cost / amount : 0,
    };

    this.positions.set(asset, position);
    return position;
  }

  /**
   * Process a disposal (sell, withdrawal, etc.)
   */
  processDisposal(
    asset: string,
    amount: number,
    proceeds: number
  ): WADisposalResult {
    const position = this.positions.get(asset);

    if (!position || position.totalAmount <= 0) {
      // No cost basis available
      return {
        asset,
        disposalAmount: amount,
        disposalProceeds: proceeds,
        costBasis: 0,
        gain: proceeds,
        averageCostUsed: 0,
      };
    }

    // Calculate cost basis using weighted average
    const costBasis = amount * position.averageCost;
    const gain = proceeds - costBasis;

    // Update position
    const newTotalAmount = position.totalAmount - amount;
    const newTotalCost = position.totalCost - costBasis;

    // Use relative tolerance for position closure to handle different asset precisions
    // e.g., BTC has 8 decimals, ETH tokens often 18 decimals
    const isPositionClosed = newTotalAmount <= 0 ||
      (position.totalAmount > 0 && Math.abs(newTotalAmount / position.totalAmount) < 1e-10);

    if (isPositionClosed) {
      // Position fully closed
      this.positions.delete(asset);
    } else {
      this.positions.set(asset, {
        asset,
        totalAmount: newTotalAmount,
        totalCost: newTotalCost,
        averageCost: newTotalCost / newTotalAmount,
      });
    }

    return {
      asset,
      disposalAmount: amount,
      disposalProceeds: proceeds,
      costBasis,
      gain,
      averageCostUsed: position.averageCost,
    };
  }

  /**
   * Get position for an asset
   */
  getPosition(asset: string): AssetPosition | undefined {
    return this.positions.get(asset);
  }

  /**
   * Get all positions
   */
  getAllPositions(): AssetPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get total value at average cost
   */
  getTotalValue(): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      total += pos.totalCost;
    }
    return total;
  }

  /**
   * Clear all positions
   */
  clear(): void {
    this.positions.clear();
  }

  /**
   * Get state for serialization
   */
  getState(): AssetPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Load state from serialized data
   */
  loadState(positions: AssetPosition[]): void {
    this.positions.clear();
    for (const pos of positions) {
      this.positions.set(pos.asset, pos);
    }
  }
}

/**
 * Factory function to create a new WeightedAverageCalculator instance.
 *
 * IMPORTANT: Do NOT use a singleton pattern here!
 * Each API request should have its own calculator instance to prevent
 * race conditions where concurrent requests could corrupt each other's
 * calculations.
 */
export function createWACalculator(
  initialPositions?: AssetPosition[]
): WeightedAverageCalculator {
  return new WeightedAverageCalculator(initialPositions);
}

/**
 * @deprecated Use createWACalculator() instead.
 * This function now creates a new instance each time to prevent race conditions.
 */
export function getWACalculator(): WeightedAverageCalculator {
  // Always create new instance - DO NOT use singleton for financial calculations
  return new WeightedAverageCalculator();
}

/**
 * @deprecated No longer needed as we don't use singleton pattern
 */
export function resetWACalculator(): void {
  // No-op - kept for backwards compatibility
}

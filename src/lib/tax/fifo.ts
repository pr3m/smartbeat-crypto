/**
 * FIFO (First In, First Out) Cost Basis Calculator
 *
 * Tracks acquisition lots and matches disposals to oldest holdings first.
 * Primary method for Estonian tax reporting.
 */

export interface AcquisitionLot {
  id: string;
  asset: string;
  amount: number;
  costPerUnit: number;
  totalCost: number;
  remainingAmount: number;
  acquisitionDate: Date;
  transactionId?: string;
}

export interface DisposalResult {
  asset: string;
  disposalAmount: number;
  disposalProceeds: number;
  totalCostBasis: number;
  gain: number;
  matchedLots: {
    lotId: string;
    amount: number;
    costBasis: number;
    acquisitionDate: Date;
    holdingPeriodDays: number;
  }[];
}

export interface FIFOState {
  holdings: Map<string, AcquisitionLot[]>;
}

export class FIFOCalculator {
  private holdings: Map<string, AcquisitionLot[]> = new Map();
  private lotCounter = 0;

  constructor(initialLots?: AcquisitionLot[]) {
    if (initialLots) {
      for (const lot of initialLots) {
        this.addLot(lot);
      }
    }
  }

  /**
   * Generate a unique lot ID
   */
  private generateLotId(): string {
    this.lotCounter++;
    return `lot_${Date.now()}_${this.lotCounter}`;
  }

  /**
   * Add an acquisition lot (buy, deposit, etc.)
   */
  addAcquisition(
    asset: string,
    amount: number,
    totalCost: number,
    acquisitionDate: Date,
    transactionId?: string
  ): AcquisitionLot {
    const lot: AcquisitionLot = {
      id: this.generateLotId(),
      asset,
      amount,
      costPerUnit: amount > 0 ? totalCost / amount : 0,
      totalCost,
      remainingAmount: amount,
      acquisitionDate,
      transactionId,
    };

    this.addLot(lot);
    return lot;
  }

  /**
   * Add an existing lot to holdings
   */
  private addLot(lot: AcquisitionLot): void {
    const existing = this.holdings.get(lot.asset) || [];

    // Insert in chronological order (oldest first for FIFO)
    const insertIndex = existing.findIndex(
      l => l.acquisitionDate > lot.acquisitionDate
    );

    if (insertIndex === -1) {
      existing.push(lot);
    } else {
      existing.splice(insertIndex, 0, lot);
    }

    this.holdings.set(lot.asset, existing);
  }

  /**
   * Process a disposal (sell, withdrawal, etc.) using FIFO
   */
  processDisposal(
    asset: string,
    amount: number,
    proceeds: number,
    disposalDate: Date
  ): DisposalResult {
    const lots = this.holdings.get(asset) || [];

    if (lots.length === 0) {
      // No cost basis available - treat as zero cost
      return {
        asset,
        disposalAmount: amount,
        disposalProceeds: proceeds,
        totalCostBasis: 0,
        gain: proceeds,
        matchedLots: [],
      };
    }

    let remainingToDispose = amount;
    let totalCostBasis = 0;
    const matchedLots: DisposalResult['matchedLots'] = [];

    // Process lots in FIFO order (oldest first)
    for (const lot of lots) {
      if (remainingToDispose <= 0) break;
      if (lot.remainingAmount <= 0) continue;

      const disposeFromLot = Math.min(remainingToDispose, lot.remainingAmount);
      const costBasis = disposeFromLot * lot.costPerUnit;

      // Calculate holding period
      const holdingPeriodMs = disposalDate.getTime() - lot.acquisitionDate.getTime();
      const holdingPeriodDays = Math.floor(holdingPeriodMs / (1000 * 60 * 60 * 24));

      matchedLots.push({
        lotId: lot.id,
        amount: disposeFromLot,
        costBasis,
        acquisitionDate: lot.acquisitionDate,
        holdingPeriodDays,
      });

      // Update lot
      lot.remainingAmount -= disposeFromLot;
      totalCostBasis += costBasis;
      remainingToDispose -= disposeFromLot;
    }

    // Remove fully depleted lots
    this.holdings.set(
      asset,
      lots.filter(lot => lot.remainingAmount > 0)
    );

    // Calculate gain
    const gain = proceeds - totalCostBasis;

    return {
      asset,
      disposalAmount: amount,
      disposalProceeds: proceeds,
      totalCostBasis,
      gain,
      matchedLots,
    };
  }

  /**
   * Get current holdings for an asset
   */
  getHoldings(asset: string): AcquisitionLot[] {
    return this.holdings.get(asset) || [];
  }

  /**
   * Get all holdings
   */
  getAllHoldings(): Map<string, AcquisitionLot[]> {
    return new Map(this.holdings);
  }

  /**
   * Get total amount held for an asset
   */
  getTotalAmount(asset: string): number {
    const lots = this.holdings.get(asset) || [];
    return lots.reduce((sum, lot) => sum + lot.remainingAmount, 0);
  }

  /**
   * Get total cost basis for an asset
   */
  getTotalCostBasis(asset: string): number {
    const lots = this.holdings.get(asset) || [];
    return lots.reduce((sum, lot) => sum + lot.remainingAmount * lot.costPerUnit, 0);
  }

  /**
   * Get average cost per unit for an asset
   */
  getAverageCost(asset: string): number {
    const totalAmount = this.getTotalAmount(asset);
    const totalCost = this.getTotalCostBasis(asset);
    return totalAmount > 0 ? totalCost / totalAmount : 0;
  }

  /**
   * Get state for serialization
   */
  getState(): AcquisitionLot[] {
    const allLots: AcquisitionLot[] = [];
    for (const lots of this.holdings.values()) {
      allLots.push(...lots);
    }
    return allLots;
  }

  /**
   * Load state from serialized data
   */
  loadState(lots: AcquisitionLot[]): void {
    this.holdings.clear();
    this.lotCounter = 0;

    for (const lot of lots) {
      this.addLot(lot);
    }
  }

  /**
   * Clear all holdings
   */
  clear(): void {
    this.holdings.clear();
    this.lotCounter = 0;
  }

  /**
   * Get summary of all holdings
   */
  getSummary(): { asset: string; amount: number; costBasis: number; avgCost: number }[] {
    const summary: { asset: string; amount: number; costBasis: number; avgCost: number }[] = [];

    for (const [asset, lots] of this.holdings) {
      const amount = lots.reduce((sum, lot) => sum + lot.remainingAmount, 0);
      const costBasis = lots.reduce(
        (sum, lot) => sum + lot.remainingAmount * lot.costPerUnit,
        0
      );
      const avgCost = amount > 0 ? costBasis / amount : 0;

      if (amount > 0) {
        summary.push({ asset, amount, costBasis, avgCost });
      }
    }

    return summary;
  }
}

// Singleton instance for app-wide use
let fifoCalculatorInstance: FIFOCalculator | null = null;

export function getFIFOCalculator(): FIFOCalculator {
  if (!fifoCalculatorInstance) {
    fifoCalculatorInstance = new FIFOCalculator();
  }
  return fifoCalculatorInstance;
}

export function resetFIFOCalculator(): void {
  fifoCalculatorInstance = null;
}

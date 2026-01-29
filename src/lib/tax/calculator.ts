/**
 * Tax Calculation Engine
 *
 * Processes Kraken transactions and calculates tax obligations
 * using FIFO or Weighted Average cost basis methods.
 */

import { FIFOCalculator, type DisposalResult } from './fifo';
import { WeightedAverageCalculator, type WADisposalResult } from './weighted-average';
import {
  categorizeTransaction,
  mapKrakenLedgerType,
  normalizeAsset,
  isReportableAsset,
  calculateTaxSummary,
  type TaxSummary,
  type TaxEventInput,
} from './estonia-rules';
import type {
  LedgerEntry,
  TradeInfo,
  TransactionType,
  TransactionCategory,
  ProcessedTransaction,
  CostBasisMethod,
} from '@/lib/kraken/types';

/**
 * Lot matching detail for cost basis audit trail
 */
export interface LotMatch {
  lotId: string;
  amount: number;
  costBasis: number;
  acquisitionDate: Date;
  holdingPeriodDays: number;
}

export interface TaxEvent {
  id: string;
  transactionId: string;
  taxYear: number;
  type: TransactionType;
  asset: string;
  amount: number;
  acquisitionDate: Date;
  acquisitionCost: number;
  disposalDate: Date;
  disposalProceeds: number;
  gain: number;
  taxableAmount: number;
  costBasisMethod: CostBasisMethod;

  // Cost basis audit trail (FIFO only - shows which lots were matched)
  matchedLots?: LotMatch[];

  // Fee tracking
  fee?: number;

  // Warnings for this event
  warnings?: string[];
}

export interface ProcessingResult {
  transactions: ProcessedTransaction[];
  taxEvents: TaxEvent[];
  summary: TaxSummary;
  errors: { id: string; error: string }[];
}

export class TaxCalculator {
  private fifoCalculator: FIFOCalculator;
  private waCalculator: WeightedAverageCalculator;
  private costBasisMethod: CostBasisMethod;
  private taxYear: number;
  private transactions: ProcessedTransaction[] = [];
  private taxEvents: TaxEvent[] = [];
  private errors: { id: string; error: string }[] = [];
  private eventCounter = 0;

  constructor(
    costBasisMethod: CostBasisMethod = 'FIFO',
    taxYear: number = new Date().getFullYear()
  ) {
    this.fifoCalculator = new FIFOCalculator();
    this.waCalculator = new WeightedAverageCalculator();
    this.costBasisMethod = costBasisMethod;
    this.taxYear = taxYear;
  }

  /**
   * Process a trade from Kraken
   */
  processTrade(trade: TradeInfo, tradeId: string): void {
    try {
      const timestamp = new Date(trade.time * 1000);
      const year = timestamp.getFullYear();

      // Parse pair to get base and quote assets
      const pair = trade.pair;
      const { base, quote } = this.parsePair(pair);

      const normalizedBase = normalizeAsset(base);
      const normalizedQuote = normalizeAsset(quote);

      const volume = parseFloat(trade.vol);
      const price = parseFloat(trade.price);
      const cost = parseFloat(trade.cost);
      const fee = parseFloat(trade.fee);

      // Input validation - prevent corrupted calculations
      if (!Number.isFinite(volume) || volume < 0) {
        throw new Error(`Invalid volume: ${trade.vol}`);
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Invalid price: ${trade.price}`);
      }
      if (!Number.isFinite(cost) || cost < 0) {
        throw new Error(`Invalid cost: ${trade.cost}`);
      }
      if (!Number.isFinite(fee) || fee < 0) {
        throw new Error(`Invalid fee: ${trade.fee}`);
      }

      const type: TransactionType = trade.margin ? 'MARGIN_TRADE' : 'TRADE';
      const category = categorizeTransaction(type, volume, trade.type);

      // Create transaction record
      const transaction: ProcessedTransaction = {
        id: `trade_${tradeId}`,
        krakenRefId: tradeId,
        krakenOrderId: trade.ordertxid,
        type,
        category,
        asset: normalizedBase,
        amount: trade.type === 'buy' ? volume : -volume,
        pair,
        side: trade.type,
        price,
        cost,
        fee,
        feeAsset: normalizedQuote,
        leverage: trade.margin ? `${trade.margin}:1` : undefined,
        timestamp,
      };

      this.transactions.push(transaction);

      // Process for tax calculation
      if (trade.type === 'buy') {
        // Acquisition - add to cost basis
        if (isReportableAsset(normalizedBase)) {
          this.fifoCalculator.addAcquisition(
            normalizedBase,
            volume,
            cost + fee, // Include fee in cost basis
            timestamp,
            transaction.id
          );
          this.waCalculator.addAcquisition(normalizedBase, volume, cost + fee);
        }
      } else {
        // Disposal - calculate gain/loss
        if (isReportableAsset(normalizedBase) && year === this.taxYear) {
          const result = this.calculateDisposal(
            normalizedBase,
            volume,
            cost - fee, // Proceeds minus fee
            timestamp
          );

          if (result) {
            this.createTaxEvent(transaction, result, timestamp);
          }
        }
      }
    } catch (error) {
      this.errors.push({
        id: tradeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Process a ledger entry from Kraken
   */
  processLedger(entry: LedgerEntry, ledgerId: string): void {
    try {
      const timestamp = new Date(entry.time * 1000);
      const year = timestamp.getFullYear();

      const asset = normalizeAsset(entry.asset);
      const amount = parseFloat(entry.amount);
      const fee = parseFloat(entry.fee);

      // Input validation - prevent corrupted calculations
      if (!Number.isFinite(amount)) {
        throw new Error(`Invalid amount: ${entry.amount}`);
      }
      if (!Number.isFinite(fee)) {
        throw new Error(`Invalid fee: ${entry.fee}`);
      }

      const type = mapKrakenLedgerType(entry.type, entry.subtype);
      const category = categorizeTransaction(type, amount);

      const transaction: ProcessedTransaction = {
        id: `ledger_${ledgerId}`,
        krakenRefId: entry.refid,
        type,
        category,
        asset,
        amount,
        fee: fee > 0 ? fee : undefined,
        feeAsset: asset,
        timestamp,
      };

      this.transactions.push(transaction);

      // Handle specific types
      if (!isReportableAsset(asset)) return;

      switch (type) {
        case 'DEPOSIT':
          // Deposits establish cost basis at market value
          // WARNING: Zero cost basis means potential double taxation if these
          // assets were purchased elsewhere. Users should track original cost
          // basis externally and consider manual adjustments for accurate reporting.
          if (amount > 0) {
            this.fifoCalculator.addAcquisition(
              asset,
              amount,
              0, // Zero cost basis - see warning above
              timestamp,
              transaction.id
            );
            this.waCalculator.addAcquisition(asset, amount, 0);

            // Log warning for audit trail
            this.errors.push({
              id: transaction.id,
              error: `WARNING: DEPOSIT of ${amount} ${asset} assigned zero cost basis. ` +
                     `If transferred from another wallet, manually record original acquisition cost.`,
            });
          }
          break;

        case 'STAKING_REWARD':
        case 'EARN_REWARD':
        case 'CREDIT':
          // Staking/Earn rewards are taxable income at fair market value when received
          // CRITICAL: Estonian tax law requires these to be reported at FMV
          if (amount > 0 && year === this.taxYear) {
            // Add to holdings at zero cost basis (will be taxed when sold)
            this.fifoCalculator.addAcquisition(
              asset,
              amount,
              0,
              timestamp,
              transaction.id
            );
            this.waCalculator.addAcquisition(asset, amount, 0);

            // Create tax event for the reward income
            // WARNING: Fair market value calculation not yet implemented!
            // Users should manually verify staking income amounts against
            // the EUR value at time of receipt for accurate tax reporting.
            const taxEvent: TaxEvent = {
              id: `event_${++this.eventCounter}`,
              transactionId: transaction.id,
              taxYear: this.taxYear,
              type,
              asset,
              amount,
              acquisitionDate: timestamp,
              acquisitionCost: 0,
              disposalDate: timestamp,
              disposalProceeds: 0, // NEEDS FMV: fetch historical price
              gain: 0, // NEEDS FMV: this should be fair market value at receipt
              taxableAmount: 0, // NEEDS FMV: for Estonian tax, this = FMV
              costBasisMethod: this.costBasisMethod,
            };
            this.taxEvents.push(taxEvent);

            // Log warning for audit trail
            this.errors.push({
              id: transaction.id,
              error: `WARNING: ${type} of ${amount} ${asset} needs manual FMV calculation for tax reporting`,
            });
          }
          break;

        case 'AIRDROP':
        case 'FORK':
          // Similar to staking rewards
          if (amount > 0 && year === this.taxYear) {
            this.fifoCalculator.addAcquisition(
              asset,
              amount,
              0,
              timestamp,
              transaction.id
            );
            this.waCalculator.addAcquisition(asset, amount, 0);
          }
          break;
      }
    } catch (error) {
      this.errors.push({
        id: ledgerId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Calculate disposal using configured method
   */
  private calculateDisposal(
    asset: string,
    amount: number,
    proceeds: number,
    date: Date
  ): DisposalResult | WADisposalResult | null {
    if (this.costBasisMethod === 'FIFO') {
      return this.fifoCalculator.processDisposal(asset, amount, proceeds, date);
    } else {
      return this.waCalculator.processDisposal(asset, amount, proceeds);
    }
  }

  /**
   * Create tax event from disposal
   */
  private createTaxEvent(
    transaction: ProcessedTransaction,
    result: DisposalResult | WADisposalResult,
    disposalDate: Date
  ): void {
    const gain = result.gain;
    const warnings: string[] = [];

    // In Estonia, only gains are taxable
    const taxableAmount = gain > 0 ? gain : 0;

    // For FIFO, use the oldest acquisition date and build audit trail
    let acquisitionDate = disposalDate;
    let acquisitionCost = 0;
    let matchedLots: LotMatch[] | undefined;

    if ('matchedLots' in result && result.matchedLots.length > 0) {
      acquisitionDate = result.matchedLots[0].acquisitionDate;
      acquisitionCost = result.totalCostBasis;

      // Build lot matching audit trail
      matchedLots = result.matchedLots.map(lot => ({
        lotId: lot.lotId,
        amount: lot.amount,
        costBasis: lot.costBasis,
        acquisitionDate: lot.acquisitionDate,
        holdingPeriodDays: lot.holdingPeriodDays,
      }));

      // Warn if holding period is very short (potential wash sale concern)
      const shortHolds = result.matchedLots.filter(lot => lot.holdingPeriodDays < 30);
      if (shortHolds.length > 0 && gain < 0) {
        warnings.push(
          `Short holding period (${shortHolds[0].holdingPeriodDays} days) with loss - ` +
          `verify no wash sale implications if applicable`
        );
      }
    } else if ('costBasis' in result) {
      acquisitionCost = result.costBasis;
    }

    // Warn if no cost basis found (full proceeds taxable)
    if (acquisitionCost === 0 && result.disposalProceeds > 0) {
      warnings.push('No cost basis found - full proceeds treated as gain');
    }

    const taxEvent: TaxEvent = {
      id: `event_${++this.eventCounter}`,
      transactionId: transaction.id,
      taxYear: this.taxYear,
      type: transaction.type,
      asset: result.asset,
      amount: result.disposalAmount,
      acquisitionDate,
      acquisitionCost,
      disposalDate,
      disposalProceeds: result.disposalProceeds,
      gain,
      taxableAmount,
      costBasisMethod: this.costBasisMethod,
      matchedLots,
      fee: transaction.fee,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    this.taxEvents.push(taxEvent);
  }

  /**
   * Parse trading pair to extract base and quote assets
   */
  private parsePair(pair: string): { base: string; quote: string } {
    // Common patterns: XRPEUR, XRP/EUR, XXRPZEUR
    const cleanPair = pair.replace('/', '');

    // Known quote currencies
    const quotes = ['EUR', 'USD', 'GBP', 'USDT', 'USDC', 'BTC', 'ETH'];

    for (const quote of quotes) {
      if (cleanPair.endsWith(quote)) {
        return {
          base: cleanPair.slice(0, -quote.length),
          quote,
        };
      }
      // Handle Kraken's Z prefix for fiat
      if (cleanPair.endsWith('Z' + quote)) {
        return {
          base: cleanPair.slice(0, -quote.length - 1),
          quote,
        };
      }
    }

    // Fallback: split in middle (rough approximation)
    const mid = Math.floor(cleanPair.length / 2);
    return {
      base: cleanPair.slice(0, mid),
      quote: cleanPair.slice(mid),
    };
  }

  /**
   * Get processing results
   */
  getResults(accountType: 'individual' | 'business' = 'individual', priorLossCarryforward: number = 0): ProcessingResult {
    // Generate summary with fee tracking
    const taxEventInputs: TaxEventInput[] = this.taxEvents.map(event => ({
      type: event.type,
      gain: event.gain,
      proceeds: event.disposalProceeds,
      costBasis: event.acquisitionCost,
      fee: event.fee,
      isMargin: event.type === 'MARGIN_TRADE' || event.type === 'MARGIN_SETTLEMENT',
    }));

    const summary = calculateTaxSummary(this.taxYear, taxEventInputs, accountType, priorLossCarryforward);

    // Add any tax event warnings to summary warnings
    const eventWarnings = this.taxEvents
      .filter(e => e.warnings && e.warnings.length > 0)
      .flatMap(e => e.warnings || []);

    if (eventWarnings.length > 0) {
      summary.warnings = [...summary.warnings, ...eventWarnings];
    }

    return {
      transactions: this.transactions,
      taxEvents: this.taxEvents,
      summary,
      errors: this.errors,
    };
  }

  /**
   * Get current holdings summary
   */
  getHoldingsSummary() {
    if (this.costBasisMethod === 'FIFO') {
      return this.fifoCalculator.getSummary();
    } else {
      return this.waCalculator.getAllPositions().map(pos => ({
        asset: pos.asset,
        amount: pos.totalAmount,
        costBasis: pos.totalCost,
        avgCost: pos.averageCost,
      }));
    }
  }

  /**
   * Reset calculator state
   */
  reset(): void {
    this.fifoCalculator.clear();
    this.waCalculator.clear();
    this.transactions = [];
    this.taxEvents = [];
    this.errors = [];
    this.eventCounter = 0;
  }

  /**
   * Set tax year
   */
  setTaxYear(year: number): void {
    this.taxYear = year;
  }

  /**
   * Set cost basis method
   */
  setCostBasisMethod(method: CostBasisMethod): void {
    this.costBasisMethod = method;
  }
}

/**
 * Factory function to create a new TaxCalculator instance.
 *
 * IMPORTANT: Do NOT use a singleton pattern here!
 * Each API request should have its own calculator instance to prevent
 * race conditions where concurrent requests could corrupt each other's
 * calculations (e.g., different years, different cost basis methods).
 */
export function createTaxCalculator(
  method?: CostBasisMethod,
  year?: number
): TaxCalculator {
  return new TaxCalculator(method, year);
}

/**
 * @deprecated Use createTaxCalculator() instead.
 * This function now creates a new instance each time to prevent race conditions.
 */
export function getTaxCalculator(
  method?: CostBasisMethod,
  year?: number
): TaxCalculator {
  // Always create new instance - DO NOT use singleton for financial calculations
  return new TaxCalculator(method, year);
}

/**
 * @deprecated No longer needed as we don't use singleton pattern
 */
export function resetTaxCalculator(): void {
  // No-op - kept for backwards compatibility
}

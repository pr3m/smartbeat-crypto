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
          // Note: We need market price at time of deposit for accurate tracking
          // For now, we'll treat as zero cost basis (conservative approach)
          if (amount > 0) {
            this.fifoCalculator.addAcquisition(
              asset,
              amount,
              0, // TODO: Fetch historical price
              timestamp,
              transaction.id
            );
            this.waCalculator.addAcquisition(asset, amount, 0);
          }
          break;

        case 'STAKING_REWARD':
          // Staking rewards are taxable income
          if (amount > 0 && year === this.taxYear) {
            // Add to holdings at zero cost basis
            this.fifoCalculator.addAcquisition(
              asset,
              amount,
              0,
              timestamp,
              transaction.id
            );
            this.waCalculator.addAcquisition(asset, amount, 0);

            // Create tax event for the reward
            // TODO: Need to calculate fair market value at time of receipt
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
              disposalProceeds: 0, // TODO: FMV
              gain: 0, // TODO: FMV
              taxableAmount: 0,
              costBasisMethod: this.costBasisMethod,
            };
            this.taxEvents.push(taxEvent);
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

    // In Estonia, only gains are taxable
    const taxableAmount = gain > 0 ? gain : 0;

    // For FIFO, use the oldest acquisition date
    let acquisitionDate = disposalDate;
    let acquisitionCost = 0;

    if ('matchedLots' in result && result.matchedLots.length > 0) {
      acquisitionDate = result.matchedLots[0].acquisitionDate;
      acquisitionCost = result.totalCostBasis;
    } else if ('costBasis' in result) {
      acquisitionCost = result.costBasis;
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
  getResults(): ProcessingResult {
    // Generate summary
    const taxEventInputs: TaxEventInput[] = this.taxEvents.map(event => ({
      type: event.type,
      gain: event.gain,
      proceeds: event.disposalProceeds,
      costBasis: event.acquisitionCost,
      isMargin: event.type === 'MARGIN_TRADE' || event.type === 'MARGIN_SETTLEMENT',
    }));

    const summary = calculateTaxSummary(this.taxYear, taxEventInputs);

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

// Singleton instance
let taxCalculatorInstance: TaxCalculator | null = null;

export function getTaxCalculator(
  method?: CostBasisMethod,
  year?: number
): TaxCalculator {
  if (!taxCalculatorInstance) {
    taxCalculatorInstance = new TaxCalculator(method, year);
  }
  return taxCalculatorInstance;
}

export function resetTaxCalculator(): void {
  taxCalculatorInstance = null;
}

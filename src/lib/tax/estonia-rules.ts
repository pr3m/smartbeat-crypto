/**
 * Estonian Tax Rules for Cryptocurrency
 *
 * Key rules:
 * - Tax Rate: 24% income tax on gains (from 2026, was 22% before)
 * - Capital Gains: No separate CGT - taxed as regular income
 * - Loss Deduction: NOT allowed in Estonia
 * - Cost Basis: FIFO (primary) or Weighted Average
 * - Reporting: Table 8.3 for foreign exchanges (Kraken = US company)
 * - Taxable Events: Trade profits, margin settlements, staking rewards, airdrops
 * - Non-Taxable: Holding, deposits, withdrawals, internal transfers
 * - DAC8/CARF: From 2026, exchanges report to Estonian Tax Authority
 */

import type { TransactionType, TransactionCategory } from '@/lib/kraken/types';

// Estonian tax rates by year
export const TAX_RATES: Record<number, number> = {
  2023: 0.22,
  2024: 0.22,
  2025: 0.22,
  2026: 0.24, // New rate from 2026
};

export function getTaxRate(year: number): number {
  return TAX_RATES[year] || 0.24; // Default to current rate
}

// Transaction type to category mapping
export function categorizeTransaction(
  type: TransactionType,
  amount: number,
  side?: 'buy' | 'sell'
): TransactionCategory {
  switch (type) {
    case 'TRADE':
      // Sells are taxable income, buys establish cost basis
      return side === 'sell' ? 'TAXABLE_INCOME' : 'COST_BASIS_ADJUSTMENT';

    case 'MARGIN_TRADE':
      return side === 'sell' ? 'TAXABLE_INCOME' : 'COST_BASIS_ADJUSTMENT';

    case 'MARGIN_SETTLEMENT':
      // Settlement of margin position - taxable
      return 'TAXABLE_INCOME';

    case 'STAKING_REWARD':
      // Staking rewards are taxable income
      return 'TAXABLE_INCOME';

    case 'EARN_REWARD':
      // Kraken Earn rewards (interest) are taxable income
      return 'TAXABLE_INCOME';

    case 'CREDIT':
      // Credits/bonuses from exchange are taxable income
      return 'TAXABLE_INCOME';

    case 'AIRDROP':
      // Airdrops are taxable at fair market value
      return 'TAXABLE_INCOME';

    case 'FORK':
      // Fork coins - taxable when received (debatable)
      return 'TAXABLE_INCOME';

    case 'DEPOSIT':
    case 'WITHDRAWAL':
    case 'TRANSFER':
    case 'STAKING_DEPOSIT':
    case 'STAKING_WITHDRAWAL':
    case 'EARN_ALLOCATION':
    case 'SPEND':
    case 'RECEIVE':
      // Moving crypto between wallets/features is not taxable
      return 'NON_TAXABLE';

    case 'ROLLOVER':
      // Margin rollover fees
      return 'FEE';

    case 'FEE':
      return 'FEE';

    case 'NFT_TRADE':
      // NFT trades could be taxable
      return amount > 0 ? 'TAXABLE_INCOME' : 'NON_TAXABLE';

    case 'ADJUSTMENT':
      return 'COST_BASIS_ADJUSTMENT';

    default:
      return 'NON_TAXABLE';
  }
}

// Map Kraken ledger types to our transaction types
export function mapKrakenLedgerType(
  krakenType: string,
  subtype?: string
): TransactionType {
  switch (krakenType) {
    case 'trade':
      return 'TRADE';
    case 'margin':
      return 'MARGIN_TRADE';
    case 'settled':
      return 'MARGIN_SETTLEMENT';
    case 'rollover':
      return 'ROLLOVER';
    case 'deposit':
      return 'DEPOSIT';
    case 'withdrawal':
      return 'WITHDRAWAL';
    case 'transfer':
      return 'TRANSFER';
    case 'staking':
      if (subtype === 'stakingfromspot' || subtype === 'stakingtospot') {
        return 'STAKING_DEPOSIT';
      }
      return 'STAKING_REWARD';
    case 'dividend':
      return 'STAKING_REWARD';
    case 'earn':
      // Kraken Earn rewards
      return 'EARN_REWARD';
    case 'creator':
      // Kraken Earn allocation (locking/unlocking)
      return 'EARN_ALLOCATION';
    case 'credit':
    case 'reward':
      return 'CREDIT';
    case 'nfttrade':
      return 'NFT_TRADE';
    case 'spend':
      return 'SPEND';
    case 'receive':
      return 'RECEIVE';
    case 'adjustment':
      return 'ADJUSTMENT';
    default:
      return 'ADJUSTMENT';
  }
}

export interface TaxSummary {
  taxYear: number;
  taxRate: number;

  // Gains breakdown
  totalProceeds: number;
  totalCostBasis: number;
  totalGains: number;     // Sum of gains only (positive amounts)
  totalLosses: number;    // Sum of losses (negative amounts, for info only)
  netGainLoss: number;    // totalGains - totalLosses (for reference)

  // Estonian specific
  taxableAmount: number;  // In Estonia: only gains count, losses NOT deductible
  estimatedTax: number;   // taxableAmount * taxRate

  // Breakdown by type
  tradingGains: number;
  tradingLosses: number;
  marginGains: number;
  marginLosses: number;
  stakingIncome: number;
  earnIncome: number;     // Kraken Earn rewards
  creditIncome: number;   // Credits/bonuses
  airdropIncome: number;
  otherIncome: number;

  // Stats
  totalTransactions: number;
  taxableTransactions: number;
}

export interface TaxEventInput {
  type: TransactionType;
  gain: number;
  proceeds?: number;
  costBasis?: number;
  isMargin: boolean;
}

/**
 * Calculate tax summary for a year
 */
export function calculateTaxSummary(
  taxYear: number,
  events: TaxEventInput[]
): TaxSummary {
  const taxRate = getTaxRate(taxYear);

  let totalProceeds = 0;
  let totalCostBasis = 0;
  let totalGains = 0;
  let totalLosses = 0;

  let tradingGains = 0;
  let tradingLosses = 0;
  let marginGains = 0;
  let marginLosses = 0;
  let stakingIncome = 0;
  let earnIncome = 0;
  let creditIncome = 0;
  let airdropIncome = 0;
  let otherIncome = 0;

  let taxableTransactions = 0;

  for (const event of events) {
    totalProceeds += event.proceeds || 0;
    totalCostBasis += event.costBasis || 0;

    if (event.gain > 0) {
      totalGains += event.gain;
    } else {
      totalLosses += Math.abs(event.gain);
    }

    // Categorize gains/losses
    switch (event.type) {
      case 'TRADE':
        if (event.gain > 0) tradingGains += event.gain;
        else tradingLosses += Math.abs(event.gain);
        if (event.gain !== 0) taxableTransactions++;
        break;

      case 'MARGIN_TRADE':
      case 'MARGIN_SETTLEMENT':
        if (event.gain > 0) marginGains += event.gain;
        else marginLosses += Math.abs(event.gain);
        if (event.gain !== 0) taxableTransactions++;
        break;

      case 'STAKING_REWARD':
        stakingIncome += event.gain;
        if (event.gain !== 0) taxableTransactions++;
        break;

      case 'EARN_REWARD':
        earnIncome += event.gain;
        if (event.gain !== 0) taxableTransactions++;
        break;

      case 'CREDIT':
        creditIncome += event.gain;
        if (event.gain !== 0) taxableTransactions++;
        break;

      case 'AIRDROP':
      case 'FORK':
        airdropIncome += event.gain;
        if (event.gain !== 0) taxableTransactions++;
        break;

      default:
        if (event.gain > 0) {
          otherIncome += event.gain;
          taxableTransactions++;
        }
    }
  }

  const netGainLoss = totalGains - totalLosses;

  // Estonian specific: ONLY gains are taxable, losses NOT deductible
  const taxableAmount = totalGains;
  const estimatedTax = taxableAmount * taxRate;

  return {
    taxYear,
    taxRate,
    totalProceeds,
    totalCostBasis,
    totalGains,
    totalLosses,
    netGainLoss,
    taxableAmount,
    estimatedTax,
    tradingGains,
    tradingLosses,
    marginGains,
    marginLosses,
    stakingIncome,
    earnIncome,
    creditIncome,
    airdropIncome,
    otherIncome,
    totalTransactions: events.length,
    taxableTransactions,
  };
}

/**
 * Format amount for Estonian tax reporting
 */
export function formatEuroAmount(amount: number): string {
  return new Intl.NumberFormat('et-EE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format date for Estonian tax reporting
 */
export function formatEstonianDate(date: Date): string {
  return new Intl.DateTimeFormat('et-EE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Check if an asset should be reported (filters out fiat)
 */
export function isReportableAsset(asset: string): boolean {
  const fiatCurrencies = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
  const normalizedAsset = asset.replace(/^[XZ]/, ''); // Remove X/Z prefix
  return !fiatCurrencies.includes(normalizedAsset) &&
         !fiatCurrencies.includes(asset);
}

/**
 * Normalize Kraken asset names
 */
export function normalizeAsset(asset: string): string {
  // Remove X/Z prefixes that Kraken uses
  let normalized = asset;
  if (normalized.startsWith('X') && normalized.length === 4) {
    normalized = normalized.substring(1);
  }
  if (normalized.startsWith('Z') && normalized.length === 4) {
    normalized = normalized.substring(1);
  }

  // Common mappings
  const mappings: Record<string, string> = {
    'XBT': 'BTC',
    'XXBT': 'BTC',
    'XETH': 'ETH',
    'XXRP': 'XRP',
    'ZEUR': 'EUR',
    'ZUSD': 'USD',
  };

  return mappings[asset] || normalized;
}

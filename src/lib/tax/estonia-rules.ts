/**
 * Estonian Tax Rules for Cryptocurrency
 *
 * INDIVIDUAL (Natural Person):
 * - Tax Rate: 22% (2025), 24% (2026+) income tax on gains
 * - Capital Gains: No separate CGT - taxed as regular income
 * - Loss Deduction: NOT allowed in Estonia
 * - Cost Basis: FIFO (primary) or Weighted Average
 * - Reporting: Table 8.3 for foreign exchanges (Kraken = US company)
 * - Taxable Events: Trade profits, margin settlements, staking rewards, airdrops
 * - Non-Taxable: Holding, deposits, withdrawals, internal transfers
 *
 * BUSINESS (OÜ / Company):
 * - Tax Rate: 0% on retained/reinvested profits (Estonia's unique system)
 * - Tax only when profits are DISTRIBUTED (dividends, salaries, etc.)
 * - Distribution tax: 22/78 (~28.2%) in 2025, 24/76 (~31.6%) in 2026
 * - All trading P&L tracked for accounting, but no immediate tax liability
 * - Losses CAN offset gains (unlike individual)
 * - Report in annual accounts, not Table 8.3
 *
 * DAC8/CARF: From 2026, exchanges report to Estonian Tax Authority
 */

export type AccountType = 'individual' | 'business';

import type { TransactionType, TransactionCategory } from '@/lib/kraken/types';

// Estonian individual income tax rates by year
export const TAX_RATES: Record<number, number> = {
  2023: 0.22,
  2024: 0.22,
  2025: 0.22,
  2026: 0.22, // 2026 rate stays at 22%
};

// Estonian corporate distribution tax rates (applied to net dividend)
// Formula: gross = net / (1 - rate), effective rate on gross = rate / (1 - rate)
export const DISTRIBUTION_TAX_RATES: Record<number, number> = {
  2023: 0.20, // 20/80 = 25% effective
  2024: 0.20, // 20/80 = 25% effective
  2025: 0.22, // 22/78 = ~28.2% effective
  2026: 0.22, // 22/78 = ~28.2% effective (24% proposed but may not pass)
};

export function getTaxRate(year: number, accountType: AccountType = 'individual'): number {
  if (accountType === 'business') {
    // Businesses pay 0% on retained profits
    // Only taxed when distributing - return 0 for trading P&L purposes
    return 0;
  }
  return TAX_RATES[year] || 0.22;
}

export function getDistributionTaxRate(year: number): number {
  return DISTRIBUTION_TAX_RATES[year] || 0.22;
}

// Calculate effective tax rate on gross distribution
export function getEffectiveDistributionRate(year: number): number {
  const rate = getDistributionTaxRate(year);
  return rate / (1 - rate); // e.g., 0.22 / 0.78 = ~28.2%
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
  accountType: AccountType;

  // P&L breakdown (same for both account types)
  totalGains: number;     // Sum of gains only (positive amounts)
  totalLosses: number;    // Sum of losses (negative amounts)
  netPnL: number;         // totalGains - totalLosses (net profit/loss)

  // Individual-specific (losses not deductible)
  taxableAmount: number;  // Individual: only gains; Business: 0 (no immediate tax)
  estimatedTax: number;   // Individual: taxableAmount * taxRate; Business: 0

  // Business-specific
  retainedProfit: number; // Net P&L retained in company (0% tax while retained)
  distributionTaxRate: number; // Tax rate if profits are distributed
  potentialDistributionTax: number; // Tax if all profits distributed

  // Loss carryforward tracking (business only)
  // Negative netPnL can be carried forward to offset future gains
  lossCarryforward: number; // Accumulated losses that can offset future gains (always >= 0)
  hasLossCarryforward: boolean; // True if there are losses to carry forward

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

  // Fee breakdown
  totalTradingFees: number; // Sum of all trading fees (reduces taxable gains)
  totalMarginFees: number;  // Sum of margin/rollover fees

  // Stats
  totalTransactions: number;
  taxableTransactions: number;

  // Warnings for manual review
  warnings: string[];

  // Deprecated - keeping for backwards compatibility
  totalProceeds?: number;
  totalCostBasis?: number;
  netGainLoss?: number;
}

export interface TaxEventInput {
  type: TransactionType;
  gain: number;
  proceeds?: number;
  costBasis?: number;
  fee?: number;
  isMargin: boolean;
}

/**
 * Calculate tax summary for a year
 *
 * @param taxYear - The tax year to calculate for
 * @param events - Array of tax events to process
 * @param accountType - 'individual' or 'business'
 * @param priorYearLossCarryforward - Losses carried forward from prior years (business only)
 */
export function calculateTaxSummary(
  taxYear: number,
  events: TaxEventInput[],
  accountType: AccountType = 'individual',
  priorYearLossCarryforward: number = 0
): TaxSummary {
  const taxRate = getTaxRate(taxYear, accountType);
  const distributionTaxRate = getEffectiveDistributionRate(taxYear);

  let totalGains = 0;
  let totalLosses = 0;
  let totalTradingFees = 0;
  let totalMarginFees = 0;

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
  const warnings: string[] = [];

  for (const event of events) {
    if (event.gain > 0) {
      totalGains += event.gain;
    } else {
      totalLosses += Math.abs(event.gain);
    }

    // Track fees by type
    if (event.fee && event.fee > 0) {
      if (event.isMargin) {
        totalMarginFees += event.fee;
      } else {
        totalTradingFees += event.fee;
      }
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
        // Warn if staking income is zero (likely missing FMV)
        if (event.gain === 0) {
          warnings.push('Staking rewards have zero value - manual FMV calculation needed');
        }
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
        // Warn if airdrop income is zero (likely missing FMV)
        if (event.gain === 0) {
          warnings.push('Airdrops have zero value - manual FMV calculation needed');
        }
        break;

      default:
        if (event.gain > 0) {
          otherIncome += event.gain;
          taxableTransactions++;
        }
    }
  }

  const netPnL = totalGains - totalLosses;

  // Calculate tax based on account type
  let taxableAmount: number;
  let estimatedTax: number;
  let retainedProfit: number;
  let potentialDistributionTax: number;
  let lossCarryforward = 0;
  let hasLossCarryforward = false;

  if (accountType === 'business') {
    // Business: 0% tax on retained profits
    // Losses CAN offset gains for accounting purposes
    taxableAmount = 0; // No immediate tax liability
    estimatedTax = 0;

    // Apply prior year loss carryforward to this year's gains
    const adjustedNetPnL = netPnL - priorYearLossCarryforward;
    retainedProfit = adjustedNetPnL;

    // Calculate new loss carryforward
    if (adjustedNetPnL < 0) {
      // This year's losses (after applying prior carryforward) carry to next year
      lossCarryforward = Math.abs(adjustedNetPnL);
      hasLossCarryforward = true;
    }

    // Only calculate distribution tax on profits after loss offset
    potentialDistributionTax = adjustedNetPnL > 0 ? adjustedNetPnL * distributionTaxRate : 0;

    if (priorYearLossCarryforward > 0) {
      warnings.push(`Applied ${priorYearLossCarryforward.toFixed(2)} EUR loss carryforward from prior years`);
    }
  } else {
    // Individual: Only gains taxable, losses NOT deductible
    taxableAmount = totalGains;
    estimatedTax = taxableAmount * taxRate;
    retainedProfit = 0;
    potentialDistributionTax = 0;

    // Individuals cannot carry forward losses in Estonia
    if (totalLosses > 0) {
      warnings.push(`${totalLosses.toFixed(2)} EUR in losses cannot be deducted (Estonian individual tax rules)`);
    }
  }

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(warnings)];

  return {
    taxYear,
    taxRate,
    accountType,
    totalGains,
    totalLosses,
    netPnL,
    taxableAmount,
    estimatedTax,
    retainedProfit,
    distributionTaxRate,
    potentialDistributionTax,
    lossCarryforward,
    hasLossCarryforward,
    tradingGains,
    tradingLosses,
    marginGains,
    marginLosses,
    stakingIncome,
    earnIncome,
    creditIncome,
    airdropIncome,
    otherIncome,
    totalTradingFees,
    totalMarginFees,
    totalTransactions: events.length,
    taxableTransactions,
    warnings: uniqueWarnings,
    // Backwards compatibility
    netGainLoss: netPnL,
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

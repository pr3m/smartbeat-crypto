/**
 * Tax Report Generator
 *
 * Generates Estonian Table 8.3 format reports and CSV exports
 */

import { formatEuroAmount, formatEstonianDate, getTaxRate } from './estonia-rules';
import type { TaxSummary } from './estonia-rules';
import type { TaxEvent } from './calculator';
import type { ProcessedTransaction } from '@/lib/kraken/types';

export interface Table83Row {
  // Column 1: Description of income source
  incomeSource: string;
  // Column 2: Country of income source
  country: string;
  // Column 3: Income amount
  incomeAmount: number;
  // Column 4: Deductions (if any)
  deductions: number;
  // Column 5: Taxable amount
  taxableAmount: number;
}

export interface Table83Report {
  taxYear: number;
  taxpayerName?: string;
  taxpayerId?: string;
  rows: Table83Row[];
  totalIncome: number;
  totalDeductions: number;
  totalTaxable: number;
  taxRate: number;
  estimatedTax: number;
  generatedAt: Date;
}

/**
 * Generate Table 8.3 report for Estonian tax declaration
 *
 * Table 8.3 is for reporting income from foreign sources.
 * Kraken is a US company, so all crypto income goes here.
 */
export function generateTable83Report(
  taxYear: number,
  summary: TaxSummary,
  events: TaxEvent[],
  taxpayerName?: string,
  taxpayerId?: string
): Table83Report {
  const rows: Table83Row[] = [];
  const taxRate = getTaxRate(taxYear);

  // Group events by type for reporting
  if (summary.tradingGains > 0) {
    rows.push({
      incomeSource: 'Cryptocurrency trading gains (Kraken)',
      country: 'USA',
      incomeAmount: summary.tradingGains,
      deductions: 0, // Losses not deductible in Estonia
      taxableAmount: summary.tradingGains,
    });
  }

  if (summary.marginGains > 0) {
    rows.push({
      incomeSource: 'Cryptocurrency margin trading gains (Kraken)',
      country: 'USA',
      incomeAmount: summary.marginGains,
      deductions: 0,
      taxableAmount: summary.marginGains,
    });
  }

  if (summary.stakingIncome > 0) {
    rows.push({
      incomeSource: 'Cryptocurrency staking rewards (Kraken)',
      country: 'USA',
      incomeAmount: summary.stakingIncome,
      deductions: 0,
      taxableAmount: summary.stakingIncome,
    });
  }

  if (summary.airdropIncome > 0) {
    rows.push({
      incomeSource: 'Cryptocurrency airdrops/forks (Kraken)',
      country: 'USA',
      incomeAmount: summary.airdropIncome,
      deductions: 0,
      taxableAmount: summary.airdropIncome,
    });
  }

  if (summary.otherIncome > 0) {
    rows.push({
      incomeSource: 'Other cryptocurrency income (Kraken)',
      country: 'USA',
      incomeAmount: summary.otherIncome,
      deductions: 0,
      taxableAmount: summary.otherIncome,
    });
  }

  const totalIncome = rows.reduce((sum, row) => sum + row.incomeAmount, 0);
  const totalDeductions = rows.reduce((sum, row) => sum + row.deductions, 0);
  const totalTaxable = rows.reduce((sum, row) => sum + row.taxableAmount, 0);

  return {
    taxYear,
    taxpayerName,
    taxpayerId,
    rows,
    totalIncome,
    totalDeductions,
    totalTaxable,
    taxRate,
    estimatedTax: totalTaxable * taxRate,
    generatedAt: new Date(),
  };
}

/**
 * Format Table 8.3 report as text
 */
export function formatTable83AsText(report: Table83Report): string {
  const lines: string[] = [];

  lines.push('=' .repeat(80));
  lines.push('ESTONIAN TAX DECLARATION - TABLE 8.3');
  lines.push('Income from Foreign Sources');
  lines.push('=' .repeat(80));
  lines.push('');
  lines.push(`Tax Year: ${report.taxYear}`);
  if (report.taxpayerName) lines.push(`Taxpayer: ${report.taxpayerName}`);
  if (report.taxpayerId) lines.push(`ID: ${report.taxpayerId}`);
  lines.push(`Generated: ${formatEstonianDate(report.generatedAt)}`);
  lines.push('');
  lines.push('-'.repeat(80));

  // Header
  lines.push(
    'Income Source'.padEnd(45) +
    'Country'.padEnd(8) +
    'Income'.padStart(12) +
    'Taxable'.padStart(12)
  );
  lines.push('-'.repeat(80));

  // Rows
  for (const row of report.rows) {
    lines.push(
      row.incomeSource.substring(0, 44).padEnd(45) +
      row.country.padEnd(8) +
      formatEuroAmount(row.incomeAmount).padStart(12) +
      formatEuroAmount(row.taxableAmount).padStart(12)
    );
  }

  lines.push('-'.repeat(80));

  // Totals
  lines.push(
    'TOTAL'.padEnd(53) +
    formatEuroAmount(report.totalIncome).padStart(12) +
    formatEuroAmount(report.totalTaxable).padStart(12)
  );
  lines.push('');
  lines.push(`Tax Rate: ${(report.taxRate * 100).toFixed(0)}%`);
  lines.push(`Estimated Tax: ${formatEuroAmount(report.estimatedTax)}`);
  lines.push('');
  lines.push('=' .repeat(80));
  lines.push('NOTE: Losses are NOT deductible in Estonia.');
  lines.push('This is an estimate. Consult a tax professional.');
  lines.push('=' .repeat(80));

  return lines.join('\n');
}

/**
 * Generate CSV export of all transactions
 */
export function generateTransactionsCSV(
  transactions: ProcessedTransaction[]
): string {
  const headers = [
    'Date',
    'Type',
    'Category',
    'Asset',
    'Amount',
    'Pair',
    'Side',
    'Price',
    'Cost',
    'Fee',
    'Fee Asset',
    'Leverage',
    'Cost Basis',
    'Proceeds',
    'Gain/Loss',
    'Kraken Ref',
  ];

  const rows = transactions.map(tx => [
    tx.timestamp.toISOString(),
    tx.type,
    tx.category,
    tx.asset,
    tx.amount.toString(),
    tx.pair || '',
    tx.side || '',
    tx.price?.toString() || '',
    tx.cost?.toString() || '',
    tx.fee?.toString() || '',
    tx.feeAsset || '',
    tx.leverage || '',
    tx.costBasis?.toString() || '',
    tx.proceeds?.toString() || '',
    tx.gain?.toString() || '',
    tx.krakenRefId || '',
  ]);

  const csvRows = [headers, ...rows].map(row =>
    row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
  );

  return csvRows.join('\n');
}

/**
 * Generate CSV export of tax events
 */
export function generateTaxEventsCSV(events: TaxEvent[]): string {
  const headers = [
    'Tax Year',
    'Type',
    'Asset',
    'Amount',
    'Acquisition Date',
    'Acquisition Cost',
    'Disposal Date',
    'Disposal Proceeds',
    'Gain/Loss',
    'Taxable Amount',
    'Cost Basis Method',
    'Transaction ID',
  ];

  const rows = events.map(event => [
    event.taxYear.toString(),
    event.type,
    event.asset,
    event.amount.toString(),
    formatEstonianDate(event.acquisitionDate),
    event.acquisitionCost.toString(),
    formatEstonianDate(event.disposalDate),
    event.disposalProceeds.toString(),
    event.gain.toString(),
    event.taxableAmount.toString(),
    event.costBasisMethod,
    event.transactionId,
  ]);

  const csvRows = [headers, ...rows].map(row =>
    row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
  );

  return csvRows.join('\n');
}

/**
 * Generate summary report as JSON (for storage)
 */
export function generateSummaryJSON(
  taxYear: number,
  summary: TaxSummary,
  table83: Table83Report
): string {
  return JSON.stringify(
    {
      taxYear,
      generatedAt: new Date().toISOString(),
      summary,
      table83: {
        rows: table83.rows,
        totals: {
          income: table83.totalIncome,
          deductions: table83.totalDeductions,
          taxable: table83.totalTaxable,
          estimatedTax: table83.estimatedTax,
        },
      },
    },
    null,
    2
  );
}

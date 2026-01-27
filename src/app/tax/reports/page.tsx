'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getTaxRate, formatEuroAmount, type AccountType } from '@/lib/tax/estonia-rules';

interface TaxSummary {
  taxYear: number;
  taxRate: number;
  accountType: AccountType;
  totalGains: number;
  totalLosses: number;
  netPnL: number;
  taxableAmount: number;
  estimatedTax: number;
  retainedProfit: number;
  distributionTaxRate: number;
  potentialDistributionTax: number;
  tradingGains: number;
  tradingLosses: number;
  marginGains: number;
  marginLosses: number;
  stakingIncome: number;
  earnIncome: number;
  airdropIncome: number;
  totalTransactions: number;
}

interface ReportRow {
  incomeSource: string;
  country: string;
  incomeAmount: number;
  taxableAmount: number;
}

export default function ReportsPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const taxRate = getTaxRate(selectedYear);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tax/summary?year=${selectedYear}`);
      if (!res.ok) {
        throw new Error('Failed to load tax summary');
      }
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Generate report rows from summary
  const generateReportRows = (): ReportRow[] => {
    if (!summary) return [];

    const rows: ReportRow[] = [];

    if (summary.tradingGains > 0) {
      rows.push({
        incomeSource: 'Cryptocurrency trading gains (Kraken)',
        country: 'USA',
        incomeAmount: summary.tradingGains,
        taxableAmount: summary.tradingGains,
      });
    }

    if (summary.marginGains > 0) {
      rows.push({
        incomeSource: 'Cryptocurrency margin trading gains (Kraken)',
        country: 'USA',
        incomeAmount: summary.marginGains,
        taxableAmount: summary.marginGains,
      });
    }

    if (summary.stakingIncome > 0) {
      rows.push({
        incomeSource: 'Cryptocurrency staking rewards (Kraken)',
        country: 'USA',
        incomeAmount: summary.stakingIncome,
        taxableAmount: summary.stakingIncome,
      });
    }

    if (summary.airdropIncome > 0) {
      rows.push({
        incomeSource: 'Cryptocurrency airdrops/forks (Kraken)',
        country: 'USA',
        incomeAmount: summary.airdropIncome,
        taxableAmount: summary.airdropIncome,
      });
    }

    return rows;
  };

  const reportRows = generateReportRows();
  const totalIncome = reportRows.reduce((sum, row) => sum + row.incomeAmount, 0);
  const totalTaxable = reportRows.reduce((sum, row) => sum + row.taxableAmount, 0);
  const estimatedTax = totalTaxable * taxRate;

  const handleGenerateReport = async (format: 'text' | 'csv' | 'pdf') => {
    setGenerating(true);

    // Small delay for UI feedback
    await new Promise(resolve => setTimeout(resolve, 300));

    if (format === 'text') {
      const text = generateTextReport();
      downloadFile(text, `table-8-3-${selectedYear}.txt`, 'text/plain');
    } else if (format === 'csv') {
      const csv = generateCSVReport();
      downloadFile(csv, `tax-report-${selectedYear}.csv`, 'text/csv');
    }

    setGenerating(false);
  };

  const handleDownloadBusinessExcel = async () => {
    setGenerating(true);
    try {
      const response = await fetch(`/api/tax/report/business?year=${selectedYear}`);
      if (!response.ok) {
        throw new Error('Failed to generate report');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crypto-report-${selectedYear}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to generate report. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const generateTextReport = () => {
    const lines = [
      '='.repeat(80),
      'ESTONIAN TAX DECLARATION - TABLE 8.3',
      'Income from Foreign Sources',
      '='.repeat(80),
      '',
      `Tax Year: ${selectedYear}`,
      `Generated: ${new Date().toLocaleDateString('et-EE')}`,
      '',
      '-'.repeat(80),
      'Income Source'.padEnd(45) + 'Country'.padEnd(8) + 'Income'.padStart(12) + 'Taxable'.padStart(12),
      '-'.repeat(80),
    ];

    for (const row of reportRows) {
      lines.push(
        row.incomeSource.substring(0, 44).padEnd(45) +
        row.country.padEnd(8) +
        formatEuroAmount(row.incomeAmount).padStart(12) +
        formatEuroAmount(row.taxableAmount).padStart(12)
      );
    }

    lines.push('-'.repeat(80));
    lines.push('TOTAL'.padEnd(53) + formatEuroAmount(totalIncome).padStart(12) + formatEuroAmount(totalTaxable).padStart(12));
    lines.push('');
    lines.push(`Tax Rate: ${(taxRate * 100).toFixed(0)}%`);
    lines.push(`Estimated Tax: ${formatEuroAmount(estimatedTax)}`);
    lines.push('');
    lines.push('='.repeat(80));
    lines.push('LOSSES (NOT DEDUCTIBLE - for reference only):');
    if (summary) {
      lines.push(`  Trading Losses: ${formatEuroAmount(summary.tradingLosses)}`);
      lines.push(`  Margin Losses: ${formatEuroAmount(summary.marginLosses)}`);
    }
    lines.push('='.repeat(80));
    lines.push('');
    lines.push('NOTE: In Estonia, cryptocurrency losses are NOT deductible.');
    lines.push('This is an estimate. Consult a tax professional.');

    return lines.join('\n');
  };

  const generateCSVReport = () => {
    const headers = ['Income Source', 'Country', 'Income Amount (EUR)', 'Taxable Amount (EUR)'];
    const rows = reportRows.map(row => [
      row.incomeSource,
      row.country,
      row.incomeAmount.toFixed(2),
      row.taxableAmount.toFixed(2),
    ]);

    rows.push(['TOTAL', '', totalIncome.toFixed(2), totalTaxable.toFixed(2)]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    return csvContent;
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Generate Tax Reports</h1>
          <p className="text-secondary">Estonian Table 8.3 format for tax declaration</p>
        </div>
        <select
          className="input"
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
        >
          {[currentYear, currentYear - 1, currentYear - 2].map(year => (
            <option key={year} value={year}>
              Tax Year {year}
            </option>
          ))}
        </select>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">⏳</div>
          <div className="text-secondary">Loading tax data...</div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="card p-4 mb-6 border-warning" style={{ borderColor: 'var(--yellow)' }}>
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-semibold text-warning mb-1">Error Loading Data</h3>
              <p className="text-sm text-secondary">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* No Data State */}
      {!loading && (!summary || summary.totalTransactions === 0) && (
        <div className="card p-8 text-center mb-6">
          <div className="text-4xl mb-4">📭</div>
          <h3 className="text-lg font-semibold mb-2">No Data for {selectedYear}</h3>
          <p className="text-secondary mb-4">
            Import your trading data from Kraken to generate reports.
          </p>
          <Link href="/tax/import" className="btn btn-primary">
            Import Data
          </Link>
        </div>
      )}

      {/* Main Content */}
      {!loading && summary && summary.totalTransactions > 0 && (
        <>
          {/* Preview */}
          <div className="card p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Report Preview - Table 8.3</h2>
            <p className="text-sm text-secondary mb-4">
              Table 8.3 is used to declare income from foreign sources. Kraken is a US-based company,
              so all cryptocurrency income should be reported here.
            </p>

            {reportRows.length === 0 ? (
              <div className="bg-primary rounded-lg p-4 text-center text-secondary">
                No taxable gains to report for {selectedYear}
              </div>
            ) : (
              <div className="bg-primary rounded-lg p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-tertiary">
                      <th className="text-left py-2 text-tertiary">Income Source</th>
                      <th className="text-left py-2 text-tertiary">Country</th>
                      <th className="text-right py-2 text-tertiary">Income (EUR)</th>
                      <th className="text-right py-2 text-tertiary">Taxable (EUR)</th>
                    </tr>
                  </thead>
                  <tbody className="mono">
                    {reportRows.map((row, i) => (
                      <tr key={i} className="border-b border-tertiary/50">
                        <td className="py-2">{row.incomeSource}</td>
                        <td className="py-2">{row.country}</td>
                        <td className="py-2 text-right">{formatEuroAmount(row.incomeAmount)}</td>
                        <td className="py-2 text-right">{formatEuroAmount(row.taxableAmount)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className="py-3" colSpan={2}>TOTAL</td>
                      <td className="py-3 text-right">{formatEuroAmount(totalIncome)}</td>
                      <td className="py-3 text-right text-success">{formatEuroAmount(totalTaxable)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="bg-tertiary rounded-lg p-4">
                <div className="text-xs text-tertiary uppercase mb-1">Tax Rate</div>
                <div className="text-xl font-bold">{(taxRate * 100).toFixed(0)}%</div>
              </div>
              <div className="bg-tertiary rounded-lg p-4">
                <div className="text-xs text-tertiary uppercase mb-1">Estimated Tax Due</div>
                <div className="text-xl font-bold text-info">{formatEuroAmount(estimatedTax)}</div>
              </div>
            </div>
          </div>

          {/* Losses Notice */}
          {summary && (summary.tradingLosses > 0 || summary.marginLosses > 0) && (
            <div className="card p-4 mb-6 border-warning" style={{ borderColor: 'var(--yellow)' }}>
              <h3 className="font-semibold text-warning mb-2">Losses Not Included in Report</h3>
              <p className="text-sm text-secondary mb-3">
                The following losses are tracked for your records but are NOT deductible in Estonia:
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-secondary">Trading Losses:</span>
                  <span className="mono text-danger">{formatEuroAmount(summary.tradingLosses)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Margin Losses:</span>
                  <span className="mono text-danger">{formatEuroAmount(summary.marginLosses)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Export Options */}
          <div className="card p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Export Report</h2>

            {summary?.accountType === 'business' ? (
              <>
                {/* Business Account Export Options */}
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <div className="text-sm text-green-400">
                    <strong>Business Account (OÜ)</strong> - Generate accounting reports for your bookkeeper
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <button
                    className="btn btn-primary py-4 flex flex-col items-center gap-2"
                    onClick={() => handleDownloadBusinessExcel()}
                    disabled={generating}
                  >
                    <span className="text-2xl">📊</span>
                    <span className="font-medium">Business Report (Excel)</span>
                    <span className="text-xs opacity-80">Positions, P&L, Fees, Balance</span>
                  </button>
                  <button
                    className="btn btn-secondary py-4 flex flex-col items-center gap-2"
                    onClick={() => handleGenerateReport('csv')}
                    disabled={generating}
                  >
                    <span className="text-2xl">📄</span>
                    <span className="font-medium">Simple CSV</span>
                    <span className="text-xs text-tertiary">Basic transaction list</span>
                  </button>
                </div>

                <div className="mt-4 p-3 bg-tertiary rounded text-sm text-secondary">
                  <strong>Excel Report includes:</strong>
                  <ul className="mt-2 space-y-1 ml-4 list-disc">
                    <li>Summary - P&L overview with Estonian tax notes</li>
                    <li>Positions - Grouped trading positions (averaged prices, fees, P&L)</li>
                    <li>Fees - Rollover fees and trading costs breakdown</li>
                    <li>Balance - Asset holdings at year-end</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                {/* Individual Account Export Options */}
                <div className="grid md:grid-cols-3 gap-4">
                  <button
                    className="btn btn-secondary py-4 flex flex-col items-center gap-2"
                    onClick={() => handleGenerateReport('text')}
                    disabled={generating || reportRows.length === 0}
                  >
                    <span className="text-2xl">📄</span>
                    <span className="font-medium">Table 8.3 (Text)</span>
                    <span className="text-xs text-tertiary">For manual entry</span>
                  </button>
                  <button
                    className="btn btn-secondary py-4 flex flex-col items-center gap-2"
                    onClick={() => handleGenerateReport('csv')}
                    disabled={generating || reportRows.length === 0}
                  >
                    <span className="text-2xl">📊</span>
                    <span className="font-medium">Full Report (CSV)</span>
                    <span className="text-xs text-tertiary">For accountant</span>
                  </button>
                  <button
                    className="btn btn-secondary py-4 flex flex-col items-center gap-2 opacity-50"
                    disabled
                  >
                    <span className="text-2xl">📑</span>
                    <span className="font-medium">PDF Report</span>
                    <span className="text-xs text-tertiary">Coming soon</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Instructions - context-aware */}
      <div className="card p-6">
        {summary?.accountType === 'business' ? (
          <>
            <h2 className="text-lg font-semibold mb-4">Business Accounting Notes</h2>
            <div className="space-y-4 text-sm text-secondary">
              <div>
                <strong className="text-primary">Estonian Corporate Tax System:</strong>
                <ul className="mt-2 ml-4 space-y-1 list-disc">
                  <li><span className="text-success">0% tax</span> on retained/reinvested profits</li>
                  <li>Tax only triggered when distributing profits (dividends, etc.)</li>
                  <li>Distribution tax: ~28% effective rate (22/78 in 2025)</li>
                </ul>
              </div>

              <div>
                <strong className="text-primary">For Your Accountant:</strong>
                <ul className="mt-2 ml-4 space-y-1 list-disc">
                  <li>Download the Excel report for bookkeeping entries</li>
                  <li>Positions sheet shows grouped trades with averaged prices</li>
                  <li>All fees (rollovers, trading) are itemized separately</li>
                  <li>Balance sheet shows crypto holdings at year-end</li>
                </ul>
              </div>

              <div className="p-3 bg-tertiary rounded">
                <strong>Record Retention:</strong> Keep all reports and Kraken statements for at least 7 years
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-4">How to File (Individual)</h2>
            <ol className="space-y-3 text-sm text-secondary">
              <li className="flex gap-2">
                <span className="text-info font-bold">1.</span>
                Log in to <a href="https://www.emta.ee/eng" target="_blank" rel="noopener noreferrer" className="text-info hover:underline">e-MTA</a> (Estonian Tax and Customs Board)
              </li>
              <li className="flex gap-2">
                <span className="text-info font-bold">2.</span>
                Navigate to your annual income tax return (form A)
              </li>
              <li className="flex gap-2">
                <span className="text-info font-bold">3.</span>
                Find Table 8.3 &quot;Income from foreign sources&quot;
              </li>
              <li className="flex gap-2">
                <span className="text-info font-bold">4.</span>
                Add each row from the report above (country: USA, income source: as shown)
              </li>
              <li className="flex gap-2">
                <span className="text-info font-bold">5.</span>
                The tax will be calculated automatically at the current rate
              </li>
            </ol>
            <div className="mt-4 p-3 bg-tertiary rounded text-sm">
              <strong>Tip:</strong> Keep the CSV export and your Kraken statements for at least 7 years
              in case of audit.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

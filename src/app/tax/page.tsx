'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getTaxRate, formatEuroAmount } from '@/lib/tax/estonia-rules';
import { Tooltip, HelpIcon, InfoBadge } from '@/components/Tooltip';

type CostBasisMethod = 'FIFO' | 'WEIGHTED_AVERAGE';

interface TaxSummary {
  taxYear: number;
  taxRate: number;
  totalProceeds: number;
  totalCostBasis: number;
  totalGains: number;
  totalLosses: number;
  taxableAmount: number;
  estimatedTax: number;
  tradingGains: number;
  tradingLosses: number;
  marginGains: number;
  marginLosses: number;
  stakingIncome: number;
  earnIncome: number;
  airdropIncome: number;
  otherIncome: number;
  totalTransactions: number;
  taxableTransactions: number;
}

export default function TaxOverviewPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [costBasisMethod, setCostBasisMethod] = useState<CostBasisMethod>('FIFO');
  const [showMethodSelector, setShowMethodSelector] = useState(false);
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
      // Set empty summary on error
      setSummary({
        taxYear: selectedYear,
        taxRate,
        totalProceeds: 0,
        totalCostBasis: 0,
        totalGains: 0,
        totalLosses: 0,
        taxableAmount: 0,
        estimatedTax: 0,
        tradingGains: 0,
        tradingLosses: 0,
        marginGains: 0,
        marginLosses: 0,
        stakingIncome: 0,
        earnIncome: 0,
        airdropIncome: 0,
        otherIncome: 0,
        totalTransactions: 0,
        taxableTransactions: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedYear, taxRate]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const displaySummary = summary || {
    taxYear: selectedYear,
    taxRate,
    totalProceeds: 0,
    totalCostBasis: 0,
    totalGains: 0,
    totalLosses: 0,
    taxableAmount: 0,
    estimatedTax: 0,
    tradingGains: 0,
    tradingLosses: 0,
    marginGains: 0,
    marginLosses: 0,
    stakingIncome: 0,
    earnIncome: 0,
    airdropIncome: 0,
    otherIncome: 0,
    totalTransactions: 0,
    taxableTransactions: 0,
  };

  const tooltips = {
    totalGains: (
      <div>
        <strong className="text-green-400">Total Gains</strong>
        <p className="mt-1">The sum of all profitable trades and crypto income during this tax year.</p>
        <p className="mt-2 text-yellow-400">In Estonia, this is your taxable amount - you pay tax on ALL gains.</p>
      </div>
    ),
    totalLosses: (
      <div>
        <strong className="text-red-400">Total Losses</strong>
        <p className="mt-1">The sum of all losing trades during this tax year.</p>
        <p className="mt-2 text-yellow-400">⚠️ Important: In Estonia, losses CANNOT be deducted from gains. You still pay tax on your full gains amount.</p>
        <p className="mt-2 text-gray-400">This differs from many other countries where you can offset gains with losses.</p>
      </div>
    ),
    taxRate: (
      <div>
        <strong className="text-blue-400">Estonian Tax Rate</strong>
        <p className="mt-1">Cryptocurrency is taxed as regular income in Estonia.</p>
        <ul className="mt-2 space-y-1 text-gray-300">
          <li>• 2023-2025: 22%</li>
          <li>• 2026 onwards: 24%</li>
        </ul>
        <p className="mt-2 text-gray-400">There is no separate capital gains tax - all crypto income is income tax.</p>
      </div>
    ),
    estimatedTax: (
      <div>
        <strong className="text-blue-400">Estimated Tax Due</strong>
        <p className="mt-1">This is calculated as:</p>
        <p className="mt-1 font-mono text-green-400">Total Gains × Tax Rate</p>
        <p className="mt-2 text-gray-400">Remember: Losses don&apos;t reduce this amount in Estonia.</p>
        <p className="mt-2 text-yellow-400">This is an estimate. Your actual tax may vary based on other income.</p>
      </div>
    ),
    totalProceeds: (
      <div>
        <strong>Total Proceeds</strong>
        <p className="mt-1">The total amount you received from selling cryptocurrency.</p>
        <p className="mt-2 text-gray-400">This is the &quot;sale price&quot; side of your trades - what you got back in EUR (or equivalent).</p>
      </div>
    ),
    totalCostBasis: (
      <div>
        <strong>Total Cost Basis</strong>
        <p className="mt-1">What you originally paid for the crypto you sold, calculated using {costBasisMethod === 'FIFO' ? 'FIFO' : 'Weighted Average'} method.</p>
        <p className="mt-2 text-gray-400">Cost basis includes the purchase price plus any fees paid when buying.</p>
        <p className="mt-2">Your gain/loss = Proceeds - Cost Basis</p>
      </div>
    ),
    costBasisMethod: (
      <div>
        <strong>Cost Basis Method</strong>
        <p className="mt-1">How we calculate what you &quot;paid&quot; for the crypto you sold.</p>
        <div className="mt-2 p-2 bg-gray-800 rounded">
          <strong className="text-blue-400">FIFO (First In, First Out)</strong>
          <p className="text-sm mt-1">When you sell, we assume you&apos;re selling your oldest coins first.</p>
          <p className="text-sm text-green-400 mt-1">✓ Recommended for Estonia</p>
        </div>
        <div className="mt-2 p-2 bg-gray-800 rounded">
          <strong className="text-purple-400">Weighted Average</strong>
          <p className="text-sm mt-1">Uses the average price of all your purchases.</p>
          <p className="text-sm text-gray-400 mt-1">Simpler but may give different results</p>
        </div>
        <p className="mt-2 text-yellow-400">Click to change method</p>
      </div>
    ),
    tradingGains: (
      <div>
        <strong className="text-green-400">Spot Trading Gains</strong>
        <p className="mt-1">Profits from regular buy/sell trades (no leverage).</p>
        <p className="mt-2 text-gray-400">Example: Buy BTC at €40,000, sell at €45,000 = €5,000 gain</p>
      </div>
    ),
    tradingLosses: (
      <div>
        <strong className="text-red-400">Spot Trading Losses</strong>
        <p className="mt-1">Losses from regular buy/sell trades.</p>
        <p className="mt-2 text-yellow-400">Remember: These cannot be deducted in Estonia!</p>
      </div>
    ),
    marginGains: (
      <div>
        <strong className="text-green-400">Margin Trading Gains</strong>
        <p className="mt-1">Profits from leveraged trades (2x-5x positions).</p>
        <p className="mt-2 text-gray-400">Margin trading amplifies both gains and losses using borrowed funds.</p>
        <p className="mt-2 text-gray-400">Includes position settlements and excludes rollover fees.</p>
      </div>
    ),
    marginLosses: (
      <div>
        <strong className="text-red-400">Margin Trading Losses</strong>
        <p className="mt-1">Losses from leveraged trades.</p>
        <p className="mt-2 text-gray-400">Includes losses from closed positions and liquidations.</p>
        <p className="mt-2 text-yellow-400">Not deductible in Estonia.</p>
      </div>
    ),
    stakingIncome: (
      <div>
        <strong className="text-green-400">Staking Rewards</strong>
        <p className="mt-1">Cryptocurrency earned by &quot;staking&quot; (locking up) your coins to help secure a blockchain.</p>
        <p className="mt-2 text-gray-400">Similar to earning interest on a savings account.</p>
        <p className="mt-2 text-yellow-400">Taxed at the value when received, even if you haven&apos;t sold.</p>
      </div>
    ),
    earnIncome: (
      <div>
        <strong className="text-green-400">Kraken Earn Rewards</strong>
        <p className="mt-1">Interest earned through Kraken&apos;s Earn program on your account balances.</p>
        <p className="mt-2 text-gray-400">Your assets earn rewards while held in your Kraken account.</p>
        <p className="mt-2 text-yellow-400">Taxed as income at the value when received.</p>
      </div>
    ),
    airdropIncome: (
      <div>
        <strong className="text-green-400">Airdrops & Forks</strong>
        <p className="mt-1"><strong>Airdrops:</strong> Free tokens given to wallet holders, often for marketing.</p>
        <p className="mt-2"><strong>Forks:</strong> New coins created when a blockchain splits (like Bitcoin Cash from Bitcoin).</p>
        <p className="mt-2 text-yellow-400">Taxed at fair market value when received.</p>
      </div>
    ),
    table83: (
      <div>
        <strong>Table 8.3 - Foreign Income</strong>
        <p className="mt-1">Estonian tax form for reporting income from foreign sources.</p>
        <p className="mt-2 text-gray-400">Kraken is a US company, so all crypto income goes here (not Table 8.1 for Estonian income).</p>
        <p className="mt-2">You&apos;ll add this to your annual tax declaration in e-MTA.</p>
      </div>
    ),
    fifo: (
      <div>
        <strong className="text-blue-400">FIFO - First In, First Out</strong>
        <p className="mt-1">When you sell crypto, FIFO assumes you&apos;re selling your <strong>oldest</strong> coins first.</p>
        <div className="mt-2 p-2 bg-gray-800 rounded text-sm">
          <p>Example:</p>
          <p>• Jan: Buy 1 BTC at €30,000</p>
          <p>• Mar: Buy 1 BTC at €40,000</p>
          <p>• Jun: Sell 1 BTC at €45,000</p>
          <p className="mt-1 text-green-400">FIFO gain: €45,000 - €30,000 = €15,000</p>
          <p className="text-gray-400">(Uses January purchase price)</p>
        </div>
        <p className="mt-2 text-green-400">✓ Standard method for Estonian tax reporting</p>
      </div>
    ),
    weightedAverage: (
      <div>
        <strong className="text-purple-400">Weighted Average Cost</strong>
        <p className="mt-1">Uses the <strong>average price</strong> of all your purchases as cost basis.</p>
        <div className="mt-2 p-2 bg-gray-800 rounded text-sm">
          <p>Example:</p>
          <p>• Jan: Buy 1 BTC at €30,000</p>
          <p>• Mar: Buy 1 BTC at €40,000</p>
          <p>• Average: €35,000 per BTC</p>
          <p>• Jun: Sell 1 BTC at €45,000</p>
          <p className="mt-1 text-green-400">WA gain: €45,000 - €35,000 = €10,000</p>
        </div>
        <p className="mt-2 text-gray-400">Simpler to calculate but may result in different tax amounts.</p>
      </div>
    ),
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tax Overview</h1>
          <p className="text-secondary">Estonian cryptocurrency tax summary</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            className="input"
            value={selectedYear}
            onChange={e => setSelectedYear(Number(e.target.value))}
          >
            {[2024, 2025, 2026].map(year => (
              <option key={year} value={year}>
                Tax Year {year}
              </option>
            ))}
          </select>
          <Link href="/tax/reports" className="btn btn-primary">
            Generate Report
          </Link>
        </div>
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
      {!loading && displaySummary.totalTransactions === 0 && (
        <div className="card p-8 text-center mb-6">
          <div className="text-4xl mb-4">📭</div>
          <h3 className="text-lg font-semibold mb-2">No Data for {selectedYear}</h3>
          <p className="text-secondary mb-4">
            Import your trading data from Kraken to see your tax summary.
          </p>
          <Link href="/tax/import" className="btn btn-primary">
            Import Data
          </Link>
        </div>
      )}

      {/* Main Content - only show if we have data */}
      {!loading && displaySummary.totalTransactions > 0 && (
        <>
          {/* Main Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Tooltip content={tooltips.totalGains} position="bottom">
              <div className="card p-4 cursor-help hover:border-green-500 transition-colors">
                <div className="text-xs text-tertiary uppercase mb-1 flex items-center">
                  Total Gains
                  <span className="ml-1 text-blue-500">ⓘ</span>
                </div>
                <div className="text-2xl font-bold text-success">
                  {formatEuroAmount(displaySummary.totalGains)}
                </div>
                <div className="text-xs text-secondary">Taxable income</div>
              </div>
            </Tooltip>

            <Tooltip content={tooltips.totalLosses} position="bottom">
              <div className="card p-4 cursor-help hover:border-red-500 transition-colors">
                <div className="text-xs text-tertiary uppercase mb-1 flex items-center">
                  Total Losses
                  <span className="ml-1 text-blue-500">ⓘ</span>
                </div>
                <div className="text-2xl font-bold text-danger">
                  {formatEuroAmount(displaySummary.totalLosses)}
                </div>
                <div className="text-xs text-danger">NOT deductible</div>
              </div>
            </Tooltip>

            <Tooltip content={tooltips.taxRate} position="bottom">
              <div className="card p-4 cursor-help hover:border-yellow-500 transition-colors">
                <div className="text-xs text-tertiary uppercase mb-1 flex items-center">
                  Tax Rate
                  <span className="ml-1 text-blue-500">ⓘ</span>
                </div>
                <div className="text-2xl font-bold text-warning">
                  {(taxRate * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-secondary">Income tax</div>
              </div>
            </Tooltip>

            <Tooltip content={tooltips.estimatedTax} position="bottom">
              <div className="card p-4 cursor-help hover:border-blue-500 transition-colors">
                <div className="text-xs text-tertiary uppercase mb-1 flex items-center">
                  Estimated Tax
                  <span className="ml-1 text-blue-500">ⓘ</span>
                </div>
                <div className="text-2xl font-bold text-info">
                  {formatEuroAmount(displaySummary.estimatedTax)}
                </div>
                <div className="text-xs text-secondary">
                  <InfoBadge tooltip={tooltips.table83}>Table 8.3</InfoBadge>
                </div>
              </div>
            </Tooltip>
          </div>

          {/* Warning Banner */}
          <div
            className="card p-4 mb-6 border-l-4"
            style={{ borderLeftColor: 'var(--yellow)' }}
          >
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h3 className="font-semibold text-warning mb-1">
                  Estonian Tax Rules - Losses Not Deductible
                </h3>
                <p className="text-sm text-secondary">
                  In Estonia, cryptocurrency losses <strong>cannot be offset against gains</strong>. Only your total
                  gains ({formatEuroAmount(displaySummary.totalGains)}) are subject to the {(taxRate * 100).toFixed(0)}%
                  income tax. Your losses ({formatEuroAmount(displaySummary.totalLosses)}) are tracked for
                  reference but will not reduce your tax liability.
                </p>
                <p className="text-sm text-tertiary mt-2">
                  This differs from countries like Germany or the US where losses can offset gains.
                </p>
              </div>
            </div>
          </div>

          {/* Cost Basis Method Selector */}
          <div className="card p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Cost Basis Method:</span>
                <Tooltip content={tooltips.costBasisMethod} position="bottom">
                  <button
                    onClick={() => setShowMethodSelector(!showMethodSelector)}
                    className="px-3 py-1 rounded-lg bg-tertiary hover:bg-blue-600 transition-colors flex items-center gap-2"
                  >
                    <span className={costBasisMethod === 'FIFO' ? 'text-blue-400' : 'text-purple-400'}>
                      {costBasisMethod === 'FIFO' ? 'FIFO (First In, First Out)' : 'Weighted Average'}
                    </span>
                    <span className="text-xs">▼</span>
                  </button>
                </Tooltip>
              </div>
              {costBasisMethod === 'FIFO' && (
                <span className="text-xs text-green-500 flex items-center gap-1">
                  ✓ Recommended for Estonia
                </span>
              )}
            </div>

            {showMethodSelector && (
              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <Tooltip content={tooltips.fifo} position="right">
                  <button
                    onClick={() => {
                      setCostBasisMethod('FIFO');
                      setShowMethodSelector(false);
                    }}
                    className={`p-4 rounded-lg border-2 text-left transition-colors ${
                      costBasisMethod === 'FIFO'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-primary hover:border-blue-500'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-blue-400">FIFO</span>
                      {costBasisMethod === 'FIFO' && <span className="text-green-500">✓ Selected</span>}
                    </div>
                    <p className="text-sm text-secondary">First In, First Out</p>
                    <p className="text-xs text-tertiary mt-1">Sells oldest coins first</p>
                    <p className="text-xs text-green-500 mt-2">✓ Standard for Estonia</p>
                  </button>
                </Tooltip>

                <Tooltip content={tooltips.weightedAverage} position="left">
                  <button
                    onClick={() => {
                      setCostBasisMethod('WEIGHTED_AVERAGE');
                      setShowMethodSelector(false);
                    }}
                    className={`p-4 rounded-lg border-2 text-left transition-colors ${
                      costBasisMethod === 'WEIGHTED_AVERAGE'
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-primary hover:border-purple-500'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-purple-400">Weighted Average</span>
                      {costBasisMethod === 'WEIGHTED_AVERAGE' && <span className="text-green-500">✓ Selected</span>}
                    </div>
                    <p className="text-sm text-secondary">Average Cost Method</p>
                    <p className="text-xs text-tertiary mt-1">Uses average purchase price</p>
                    <p className="text-xs text-yellow-500 mt-2">Alternative method</p>
                  </button>
                </Tooltip>
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Income Breakdown */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                Income Breakdown
                <HelpIcon
                  tooltip={
                    <div>
                      <strong>Income Breakdown</strong>
                      <p className="mt-1">Shows where your crypto gains and losses came from.</p>
                      <p className="mt-2 text-gray-400">All categories contribute to your total taxable amount (gains only).</p>
                    </div>
                  }
                />
              </h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-primary">
                  <div>
                    <Tooltip content={tooltips.tradingGains} position="right">
                      <div className="font-medium cursor-help flex items-center">
                        Trading Gains
                        <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                      </div>
                    </Tooltip>
                    <div className="text-xs text-tertiary">Spot trading profits</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-success mono">
                      +{formatEuroAmount(displaySummary.tradingGains)}
                    </div>
                    <Tooltip content={tooltips.tradingLosses} position="left">
                      <div className="text-xs text-danger mono cursor-help">
                        -{formatEuroAmount(displaySummary.tradingLosses)} (not deductible)
                      </div>
                    </Tooltip>
                  </div>
                </div>

                <div className="flex justify-between items-center py-2 border-b border-primary">
                  <div>
                    <Tooltip content={tooltips.marginGains} position="right">
                      <div className="font-medium cursor-help flex items-center">
                        Margin Trading
                        <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                      </div>
                    </Tooltip>
                    <div className="text-xs text-tertiary">Leveraged trading profits</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-success mono">
                      +{formatEuroAmount(displaySummary.marginGains)}
                    </div>
                    <Tooltip content={tooltips.marginLosses} position="left">
                      <div className="text-xs text-danger mono cursor-help">
                        -{formatEuroAmount(displaySummary.marginLosses)} (not deductible)
                      </div>
                    </Tooltip>
                  </div>
                </div>

                <div className="flex justify-between items-center py-2 border-b border-primary">
                  <div>
                    <Tooltip content={tooltips.stakingIncome} position="right">
                      <div className="font-medium cursor-help flex items-center">
                        Staking Rewards
                        <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                      </div>
                    </Tooltip>
                    <div className="text-xs text-tertiary">Passive income from staking</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-success mono">
                      +{formatEuroAmount(displaySummary.stakingIncome)}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center py-2 border-b border-primary">
                  <div>
                    <Tooltip content={tooltips.earnIncome} position="right">
                      <div className="font-medium cursor-help flex items-center">
                        Earn Rewards
                        <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                      </div>
                    </Tooltip>
                    <div className="text-xs text-tertiary">Kraken Earn interest income</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-success mono">
                      +{formatEuroAmount(displaySummary.earnIncome)}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center py-2">
                  <div>
                    <Tooltip content={tooltips.airdropIncome} position="right">
                      <div className="font-medium cursor-help flex items-center">
                        Airdrops & Forks
                        <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                      </div>
                    </Tooltip>
                    <div className="text-xs text-tertiary">Free tokens received</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold mono">
                      {formatEuroAmount(displaySummary.airdropIncome)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tax Calculation */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                Tax Calculation
                <HelpIcon
                  tooltip={
                    <div>
                      <strong>Tax Calculation</strong>
                      <p className="mt-1">Step-by-step breakdown of how your tax is calculated.</p>
                      <p className="mt-2 text-yellow-400">Remember: In Estonia, only gains are taxed. Losses are tracked but don&apos;t reduce your tax.</p>
                    </div>
                  }
                />
              </h2>
              <div className="space-y-3">
                <Tooltip content={tooltips.totalProceeds} position="left">
                  <div className="flex justify-between py-2 cursor-help">
                    <span className="text-secondary flex items-center">
                      Total Proceeds
                      <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                    </span>
                    <span className="mono">{formatEuroAmount(displaySummary.totalProceeds)}</span>
                  </div>
                </Tooltip>

                <Tooltip content={tooltips.totalCostBasis} position="left">
                  <div className="flex justify-between py-2 cursor-help">
                    <span className="text-secondary flex items-center">
                      Total Cost Basis ({costBasisMethod})
                      <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                    </span>
                    <span className="mono">-{formatEuroAmount(displaySummary.totalCostBasis)}</span>
                  </div>
                </Tooltip>

                <div className="flex justify-between py-2 border-t border-primary">
                  <span className="text-secondary">Net Gain/Loss</span>
                  <span className="mono">
                    {displaySummary.totalGains - displaySummary.totalLosses >= 0 ? '+' : ''}
                    {formatEuroAmount(displaySummary.totalGains - displaySummary.totalLosses)}
                  </span>
                </div>

                <div className="flex justify-between py-2">
                  <span className="text-secondary">Losses (not deductible)</span>
                  <span className="mono text-danger line-through">-{formatEuroAmount(displaySummary.totalLosses)}</span>
                </div>

                <div className="flex justify-between py-2 border-t border-primary font-semibold">
                  <span>Taxable Amount</span>
                  <span className="mono text-success">{formatEuroAmount(displaySummary.taxableAmount)}</span>
                </div>

                <div className="flex justify-between py-2">
                  <span className="text-secondary">Tax Rate ({selectedYear})</span>
                  <span className="mono">{(taxRate * 100).toFixed(0)}%</span>
                </div>

                <div className="flex justify-between py-3 border-t border-primary bg-tertiary -mx-6 px-6 mt-3 rounded-b-lg">
                  <span className="font-bold text-lg">Estimated Tax Due</span>
                  <span className="font-bold text-lg text-info mono">
                    {formatEuroAmount(displaySummary.estimatedTax)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Transaction Summary */}
          <div className="mt-6 card p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold flex items-center">
                Transaction Summary
                <HelpIcon
                  tooltip={
                    <div>
                      <strong>Transaction Summary</strong>
                      <p className="mt-1">Overview of all your crypto transactions for this tax year.</p>
                      <p className="mt-2 text-gray-400">Taxable events include trades, margin settlements, and income like staking rewards.</p>
                    </div>
                  }
                />
              </h2>
              <Link href="/tax/transactions" className="text-info hover:underline text-sm">
                View all transactions →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Tooltip content="All transactions synced from Kraken for this tax year" position="bottom">
                <div className="bg-primary rounded-lg p-4 text-center cursor-help">
                  <div className="text-2xl font-bold">{displaySummary.totalTransactions}</div>
                  <div className="text-xs text-tertiary">Total Transactions</div>
                </div>
              </Tooltip>

              <Tooltip content="Transactions that resulted in a taxable gain (sells, settlements, rewards)" position="bottom">
                <div className="bg-primary rounded-lg p-4 text-center cursor-help">
                  <div className="text-2xl font-bold text-success">{displaySummary.taxableTransactions}</div>
                  <div className="text-xs text-tertiary">Taxable Events</div>
                </div>
              </Tooltip>

              <Tooltip content={tooltips.costBasisMethod} position="bottom">
                <div
                  className="bg-primary rounded-lg p-4 text-center cursor-pointer hover:bg-tertiary transition-colors"
                  onClick={() => setShowMethodSelector(true)}
                >
                  <div className="text-2xl font-bold">{costBasisMethod === 'FIFO' ? 'FIFO' : 'WA'}</div>
                  <div className="text-xs text-tertiary">Cost Basis Method</div>
                </div>
              </Tooltip>

              <Tooltip content={tooltips.table83} position="bottom">
                <div className="bg-primary rounded-lg p-4 text-center cursor-help">
                  <div className="text-2xl font-bold">Table 8.3</div>
                  <div className="text-xs text-tertiary">Report Format</div>
                </div>
              </Tooltip>
            </div>
          </div>
        </>
      )}

      {/* Quick Actions - always visible */}
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        <Link href="/tax/import" className="card p-4 hover:border-blue-500 transition-colors">
          <div className="text-xl mb-2">📥</div>
          <h3 className="font-semibold mb-1">Import Data</h3>
          <p className="text-sm text-secondary">Sync trades and ledgers from Kraken</p>
        </Link>
        <Link href="/tax/transactions" className="card p-4 hover:border-blue-500 transition-colors">
          <div className="text-xl mb-2">📋</div>
          <h3 className="font-semibold mb-1">View Transactions</h3>
          <p className="text-sm text-secondary">Review and categorize all transactions</p>
        </Link>
        <Link href="/tax/reports" className="card p-4 hover:border-blue-500 transition-colors">
          <div className="text-xl mb-2">📄</div>
          <h3 className="font-semibold mb-1">Generate Reports</h3>
          <p className="text-sm text-secondary">Export Table 8.3 for tax declaration</p>
        </Link>
      </div>

      {/* Help Section */}
      <div className="mt-6 card p-6">
        <h2 className="text-lg font-semibold mb-4">Need Help Understanding?</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-blue-500">💡</span>
              <div>
                <strong>Hover over any item</strong> with a <span className="text-blue-500">ⓘ</span> icon to see a detailed explanation.
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-blue-500">📊</span>
              <div>
                <strong>Cost basis</strong> is what you paid for your crypto. Click the method selector above to understand FIFO vs Weighted Average.
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-yellow-500">⚠️</span>
              <div>
                <strong>Estonian tax rule:</strong> Only gains are taxed. Losses cannot reduce your tax.
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-500">✓</span>
              <div>
                <strong>All calculations are estimates.</strong> Consult a tax professional for your specific situation.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

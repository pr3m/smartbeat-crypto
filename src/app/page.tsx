import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">SmartBeatCrypto</h1>
        <p className="text-xl text-secondary">
          Trading Assistant & Tax Reporting for Estonian Crypto Traders
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Trading Card */}
        <Link href="/trading" className="card p-8 hover:border-blue-500 transition-colors">
          <div className="text-3xl mb-4">📈</div>
          <h2 className="text-xl font-semibold mb-2">Trading Assistant</h2>
          <p className="text-secondary mb-4">
            Real-time multi-timeframe analysis with automated entry signals and position management.
          </p>
          <ul className="text-sm text-tertiary space-y-1">
            <li>• 4H/1H/15m/5m timeframe analysis</li>
            <li>• RSI, MACD, Bollinger Bands, ATR</li>
            <li>• LONG/SHORT/WAIT recommendations</li>
            <li>• Position calculator with DCA levels</li>
          </ul>
        </Link>

        {/* Tax Card */}
        <Link href="/tax" className="card p-8 hover:border-blue-500 transition-colors">
          <div className="text-3xl mb-4">📋</div>
          <h2 className="text-xl font-semibold mb-2">Tax Reporting</h2>
          <p className="text-secondary mb-4">
            Estonian tax compliance with FIFO cost basis tracking and Table 8.3 report generation.
          </p>
          <ul className="text-sm text-tertiary space-y-1">
            <li>• FIFO cost basis calculation</li>
            <li>• Estonian 24% tax rate (2026+)</li>
            <li>• Table 8.3 report export</li>
            <li>• Automatic Kraken data sync</li>
          </ul>
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-info">24%</div>
          <div className="text-xs text-tertiary">Estonian Tax Rate</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-warning">FIFO</div>
          <div className="text-xs text-tertiary">Cost Basis Method</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-success">Table 8.3</div>
          <div className="text-xs text-tertiary">Report Format</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-danger">No</div>
          <div className="text-xs text-tertiary">Loss Deduction</div>
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="mt-12 max-w-2xl mx-auto">
        <h3 className="text-lg font-semibold mb-4">Getting Started</h3>
        <div className="card p-6">
          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-tertiary flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <strong>Configure API Keys</strong>
                <p className="text-secondary">
                  Copy <code className="mono text-info">.env.example</code> to{' '}
                  <code className="mono text-info">.env.local</code> and add your Kraken API keys.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-tertiary flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <strong>Initialize Database</strong>
                <p className="text-secondary">
                  Run <code className="mono text-info">npm run db:push</code> to create the SQLite database.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-tertiary flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <strong>Import Trading History</strong>
                <p className="text-secondary">
                  Go to <Link href="/tax/import" className="text-info hover:underline">Import</Link> to sync your Kraken trades and ledger entries.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-tertiary flex items-center justify-center text-xs font-bold">4</span>
              <div>
                <strong>Generate Reports</strong>
                <p className="text-secondary">
                  View your tax summary and export Table 8.3 reports for your tax declaration.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>

      {/* Estonian Tax Notes */}
      <div className="mt-8 max-w-2xl mx-auto">
        <div className="card p-6 border-warning" style={{ borderColor: 'var(--yellow)' }}>
          <h4 className="font-semibold text-warning mb-2">Estonian Tax Rules</h4>
          <ul className="text-sm text-secondary space-y-1">
            <li>• Cryptocurrency gains are taxed as income at 24% (from 2026)</li>
            <li>• <strong className="text-danger">Losses are NOT deductible</strong> - only gains are taxed</li>
            <li>• Report on Table 8.3 (foreign income) since Kraken is US-based</li>
            <li>• DAC8/CARF: Exchanges will report to tax authorities from 2026</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

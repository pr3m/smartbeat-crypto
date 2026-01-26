'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface SyncResult {
  success: boolean;
  year: number;
  summary: {
    tradesFound: number;
    spotTrades: number;
    marginTrades: number;
    ledgerEntries: number;
    recordsImported: number;
    recordsSkipped: number;
  };
  errors?: string[];
}

interface SyncStatus {
  lastSyncAt: string | null;
  yearsWithData: number[];
  transactionCounts: { type: string; _count: { id: number } }[];
  recentSyncs: {
    id: string;
    syncType: string;
    status: string;
    recordsFound: number;
    recordsImported: number;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  }[];
}

interface DbStats {
  totalTransactions: number;
  spotTrades: number;
  marginTrades: number;
  deposits: number;
  withdrawals: number;
  stakingRewards: number;
}

export default function ImportPage() {
  const currentYear = new Date().getFullYear();
  const availableYears = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const [includeSpot, setIncludeSpot] = useState(true);
  const [includeMargin, setIncludeMargin] = useState(true);
  const [fullResync, setFullResync] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);

  // Check API configuration and load sync status on mount
  useEffect(() => {
    checkApiConfig();
    loadSyncStatus();
  }, []);

  // Load database stats when year changes
  useEffect(() => {
    loadDbStats();
  }, [selectedYear]);

  const checkApiConfig = async () => {
    try {
      const res = await fetch('/api/kraken/private/balance');
      const data = await res.json();
      setApiConfigured(!data.error);
    } catch {
      setApiConfigured(false);
    }
  };

  const loadSyncStatus = async () => {
    try {
      const res = await fetch('/api/sync');
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
      }
    } catch (err) {
      console.error('Failed to load sync status:', err);
    }
  };

  const loadDbStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/transactions?year=${selectedYear}&limit=1`);
      if (res.ok) {
        const data = await res.json();
        setDbStats({
          totalTransactions: data.pagination?.total || 0,
          spotTrades: data.countsByType?.TRADE || 0,
          marginTrades: data.countsByType?.MARGIN_TRADE || 0,
          deposits: data.countsByType?.DEPOSIT || 0,
          withdrawals: data.countsByType?.WITHDRAWAL || 0,
          stakingRewards: data.countsByType?.STAKING_REWARD || 0,
        });
      }
    } catch (err) {
      console.error('Failed to load db stats:', err);
    }
  }, [selectedYear]);

  const handleSync = async () => {
    if (!includeSpot && !includeMargin) {
      setSyncError('Please select at least one trade type');
      return;
    }

    setIsSyncing(true);
    setSyncResult(null);
    setSyncError(null);

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: selectedYear,
          includeSpot,
          includeMargin,
          fullResync,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      setSyncResult(data);
      // Reload stats after sync
      await loadDbStats();
      await loadSyncStatus();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString('et-EE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Import Kraken Data</h1>
        <p className="text-secondary">Sync your trading history for tax reporting</p>
      </div>

      {/* API Status */}
      {apiConfigured === false && (
        <div className="card p-4 mb-6 border-danger" style={{ borderColor: 'var(--red)' }}>
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-semibold text-danger mb-1">API Keys Not Configured</h3>
              <p className="text-sm text-secondary">
                Please add your Kraken API keys to <code className="mono text-info">.env.local</code>.
                You need Query Funds, Query Ledger Entries, and Query Orders permissions.
              </p>
            </div>
          </div>
        </div>
      )}

      {apiConfigured === true && (
        <div className="card p-4 mb-6 border-success" style={{ borderColor: 'var(--green)' }}>
          <div className="flex items-center gap-3">
            <span className="text-xl">✅</span>
            <div>
              <h3 className="font-semibold text-success">API Connected</h3>
              <p className="text-sm text-secondary">
                Your Kraken API keys are configured and working.
                {syncStatus?.lastSyncAt && (
                  <span className="ml-1">Last sync: {formatDate(syncStatus.lastSyncAt)}</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Current Database Stats */}
      {dbStats && dbStats.totalTransactions > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Current Data for {selectedYear}</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{dbStats.totalTransactions}</div>
              <div className="text-xs text-tertiary">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-info">{dbStats.spotTrades}</div>
              <div className="text-xs text-tertiary">Spot Trades</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-warning">{dbStats.marginTrades}</div>
              <div className="text-xs text-tertiary">Margin Trades</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-success">{dbStats.deposits}</div>
              <div className="text-xs text-tertiary">Deposits</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-danger">{dbStats.withdrawals}</div>
              <div className="text-xs text-tertiary">Withdrawals</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{dbStats.stakingRewards}</div>
              <div className="text-xs text-tertiary">Staking</div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Link href="/tax/transactions" className="text-info text-sm hover:underline">
              View all transactions →
            </Link>
          </div>
        </div>
      )}

      {/* Year Selection */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Select Tax Year</h2>
        <p className="text-sm text-secondary mb-4">
          Choose a specific tax year to import data for. Data is synced from Kraken and stored locally.
        </p>
        <div className="flex flex-wrap gap-2">
          {availableYears.map(year => (
            <button
              key={year}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedYear === year
                  ? 'bg-blue-600 text-white'
                  : 'bg-tertiary text-secondary hover:text-primary'
              }`}
              onClick={() => setSelectedYear(year)}
            >
              {year}
              {syncStatus?.yearsWithData?.includes(year) && (
                <span className="ml-1 text-xs">✓</span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-4 p-3 bg-primary rounded text-sm">
          <strong>Selected:</strong> Tax Year {selectedYear}
          <span className="text-secondary ml-2">
            (Jan 1 - Dec 31, {selectedYear})
          </span>
        </div>
      </div>

      {/* Trade Type Selection */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Import Options</h2>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSpot}
              onChange={e => setIncludeSpot(e.target.checked)}
              className="w-5 h-5 rounded border-primary bg-primary"
            />
            <div>
              <div className="font-medium">Spot Trades</div>
              <div className="text-sm text-secondary">Regular buy/sell trades without leverage</div>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMargin}
              onChange={e => setIncludeMargin(e.target.checked)}
              className="w-5 h-5 rounded border-primary bg-primary"
            />
            <div>
              <div className="font-medium">Margin Trades</div>
              <div className="text-sm text-secondary">Leveraged trades and settlements</div>
            </div>
          </label>
          <div className="pt-3 border-t border-primary">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={fullResync}
                onChange={e => setFullResync(e.target.checked)}
                className="w-5 h-5 rounded border-primary bg-primary"
              />
              <div>
                <div className="font-medium text-warning">Full Resync</div>
                <div className="text-sm text-secondary">Delete existing data for this year and reimport everything</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Sync Button */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Sync Data</h2>

        {/* Sync Result */}
        {syncResult && (
          <div className={`mb-4 p-4 rounded-lg ${syncResult.errors?.length ? 'bg-warning/10 border border-warning' : 'bg-success/10 border border-success'}`}>
            <h3 className={`font-semibold mb-2 ${syncResult.errors?.length ? 'text-warning' : 'text-success'}`}>
              {syncResult.errors?.length ? 'Sync Completed with Warnings' : 'Sync Completed Successfully'}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-tertiary">Trades Found</div>
                <div className="font-semibold">{syncResult.summary.tradesFound}</div>
              </div>
              <div>
                <div className="text-tertiary">Spot / Margin</div>
                <div className="font-semibold">{syncResult.summary.spotTrades} / {syncResult.summary.marginTrades}</div>
              </div>
              <div>
                <div className="text-tertiary">Ledger Entries</div>
                <div className="font-semibold">{syncResult.summary.ledgerEntries}</div>
              </div>
              <div>
                <div className="text-tertiary">Imported / Skipped</div>
                <div className="font-semibold">{syncResult.summary.recordsImported} / {syncResult.summary.recordsSkipped}</div>
              </div>
            </div>
            {syncResult.errors && syncResult.errors.length > 0 && (
              <div className="mt-3 text-sm">
                <div className="text-warning font-medium">Warnings:</div>
                <ul className="mt-1 list-disc list-inside text-secondary">
                  {syncResult.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {syncResult.errors.length > 5 && (
                    <li>...and {syncResult.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Sync Error */}
        {syncError && (
          <div className="mb-4 p-4 rounded-lg bg-danger/10 border border-danger">
            <h3 className="font-semibold text-danger mb-1">Sync Failed</h3>
            <p className="text-sm text-secondary">{syncError}</p>
          </div>
        )}

        {/* Sync Button */}
        <button
          className="btn btn-primary w-full py-3 text-lg font-semibold"
          onClick={handleSync}
          disabled={isSyncing || apiConfigured === false || (!includeSpot && !includeMargin)}
        >
          {isSyncing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⏳</span>
              Syncing {selectedYear} data from Kraken...
            </span>
          ) : (
            `Sync ${selectedYear} Data from Kraken`
          )}
        </button>

        <p className="mt-3 text-xs text-center text-tertiary">
          This will fetch all trades and ledger entries for {selectedYear} from Kraken and save them to the local database.
          {fullResync ? ' Existing data for this year will be replaced.' : ' Existing records will be skipped.'}
        </p>
      </div>

      {/* Recent Syncs */}
      {syncStatus?.recentSyncs && syncStatus.recentSyncs.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Recent Sync History</h2>
          <div className="space-y-2">
            {syncStatus.recentSyncs.slice(0, 5).map(sync => (
              <div key={sync.id} className="flex items-center justify-between py-2 border-b border-primary text-sm">
                <div className="flex items-center gap-2">
                  <span className={
                    sync.status === 'completed' ? 'text-success' :
                    sync.status === 'failed' ? 'text-danger' :
                    sync.status === 'completed_with_errors' ? 'text-warning' :
                    'text-secondary'
                  }>
                    {sync.status === 'completed' ? '✅' :
                     sync.status === 'failed' ? '❌' :
                     sync.status === 'completed_with_errors' ? '⚠️' :
                     '⏳'}
                  </span>
                  <span>{formatDate(sync.startedAt)}</span>
                </div>
                <div className="text-secondary">
                  {sync.recordsImported} imported, {sync.recordsFound - sync.recordsImported} skipped
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info about spot vs margin */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">How Data Sync Works</h2>
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-3">
            <span className="text-info text-lg">1️⃣</span>
            <div>
              <strong>Fetches from Kraken</strong>
              <p className="text-secondary">
                Retrieves all trades and ledger entries for the selected year using your API key.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-info text-lg">2️⃣</span>
            <div>
              <strong>Saves to Local Database</strong>
              <p className="text-secondary">
                Stores data in SQLite on your machine. Duplicate records are automatically skipped.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-info text-lg">3️⃣</span>
            <div>
              <strong>Calculates Tax Events</strong>
              <p className="text-secondary">
                Automatically applies FIFO cost basis to calculate gains/losses for each sale.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-info text-lg">4️⃣</span>
            <div>
              <strong>Ready for Reports</strong>
              <p className="text-secondary">
                Tax overview and reports are generated from the local database.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 bg-tertiary rounded text-sm">
          <strong>Data Privacy:</strong> All data is stored locally on your machine.
          Nothing is sent to external servers except Kraken API calls.
        </div>
      </div>

      {/* Kraken API Setup Help */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Setting Up Kraken API</h2>
        <ol className="space-y-3 text-sm text-secondary">
          <li className="flex gap-2">
            <span className="text-info font-bold">1.</span>
            Go to{' '}
            <a
              href="https://pro.kraken.com/app/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-info hover:underline"
            >
              Kraken API Settings
            </a>
          </li>
          <li className="flex gap-2">
            <span className="text-info font-bold">2.</span>
            <div>
              Create a new API key under &quot;Spot trading API&quot; with these permissions:
              <ul className="ml-4 mt-1 space-y-1">
                <li>• <strong>Query Funds</strong> - Account balance</li>
                <li>• <strong>Query Open Orders & Trades</strong> - Trading history</li>
                <li>• <strong>Query Closed Orders & Trades</strong> - Historical trades</li>
                <li>• <strong>Query Ledger Entries</strong> - Deposits, withdrawals, staking</li>
                <li>• <strong>Export Data</strong> - Bulk data export</li>
              </ul>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="text-info font-bold">3.</span>
            Copy API Key and Private Key to your{' '}
            <code className="mono bg-tertiary px-1 rounded">.env.local</code>
          </li>
          <li className="flex gap-2">
            <span className="text-info font-bold">4.</span>
            Restart the development server
          </li>
        </ol>

        <div className="mt-4 p-3 bg-warning/10 border border-warning rounded text-sm">
          <strong className="text-warning">Same key for Spot + Margin:</strong>
          <p className="text-secondary mt-1">
            The &quot;Spot trading API&quot; handles both spot and margin trades.
            The app automatically detects which trades are margin based on the trade data.
          </p>
        </div>
      </div>
    </div>
  );
}

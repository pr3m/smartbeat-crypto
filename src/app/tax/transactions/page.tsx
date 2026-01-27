'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatEuroAmount, formatEstonianDate } from '@/lib/tax/estonia-rules';
import { Tooltip, HelpIcon } from '@/components/Tooltip';

type TransactionType = 'all' | 'TRADE' | 'MARGIN_TRADE' | 'STAKING_REWARD' | 'EARN_REWARD' | 'DEPOSIT' | 'WITHDRAWAL';
type ViewMode = 'raw' | 'grouped' | 'ledger';

interface Transaction {
  id: string;
  krakenRefId: string | null;
  type: string;
  category: string;
  asset: string;
  amount: number;
  pair: string | null;
  side: string | null;
  price: number | null;
  cost: number | null;
  fee: number | null;
  costBasis: number | null;
  proceeds: number | null;
  gain: number | null;
  timestamp: string;
  taxEvents: Array<{
    id: string;
    gain: number;
    taxableAmount: number;
  }>;
}

interface GroupedPosition {
  id: string;
  pair: string;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED' | 'PARTIAL';
  entryTime: string;
  entryTrades: number;
  avgEntryPrice: number;
  totalEntryVolume: number;
  totalEntryCost: number;
  exitTime: string | null;
  exitTrades: number;
  avgExitPrice: number | null;
  totalExitVolume: number;
  totalExitProceeds: number;
  entryFees: number;
  exitFees: number;
  marginFees: number;
  totalFees: number;
  realizedPnL: number | null;
  pnlSource: 'kraken' | 'calculated';
  transactionIds: string[];
  positionTxId: string | null;
  openingTradeId: string | null;
  closingTradeId: string | null;
}

interface PositionsResponse {
  positions: GroupedPosition[];
  pairs: string[];
  summary: {
    totalPositions: number;
    openPositions: number;
    closedPositions: number;
    totalRealizedPnL: number;
    totalFees: number;
    profitablePositions: number;
    losingPositions: number;
  };
}

interface TransactionsResponse {
  transactions: Transaction[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  stats: {
    totalGain: number;
    totalCost: number;
    totalFees: number;
    count: number;
  };
  countsByType: Record<string, number>;
  countsByCategory: Record<string, number>;
}

interface LedgerBreakdownItem {
  type: string;
  count: number;
  totalAmount: number;
  totalFees: number;
  byAsset: Record<string, {
    count: number;
    amount: number;
    fees: number;
  }>;
}

interface LedgerResponse {
  breakdown: LedgerBreakdownItem[];
  typeLabels: Record<string, string>;
  incomeSummary: {
    count: number;
    totalAmount: number;
  };
  years: number[];
  types: string[];
  totalTransactions: number;
  selectedYear: number | null;
  selectedType: string | null;
}

interface AssetDetailResponse {
  asset: string;
  year: number | null;
  type: string | null;
  summary: {
    transactionCount: number;
    totalIn: number;
    totalOut: number;
    netBalance: number;
    totalFees: number;
    totalGain: number;
    totalLoss: number;
    netPnL: number;
  };
  byType: Array<{
    type: string;
    label: string;
    count: number;
    totalAmount: number;
    totalFees: number;
  }>;
  recentTransactions: Array<{
    id: string;
    type: string;
    amount: number;
    fee: number | null;
    gain: number | null;
    timestamp: string;
    pair: string | null;
    side: string | null;
    price: number | null;
  }>;
  typeLabels: Record<string, string>;
}

export default function TransactionsPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [filter, setFilter] = useState<TransactionType>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('raw');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0, hasMore: false });
  const [stats, setStats] = useState({ totalGain: 0, totalCost: 0, totalFees: 0, count: 0 });
  const [countsByType, setCountsByType] = useState<Record<string, number>>({});
  const [countsByCategory, setCountsByCategory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Grouped positions state
  const [positions, setPositions] = useState<GroupedPosition[]>([]);
  const [positionsSummary, setPositionsSummary] = useState<PositionsResponse['summary'] | null>(null);
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);

  // Ledger breakdown state
  const [ledgerBreakdown, setLedgerBreakdown] = useState<LedgerBreakdownItem[]>([]);
  const [ledgerTypeLabels, setLedgerTypeLabels] = useState<Record<string, string>>({});
  const [ledgerIncomeSummary, setLedgerIncomeSummary] = useState({ count: 0, totalAmount: 0 });
  const [ledgerTotalTransactions, setLedgerTotalTransactions] = useState(0);
  const [expandedLedgerType, setExpandedLedgerType] = useState<string | null>(null);

  // Asset detail modal state
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [selectedAssetType, setSelectedAssetType] = useState<string | null>(null);
  const [assetDetail, setAssetDetail] = useState<AssetDetailResponse | null>(null);
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);

  const loadTransactions = useCallback(async (offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(selectedYear),
        limit: '50',
        offset: String(offset),
      });
      if (filter !== 'all') {
        params.set('type', filter);
      }
      if (search) {
        params.set('asset', search);
      }

      const res = await fetch(`/api/transactions?${params}`);
      if (!res.ok) {
        throw new Error('Failed to load transactions');
      }

      const data: TransactionsResponse = await res.json();
      setTransactions(data.transactions);
      setPagination(data.pagination);
      setStats(data.stats);
      setCountsByType(data.countsByType);
      setCountsByCategory(data.countsByCategory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, filter, search]);

  const loadPositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(selectedYear),
      });
      if (search) {
        params.set('pair', search);
      }

      const res = await fetch(`/api/transactions/positions?${params}`);
      if (!res.ok) {
        throw new Error('Failed to load positions');
      }

      const data: PositionsResponse = await res.json();
      setPositions(data.positions);
      setPositionsSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, search]);

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(selectedYear),
      });

      const res = await fetch(`/api/transactions/ledger?${params}`);
      if (!res.ok) {
        throw new Error('Failed to load ledger breakdown');
      }

      const data: LedgerResponse = await res.json();
      setLedgerBreakdown(data.breakdown);
      setLedgerTypeLabels(data.typeLabels);
      setLedgerIncomeSummary(data.incomeSummary);
      setLedgerTotalTransactions(data.totalTransactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    if (viewMode === 'raw') {
      loadTransactions(0);
    } else if (viewMode === 'grouped') {
      loadPositions();
    } else {
      loadLedger();
    }
  }, [viewMode, loadTransactions, loadPositions, loadLedger]);

  const loadAssetDetail = async (asset: string, type: string) => {
    setSelectedAsset(asset);
    setSelectedAssetType(type);
    setAssetDetailLoading(true);
    try {
      const params = new URLSearchParams({
        asset,
        year: String(selectedYear),
        type,
      });

      const res = await fetch(`/api/transactions/asset?${params}`);
      if (!res.ok) {
        throw new Error('Failed to load asset detail');
      }

      const data: AssetDetailResponse = await res.json();
      setAssetDetail(data);
    } catch (err) {
      console.error('Failed to load asset detail:', err);
      setAssetDetail(null);
    } finally {
      setAssetDetailLoading(false);
    }
  };

  const closeAssetDetail = () => {
    setSelectedAsset(null);
    setSelectedAssetType(null);
    setAssetDetail(null);
  };

  const togglePositionExpand = (id: string) => {
    setExpandedPositionId(expandedPositionId === id ? null : id);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'TRADE': return 'text-info';
      case 'MARGIN_TRADE': return 'text-warning';
      case 'STAKING_REWARD': return 'text-success';
      case 'DEPOSIT': return 'text-success';
      case 'WITHDRAWAL': return 'text-danger';
      default: return 'text-secondary';
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'TAXABLE_INCOME': return 'bg-red/10 text-red';
      case 'NON_TAXABLE': return 'bg-tertiary text-tertiary';
      case 'COST_BASIS_ADJUSTMENT': return 'bg-tertiary text-secondary';
      default: return 'bg-tertiary text-tertiary';
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'TAXABLE_INCOME': return 'Taxable';
      case 'NON_TAXABLE': return 'Non-taxable';
      case 'COST_BASIS_ADJUSTMENT': return 'Cost basis';
      default: return category;
    }
  };

  const handleLoadMore = () => {
    loadTransactions(pagination.offset + pagination.limit);
  };

  const handlePrevPage = () => {
    if (pagination.offset > 0) {
      loadTransactions(Math.max(0, pagination.offset - pagination.limit));
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const formatDuration = (start: Date, end: Date): string => {
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      const hours = diffHours % 24;
      return `${diffDays}d ${hours}h`;
    } else if (diffHours > 0) {
      const mins = diffMins % 60;
      return `${diffHours}h ${mins}m`;
    } else {
      return `${diffMins}m`;
    }
  };

  const totalGains = transactions.filter(t => (t.gain || 0) > 0).length;
  const totalLosses = transactions.filter(t => t.category === 'TAXABLE_INCOME' && (t.gain || 0) < 0).length;
  const totalNonTaxable = countsByCategory['NON_TAXABLE'] || 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-secondary">
            {viewMode === 'raw'
              ? 'All synced transactions from Kraken'
              : viewMode === 'grouped'
              ? 'Margin positions grouped by entry/exit'
              : 'Ledger breakdown by transaction type'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-tertiary rounded-lg p-1">
            <button
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'raw'
                  ? 'bg-primary text-primary'
                  : 'text-tertiary hover:text-secondary'
              }`}
              onClick={() => setViewMode('raw')}
            >
              Raw
            </button>
            <button
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'grouped'
                  ? 'bg-primary text-primary'
                  : 'text-tertiary hover:text-secondary'
              }`}
              onClick={() => setViewMode('grouped')}
            >
              Positions
            </button>
            <button
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'ledger'
                  ? 'bg-primary text-primary'
                  : 'text-tertiary hover:text-secondary'
              }`}
              onClick={() => setViewMode('ledger')}
            >
              Ledger
            </button>
          </div>
          <select
            className="input"
            value={selectedYear}
            onChange={e => setSelectedYear(Number(e.target.value))}
          >
            {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(year => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder={viewMode === 'raw' ? 'Search asset...' : 'Search pair...'}
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {viewMode === 'raw' && (
            <select
              className="input"
              value={filter}
              onChange={e => setFilter(e.target.value as TransactionType)}
            >
              <option value="all">All Types</option>
              <option value="TRADE">Trades</option>
              <option value="MARGIN_TRADE">Margin Trades</option>
              <option value="STAKING_REWARD">Staking Rewards</option>
              <option value="EARN_REWARD">Earn Rewards</option>
              <option value="DEPOSIT">Deposits</option>
              <option value="WITHDRAWAL">Withdrawals</option>
            </select>
          )}
        </div>
      </div>

      {/* Stats - Raw View */}
      {viewMode === 'raw' && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Tooltip content={
            <div>
              <strong>Total Transactions</strong>
              <p className="mt-1">All transactions synced from Kraken for {selectedYear}.</p>
              <p className="mt-2 text-gray-400">Includes trades, deposits, withdrawals, rewards, and more.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-blue-500 transition-colors">
              <div className="text-2xl font-bold">{pagination.total}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Total <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong className="text-green-400">Profitable Transactions</strong>
              <p className="mt-1">Number of transactions that resulted in a gain.</p>
              <p className="mt-2 text-yellow-400">These gains are taxable under Estonian law.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-green-500 transition-colors">
              <div className="text-2xl font-bold text-success">{totalGains}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Gains <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong className="text-red-400">Losing Transactions</strong>
              <p className="mt-1">Number of transactions that resulted in a loss.</p>
              <p className="mt-2 text-yellow-400">Remember: In Estonia, losses CANNOT be deducted from gains.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-red-500 transition-colors">
              <div className="text-2xl font-bold text-danger">{totalLosses}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Losses <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong>Non-Taxable Transactions</strong>
              <p className="mt-1">Transactions with no direct tax impact.</p>
              <p className="mt-2 text-gray-400">Includes deposits, withdrawals, and transfers between wallets.</p>
              <p className="mt-2 text-gray-400">Note: These may still affect your cost basis.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-gray-500 transition-colors">
              <div className="text-2xl font-bold text-secondary">{totalNonTaxable}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Non-Taxable <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Stats - Grouped View */}
      {viewMode === 'grouped' && positionsSummary && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <Tooltip content={
            <div>
              <strong>Total Margin Positions</strong>
              <p className="mt-1">All margin trading positions for {selectedYear}.</p>
              <p className="mt-2 text-gray-400">Multiple fill orders from the same position are grouped together.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-blue-500 transition-colors">
              <div className="text-2xl font-bold">{positionsSummary.totalPositions}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Positions <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong className="text-blue-400">Open Positions</strong>
              <p className="mt-1">Positions that have not yet been closed.</p>
              <p className="mt-2 text-gray-400">No P&L is realized until the position is closed.</p>
              <p className="mt-2 text-yellow-400">Not taxable until closed.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-blue-500 transition-colors">
              <div className="text-2xl font-bold text-info">{positionsSummary.openPositions}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Open <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong className="text-green-400">Profitable Positions</strong>
              <p className="mt-1">Closed positions that resulted in a profit.</p>
              <p className="mt-2 text-yellow-400">These gains are taxable income.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-green-500 transition-colors">
              <div className="text-2xl font-bold text-success">{positionsSummary.profitablePositions}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Profitable <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong className="text-red-400">Losing Positions</strong>
              <p className="mt-1">Closed positions that resulted in a loss.</p>
              <p className="mt-2 text-yellow-400">In Estonia, these losses CANNOT be deducted from gains.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-red-500 transition-colors">
              <div className="text-2xl font-bold text-danger">{positionsSummary.losingPositions}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Losing <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong>Total Realized P&L</strong>
              <p className="mt-1">Sum of all closed position profits and losses.</p>
              <p className="mt-2 text-gray-400">This is the net P&L from Kraken&apos;s official calculations.</p>
              <p className="mt-2 text-yellow-400">For tax: Only gains are taxed, losses not deductible.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-blue-500 transition-colors">
              <div className={`text-2xl font-bold ${positionsSummary.totalRealizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                {formatEuroAmount(positionsSummary.totalRealizedPnL)}
              </div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Total P&L <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Stats - Ledger View */}
      {viewMode === 'ledger' && !loading && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Tooltip content={
            <div>
              <strong>Total Ledger Entries</strong>
              <p className="mt-1">All ledger entries from Kraken for {selectedYear}.</p>
              <p className="mt-2 text-gray-400">Each entry is a balance change on your account.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-blue-500 transition-colors">
              <div className="text-2xl font-bold">{ledgerTotalTransactions}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Total Entries <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong>Transaction Categories</strong>
              <p className="mt-1">Different types of transactions in your ledger.</p>
              <p className="mt-2 text-gray-400">E.g., Trades, Deposits, Withdrawals, Staking Rewards, Margin Trades.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-blue-500 transition-colors">
              <div className="text-2xl font-bold text-info">{ledgerBreakdown.length}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Categories <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
          <Tooltip content={
            <div>
              <strong className="text-green-400">Income Entries</strong>
              <p className="mt-1">Transactions that represent taxable income.</p>
              <p className="mt-2 text-gray-400">Includes staking rewards, Kraken Earn interest, airdrops, etc.</p>
              <p className="mt-2 text-yellow-400">These are taxed at fair market value when received.</p>
            </div>
          } position="bottom">
            <div className="card p-4 text-center cursor-help hover:border-green-500 transition-colors">
              <div className="text-2xl font-bold text-success">{ledgerIncomeSummary.count}</div>
              <div className="text-xs text-tertiary flex items-center justify-center">
                Income Entries <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
              </div>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">⏳</div>
          <div className="text-secondary">
            {viewMode === 'raw' ? 'Loading transactions...' : viewMode === 'grouped' ? 'Loading positions...' : 'Loading ledger...'}
          </div>
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

      {/* No Data State - Raw View */}
      {viewMode === 'raw' && !loading && transactions.length === 0 && !error && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">📭</div>
          <h3 className="text-lg font-semibold mb-2">No Transactions Found</h3>
          <p className="text-secondary mb-4">
            {filter !== 'all' || search
              ? 'Try adjusting your filters or search.'
              : 'Import your trading data from Kraken to see your transactions.'}
          </p>
          {filter === 'all' && !search && (
            <Link href="/tax/import" className="btn btn-primary">
              Import Data
            </Link>
          )}
        </div>
      )}

      {/* No Data State - Grouped View */}
      {viewMode === 'grouped' && !loading && positions.length === 0 && !error && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">📭</div>
          <h3 className="text-lg font-semibold mb-2">No Margin Positions Found</h3>
          <p className="text-secondary mb-4">
            {search
              ? 'Try adjusting your search.'
              : 'Import your margin trading data from Kraken to see grouped positions.'}
          </p>
          {!search && (
            <Link href="/tax/import" className="btn btn-primary">
              Import Data
            </Link>
          )}
        </div>
      )}

      {/* Grouped Positions Table */}
      {viewMode === 'grouped' && !loading && positions.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-tertiary">
                <tr>
                  <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Entry</th>
                  <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Pair</th>
                  <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Direction</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Volume</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Avg Entry</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Avg Exit</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Fees</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">P&L</th>
                  <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const entryTime = new Date(pos.entryTime);
                  const exitTime = pos.exitTime ? new Date(pos.exitTime) : null;
                  const isExpanded = expandedPositionId === pos.id;
                  return (
                    <React.Fragment key={pos.id}>
                      <tr
                        className={`border-b border-primary hover:bg-tertiary/50 cursor-pointer ${isExpanded ? 'bg-tertiary/30' : ''}`}
                        onClick={() => togglePositionExpand(pos.id)}
                      >
                        <td className="px-4 py-3 text-sm text-secondary">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                            <div>
                              {formatEstonianDate(entryTime)}
                              <div className="text-xs text-tertiary">
                                {entryTime.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium mono">{pos.pair}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded font-semibold ${
                            pos.direction === 'LONG' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
                          }`}>
                            {pos.direction}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right mono">
                          {pos.totalEntryVolume.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-4 py-3 text-sm text-right mono">{formatEuroAmount(pos.avgEntryPrice)}</td>
                        <td className="px-4 py-3 text-sm text-right mono text-secondary">
                          {pos.avgExitPrice ? formatEuroAmount(pos.avgExitPrice) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right mono text-tertiary">{formatEuroAmount(pos.totalFees)}</td>
                        <td className={`px-4 py-3 text-sm text-right mono font-semibold ${
                          pos.realizedPnL === null ? '' : pos.realizedPnL >= 0 ? 'text-success' : 'text-danger'
                        }`}>
                          {pos.realizedPnL !== null ? (
                            <>{pos.realizedPnL >= 0 ? '+' : ''}{formatEuroAmount(pos.realizedPnL)}</>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${
                            pos.status === 'CLOSED' ? 'badge-neutral' :
                            pos.status === 'OPEN' ? 'badge-bullish' : 'badge-bearish'
                          }`}>
                            {pos.status}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-tertiary/20">
                          <td colSpan={9} className="px-4 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              {/* Entry Details */}
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Entry Time</div>
                                <div className="mono text-xs">
                                  {entryTime.toLocaleString('et-EE', {
                                    year: 'numeric', month: '2-digit', day: '2-digit',
                                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                                  })}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Entry Trades</div>
                                <div className="mono">{pos.entryTrades} order{pos.entryTrades !== 1 ? 's' : ''}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Total Entry Cost</div>
                                <div className="mono">{formatEuroAmount(pos.totalEntryCost)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Avg Entry Price</div>
                                <div className="mono">{formatEuroAmount(pos.avgEntryPrice)}</div>
                              </div>

                              {/* Exit Details */}
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Exit Time</div>
                                <div className="mono text-xs">
                                  {exitTime ? exitTime.toLocaleString('et-EE', {
                                    year: 'numeric', month: '2-digit', day: '2-digit',
                                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                                  }) : '-'}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Exit Trades</div>
                                <div className="mono">{pos.exitTrades} order{pos.exitTrades !== 1 ? 's' : ''}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Total Exit Proceeds</div>
                                <div className="mono">{formatEuroAmount(pos.totalExitProceeds)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Avg Exit Price</div>
                                <div className="mono">{pos.avgExitPrice ? formatEuroAmount(pos.avgExitPrice) : '-'}</div>
                              </div>

                              {/* Fees Breakdown */}
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Entry Fees</div>
                                <div className="mono text-tertiary">{formatEuroAmount(pos.entryFees)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Exit Fees</div>
                                <div className="mono text-tertiary">{formatEuroAmount(pos.exitFees)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Margin/Rollover Fees</div>
                                <div className="mono text-tertiary">{formatEuroAmount(pos.marginFees)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Total Fees</div>
                                <div className="mono font-semibold">{formatEuroAmount(pos.totalFees)}</div>
                              </div>

                              {/* P&L */}
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Realized P&L</div>
                                <div className={`mono font-semibold ${
                                  pos.realizedPnL === null ? '' : pos.realizedPnL >= 0 ? 'text-success' : 'text-danger'
                                }`}>
                                  {pos.realizedPnL !== null ? (
                                    <>{pos.realizedPnL >= 0 ? '+' : ''}{formatEuroAmount(pos.realizedPnL)}</>
                                  ) : 'Open Position'}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">P&L Source</div>
                                <div className={`text-xs px-2 py-1 rounded inline-block ${
                                  pos.pnlSource === 'kraken' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
                                }`}>
                                  {pos.pnlSource === 'kraken' ? 'Kraken (Verified)' : 'Calculated'}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Position ID</div>
                                <div className="mono text-xs">{pos.positionTxId || '-'}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Opening Trade</div>
                                <div className="mono text-xs">{pos.openingTradeId || '-'}</div>
                              </div>
                              <div>
                                <div className="text-xs text-tertiary uppercase mb-1">Closing Trade</div>
                                <div className="mono text-xs">{pos.closingTradeId || '-'}</div>
                              </div>
                            </div>

                            {/* Duration */}
                            {exitTime && (
                              <div className="mt-4 pt-4 border-t border-primary">
                                <div className="flex items-center gap-4 text-sm">
                                  <div>
                                    <span className="text-tertiary">Position Duration:</span>{' '}
                                    <span className="mono">
                                      {formatDuration(entryTime, exitTime)}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-tertiary">Raw Transactions:</span>{' '}
                                    <span className="mono">{pos.transactionIds.length}</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Tax Note for Losses */}
                            {pos.realizedPnL !== null && pos.realizedPnL < 0 && (
                              <div className="mt-4 p-3 bg-warning/10 border border-warning/30 rounded text-sm">
                                <span className="text-warning font-medium">Note:</span>{' '}
                                <span className="text-secondary">
                                  This loss of {formatEuroAmount(Math.abs(pos.realizedPnL))} is tracked for your records but is NOT deductible under Estonian tax law.
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Data State - Ledger View */}
      {viewMode === 'ledger' && !loading && ledgerBreakdown.length === 0 && !error && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">📭</div>
          <h3 className="text-lg font-semibold mb-2">No Ledger Data Found</h3>
          <p className="text-secondary mb-4">
            Import your data from Kraken to see the ledger breakdown.
          </p>
          <Link href="/tax/import" className="btn btn-primary">
            Import Data
          </Link>
        </div>
      )}

      {/* Ledger Breakdown Table */}
      {viewMode === 'ledger' && !loading && ledgerBreakdown.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-tertiary">
                <tr>
                  <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Type</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Count</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Total Amount</th>
                  <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Total Fees</th>
                  <th className="text-center text-xs text-tertiary uppercase px-4 py-3">Assets</th>
                  <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Tax Status</th>
                </tr>
              </thead>
              <tbody>
                {ledgerBreakdown.map(item => {
                  const isExpanded = expandedLedgerType === item.type;
                  const taxableTypes = ['STAKING_REWARD', 'EARN_REWARD', 'CREDIT', 'AIRDROP', 'FORK', 'MARGIN_SETTLEMENT'];
                  const isTaxable = taxableTypes.includes(item.type);
                  const assetList = Object.keys(item.byAsset);
                  return (
                    <React.Fragment key={item.type}>
                      <tr
                        className={`border-b border-primary hover:bg-tertiary/50 cursor-pointer ${isExpanded ? 'bg-tertiary/30' : ''}`}
                        onClick={() => setExpandedLedgerType(isExpanded ? null : item.type)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                            <div>
                              <div className="font-medium">{ledgerTypeLabels[item.type] || item.type}</div>
                              <div className="text-xs text-tertiary mono">{item.type}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-right mono font-semibold">{item.count}</td>
                        <td className={`px-4 py-3 text-sm text-right mono ${item.totalAmount >= 0 ? 'text-success' : 'text-danger'}`}>
                          {item.totalAmount >= 0 ? '+' : ''}{item.totalAmount.toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right mono text-tertiary">
                          {item.totalFees > 0 ? item.totalFees.toFixed(4) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-center">
                          <span className="text-xs text-tertiary">{assetList.length} asset{assetList.length !== 1 ? 's' : ''}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${isTaxable ? 'bg-warning/20 text-warning' : 'badge-neutral'}`}>
                            {isTaxable ? 'Taxable' : 'Non-Taxable'}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-tertiary/20">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="text-xs text-tertiary uppercase mb-2">Breakdown by Asset (click for details)</div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              {assetList.map(asset => {
                                const assetData = item.byAsset[asset];
                                return (
                                  <div
                                    key={asset}
                                    className="bg-primary rounded p-3 cursor-pointer hover:bg-blue-900/30 hover:border-blue-500 border border-transparent transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      loadAssetDetail(asset, item.type);
                                    }}
                                  >
                                    <div className="font-medium mono mb-1 flex items-center justify-between">
                                      {asset}
                                      <span className="text-blue-500 text-xs">→</span>
                                    </div>
                                    <div className="text-xs text-tertiary">Count: <span className="text-secondary">{assetData.count}</span></div>
                                    <div className={`text-xs ${assetData.amount >= 0 ? 'text-success' : 'text-danger'}`}>
                                      Amount: {assetData.amount >= 0 ? '+' : ''}{assetData.amount.toFixed(6)}
                                    </div>
                                    {assetData.fees > 0 && (
                                      <div className="text-xs text-tertiary">
                                        Fees: {assetData.fees.toFixed(6)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Tax Info for Taxable Types */}
                            {isTaxable && item.totalAmount > 0 && (
                              <div className="mt-4 p-3 bg-warning/10 border border-warning/30 rounded text-sm">
                                <span className="text-warning font-medium">Tax Note:</span>{' '}
                                <span className="text-secondary">
                                  This income of {item.totalAmount.toFixed(4)} units is taxable under Estonian tax law and should be reported on your tax declaration.
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactions Table - Raw View */}
      {viewMode === 'raw' && !loading && transactions.length > 0 && (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-tertiary">
                  <tr>
                    <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Date</th>
                    <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Type</th>
                    <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Asset</th>
                    <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Amount</th>
                    <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Price</th>
                    <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Cost/Proceeds</th>
                    <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Fee</th>
                    <th className="text-right text-xs text-tertiary uppercase px-4 py-3">Gain/Loss</th>
                    <th className="text-left text-xs text-tertiary uppercase px-4 py-3">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => {
                    const timestamp = new Date(tx.timestamp);
                    const isExpanded = expandedId === tx.id;
                    return (
                      <React.Fragment key={tx.id}>
                        <tr
                          className={`border-b border-primary hover:bg-tertiary/50 cursor-pointer ${isExpanded ? 'bg-tertiary/30' : ''}`}
                          onClick={() => toggleExpand(tx.id)}
                        >
                          <td className="px-4 py-3 text-sm text-secondary">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                              <div>
                                {formatEstonianDate(timestamp)}
                                <div className="text-xs text-tertiary">
                                  {timestamp.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className={`px-4 py-3 text-sm font-medium ${getTypeColor(tx.type)}`}>
                            {tx.type.replace('_', ' ')}
                            {tx.side && (
                              <span className={`ml-2 text-xs ${tx.side === 'buy' ? 'text-success' : 'text-danger'}`}>
                                ({tx.side.toUpperCase()})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium mono">
                            {tx.asset}
                            {tx.pair && <span className="text-tertiary text-xs ml-1">/ {tx.pair.replace(tx.asset, '')}</span>}
                          </td>
                          <td className={`px-4 py-3 text-sm text-right mono ${tx.amount >= 0 ? 'text-success' : 'text-danger'}`}>
                            {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                          </td>
                          <td className="px-4 py-3 text-sm text-right mono text-secondary">
                            {tx.price ? formatEuroAmount(tx.price) : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right mono">
                            {tx.cost ? formatEuroAmount(tx.cost) : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right mono text-tertiary">
                            {tx.fee ? formatEuroAmount(tx.fee) : '-'}
                          </td>
                          <td className={`px-4 py-3 text-sm text-right mono font-semibold ${
                            tx.gain === null ? '' : tx.gain >= 0 ? 'text-success' : 'text-danger'
                          }`}>
                            {tx.gain !== null ? (
                              <>
                                {tx.gain >= 0 ? '+' : ''}{formatEuroAmount(tx.gain)}
                              </>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded ${getCategoryBadge(tx.category)}`}>
                              {getCategoryLabel(tx.category)}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${tx.id}-details`} className="bg-tertiary/20">
                            <td colSpan={9} className="px-4 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                {/* Row 1: IDs */}
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Transaction ID</div>
                                  <div className="mono text-xs break-all">{tx.id}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Kraken Ref ID</div>
                                  <div className="mono text-xs break-all">{tx.krakenRefId || '-'}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Full Timestamp</div>
                                  <div className="mono text-xs">
                                    {timestamp.toLocaleString('et-EE', {
                                      year: 'numeric',
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit'
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Trading Pair</div>
                                  <div className="mono">{tx.pair || '-'}</div>
                                </div>

                                {/* Row 2: Financial Details */}
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Amount</div>
                                  <div className={`mono font-semibold ${tx.amount >= 0 ? 'text-success' : 'text-danger'}`}>
                                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {tx.asset}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Price per Unit</div>
                                  <div className="mono">{tx.price ? formatEuroAmount(tx.price) : '-'}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Total Cost</div>
                                  <div className="mono">{tx.cost ? formatEuroAmount(tx.cost) : '-'}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Fee</div>
                                  <div className="mono text-tertiary">{tx.fee ? formatEuroAmount(tx.fee) : '-'}</div>
                                </div>

                                {/* Row 3: Tax Details */}
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Cost Basis (FIFO)</div>
                                  <div className="mono">{tx.costBasis !== null ? formatEuroAmount(tx.costBasis) : '-'}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Proceeds</div>
                                  <div className="mono">{tx.proceeds !== null ? formatEuroAmount(tx.proceeds) : '-'}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Gain/Loss</div>
                                  <div className={`mono font-semibold ${
                                    tx.gain === null ? '' : tx.gain >= 0 ? 'text-success' : 'text-danger'
                                  }`}>
                                    {tx.gain !== null ? (
                                      <>{tx.gain >= 0 ? '+' : ''}{formatEuroAmount(tx.gain)}</>
                                    ) : '-'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs text-tertiary uppercase mb-1">Tax Category</div>
                                  <div>
                                    <span className={`text-xs px-2 py-1 rounded ${getCategoryBadge(tx.category)}`}>
                                      {getCategoryLabel(tx.category)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Tax Events */}
                              {tx.taxEvents && tx.taxEvents.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-primary">
                                  <div className="text-xs text-tertiary uppercase mb-2">Tax Events</div>
                                  <div className="space-y-2">
                                    {tx.taxEvents.map(event => (
                                      <div key={event.id} className="flex items-center gap-4 text-sm bg-primary rounded p-2">
                                        <div>
                                          <span className="text-tertiary">Gain:</span>{' '}
                                          <span className={`mono font-semibold ${event.gain >= 0 ? 'text-success' : 'text-danger'}`}>
                                            {event.gain >= 0 ? '+' : ''}{formatEuroAmount(event.gain)}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-tertiary">Taxable:</span>{' '}
                                          <span className="mono font-semibold text-warning">
                                            {formatEuroAmount(event.taxableAmount)}
                                          </span>
                                        </div>
                                        <div className="text-xs text-tertiary mono">{event.id}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Estonia Tax Note */}
                              {tx.gain !== null && tx.gain < 0 && (
                                <div className="mt-4 p-3 bg-warning/10 border border-warning/30 rounded text-sm">
                                  <span className="text-warning font-medium">Note:</span>{' '}
                                  <span className="text-secondary">
                                    This loss of {formatEuroAmount(Math.abs(tx.gain))} is tracked for your records but is NOT deductible under Estonian tax law.
                                  </span>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-secondary">
              Showing {pagination.offset + 1} - {Math.min(pagination.offset + transactions.length, pagination.total)} of {pagination.total}
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-secondary"
                onClick={handlePrevPage}
                disabled={pagination.offset === 0}
              >
                ← Previous
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleLoadMore}
                disabled={!pagination.hasMore}
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}

      {/* Summary Footer - only show in raw view */}
      {viewMode === 'raw' && !loading && transactions.length > 0 && (
        <div className="mt-6 card p-4">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <Tooltip content={
              <div>
                <strong>Total Trading Volume</strong>
                <p className="mt-1">Sum of all trade costs/proceeds for the displayed transactions.</p>
                <p className="mt-2 text-gray-400">This reflects the total EUR value you traded.</p>
              </div>
            } position="top">
              <div className="cursor-help">
                <div className="text-tertiary flex items-center">
                  Total Volume <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                </div>
                <div className="font-semibold mono">{formatEuroAmount(stats.totalCost)}</div>
              </div>
            </Tooltip>
            <Tooltip content={
              <div>
                <strong>Total Fees Paid</strong>
                <p className="mt-1">Sum of all trading fees for the displayed transactions.</p>
                <p className="mt-2 text-gray-400">Fees are automatically included in your cost basis calculations.</p>
              </div>
            } position="top">
              <div className="cursor-help">
                <div className="text-tertiary flex items-center">
                  Total Fees <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                </div>
                <div className="font-semibold mono">{formatEuroAmount(stats.totalFees)}</div>
              </div>
            </Tooltip>
            <Tooltip content={
              <div>
                <strong>Net Gain/Loss</strong>
                <p className="mt-1">Sum of gains minus losses for displayed transactions.</p>
                <p className="mt-2 text-yellow-400">Warning: This raw sum may not match your tax liability!</p>
                <p className="mt-2 text-gray-400">For margin trades, this sums individual fills which can over-count. Check Tax Overview for accurate numbers.</p>
              </div>
            } position="top">
              <div className="cursor-help">
                <div className="text-tertiary flex items-center">
                  Net Gain/Loss <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                </div>
                <div className={`font-semibold mono ${stats.totalGain >= 0 ? 'text-success' : 'text-danger'}`}>
                  {stats.totalGain >= 0 ? '+' : ''}{formatEuroAmount(stats.totalGain)}
                </div>
              </div>
            </Tooltip>
            <Tooltip content={
              <div>
                <strong>Transactions by Type</strong>
                <p className="mt-1">Breakdown of transactions by category.</p>
              </div>
            } position="top">
              <div className="cursor-help">
                <div className="text-tertiary flex items-center">
                  By Type <span className="ml-1 text-blue-500 text-xs">ⓘ</span>
                </div>
                <div className="text-xs">
                  {Object.entries(countsByType).map(([type, count]) => (
                    <span key={type} className="mr-2">
                      {type.replace('_', ' ')}: {count}
                    </span>
                  ))}
                </div>
              </div>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Asset Detail Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeAssetDetail}>
          <div className="bg-secondary rounded-lg max-w-3xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-secondary border-b border-primary p-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold mono">{selectedAsset}</h2>
                <p className="text-sm text-tertiary">
                  {ledgerTypeLabels[selectedAssetType || ''] || selectedAssetType} • {selectedYear}
                </p>
              </div>
              <button
                onClick={closeAssetDetail}
                className="p-2 hover:bg-tertiary rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>

            {assetDetailLoading && (
              <div className="p-8 text-center">
                <div className="text-4xl mb-4">⏳</div>
                <div className="text-secondary">Loading asset details...</div>
              </div>
            )}

            {!assetDetailLoading && assetDetail && (
              <div className="p-4 space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Tooltip content={
                    <div>
                      <strong>Transaction Count</strong>
                      <p className="mt-1">Total number of transactions for this asset in {selectedYear}.</p>
                    </div>
                  } position="bottom">
                    <div className="bg-primary rounded-lg p-3 text-center cursor-help hover:bg-tertiary transition-colors">
                      <div className="text-lg font-bold">{assetDetail.summary.transactionCount}</div>
                      <div className="text-xs text-tertiary flex items-center justify-center">
                        Transactions <span className="ml-1 text-blue-500">ⓘ</span>
                      </div>
                    </div>
                  </Tooltip>
                  <Tooltip content={
                    <div>
                      <strong>Net Balance Change</strong>
                      <p className="mt-1">The net change in your holdings of this asset.</p>
                      <p className="mt-2 text-gray-400">Calculated as: Total In - Total Out</p>
                      <p className="mt-2 text-gray-400">Positive = you accumulated more, Negative = you reduced holdings.</p>
                    </div>
                  } position="bottom">
                    <div className="bg-primary rounded-lg p-3 text-center cursor-help hover:bg-tertiary transition-colors">
                      <div className={`text-lg font-bold mono ${assetDetail.summary.netBalance >= 0 ? 'text-success' : 'text-danger'}`}>
                        {assetDetail.summary.netBalance >= 0 ? '+' : ''}{assetDetail.summary.netBalance.toFixed(6)}
                      </div>
                      <div className="text-xs text-tertiary flex items-center justify-center">
                        Net Balance <span className="ml-1 text-blue-500">ⓘ</span>
                      </div>
                    </div>
                  </Tooltip>
                  <Tooltip content={
                    <div>
                      <strong className="text-green-400">Total In</strong>
                      <p className="mt-1">Total amount of this asset received.</p>
                      <p className="mt-2 text-gray-400">Includes: buys, deposits, rewards, transfers in.</p>
                    </div>
                  } position="bottom">
                    <div className="bg-primary rounded-lg p-3 text-center cursor-help hover:bg-tertiary transition-colors">
                      <div className="text-lg font-bold text-success mono">+{assetDetail.summary.totalIn.toFixed(6)}</div>
                      <div className="text-xs text-tertiary flex items-center justify-center">
                        Total In <span className="ml-1 text-blue-500">ⓘ</span>
                      </div>
                    </div>
                  </Tooltip>
                  <Tooltip content={
                    <div>
                      <strong className="text-red-400">Total Out</strong>
                      <p className="mt-1">Total amount of this asset sent out.</p>
                      <p className="mt-2 text-gray-400">Includes: sells, withdrawals, fees, transfers out.</p>
                    </div>
                  } position="bottom">
                    <div className="bg-primary rounded-lg p-3 text-center cursor-help hover:bg-tertiary transition-colors">
                      <div className="text-lg font-bold text-danger mono">-{assetDetail.summary.totalOut.toFixed(6)}</div>
                      <div className="text-xs text-tertiary flex items-center justify-center">
                        Total Out <span className="ml-1 text-blue-500">ⓘ</span>
                      </div>
                    </div>
                  </Tooltip>
                </div>

                {/* P&L Summary (if applicable) */}
                {(assetDetail.summary.totalGain > 0 || assetDetail.summary.totalLoss > 0) && (
                  <div className="bg-tertiary rounded-lg p-4">
                    <h3 className="font-semibold mb-3 flex items-center">
                      P&L Summary
                      <HelpIcon
                        tooltip={
                          <div>
                            <strong>P&L Summary for {selectedAsset}</strong>
                            <p className="mt-1">Profit and Loss from trading this asset.</p>
                            <p className="mt-2 text-gray-400">For margin trades, P&L is from Kraken&apos;s official calculations, grouped by position to avoid double-counting.</p>
                            <p className="mt-2 text-yellow-400">In Estonia: Only gains are taxed, losses are NOT deductible.</p>
                          </div>
                        }
                        position="right"
                      />
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      <Tooltip content={
                        <div>
                          <strong className="text-green-400">Total Gains</strong>
                          <p className="mt-1">Sum of all profitable trades for this asset.</p>
                          <p className="mt-2 text-yellow-400">This amount is taxable income in Estonia.</p>
                        </div>
                      } position="bottom">
                        <div className="cursor-help">
                          <div className="text-xs text-tertiary flex items-center">
                            Gains <span className="ml-1 text-blue-500">ⓘ</span>
                          </div>
                          <div className="font-bold text-success mono">{formatEuroAmount(assetDetail.summary.totalGain)}</div>
                        </div>
                      </Tooltip>
                      <Tooltip content={
                        <div>
                          <strong className="text-red-400">Total Losses</strong>
                          <p className="mt-1">Sum of all losing trades for this asset.</p>
                          <p className="mt-2 text-yellow-400">In Estonia, losses CANNOT be deducted from gains.</p>
                        </div>
                      } position="bottom">
                        <div className="cursor-help">
                          <div className="text-xs text-tertiary flex items-center">
                            Losses <span className="ml-1 text-blue-500">ⓘ</span>
                          </div>
                          <div className="font-bold text-danger mono">{formatEuroAmount(assetDetail.summary.totalLoss)}</div>
                        </div>
                      </Tooltip>
                      <Tooltip content={
                        <div>
                          <strong>Net P&L</strong>
                          <p className="mt-1">Gains minus Losses = Net Profit/Loss</p>
                          <p className="mt-2 text-yellow-400">Note: For tax, you pay on GAINS only. This net figure is for informational purposes.</p>
                        </div>
                      } position="bottom">
                        <div className="cursor-help">
                          <div className="text-xs text-tertiary flex items-center">
                            Net P&L <span className="ml-1 text-blue-500">ⓘ</span>
                          </div>
                          <div className={`font-bold mono ${assetDetail.summary.netPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                            {assetDetail.summary.netPnL >= 0 ? '+' : ''}{formatEuroAmount(assetDetail.summary.netPnL)}
                          </div>
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                )}

                {/* Breakdown by Type */}
                {assetDetail.byType.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">Breakdown by Transaction Type</h3>
                    <div className="space-y-2">
                      {assetDetail.byType.map(typeData => (
                        <div key={typeData.type} className="flex justify-between items-center bg-primary rounded p-3">
                          <div>
                            <div className="font-medium">{typeData.label}</div>
                            <div className="text-xs text-tertiary">{typeData.count} transactions</div>
                          </div>
                          <div className="text-right">
                            <div className={`mono ${typeData.totalAmount >= 0 ? 'text-success' : 'text-danger'}`}>
                              {typeData.totalAmount >= 0 ? '+' : ''}{typeData.totalAmount.toFixed(6)}
                            </div>
                            {typeData.totalFees > 0 && (
                              <div className="text-xs text-tertiary mono">
                                Fees: {typeData.totalFees.toFixed(6)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Transactions */}
                {assetDetail.recentTransactions.length > 0 && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-semibold">Recent Transactions</h3>
                      <Link
                        href={`/tax/transactions?asset=${selectedAsset}&year=${selectedYear}`}
                        className="text-sm text-info hover:underline"
                        onClick={closeAssetDetail}
                      >
                        View all →
                      </Link>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-auto">
                      {assetDetail.recentTransactions.map(tx => (
                        <div key={tx.id} className="flex justify-between items-center bg-primary rounded p-2 text-sm">
                          <div>
                            <div className="text-xs text-tertiary">
                              {formatEstonianDate(new Date(tx.timestamp))}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-tertiary">{tx.type.replace(/_/g, ' ')}</span>
                              {tx.side && (
                                <span className={`text-xs ${tx.side === 'buy' ? 'text-success' : 'text-danger'}`}>
                                  {tx.side.toUpperCase()}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`mono ${tx.amount >= 0 ? 'text-success' : 'text-danger'}`}>
                              {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(6)}
                            </div>
                            {tx.gain !== null && (
                              <div className={`text-xs mono ${tx.gain >= 0 ? 'text-success' : 'text-danger'}`}>
                                P&L: {tx.gain >= 0 ? '+' : ''}{formatEuroAmount(tx.gain)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

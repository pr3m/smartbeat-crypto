'use client';

import { useState, useEffect, useMemo } from 'react';

interface ClosedPosition {
  id: string;
  pair: string;
  side: 'long' | 'short';
  volume: number;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  realizedPnl: number;
  totalFees: number;
  openedAt: string;
  closedAt: string;
  duration: number; // hours
  outcome: 'win' | 'loss' | 'breakeven';
}

interface HistoryStats {
  totalTrades: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgDuration: number;
  totalFees: number;
}

interface HistoryTabProps {
  testMode: boolean;
}

type FilterType = 'all' | 'win' | 'loss' | 'long' | 'short';
type TimeRange = 'all' | 'today' | 'week' | 'month' | 'year';

export function HistoryTab({ testMode }: HistoryTabProps) {
  const [positions, setPositions] = useState<ClosedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);

      try {
        const endpoint = testMode
          ? '/api/simulated/positions/history'
          : '/api/trading/history';

        const res = await fetch(endpoint);
        if (!res.ok) {
          throw new Error('Failed to fetch trade history');
        }

        const data = await res.json();
        setPositions(data.positions || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [testMode]);

  // Filter by time range
  const timeFilteredPositions = useMemo(() => {
    if (timeRange === 'all') return positions;

    const now = new Date();
    let cutoff: Date;

    switch (timeRange) {
      case 'today':
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        cutoff = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        return positions;
    }

    return positions.filter(p => new Date(p.closedAt) >= cutoff);
  }, [positions, timeRange]);

  // Apply outcome/side filter
  const filteredPositions = useMemo(() => {
    return timeFilteredPositions.filter(p => {
      switch (filter) {
        case 'win':
          return p.outcome === 'win';
        case 'loss':
          return p.outcome === 'loss';
        case 'long':
          return p.side === 'long';
        case 'short':
          return p.side === 'short';
        default:
          return true;
      }
    });
  }, [timeFilteredPositions, filter]);

  // Calculate stats
  const stats = useMemo((): HistoryStats => {
    const trades = filteredPositions;
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        totalPnl: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        avgDuration: 0,
        totalFees: 0,
      };
    }

    const wins = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');
    const breakevens = trades.filter(t => t.outcome === 'breakeven');

    const totalPnl = trades.reduce((sum, t) => sum + t.realizedPnl, 0);
    const totalFees = trades.reduce((sum, t) => sum + t.totalFees, 0);
    const totalDuration = trades.reduce((sum, t) => sum + t.duration, 0);

    return {
      totalTrades: trades.length,
      totalPnl,
      winCount: wins.length,
      lossCount: losses.length,
      breakevenCount: breakevens.length,
      winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      avgWin: wins.length > 0 ? wins.reduce((sum, t) => sum + t.realizedPnl, 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((sum, t) => sum + t.realizedPnl, 0) / losses.length : 0,
      largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.realizedPnl)) : 0,
      largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.realizedPnl)) : 0,
      avgDuration: trades.length > 0 ? totalDuration / trades.length : 0,
      totalFees,
    };
  }, [filteredPositions]);

  const formatDuration = (hours: number): string => {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours.toFixed(0)}h`;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 text-center">
        <div className="text-red-400 mb-2">Error loading history</div>
        <p className="text-secondary text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {testMode ? '🧪 Paper Trade History' : '📜 Trade History'}
          </h2>
          <p className="text-sm text-secondary">
            {filteredPositions.length} closed position{filteredPositions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
          testMode
            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
        }`}>
          {testMode ? 'Paper Trading' : 'Live Trades'}
        </div>
      </div>

      {/* Time Range Filter */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'today', 'week', 'month', 'year'] as TimeRange[]).map(range => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              timeRange === range
                ? 'bg-blue-500 text-white'
                : 'bg-tertiary text-secondary hover:bg-primary'
            }`}
          >
            {range === 'all' && 'All Time'}
            {range === 'today' && 'Today'}
            {range === 'week' && 'This Week'}
            {range === 'month' && 'This Month'}
            {range === 'year' && 'This Year'}
          </button>
        ))}
      </div>

      {/* Outcome/Side Filter */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'win', 'loss', 'long', 'short'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? 'bg-purple-500 text-white'
                : 'bg-tertiary text-secondary hover:bg-primary'
            }`}
          >
            {f === 'all' && 'All'}
            {f === 'win' && '+ Wins'}
            {f === 'loss' && '- Losses'}
            {f === 'long' && '+ Long'}
            {f === 'short' && '- Short'}
          </button>
        ))}
      </div>

      {/* Stats Summary */}
      {filteredPositions.length > 0 && (
        <div className="card p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xs text-tertiary uppercase">Total P&L</div>
              <div className={`text-xl font-bold ${stats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {stats.totalPnl >= 0 ? '+' : ''}{stats.totalPnl.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary uppercase">Win Rate</div>
              <div className={`text-xl font-bold ${stats.winRate >= 50 ? 'text-green-500' : 'text-yellow-500'}`}>
                {stats.winRate.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary uppercase">Trades</div>
              <div className="text-xl font-bold">
                <span className="text-green-500">{stats.winCount}</span>
                <span className="text-tertiary">/</span>
                <span className="text-red-500">{stats.lossCount}</span>
                {stats.breakevenCount > 0 && (
                  <>
                    <span className="text-tertiary">/</span>
                    <span className="text-yellow-500">{stats.breakevenCount}</span>
                  </>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary uppercase">Total Fees</div>
              <div className="text-xl font-bold text-secondary">
                {stats.totalFees.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Detailed stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-primary text-center">
            <div>
              <div className="text-xs text-tertiary">Avg Win</div>
              <div className="text-sm font-medium text-green-500">
                +{stats.avgWin.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary">Avg Loss</div>
              <div className="text-sm font-medium text-red-500">
                {stats.avgLoss.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary">Largest Win</div>
              <div className="text-sm font-medium text-green-500">
                +{stats.largestWin.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary">Largest Loss</div>
              <div className="text-sm font-medium text-red-500">
                {stats.largestLoss.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-primary text-center">
            <div className="text-xs text-tertiary">Avg Duration</div>
            <div className="text-sm font-medium">
              {formatDuration(stats.avgDuration)}
            </div>
          </div>
        </div>
      )}

      {/* Trades List */}
      {filteredPositions.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">📭</div>
          <h3 className="text-lg font-semibold mb-1">No Trade History</h3>
          <p className="text-secondary text-sm">
            {filter === 'all' && timeRange === 'all'
              ? 'Complete some trades to see your history here.'
              : 'No trades match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPositions.map(position => (
            <div
              key={position.id}
              className={`card p-4 border-l-4 ${
                position.outcome === 'win'
                  ? 'border-l-green-500'
                  : position.outcome === 'loss'
                  ? 'border-l-red-500'
                  : 'border-l-yellow-500'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    position.side === 'long'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {position.side.toUpperCase()} {position.leverage}x
                  </span>
                  <span className="text-sm font-medium">{position.pair}</span>
                </div>
                <div className={`text-lg font-bold ${
                  position.realizedPnl >= 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {position.realizedPnl >= 0 ? '+' : ''}{position.realizedPnl.toFixed(2)}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-tertiary">Entry: </span>
                  <span className="mono">{position.entryPrice.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-tertiary">Exit: </span>
                  <span className="mono">{position.exitPrice.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-tertiary">Size: </span>
                  <span className="mono">{position.volume.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-tertiary">Duration: </span>
                  <span>{formatDuration(position.duration)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2 text-xs text-tertiary">
                <span>Closed: {new Date(position.closedAt).toLocaleString()}</span>
                <span>Fees: {position.totalFees.toFixed(4)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

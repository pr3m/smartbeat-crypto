'use client';

import { useState, useEffect, useCallback } from 'react';

interface ClosedPosition {
  id: string;
  pair: string;
  side: 'long' | 'short';
  volume: number;
  avgEntryPrice: number;
  leverage: number;
  totalCost: number;
  totalFees: number;
  realizedPnl: number | null;
  openedAt: string;
  closedAt: string | null;
}

interface TradeHistoryProps {
  onAnalyzeClick?: (positionId: string) => void;
}

export function TradeHistory({ onAnalyzeClick }: TradeHistoryProps) {
  const [positions, setPositions] = useState<ClosedPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnl: 0,
    avgPnl: 0,
  });

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/simulated/positions?open=false');
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      const closedPositions = data.positions || [];
      setPositions(closedPositions);

      // Calculate stats
      const wins = closedPositions.filter((p: ClosedPosition) => (p.realizedPnl ?? 0) > 0).length;
      const losses = closedPositions.filter((p: ClosedPosition) => (p.realizedPnl ?? 0) < 0).length;
      const totalPnl = closedPositions.reduce((sum: number, p: ClosedPosition) => sum + (p.realizedPnl ?? 0), 0);

      setStats({
        totalTrades: closedPositions.length,
        wins,
        losses,
        winRate: closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0,
        totalPnl,
        avgPnl: closedPositions.length > 0 ? totalPnl / closedPositions.length : 0,
      });
    } catch (error) {
      console.error('Error fetching trade history:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (isLoading) {
    return (
      <div className="p-4 text-center text-secondary text-sm">
        Loading trade history...
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-tertiary rounded-lg p-2 text-center">
          <div className="text-xs text-tertiary">Trades</div>
          <div className="font-semibold">{stats.totalTrades}</div>
        </div>
        <div className="bg-tertiary rounded-lg p-2 text-center">
          <div className="text-xs text-tertiary">Win Rate</div>
          <div className={`font-semibold ${stats.winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
            {stats.winRate.toFixed(1)}%
          </div>
        </div>
        <div className="bg-tertiary rounded-lg p-2 text-center">
          <div className="text-xs text-tertiary">Total P&L</div>
          <div className={`font-semibold mono ${stats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {stats.totalPnl >= 0 ? '+' : ''}{stats.totalPnl.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Win/Loss bar */}
      {stats.totalTrades > 0 && (
        <div className="mb-4">
          <div className="flex h-2 rounded-full overflow-hidden">
            <div
              className="bg-green-500"
              style={{ width: `${stats.winRate}%` }}
            />
            <div
              className="bg-red-500"
              style={{ width: `${100 - stats.winRate}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-tertiary mt-1">
            <span>{stats.wins} wins</span>
            <span>{stats.losses} losses</span>
          </div>
        </div>
      )}

      {/* Trade list */}
      <h4 className="text-xs text-tertiary uppercase tracking-wider mb-2">
        Recent Trades
      </h4>

      {positions.length === 0 ? (
        <div className="text-center text-tertiary text-sm py-4">
          No closed trades yet
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {positions.slice(0, 20).map((pos) => {
            const pnl = pos.realizedPnl ?? 0;
            const isProfitable = pnl >= 0;
            const margin = pos.totalCost / pos.leverage;
            const pnlPercent = margin > 0 ? (pnl / margin) * 100 : 0;

            return (
              <div
                key={pos.id}
                className={`rounded-lg border p-2 text-xs ${
                  isProfitable
                    ? 'bg-green-500/5 border-green-500/20'
                    : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        pos.side === 'long'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {pos.side.toUpperCase()}
                    </span>
                    <span className="text-secondary">{pos.volume.toFixed(2)} XRP</span>
                  </div>
                  <span
                    className={`mono font-semibold ${
                      isProfitable ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    {isProfitable ? '+' : ''}{pnl.toFixed(2)} EUR
                  </span>
                </div>

                <div className="flex items-center justify-between text-tertiary">
                  <span>
                    €{pos.avgEntryPrice.toFixed(4)} → €{(
                      pos.side === 'long'
                        ? pos.avgEntryPrice + (pnl + pos.totalFees) / pos.volume
                        : pos.avgEntryPrice - (pnl + pos.totalFees) / pos.volume
                    ).toFixed(4)}
                  </span>
                  <span className={isProfitable ? 'text-green-500' : 'text-red-500'}>
                    {isProfitable ? '+' : ''}{pnlPercent.toFixed(1)}%
                  </span>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span className="text-tertiary">
                    {pos.closedAt ? new Date(pos.closedAt).toLocaleDateString() : '-'}
                  </span>
                  {onAnalyzeClick && (
                    <button
                      onClick={() => onAnalyzeClick(pos.id)}
                      className="text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      Analyze
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

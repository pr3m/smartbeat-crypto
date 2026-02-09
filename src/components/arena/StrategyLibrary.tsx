'use client';

import { useEffect, useCallback } from 'react';
import { useArenaStore } from '@/stores/arenaStore';

export function StrategyLibrary() {
  const strategies = useArenaStore((s) => s.strategies);
  const setStrategies = useArenaStore((s) => s.setStrategies);

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/arena/strategies');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.strategies)) {
        setStrategies(data.strategies);
      }
    } catch {
      // silent
    }
  }, [setStrategies]);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/arena/strategies?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStrategies(strategies.filter((s) => s.id !== id));
      }
    } catch {
      // silent
    }
  };

  if (strategies.length === 0) {
    return (
      <div className="text-sm text-tertiary text-center py-8">
        No saved strategies yet. Extract strategies from winning agents!
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {strategies.map((strategy) => (
        <div key={strategy.id} className="arena-card">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-primary">{strategy.name}</div>
            <button
              onClick={() => handleDelete(strategy.id)}
              className="text-xs text-danger hover:text-red-400"
            >
              Delete
            </button>
          </div>

          {strategy.sourceAgentName && (
            <div className="text-xs text-tertiary mb-2">
              From: {strategy.sourceAgentName}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-tertiary">Win Rate</div>
              <div className="text-sm mono text-primary">{(strategy.winRate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-xs text-tertiary">P&L</div>
              <div className={`text-sm mono ${strategy.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                {strategy.totalPnl >= 0 ? '+' : ''}{strategy.totalPnl.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary">Rating</div>
              <div className="text-sm mono text-yellow-400">
                {'*'.repeat(Math.round(strategy.rating))}{' '}
                <span className="text-tertiary">{strategy.rating.toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

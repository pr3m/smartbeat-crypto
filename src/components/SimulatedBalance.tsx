'use client';

import { useState, useCallback } from 'react';
import { Tooltip } from './Tooltip';
import { useToast } from './Toast';
import { useTradingData } from '@/components/TradingDataProvider';

interface SimulatedBalanceProps {
  onBalanceChange?: () => void;
}

export function SimulatedBalance({ onBalanceChange }: SimulatedBalanceProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const { addToast } = useToast();
  const { simulatedBalance: balance, simulatedBalanceLoading: isLoading, refreshSimulatedBalance } = useTradingData();

  const handleReset = async () => {
    try {
      const res = await fetch('/api/simulated/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', amount: 2000 }),
      });

      if (!res.ok) throw new Error('Failed to reset balance');

      addToast({
        title: 'Balance Reset',
        message: 'Paper trading account reset to €2,000',
        type: 'success',
      });

      setShowResetConfirm(false);
      refreshSimulatedBalance(true);
      onBalanceChange?.();
    } catch (error) {
      addToast({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to reset balance',
        type: 'error',
      });
    }
  };

  if (isLoading || !balance) {
    return (
      <div className="p-4 animate-pulse">
        <div className="h-20 bg-tertiary rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Main balance card */}
      <div className="bg-tertiary rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-tertiary uppercase">Paper Trading Balance</span>
          <Tooltip content="Reset account to €2,000 and close all positions" position="left">
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-xs text-tertiary hover:text-orange-400 transition-colors"
            >
              Reset
            </button>
          </Tooltip>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-tertiary">Equity</div>
            <div className="font-semibold mono text-lg">
              €{balance.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-xs text-tertiary">Available</div>
            <div className="font-semibold mono text-lg text-green-400">
              €{balance.freeMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Margin level indicator */}
        {balance.marginUsed > 0 && (
          <div className="mt-3 pt-3 border-t border-primary">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-tertiary">Margin Level</span>
              <span
                className={`font-semibold ${
                  balance.marginLevel === null
                    ? 'text-secondary'
                    : balance.marginLevel < 150
                    ? 'text-red-500'
                    : balance.marginLevel < 200
                    ? 'text-yellow-500'
                    : 'text-green-500'
                }`}
              >
                {balance.marginLevel !== null ? `${balance.marginLevel.toFixed(0)}%` : '-'}
              </span>
            </div>
            <div className="h-1.5 bg-primary rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  balance.marginLevel === null
                    ? 'bg-gray-500'
                    : balance.marginLevel < 150
                    ? 'bg-red-500'
                    : balance.marginLevel < 200
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{
                  width: `${Math.min(100, (balance.marginLevel ?? 0) / 5)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-primary rounded p-2">
          <div className="text-tertiary">Margin Used</div>
          <div className="mono">€{balance.marginUsed.toFixed(2)}</div>
        </div>
        <div className="bg-primary rounded p-2">
          <div className="text-tertiary">Open Positions</div>
          <div className="mono">{balance.openPositionsCount}</div>
        </div>
        <div className="bg-primary rounded p-2">
          <div className="text-tertiary">Total P&L</div>
          <div
            className={`mono font-semibold ${
              balance.totalRealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'
            }`}
          >
            {balance.totalRealizedPnl >= 0 ? '+' : ''}€{balance.totalRealizedPnl.toFixed(2)}
          </div>
        </div>
        <div className="bg-primary rounded p-2">
          <div className="text-tertiary">Fees Paid</div>
          <div className="mono text-red-400">€{balance.totalFeesPaid.toFixed(2)}</div>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-secondary rounded-lg p-4 max-w-sm mx-4 border border-primary">
            <h3 className="text-lg font-semibold mb-2">Reset Paper Trading?</h3>
            <p className="text-sm text-secondary mb-4">
              This will close all open positions and reset your balance to €2,000.
              All trade history will be preserved.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm bg-tertiary rounded-lg hover:bg-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm bg-orange-500 text-black rounded-lg hover:bg-orange-400 transition-colors font-semibold"
              >
                Reset Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

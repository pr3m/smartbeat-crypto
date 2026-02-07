'use client';

import { useState, useCallback } from 'react';
import { useTradingData } from '@/components/TradingDataProvider';
import { useToast } from '@/components/Toast';

type ActionMode = null | 'set' | 'deposit';

interface AccountWidgetProps {
  testMode: boolean;
}

export function AccountWidget({ testMode }: AccountWidgetProps) {
  const { tradeBalance, simulatedBalance, simulatedBalanceLoading, tradeBalanceLoading, refreshSimulatedBalance } = useTradingData();
  const { addToast } = useToast();

  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [inputAmount, setInputAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Derive unified values from paper or live mode
  const isPaper = testMode;
  const isLoading = isPaper ? simulatedBalanceLoading : tradeBalanceLoading;

  let equity = 0;
  let freeMargin = 0;
  let marginUsed = 0;
  let marginLevel: number | null = null;
  let unrealizedPnL = 0;
  let realizedPnL = 0;
  let feesPaid = 0;
  let hasData = false;

  if (isPaper && simulatedBalance) {
    equity = simulatedBalance.equity;
    freeMargin = simulatedBalance.freeMargin;
    marginUsed = simulatedBalance.marginUsed;
    marginLevel = simulatedBalance.marginLevel;
    unrealizedPnL = simulatedBalance.unrealizedPnl ?? 0;
    realizedPnL = simulatedBalance.totalRealizedPnl;
    feesPaid = simulatedBalance.totalFeesPaid;
    hasData = true;
  } else if (!isPaper && tradeBalance) {
    equity = parseFloat(tradeBalance.e);
    freeMargin = parseFloat(tradeBalance.mf);
    marginUsed = parseFloat(tradeBalance.m);
    marginLevel = tradeBalance.ml ? parseFloat(tradeBalance.ml) : null;
    unrealizedPnL = parseFloat(tradeBalance.n);
    hasData = true;
  }

  const formatEur = (val: number) =>
    `€${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const marginLevelColor = marginLevel === null
    ? 'text-secondary'
    : marginLevel < 150
    ? 'text-red-500'
    : marginLevel < 200
    ? 'text-yellow-500'
    : 'text-green-500';

  const marginBarColor = marginLevel === null
    ? 'bg-gray-500'
    : marginLevel < 150
    ? 'bg-red-500'
    : marginLevel < 200
    ? 'bg-yellow-500'
    : 'bg-green-500';

  const handleAction = useCallback(async (action: 'reset' | 'deposit' | 'set', amount?: number) => {
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = action === 'set'
        ? { action: 'reset', amount }
        : action === 'deposit'
        ? { action: 'deposit', amount }
        : { action: 'reset' };

      const res = await fetch('/api/simulated/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update balance');
      }

      const messages: Record<string, string> = {
        reset: 'Paper trading account reset to €2,000',
        deposit: `Deposited ${formatEur(amount || 0)} to paper account`,
        set: `Paper account balance set to ${formatEur(amount || 0)}`,
      };

      addToast({ title: 'Balance Updated', message: messages[action], type: 'success' });
      setActionMode(null);
      setInputAmount('');
      setShowResetConfirm(false);
      refreshSimulatedBalance(true);
    } catch (error) {
      addToast({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to update balance',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [addToast, refreshSimulatedBalance]);

  const handleSubmitInput = useCallback(() => {
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      addToast({ title: 'Invalid Amount', message: 'Please enter a positive number', type: 'error' });
      return;
    }
    if (actionMode === 'set') {
      handleAction('set', amount);
    } else if (actionMode === 'deposit') {
      handleAction('deposit', amount);
    }
  }, [inputAmount, actionMode, handleAction, addToast]);

  if (isLoading && !hasData) {
    return (
      <div className="card p-4 animate-pulse">
        <div className="h-4 bg-tertiary rounded w-1/2 mb-3" />
        <div className="h-8 bg-tertiary rounded mb-2" />
        <div className="h-4 bg-tertiary rounded w-3/4" />
      </div>
    );
  }

  if (!hasData) return null;

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs text-tertiary uppercase tracking-wider">Account Balance</h3>
        <span
          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
            isPaper
              ? 'bg-orange-500/20 text-orange-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {isPaper ? 'PAPER' : 'LIVE'}
        </span>
      </div>

      {/* Equity - primary value */}
      <div className="mb-3">
        <div className="text-xs text-tertiary">Equity</div>
        <div className="font-semibold mono text-xl">{formatEur(equity)}</div>
      </div>

      {/* Key metrics grid */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-tertiary">Free Margin</span>
          <span className="mono text-green-400">{formatEur(freeMargin)}</span>
        </div>

        {marginUsed > 0 && (
          <div className="flex justify-between">
            <span className="text-tertiary">Margin Used</span>
            <span className="mono">{formatEur(marginUsed)}</span>
          </div>
        )}

        {/* Margin level bar - only when margin is used */}
        {marginUsed > 0 && marginLevel !== null && (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-tertiary">Margin Level</span>
              <span className={`font-semibold mono ${marginLevelColor}`}>
                {marginLevel.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 bg-primary rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${marginBarColor}`}
                style={{ width: `${Math.min(100, marginLevel / 5)}%` }}
              />
            </div>
          </div>
        )}

        {/* Unrealized P&L - shown when positions are open */}
        {unrealizedPnL !== 0 && (
          <div className="flex justify-between">
            <span className="text-tertiary">Unrealized P&L</span>
            <span className={`mono font-semibold ${unrealizedPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {unrealizedPnL >= 0 ? '+' : ''}{formatEur(unrealizedPnL)}
            </span>
          </div>
        )}

        {/* Paper mode extras */}
        {isPaper && (
          <>
            <div className="flex justify-between">
              <span className="text-tertiary">Realized P&L</span>
              <span className={`mono font-semibold ${realizedPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {realizedPnL >= 0 ? '+' : ''}{formatEur(realizedPnL)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Fees Paid</span>
              <span className="mono text-red-400">{formatEur(feesPaid)}</span>
            </div>
          </>
        )}
      </div>

      {/* Paper mode actions */}
      {isPaper && (
        <div className="mt-3 pt-3 border-t border-primary">
          {/* Inline input for set/deposit */}
          {actionMode && (
            <div className="flex gap-1.5 mb-2">
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-tertiary">€</span>
                <input
                  type="number"
                  value={inputAmount}
                  onChange={e => setInputAmount(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSubmitInput();
                    if (e.key === 'Escape') { setActionMode(null); setInputAmount(''); }
                  }}
                  placeholder={actionMode === 'set' ? 'New balance' : 'Amount'}
                  className="w-full pl-6 pr-2 py-1.5 text-xs bg-primary border border-primary rounded focus:outline-none focus:border-blue-500 mono"
                  autoFocus
                  disabled={isSubmitting}
                  min="0"
                  step="100"
                />
              </div>
              <button
                onClick={handleSubmitInput}
                disabled={isSubmitting}
                className="px-2.5 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-400 transition-colors disabled:opacity-50 font-medium"
              >
                {isSubmitting ? '...' : 'OK'}
              </button>
              <button
                onClick={() => { setActionMode(null); setInputAmount(''); }}
                className="px-2 py-1.5 text-xs text-tertiary hover:text-secondary transition-colors"
              >
                ✕
              </button>
            </div>
          )}

          {/* Action buttons */}
          {!actionMode && !showResetConfirm && (
            <div className="flex gap-1.5">
              <button
                onClick={() => setActionMode('set')}
                className="flex-1 px-2 py-1.5 text-xs bg-tertiary hover:bg-primary text-secondary rounded transition-colors"
              >
                Set Balance
              </button>
              <button
                onClick={() => setActionMode('deposit')}
                className="flex-1 px-2 py-1.5 text-xs bg-tertiary hover:bg-primary text-secondary rounded transition-colors"
              >
                Deposit
              </button>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex-1 px-2 py-1.5 text-xs bg-tertiary hover:bg-primary text-orange-400 rounded transition-colors"
              >
                Reset
              </button>
            </div>
          )}

          {/* Reset confirmation inline */}
          {showResetConfirm && (
            <div className="text-xs">
              <p className="text-secondary mb-2">Reset to €2,000 and close all positions?</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleAction('reset')}
                  disabled={isSubmitting}
                  className="flex-1 px-2 py-1.5 bg-orange-500 text-black rounded hover:bg-orange-400 transition-colors font-semibold disabled:opacity-50"
                >
                  {isSubmitting ? 'Resetting...' : 'Confirm Reset'}
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 bg-tertiary rounded hover:bg-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

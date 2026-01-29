'use client';

import { useState } from 'react';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';
import { useTradingData } from './TradingDataProvider';

export interface DraftOrder {
  id: string;
  pair: string;
  side: 'buy' | 'sell';
  orderType: string;
  price: number | null;
  price2: number | null;
  volume: number;
  displayVolume: number | null;
  leverage: number;
  trailingOffset: number | null;
  trailingOffsetType: string | null;
  source: 'manual' | 'ai';
  aiSetupType: string | null;
  activationCriteria: string | null;
  invalidation: string | null;
  positionSizePct: number | null;
  status: string;
  createdAt: string;
}

interface DraftOrdersProps {
  testMode: boolean;
  onEditDraft?: (draft: DraftOrder) => void;
  onSubmitDraft?: (draft: DraftOrder) => void;
}

interface ConfirmSubmitState {
  show: boolean;
  draft: DraftOrder | null;
  submitAll: boolean;
}

export function DraftOrders({ testMode, onEditDraft, onSubmitDraft }: DraftOrdersProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submittingAll, setSubmittingAll] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState<ConfirmSubmitState>({
    show: false,
    draft: null,
    submitAll: false,
  });
  const { addToast } = useToast();
  const {
    draftOrders,
    draftOrdersLoading: loading,
    refreshDraftOrders,
    price: currentPrice,
  } = useTradingData();

  // Filter to only show pending drafts
  const pendingDrafts = draftOrders.filter(d => d.status === 'pending');

  // Calculate distance to entry for limit orders
  const getDistanceToEntry = (draft: DraftOrder): { percent: number; direction: string; close: boolean } | null => {
    if (!draft.price || draft.orderType === 'market' || !currentPrice || currentPrice === 0) return null;

    const diff = draft.price - currentPrice;
    const percent = Math.abs(diff / currentPrice) * 100;

    // For entries
    if (draft.side === 'buy') {
      // Buy entry: want price to drop to entry
      if (diff <= 0) return { percent: 0, direction: 'at or below', close: true };
      return { percent, direction: 'above', close: percent < 1 };
    } else {
      // Sell entry: want price to rise to entry
      if (diff >= 0) return { percent: 0, direction: 'at or above', close: true };
      return { percent, direction: 'below', close: percent < 1 };
    }
  };

  const showSubmitConfirm = (draft: DraftOrder) => {
    setConfirmSubmit({
      show: true,
      draft,
      submitAll: false,
    });
  };

  const showSubmitAllConfirm = () => {
    if (pendingDrafts.length === 0) return;
    setConfirmSubmit({
      show: true,
      draft: null,
      submitAll: true,
    });
  };

  const executeSubmitConfirmed = async () => {
    if (confirmSubmit.submitAll) {
      await handleSubmitAll();
    } else if (confirmSubmit.draft) {
      await handleSubmit(confirmSubmit.draft);
    }
    setConfirmSubmit({ show: false, draft: null, submitAll: false });
  };

  const handleSubmit = async (draft: DraftOrder) => {
    setSubmittingId(draft.id);

    try {
      const response = await fetch(`/api/draft-orders/${draft.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testMode, currentPrice }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit draft');
      }

      addToast({
        title: 'Draft Submitted',
        message: `${draft.side.toUpperCase()} ${draft.volume.toFixed(2)} XRP submitted${testMode ? ' (test)' : ''}`,
        type: 'success',
      });

      onSubmitDraft?.(draft);
      refreshDraftOrders(true);
    } catch (err) {
      addToast({
        title: 'Submit Failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setSubmittingId(null);
    }
  };

  const handleSubmitAll = async () => {
    setSubmittingAll(true);
    let submitted = 0;
    let failed = 0;

    for (const draft of pendingDrafts) {
      try {
        const response = await fetch(`/api/draft-orders/${draft.id}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testMode, currentPrice }),
        });

        if (response.ok) {
          submitted++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    addToast({
      title: 'Batch Submit Complete',
      message: `${submitted} submitted, ${failed} failed`,
      type: failed === 0 ? 'success' : 'warning',
    });

    refreshDraftOrders(true);
    setSubmittingAll(false);
  };

  const handleDelete = async (draftId: string) => {
    try {
      const response = await fetch(`/api/draft-orders/${draftId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete draft');
      }

      addToast({
        title: 'Draft Deleted',
        message: 'Draft order removed',
        type: 'info',
      });

      refreshDraftOrders(true);
    } catch (err) {
      addToast({
        title: 'Delete Failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    }
  };

  const handleDeleteAll = async () => {
    try {
      const response = await fetch('/api/draft-orders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteAll: true, status: 'pending' }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete drafts');
      }

      addToast({
        title: 'All Drafts Deleted',
        message: `${result.deleted} draft orders removed`,
        type: 'info',
      });

      refreshDraftOrders(true);
    } catch (err) {
      addToast({
        title: 'Delete Failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    }
  };

  // Don't render if no pending drafts
  if (!loading && pendingDrafts.length === 0) {
    return null;
  }

  const getOrderTypeLabel = (orderType: string) => {
    const labels: Record<string, string> = {
      'market': 'Market',
      'limit': 'Limit',
      'stop-loss': 'Stop Loss',
      'stop-loss-limit': 'Stop Loss Limit',
      'take-profit': 'Take Profit',
      'take-profit-limit': 'Take Profit Limit',
      'trailing-stop': 'Trailing Stop',
      'trailing-stop-limit': 'Trailing Stop Limit',
      'iceberg': 'Iceberg',
    };
    return labels[orderType] || orderType;
  };

  const getSetupTypeColor = (setupType: string | null): string => {
    if (!setupType) return 'bg-gray-500/20 text-gray-400';
    const upper = setupType.toUpperCase();
    if (upper.includes('SHORT') || upper.includes('_SL')) {
      return 'bg-red-500/20 text-red-400';
    }
    if (upper.includes('LONG') || upper.includes('_TP')) {
      return 'bg-green-500/20 text-green-400';
    }
    return 'bg-purple-500/20 text-purple-400';
  };

  return (
    <div className="card p-4 border-2 border-dashed border-purple-500/40 bg-purple-500/5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-500/30 text-purple-300">
            DRAFT
          </span>
          <span className="text-secondary">AI Draft Orders</span>
          <span className="px-2 py-0.5 rounded bg-tertiary text-secondary text-xs">
            {pendingDrafts.length}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshDraftOrders(true)}
            className="text-xs text-secondary hover:text-primary transition-colors"
          >
            Refresh
          </button>
          {pendingDrafts.length > 1 && (
            <>
              <Tooltip content="Submit all pending drafts" position="left">
                <button
                  onClick={showSubmitAllConfirm}
                  disabled={submittingAll}
                  className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                >
                  {submittingAll ? 'Submitting...' : 'Submit All'}
                </button>
              </Tooltip>
              <Tooltip content="Delete all pending drafts" position="left">
                <button
                  onClick={handleDeleteAll}
                  className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Delete All
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-4 text-secondary text-sm">
          Loading draft orders...
        </div>
      )}

      {/* Draft Orders List */}
      {!loading && pendingDrafts.length > 0 && (
        <div className="space-y-3">
          {pendingDrafts.map((draft) => (
            <div
              key={draft.id}
              className={`p-4 rounded-lg border-2 border-dashed ${
                draft.side === 'buy'
                  ? 'bg-green-500/5 border-green-500/30'
                  : 'bg-red-500/5 border-red-500/30'
              }`}
            >
              {/* Draft Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* AI Badge */}
                  {draft.source === 'ai' && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/30 text-purple-300 flex items-center gap-1">
                      <span>🤖</span> AI
                    </span>
                  )}
                  {/* Side Badge */}
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      draft.side === 'buy'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {draft.side === 'buy' ? 'LONG' : 'SHORT'}
                  </span>
                  {/* Order Type */}
                  <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                    {getOrderTypeLabel(draft.orderType)}
                  </span>
                  {/* Setup Type */}
                  {draft.aiSetupType && (
                    <span className={`px-2 py-0.5 rounded text-xs ${getSetupTypeColor(draft.aiSetupType)}`}>
                      {draft.aiSetupType}
                    </span>
                  )}
                  {/* Leverage */}
                  {draft.leverage > 1 && (
                    <span className="text-xs text-tertiary">{draft.leverage}x</span>
                  )}
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1">
                  {onEditDraft && (
                    <Tooltip content="Edit in trade panel" position="left">
                      <button
                        onClick={() => onEditDraft(draft)}
                        className="px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                      >
                        Edit
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="Delete this draft" position="left">
                    <button
                      onClick={() => handleDelete(draft.id)}
                      className="px-2 py-1 text-xs rounded bg-tertiary hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Order Details */}
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div>
                  <span className="text-tertiary">Price: </span>
                  <span className="mono font-semibold">
                    {draft.price ? `€${draft.price.toFixed(4)}` : 'Market'}
                  </span>
                </div>
                <div>
                  <span className="text-tertiary">Volume: </span>
                  <span className="mono">{draft.volume.toFixed(2)} XRP</span>
                </div>
                <div>
                  <span className="text-tertiary">Value: </span>
                  <span className="mono">
                    €{draft.price ? (draft.price * draft.volume).toFixed(2) : '-'}
                  </span>
                </div>
              </div>

              {/* Activation Criteria */}
              {draft.activationCriteria && (
                <div className="mb-2 p-2 rounded bg-blue-500/10 border border-blue-500/20">
                  <div className="text-xs text-blue-400 mb-1 font-semibold flex items-center gap-1">
                    <span>⚡</span> Activation Criteria
                  </div>
                  <ul className="text-xs text-blue-300 space-y-0.5">
                    {JSON.parse(draft.activationCriteria).slice(0, 3).map((crit: string, i: number) => (
                      <li key={i} className="truncate">• {crit}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Invalidation */}
              {draft.invalidation && (
                <div className="mb-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
                  <div className="text-xs text-yellow-400 mb-1 font-semibold flex items-center gap-1">
                    <span>⚠️</span> Invalid if
                  </div>
                  <ul className="text-xs text-yellow-300 space-y-0.5">
                    {JSON.parse(draft.invalidation).slice(0, 2).map((inv: string, i: number) => (
                      <li key={i} className="truncate">• {inv}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Distance to Entry */}
              {(() => {
                const distance = getDistanceToEntry(draft);
                if (!distance) return null;
                return (
                  <div className={`mb-3 p-2 rounded text-xs ${
                    distance.close
                      ? 'bg-yellow-500/20 border border-yellow-500/30'
                      : 'bg-tertiary/30'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-tertiary">Current: </span>
                        <span className="mono font-semibold">€{currentPrice.toFixed(4)}</span>
                      </div>
                      <div className={distance.close ? 'text-yellow-400 font-semibold' : 'text-secondary'}>
                        {distance.percent === 0 ? (
                          <span className="text-green-400">Ready to trigger!</span>
                        ) : (
                          <>
                            {distance.percent.toFixed(2)}% {distance.direction}
                            {distance.close && ' ⚡'}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Submit Button */}
              <button
                onClick={() => showSubmitConfirm(draft)}
                disabled={submittingId === draft.id}
                className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                  testMode
                    ? 'bg-gradient-to-r from-orange-500/80 to-orange-600/80 hover:from-orange-500 hover:to-orange-600 text-black'
                    : draft.side === 'buy'
                    ? 'bg-gradient-to-r from-green-500/80 to-green-600/80 hover:from-green-500 hover:to-green-600 text-black'
                    : 'bg-gradient-to-r from-red-500/80 to-red-600/80 hover:from-red-500 hover:to-red-600 text-white'
                } disabled:opacity-50`}
              >
                {submittingId === draft.id ? (
                  'Submitting...'
                ) : (
                  <>
                    <span>Submit to {testMode ? 'TEST' : 'LIVE'}</span>
                  </>
                )}
              </button>

              {/* Created Time */}
              <div className="mt-2 text-xs text-tertiary text-center">
                Created: {new Date(draft.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Submit Confirmation Modal */}
      {confirmSubmit.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setConfirmSubmit({ show: false, draft: null, submitAll: false })}
          />

          {/* Modal */}
          <div className="relative bg-secondary border border-primary rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className={`px-6 py-4 ${testMode ? 'bg-orange-500' : 'bg-blue-500'}`}>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {testMode ? '🧪' : '⚡'}
                Confirm {testMode ? 'Test' : 'Live'} Submit
              </h2>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-secondary mb-4">
                {confirmSubmit.submitAll
                  ? `Submit all ${pendingDrafts.length} pending draft orders?`
                  : 'Submit this draft order?'
                }
              </p>

              {confirmSubmit.draft && (
                <div className="bg-tertiary rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      confirmSubmit.draft.side === 'buy'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {confirmSubmit.draft.side === 'buy' ? 'LONG' : 'SHORT'}
                    </span>
                    <span className="text-sm mono font-semibold">
                      {confirmSubmit.draft.volume.toFixed(2)} XRP
                    </span>
                    {confirmSubmit.draft.price && (
                      <span className="text-sm text-secondary">
                        @ €{confirmSubmit.draft.price.toFixed(4)}
                      </span>
                    )}
                  </div>
                  {confirmSubmit.draft.aiSetupType && (
                    <div className="text-xs text-purple-400">
                      Setup: {confirmSubmit.draft.aiSetupType}
                    </div>
                  )}
                </div>
              )}

              <div className={`p-3 rounded-lg ${testMode ? 'bg-orange-500/20' : 'bg-red-500/20'}`}>
                <p className={`text-xs ${testMode ? 'text-orange-300' : 'text-red-300'}`}>
                  {testMode
                    ? 'Orders will be placed in paper trading mode. No real money involved.'
                    : 'WARNING: Orders will be placed with REAL MONEY on Kraken!'}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-tertiary border-t border-primary flex gap-3">
              <button
                onClick={() => setConfirmSubmit({ show: false, draft: null, submitAll: false })}
                className="flex-1 btn btn-secondary py-3 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={executeSubmitConfirmed}
                disabled={submittingId !== null || submittingAll}
                className={`flex-1 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 ${
                  testMode
                    ? 'bg-orange-500 hover:bg-orange-400 text-black'
                    : 'bg-green-500 hover:bg-green-400 text-black'
                }`}
              >
                {submittingId !== null || submittingAll ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

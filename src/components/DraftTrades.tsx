'use client';

import { useState, useMemo } from 'react';
import { useToast } from './Toast';
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
  testMode: boolean;
  createdAt: string;
}

interface DraftTradesProps {
  testMode: boolean;
  onEditDraft?: (draft: DraftOrder) => void;
}

interface GroupedTrade {
  baseType: string;
  displayName: string;
  side: 'buy' | 'sell';
  entry: DraftOrder | null;
  stopLoss: DraftOrder | null;
  takeProfits: DraftOrder[];
  activationCriteria: string[] | null;
  invalidation: string[] | null;
  createdAt: string;
}

// Extract base setup type from aiSetupType (e.g., "SHORT_REJECTION_TP1" -> "SHORT_REJECTION")
function getBaseSetupType(aiSetupType: string | null): string {
  if (!aiSetupType) return 'manual';
  // Remove _SL, _TP1, _TP2, _TP3, etc. suffixes
  return aiSetupType.replace(/_(SL|TP\d+)$/, '');
}

// Get display name from base type
function getDisplayName(baseType: string): string {
  if (baseType === 'manual') return 'Manual Trade';
  return baseType.replace(/_/g, ' ');
}

// Group draft orders into trades
function groupDraftOrders(orders: DraftOrder[]): GroupedTrade[] {
  const groups = new Map<string, GroupedTrade>();

  for (const order of orders) {
    if (order.status !== 'pending') continue;

    const baseType = getBaseSetupType(order.aiSetupType);
    const key = `${baseType}-${order.createdAt.slice(0, 16)}`; // Group by type and ~minute

    if (!groups.has(key)) {
      groups.set(key, {
        baseType,
        displayName: getDisplayName(baseType),
        side: order.side,
        entry: null,
        stopLoss: null,
        takeProfits: [],
        activationCriteria: null,
        invalidation: null,
        createdAt: order.createdAt,
      });
    }

    const group = groups.get(key)!;

    // Categorize the order
    const setupType = order.aiSetupType || '';
    if (setupType.includes('_SL')) {
      group.stopLoss = order;
    } else if (setupType.includes('_TP')) {
      group.takeProfits.push(order);
    } else {
      // Entry order
      group.entry = order;
      group.side = order.side;
      // Get activation criteria and invalidation from entry order
      if (order.activationCriteria) {
        try {
          group.activationCriteria = JSON.parse(order.activationCriteria);
        } catch { /* ignore */ }
      }
      if (order.invalidation) {
        try {
          group.invalidation = JSON.parse(order.invalidation);
        } catch { /* ignore */ }
      }
    }
  }

  // Sort take profits by price
  for (const group of groups.values()) {
    group.takeProfits.sort((a, b) => {
      const priceA = a.price || 0;
      const priceB = b.price || 0;
      // For shorts (sell entry), TP prices are lower, sort descending
      // For longs (buy entry), TP prices are higher, sort ascending
      return group.side === 'sell' ? priceB - priceA : priceA - priceB;
    });
  }

  // Sort groups by creation time, newest first
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function DraftTrades({ testMode, onEditDraft }: DraftTradesProps) {
  const [submittingOrders, setSubmittingOrders] = useState<Set<string>>(new Set());
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set());
  const { addToast } = useToast();
  const {
    draftOrders,
    draftOrdersLoading: loading,
    refreshDraftOrders,
    price: currentPrice,
  } = useTradingData();

  // Group draft orders into trades
  const groupedTrades = useMemo(() => groupDraftOrders(draftOrders), [draftOrders]);

  // Toggle order selection
  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  // Toggle all orders in a trade
  const toggleTradeSelection = (trade: GroupedTrade) => {
    const orderIds = [
      trade.entry?.id,
      trade.stopLoss?.id,
      ...trade.takeProfits.map(tp => tp.id),
    ].filter(Boolean) as string[];

    setSelectedOrders(prev => {
      const allSelected = orderIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        orderIds.forEach(id => next.delete(id));
      } else {
        orderIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  // Toggle trade expansion
  const toggleExpanded = (tradeKey: string) => {
    setExpandedTrades(prev => {
      const next = new Set(prev);
      if (next.has(tradeKey)) {
        next.delete(tradeKey);
      } else {
        next.add(tradeKey);
      }
      return next;
    });
  };

  // Submit selected orders from a trade
  const handleSubmitSelected = async (trade: GroupedTrade) => {
    const orderIds = [
      trade.entry?.id,
      trade.stopLoss?.id,
      ...trade.takeProfits.map(tp => tp.id),
    ].filter(id => id && selectedOrders.has(id)) as string[];

    if (orderIds.length === 0) {
      addToast({
        title: 'No Orders Selected',
        message: 'Select at least one order to submit',
        type: 'warning',
      });
      return;
    }

    setSubmittingOrders(new Set(orderIds));
    let submitted = 0;
    let failed = 0;

    for (const orderId of orderIds) {
      try {
        const response = await fetch(`/api/draft-orders/${orderId}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testMode, currentPrice }),
        });

        if (response.ok) {
          submitted++;
          setSelectedOrders(prev => {
            const next = new Set(prev);
            next.delete(orderId);
            return next;
          });
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    addToast({
      title: 'Orders Submitted',
      message: `${submitted} submitted${failed > 0 ? `, ${failed} failed` : ''}`,
      type: failed === 0 ? 'success' : 'warning',
    });

    refreshDraftOrders(true);
    setSubmittingOrders(new Set());
  };

  // Delete a trade (all its orders)
  const handleDeleteTrade = async (trade: GroupedTrade) => {
    const orderIds = [
      trade.entry?.id,
      trade.stopLoss?.id,
      ...trade.takeProfits.map(tp => tp.id),
    ].filter(Boolean) as string[];

    let deleted = 0;
    for (const orderId of orderIds) {
      try {
        const response = await fetch(`/api/draft-orders/${orderId}`, {
          method: 'DELETE',
        });
        if (response.ok) deleted++;
      } catch { /* ignore */ }
    }

    addToast({
      title: 'Trade Deleted',
      message: `Removed ${deleted} draft orders`,
      type: 'info',
    });

    refreshDraftOrders(true);
  };

  // Don't render if no trades
  if (!loading && groupedTrades.length === 0) {
    return null;
  }

  const getOrderTypeLabel = (orderType: string) => {
    const labels: Record<string, string> = {
      'market': 'Market',
      'limit': 'Limit',
      'stop-loss': 'Stop Loss',
      'take-profit': 'Take Profit',
    };
    return labels[orderType] || orderType;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-secondary flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
          Draft Trades
          <span className="px-2 py-0.5 rounded bg-tertiary text-tertiary text-xs font-normal">
            {groupedTrades.length} trade{groupedTrades.length !== 1 ? 's' : ''}
          </span>
        </h3>
        <button
          onClick={() => refreshDraftOrders(true)}
          className="text-xs text-secondary hover:text-primary transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-4 text-secondary text-sm">
          Loading draft trades...
        </div>
      )}

      {/* Grouped Trades */}
      {!loading && groupedTrades.map((trade, index) => {
        const tradeKey = `${trade.baseType}-${trade.createdAt}`;
        const isExpanded = expandedTrades.has(tradeKey);
        const isShort = trade.side === 'sell';

        const allOrders = [
          trade.entry,
          trade.stopLoss,
          ...trade.takeProfits,
        ].filter(Boolean) as DraftOrder[];

        const selectedCount = allOrders.filter(o => selectedOrders.has(o.id)).length;
        const allSelected = selectedCount === allOrders.length && allOrders.length > 0;

        return (
          <div
            key={tradeKey}
            className={`card border-2 border-dashed overflow-hidden ${
              isShort
                ? 'border-red-500/40 bg-red-500/5'
                : 'border-green-500/40 bg-green-500/5'
            }`}
          >
            {/* Trade Header */}
            <div
              className={`p-3 cursor-pointer hover:bg-white/5 transition-colors ${
                isShort ? 'bg-red-500/10' : 'bg-green-500/10'
              }`}
              onClick={() => toggleExpanded(tradeKey)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* AI Badge */}
                  {trade.baseType !== 'manual' && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/30 text-purple-300">
                      AI
                    </span>
                  )}
                  {/* Side Badge */}
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    isShort ? 'bg-red-500/30 text-red-400' : 'bg-green-500/30 text-green-400'
                  }`}>
                    {isShort ? 'SHORT' : 'LONG'}
                  </span>
                  {/* Trade Name */}
                  <span className="font-semibold text-primary">
                    {trade.displayName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Order Count */}
                  <span className="text-xs text-tertiary">
                    {allOrders.length} order{allOrders.length !== 1 ? 's' : ''}
                  </span>
                  {/* Expand Arrow */}
                  <span className={`text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </div>
              </div>

              {/* Summary Row */}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {trade.entry && (
                  <span>
                    <span className="text-tertiary">Entry: </span>
                    <span className="font-mono text-blue-400">
                      €{trade.entry.price?.toFixed(4) || 'Market'}
                    </span>
                  </span>
                )}
                {trade.stopLoss && (
                  <span>
                    <span className="text-tertiary">SL: </span>
                    <span className="font-mono text-red-400">
                      €{trade.stopLoss.price?.toFixed(4)}
                    </span>
                  </span>
                )}
                {trade.takeProfits.length > 0 && (
                  <span>
                    <span className="text-tertiary">TP: </span>
                    <span className="font-mono text-green-400">
                      {trade.takeProfits.length} level{trade.takeProfits.length !== 1 ? 's' : ''}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="p-3 border-t border-primary/20">
                {/* Activation Criteria */}
                {trade.activationCriteria && trade.activationCriteria.length > 0 && (
                  <div className="mb-3 p-2 rounded bg-blue-500/10 border border-blue-500/20">
                    <div className="text-xs text-blue-400 mb-1 font-semibold">
                      Activation Criteria:
                    </div>
                    <ul className="text-xs text-blue-300 space-y-0.5">
                      {trade.activationCriteria.map((crit, i) => (
                        <li key={i}>• {crit}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Invalidation */}
                {trade.invalidation && trade.invalidation.length > 0 && (
                  <div className="mb-3 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
                    <div className="text-xs text-yellow-400 mb-1 font-semibold">
                      Invalid if:
                    </div>
                    <ul className="text-xs text-yellow-300 space-y-0.5">
                      {trade.invalidation.map((inv, i) => (
                        <li key={i}>• {inv}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Select All */}
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => toggleTradeSelection(trade)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-secondary">Select all orders</span>
                  </label>
                  <span className="text-xs text-tertiary">
                    {selectedCount}/{allOrders.length} selected
                  </span>
                </div>

                {/* Individual Orders */}
                <div className="space-y-2">
                  {/* Entry Order */}
                  {trade.entry && (
                    <OrderRow
                      order={trade.entry}
                      label="Entry"
                      selected={selectedOrders.has(trade.entry.id)}
                      submitting={submittingOrders.has(trade.entry.id)}
                      onToggle={() => toggleOrderSelection(trade.entry!.id)}
                      onEdit={onEditDraft}
                      currentPrice={currentPrice}
                    />
                  )}

                  {/* Stop Loss */}
                  {trade.stopLoss && (
                    <OrderRow
                      order={trade.stopLoss}
                      label="Stop Loss"
                      selected={selectedOrders.has(trade.stopLoss.id)}
                      submitting={submittingOrders.has(trade.stopLoss.id)}
                      onToggle={() => toggleOrderSelection(trade.stopLoss!.id)}
                      onEdit={onEditDraft}
                      currentPrice={currentPrice}
                    />
                  )}

                  {/* Take Profits */}
                  {trade.takeProfits.map((tp, i) => (
                    <OrderRow
                      key={tp.id}
                      order={tp}
                      label={`Take Profit ${i + 1}`}
                      selected={selectedOrders.has(tp.id)}
                      submitting={submittingOrders.has(tp.id)}
                      onToggle={() => toggleOrderSelection(tp.id)}
                      onEdit={onEditDraft}
                      currentPrice={currentPrice}
                    />
                  ))}
                </div>

                {/* Actions */}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => handleSubmitSelected(trade)}
                    disabled={selectedCount === 0 || submittingOrders.size > 0}
                    className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      testMode
                        ? 'bg-orange-500 hover:bg-orange-400 text-black'
                        : 'bg-green-500 hover:bg-green-400 text-black'
                    }`}
                  >
                    {submittingOrders.size > 0 ? 'Submitting...' : `Submit ${selectedCount} to ${testMode ? 'TEST' : 'LIVE'}`}
                  </button>
                  <button
                    onClick={() => handleDeleteTrade(trade)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  >
                    Delete
                  </button>
                </div>

                {/* Created Time */}
                <div className="mt-2 text-xs text-tertiary text-center">
                  Created: {new Date(trade.createdAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Individual order row component
function OrderRow({
  order,
  label,
  selected,
  submitting,
  onToggle,
  onEdit,
  currentPrice,
}: {
  order: DraftOrder;
  label: string;
  selected: boolean;
  submitting: boolean;
  onToggle: () => void;
  onEdit?: (draft: DraftOrder) => void;
  currentPrice: number;
}) {
  const isEntry = label === 'Entry';
  const isSL = label === 'Stop Loss';
  const isTP = label.startsWith('Take Profit');

  // Calculate distance from current price
  const distance = order.price && currentPrice > 0
    ? ((order.price - currentPrice) / currentPrice * 100)
    : null;

  return (
    <div
      className={`p-2 rounded border transition-colors ${
        selected
          ? 'border-purple-500/50 bg-purple-500/10'
          : 'border-primary/30 bg-primary/10 hover:border-primary/50'
      } ${submitting ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={submitting}
          className="w-4 h-4 rounded"
        />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${
                isSL ? 'text-red-400' : isTP ? 'text-green-400' : 'text-blue-400'
              }`}>
                {label}
              </span>
              <span className="text-xs text-tertiary">
                {order.orderType}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono">
                {order.price ? `€${order.price.toFixed(4)}` : 'Market'}
              </span>
              {distance !== null && (
                <span className={`text-xs ${Math.abs(distance) < 1 ? 'text-yellow-400' : 'text-tertiary'}`}>
                  ({distance > 0 ? '+' : ''}{distance.toFixed(2)}%)
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-tertiary mt-0.5">
            <span>{order.volume.toFixed(2)} XRP</span>
            <span>€{((order.price || currentPrice) * order.volume).toFixed(2)}</span>
          </div>
        </div>
        {onEdit && (
          <button
            onClick={() => onEdit(order)}
            className="p-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            title="Edit order"
          >
            ✎
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';
import { useTradingData } from '@/components/TradingDataProvider';
import { PositionHealthBadge } from './PositionHealthBadge';
import { PositionAnalysisModal } from './PositionAnalysisModal';
import { calculatePositionHealth, type PositionHealthMetrics } from '@/lib/trading/position-health';

interface SimulatedPosition {
  id: string;
  pair: string;
  side: 'long' | 'short';
  volume: number;
  avgEntryPrice: number;
  leverage: number;
  totalCost: number;
  totalFees: number;
  isOpen: boolean;
  openedAt: string;
  // Calculated fields from API
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  unrealizedPnlLevered?: number;
  unrealizedPnlLeveredPercent?: number;
  liquidationPrice?: number;
  marginUsed?: number;
  currentValue?: number;
}

interface SimulatedPositionsProps {
  currentPrice: number;
  onPositionChange?: () => void;
}

export function SimulatedPositions({ currentPrice, onPositionChange }: SimulatedPositionsProps) {
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [analyzingPosition, setAnalyzingPosition] = useState<SimulatedPosition | null>(null);
  const [expandedRiskId, setExpandedRiskId] = useState<string | null>(null);
  const { addToast } = useToast();
  const {
    simulatedPositions: positions,
    simulatedPositionsLoading: isLoading,
    simulatedPositionsError: error,
    refreshSimulatedPositions,
    simulatedBalance,
  } = useTradingData();

  // Calculate health metrics for all positions
  const positionHealthMap = useMemo(() => {
    const map = new Map<string, PositionHealthMetrics>();
    const equity = simulatedBalance?.equity ?? 2000;

    for (const pos of positions) {
      // Calculate liquidation price fallback if API value not available
      let liqPrice = pos.liquidationPrice ?? 0;
      if (liqPrice === 0 && pos.avgEntryPrice > 0 && pos.leverage > 0) {
        const liqDistance = pos.avgEntryPrice / pos.leverage * 0.8;
        liqPrice = pos.side === 'long'
          ? pos.avgEntryPrice - liqDistance
          : pos.avgEntryPrice + liqDistance;
      }

      const health = calculatePositionHealth({
        side: pos.side,
        entryPrice: pos.avgEntryPrice,
        currentPrice,
        liquidationPrice: liqPrice,
        leverage: pos.leverage,
        marginUsed: pos.marginUsed ?? pos.totalCost / pos.leverage,
        equity,
        openedAt: pos.openedAt,
      });
      map.set(pos.id, health);
    }

    return map;
  }, [positions, currentPrice, simulatedBalance?.equity]);

  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  const handleCloseClick = (positionId: string) => {
    if (!currentPrice) {
      addToast({
        title: 'Error',
        message: 'Cannot close position: no current price',
        type: 'error',
      });
      return;
    }
    // Show confirmation dialog
    setConfirmCloseId(positionId);
  };

  const executeClosePosition = async (positionId: string) => {
    setConfirmCloseId(null);
    setClosingPosition(positionId);

    try {
      const res = await fetch('/api/simulated/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          closePrice: currentPrice,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to close position');
      }

      addToast({
        title: 'Position Closed',
        message: data.message,
        type: data.realizedPnl >= 0 ? 'success' : 'error',
        duration: 10000,
      });

      // Refresh positions
      refreshSimulatedPositions(true);
      onPositionChange?.();
    } catch (error) {
      addToast({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to close position',
        type: 'error',
      });
    } finally {
      setClosingPosition(null);
    }
  };

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-red-400">⚠️</span>
            <span className="text-sm font-semibold text-red-400">Database Error</span>
          </div>
          <p className="text-xs text-secondary">{error}</p>
          <button
            onClick={() => refreshSimulatedPositions(true)}
            className="mt-3 text-xs px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 text-center text-secondary text-sm">
        Loading simulated positions...
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="p-4 text-center">
        <div className="text-tertiary text-sm mb-2">No open positions</div>
        <p className="text-xs text-tertiary">
          Place a test order to start paper trading
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 border-2 border-orange-500/40 bg-orange-500/5">
      <h4 className="text-xs uppercase tracking-wider flex items-center gap-2 mb-3">
        <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
        <span className="px-2 py-0.5 rounded bg-orange-500/30 text-orange-300 text-xs font-bold">TEST</span>
        <span className="text-secondary">Open Positions</span>
        <span className="px-2 py-0.5 rounded bg-tertiary text-secondary text-xs ml-auto">
          {positions.length}
        </span>
      </h4>

      {positions.map((pos) => {
        // Use API-calculated P&L, or calculate client-side if not available
        let pnl = pos.unrealizedPnlLevered ?? 0;
        let pnlPercent = pos.unrealizedPnlLeveredPercent ?? 0;

        // Client-side fallback calculation when API P&L is 0 but we have prices
        if (pnl === 0 && currentPrice > 0 && pos.avgEntryPrice > 0) {
          const priceDiff = pos.side === 'long'
            ? currentPrice - pos.avgEntryPrice
            : pos.avgEntryPrice - currentPrice;
          const rawPnl = priceDiff * pos.volume;
          const margin = pos.totalCost / pos.leverage;
          // Calculate levered P&L (after fees, as % of margin)
          pnl = rawPnl - pos.totalFees;
          pnlPercent = margin > 0 ? (pnl / margin) * 100 : 0;
        }

        // Calculate liquidation price fallback if API value not available
        let liquidationPrice = pos.liquidationPrice ?? 0;
        if (liquidationPrice === 0 && pos.avgEntryPrice > 0 && pos.leverage > 0) {
          // Simple approximation: liquidation at ~80% loss of margin
          // Long: price drops by margin/position_value * 0.8
          // Short: price rises by the same ratio
          const liqDistance = pos.avgEntryPrice / pos.leverage * 0.8;
          liquidationPrice = pos.side === 'long'
            ? pos.avgEntryPrice - liqDistance
            : pos.avgEntryPrice + liqDistance;
        }

        const isProfitable = pnl >= 0;
        const isClosing = closingPosition === pos.id;
        const health = positionHealthMap.get(pos.id);

        return (
          <div
            key={pos.id}
            className={`rounded-lg border p-3 ${
              pos.side === 'long'
                ? 'bg-green-500/5 border-green-500/30'
                : 'bg-red-500/5 border-red-500/30'
            }`}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    pos.side === 'long'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {pos.side.toUpperCase()} {pos.leverage}x
                </span>
                <span className="text-sm font-medium">{pos.pair}</span>
                {/* Clickable Risk Badge */}
                {health && (
                  <button
                    onClick={() => setExpandedRiskId(expandedRiskId === pos.id ? null : pos.id)}
                    className={`px-2 py-0.5 rounded text-xs font-semibold transition-all ${
                      health.riskLevel === 'extreme'
                        ? 'bg-red-500/30 text-red-400 border border-red-500/50'
                        : health.riskLevel === 'high'
                        ? 'bg-orange-500/30 text-orange-400 border border-orange-500/50'
                        : health.riskLevel === 'medium'
                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                        : 'bg-green-500/20 text-green-400 border border-green-500/40'
                    } ${expandedRiskId === pos.id ? 'ring-2 ring-offset-1 ring-offset-transparent' : 'hover:opacity-80'}`}
                    title="Click to view risk details"
                  >
                    {health.riskLevel === 'extreme' && '⚠️ '}
                    {health.riskLevel === 'high' && '⚡ '}
                    {health.riskLevel.toUpperCase()}
                    <span className="ml-1 opacity-70">{expandedRiskId === pos.id ? '▲' : '▼'}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Tooltip content="Analyze with AI" position="left">
                  <button
                    onClick={() => setAnalyzingPosition(pos)}
                    className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded transition-colors"
                  >
                    ⚡
                  </button>
                </Tooltip>
                <Tooltip content={`Close position at market price (€${currentPrice.toFixed(4)})`} position="left">
                  <button
                    onClick={() => handleCloseClick(pos.id)}
                    disabled={isClosing}
                    className="px-3 py-1 text-xs bg-tertiary hover:bg-red-500/20 hover:text-red-400 rounded transition-colors disabled:opacity-50"
                  >
                    {isClosing ? 'Closing...' : 'Close'}
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Position details */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-tertiary">Size: </span>
                <span className="mono">{pos.volume.toFixed(2)} XRP</span>
              </div>
              <div>
                <span className="text-tertiary">Entry: </span>
                <span className="mono">€{pos.avgEntryPrice.toFixed(4)}</span>
              </div>
              <div>
                <span className="text-tertiary">Current: </span>
                <span className={`mono font-semibold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                  €{currentPrice.toFixed(4)}
                </span>
              </div>
              <div>
                <span className="text-tertiary">Liq: </span>
                <span className={`mono ${pos.side === 'long' ? 'text-red-400' : 'text-green-400'}`}>
                  €{liquidationPrice.toFixed(4)}
                </span>
              </div>
            </div>

            {/* P&L row - more prominent */}
            <div
              className={`mt-2 p-2 rounded-lg ${
                isProfitable ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-secondary">Unrealized P&L</span>
                <div className="text-right">
                  <span className={`mono font-bold text-lg ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                    {isProfitable ? '+' : ''}€{pnl.toFixed(2)}
                  </span>
                  <span className={`text-xs ml-2 ${isProfitable ? 'text-green-400/70' : 'text-red-400/70'}`}>
                    ({isProfitable ? '+' : ''}{pnlPercent.toFixed(1)}%)
                  </span>
                </div>
              </div>
              <div className="text-xs text-tertiary mt-1">
                Margin: €{(pos.marginUsed ?? pos.totalCost / pos.leverage).toFixed(2)} •
                Value: €{(pos.volume * currentPrice).toFixed(2)}
              </div>
            </div>

            {/* Time open */}
            <div className="mt-1 text-xs text-tertiary">
              Opened: {new Date(pos.openedAt).toLocaleString()}
            </div>

            {/* Health Metrics (collapsible) - only show when clicked */}
            {health && expandedRiskId === pos.id && (
              <div className="mt-2 animate-fade-in">
                <PositionHealthBadge health={health} />
              </div>
            )}
          </div>
        );
      })}

      {/* Position Analysis Modal */}
      {analyzingPosition && positionHealthMap.get(analyzingPosition.id) && (() => {
        // Calculate fallback values for modal
        const pos = analyzingPosition;
        let modalPnl = pos.unrealizedPnlLevered ?? 0;
        let modalPnlPercent = pos.unrealizedPnlLeveredPercent ?? 0;
        let modalLiqPrice = pos.liquidationPrice ?? 0;

        // Client-side fallback calculation
        if (modalPnl === 0 && currentPrice > 0 && pos.avgEntryPrice > 0) {
          const priceDiff = pos.side === 'long'
            ? currentPrice - pos.avgEntryPrice
            : pos.avgEntryPrice - currentPrice;
          const rawPnl = priceDiff * pos.volume;
          const margin = pos.totalCost / pos.leverage;
          modalPnl = rawPnl - pos.totalFees;
          modalPnlPercent = margin > 0 ? (modalPnl / margin) * 100 : 0;
        }

        if (modalLiqPrice === 0 && pos.avgEntryPrice > 0 && pos.leverage > 0) {
          const liqDistance = pos.avgEntryPrice / pos.leverage * 0.8;
          modalLiqPrice = pos.side === 'long'
            ? pos.avgEntryPrice - liqDistance
            : pos.avgEntryPrice + liqDistance;
        }

        return (
          <PositionAnalysisModal
            isOpen={true}
            onClose={() => setAnalyzingPosition(null)}
            positionId={pos.id}
            positionData={{
              pair: pos.pair,
              side: pos.side,
              leverage: pos.leverage,
              entryPrice: pos.avgEntryPrice,
              currentPrice,
              liquidationPrice: modalLiqPrice,
              volume: pos.volume,
              unrealizedPnl: modalPnl,
              pnlPercent: modalPnlPercent,
              marginUsed: pos.marginUsed ?? pos.totalCost / pos.leverage,
              hoursOpen: positionHealthMap.get(pos.id)!.hoursOpen,
            }}
            health={positionHealthMap.get(pos.id)!}
          />
        );
      })()}

      {/* Close Position Confirmation Modal */}
      {confirmCloseId && (() => {
        const pos = positions.find(p => p.id === confirmCloseId);
        if (!pos) return null;

        // Calculate P&L for display
        let pnl = pos.unrealizedPnlLevered ?? 0;
        if (pnl === 0 && currentPrice > 0 && pos.avgEntryPrice > 0) {
          const priceDiff = pos.side === 'long'
            ? currentPrice - pos.avgEntryPrice
            : pos.avgEntryPrice - currentPrice;
          const rawPnl = priceDiff * pos.volume;
          pnl = rawPnl - pos.totalFees;
        }
        const isProfitable = pnl >= 0;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setConfirmCloseId(null)}
            />
            <div className="relative bg-secondary border border-primary rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
              <div className={`${isProfitable ? 'bg-green-500' : 'bg-red-500'} px-6 py-4`}>
                <h2 className="text-xl font-bold text-white">Confirm Close Position</h2>
                <p className="text-white/80 text-sm mt-1">
                  Close {pos.side.toUpperCase()} {pos.volume.toFixed(2)} XRP
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-tertiary rounded-lg p-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary">Entry Price</span>
                    <span className="mono">€{pos.avgEntryPrice.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary">Close Price</span>
                    <span className="mono">€{currentPrice.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-primary pt-3">
                    <span className="text-secondary">Estimated P&L</span>
                    <span className={`mono font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                      {isProfitable ? '+' : ''}€{pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-orange-500/20 border border-orange-500/40">
                  <p className="text-sm text-orange-300 text-center">
                    Paper Trading - This is a simulated close
                  </p>
                </div>
              </div>
              <div className="px-6 py-4 bg-tertiary border-t border-primary flex gap-3">
                <button
                  onClick={() => setConfirmCloseId(null)}
                  className="flex-1 btn btn-secondary py-3 font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => executeClosePosition(confirmCloseId)}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                    isProfitable
                      ? 'bg-green-500 hover:bg-green-400 text-black'
                      : 'bg-red-500 hover:bg-red-400 text-white'
                  }`}
                >
                  Close Position
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

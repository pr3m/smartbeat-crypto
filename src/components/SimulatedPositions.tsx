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
      const health = calculatePositionHealth({
        side: pos.side,
        entryPrice: pos.avgEntryPrice,
        currentPrice,
        liquidationPrice: pos.liquidationPrice ?? 0,
        leverage: pos.leverage,
        marginUsed: pos.marginUsed ?? pos.totalCost / pos.leverage,
        equity,
        openedAt: pos.openedAt,
      });
      map.set(pos.id, health);
    }

    return map;
  }, [positions, currentPrice, simulatedBalance?.equity]);

  const closePosition = async (positionId: string) => {
    if (!currentPrice) {
      addToast({
        title: 'Error',
        message: 'Cannot close position: no current price',
        type: 'error',
      });
      return;
    }

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
        const pnl = pos.unrealizedPnlLevered ?? 0;
        const pnlPercent = pos.unrealizedPnlLeveredPercent ?? 0;
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
                    onClick={() => closePosition(pos.id)}
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
                  €{(pos.liquidationPrice ?? 0).toFixed(4)}
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
      {analyzingPosition && positionHealthMap.get(analyzingPosition.id) && (
        <PositionAnalysisModal
          isOpen={true}
          onClose={() => setAnalyzingPosition(null)}
          positionId={analyzingPosition.id}
          positionData={{
            pair: analyzingPosition.pair,
            side: analyzingPosition.side,
            leverage: analyzingPosition.leverage,
            entryPrice: analyzingPosition.avgEntryPrice,
            currentPrice,
            liquidationPrice: analyzingPosition.liquidationPrice ?? 0,
            volume: analyzingPosition.volume,
            unrealizedPnl: analyzingPosition.unrealizedPnlLevered ?? 0,
            pnlPercent: analyzingPosition.unrealizedPnlLeveredPercent ?? 0,
            marginUsed: analyzingPosition.marginUsed ?? analyzingPosition.totalCost / analyzingPosition.leverage,
            hoursOpen: positionHealthMap.get(analyzingPosition.id)!.hoursOpen,
          }}
          health={positionHealthMap.get(analyzingPosition.id)!}
        />
      )}
    </div>
  );
}

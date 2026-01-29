'use client';

import { useState } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { PositionHealthBadge } from './PositionHealthBadge';
import type { PositionHealthMetrics } from '@/lib/trading/position-health';

export interface PositionCardData {
  id: string;
  pair: string;
  side: 'long' | 'short';
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  volume: number;
  margin: number;
  fee: number;
  rolloverCost: number;
  hasActualRollover: boolean;
  openTime: number;
}

interface PositionCardProps {
  position: PositionCardData;
  health?: PositionHealthMetrics;

  // Feature toggles
  showAnalyzeButton?: boolean;
  showCloseButton?: boolean;
  showRiskBadge?: boolean;
  showRolloverDetails?: boolean;
  showNetPnL?: boolean;

  // Callbacks
  onAnalyze?: () => void;
  onClose?: () => void;

  // Loading states
  isClosing?: boolean;

  // Custom styling
  compact?: boolean;
}

export function PositionCard({
  position,
  health,
  showAnalyzeButton = false,
  showCloseButton = false,
  showRiskBadge = false,
  showRolloverDetails = true,
  showNetPnL = true,
  onAnalyze,
  onClose,
  isClosing = false,
  compact = false,
}: PositionCardProps) {
  const [expandedRisk, setExpandedRisk] = useState(false);

  // Calculate P&L (guard against invalid currentPrice)
  const calculateGrossPnL = (): number => {
    const { side, volume, entryPrice, currentPrice, fee } = position;
    // If currentPrice is 0 or invalid, use entryPrice to show 0 P&L (minus fees)
    const effectivePrice = currentPrice > 0 ? currentPrice : entryPrice;
    if (side === 'long') {
      return (effectivePrice - entryPrice) * volume - fee;
    } else {
      return (entryPrice - effectivePrice) * volume - fee;
    }
  };

  const grossPnL = calculateGrossPnL();
  const netPnL = grossPnL - position.rolloverCost;
  const isProfitable = netPnL >= 0;
  const pnlPercent = position.margin > 0 ? (netPnL / position.margin) * 100 : 0;

  // Calculate time since open
  const getTimeSinceOpen = (): string => {
    if (!position.openTime || isNaN(position.openTime)) return '-';
    const elapsed = Date.now() - position.openTime;
    if (elapsed < 0) return '-';
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    if (hours < 1) {
      const mins = Math.floor(elapsed / (1000 * 60));
      return `${mins}m`;
    }
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  };

  const timeSinceOpen = getTimeSinceOpen();
  const hoursSinceOpen = (Date.now() - position.openTime) / (1000 * 60 * 60);
  const isOverdue = hoursSinceOpen > 72;

  // Format pair name
  const displayPair = position.pair
    .replace('XXRP', 'XRP')
    .replace('ZEUR', '/EUR')
    .replace('XRPEUR', 'XRP/EUR');

  return (
    <div
      className={`p-3 rounded-lg ${
        isProfitable
          ? 'bg-green-500/10 border border-green-500/30'
          : 'bg-red-500/10 border border-red-500/30'
      }`}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-bold ${
              position.side === 'long'
                ? 'bg-green-500 text-black'
                : 'bg-red-500 text-white'
            }`}
          >
            {position.side === 'long' ? 'LONG' : 'SHORT'}
          </span>
          <span className="font-semibold">{displayPair}</span>

          {/* Risk Badge */}
          {showRiskBadge && health && (
            <button
              onClick={() => setExpandedRisk(!expandedRisk)}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-all ${
                health.riskLevel === 'extreme'
                  ? 'bg-red-500/30 text-red-400 border border-red-500/50'
                  : health.riskLevel === 'high'
                  ? 'bg-orange-500/30 text-orange-400 border border-orange-500/50'
                  : health.riskLevel === 'medium'
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                  : 'bg-green-500/20 text-green-400 border border-green-500/40'
              } ${expandedRisk ? 'ring-2 ring-offset-1 ring-offset-transparent' : 'hover:opacity-80'}`}
              title="Click to view risk details"
            >
              {health.riskLevel === 'extreme' && '⚠️ '}
              {health.riskLevel === 'high' && '⚡ '}
              {health.riskLevel.toUpperCase()}
              <span className="ml-1 opacity-70">{expandedRisk ? '▲' : '▼'}</span>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {showAnalyzeButton && onAnalyze && (
            <Tooltip content="Analyze with AI" position="left">
              <button
                onClick={onAnalyze}
                className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded transition-colors"
              >
                ⚡
              </button>
            </Tooltip>
          )}

          {showCloseButton && onClose && (
            <button
              onClick={onClose}
              disabled={isClosing}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                isClosing
                  ? 'bg-gray-500/20 text-gray-400 cursor-wait'
                  : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
              }`}
            >
              {isClosing ? 'Closing...' : 'Close'}
            </button>
          )}

          <Tooltip
            content={`Opened: ${new Date(position.openTime).toLocaleString()}${isOverdue ? ' ⚠️ Consider closing!' : ''}`}
            position="left"
          >
            <span className={`text-xs ${isOverdue ? 'text-warning font-bold' : 'text-tertiary'}`}>
              {isOverdue ? '⚠️ ' : ''}{timeSinceOpen}
            </span>
          </Tooltip>
        </div>
      </div>

      {/* Data Grid */}
      <div className={`grid ${showNetPnL ? 'grid-cols-5' : 'grid-cols-4'} gap-2 text-sm`}>
        <Tooltip content={`Entry price: €${position.entryPrice.toFixed(4)}`} position="bottom">
          <div className="cursor-help">
            <div className="text-xs text-tertiary">Entry</div>
            <div className="mono">€{position.entryPrice.toFixed(4)}</div>
          </div>
        </Tooltip>

        <Tooltip content="Current market price (real-time)" position="bottom">
          <div className="cursor-help">
            <div className="text-xs text-tertiary">Current</div>
            <div className="mono">€{position.currentPrice.toFixed(4)}</div>
          </div>
        </Tooltip>

        <Tooltip content={`Position size: ${position.volume.toFixed(2)} XRP with €${position.margin.toFixed(2)} margin (${position.leverage}x)`} position="bottom">
          <div className="cursor-help">
            <div className="text-xs text-tertiary">Size</div>
            <div className="mono">{position.volume.toFixed(2)} XRP</div>
          </div>
        </Tooltip>

        {showNetPnL ? (
          <>
            <Tooltip content={`Unrealized P&L before rollover costs (fee: €${position.fee.toFixed(2)} already deducted)`} position="bottom">
              <div className="cursor-help">
                <div className="text-xs text-tertiary">Gross P&L</div>
                <div className={`mono ${grossPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {grossPnL >= 0 ? '+' : ''}€{grossPnL.toFixed(2)}
                </div>
              </div>
            </Tooltip>

            <Tooltip
              content={
                <div>
                  <div className="font-semibold mb-1">Net P&L Breakdown</div>
                  <div>P&L (incl. fee): €{grossPnL.toFixed(2)}</div>
                  <div className="text-yellow-400">Rollover: -€{position.rolloverCost.toFixed(2)}</div>
                  <div className="border-t border-gray-600 mt-1 pt-1 font-semibold">
                    Net: €{netPnL.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    (Fee €{position.fee.toFixed(2)} already in P&L)
                  </div>
                </div>
              }
              position="bottom"
            >
              <div className="cursor-help">
                <div className="text-xs text-tertiary">Net P&L</div>
                <div className={`mono font-bold ${netPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                  {netPnL >= 0 ? '+' : ''}€{netPnL.toFixed(2)}
                </div>
              </div>
            </Tooltip>
          </>
        ) : (
          <Tooltip content={`Unrealized P&L: ${pnlPercent.toFixed(2)}% on margin`} position="bottom">
            <div className="cursor-help">
              <div className="text-xs text-tertiary">P&L</div>
              <div className={`mono font-bold ${grossPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                {grossPnL >= 0 ? '+' : ''}€{grossPnL.toFixed(2)}
              </div>
            </div>
          </Tooltip>
        )}
      </div>

      {/* Rollover Details Row */}
      {showRolloverDetails && (
        <div className="mt-2 pt-2 border-t border-primary flex items-center justify-between text-xs text-tertiary">
          <Tooltip
            content={position.hasActualRollover
              ? `Actual rollover fees from ledger (position open ${timeSinceOpen})`
              : `Estimated rollover fees over ${timeSinceOpen} (~0.015% per 4h)`}
            position="top"
          >
            <span className="cursor-help">
              {position.hasActualRollover ? 'Rollover' : 'Est. Rollover'}: <span className="text-warning">-€{position.rolloverCost.toFixed(2)}</span>
            </span>
          </Tooltip>
          <Tooltip content={`Trading fee paid when opening: €${position.fee.toFixed(2)}`} position="top">
            <span className="cursor-help">
              Fee: €{position.fee.toFixed(2)}
            </span>
          </Tooltip>
          <Tooltip content={`Margin used: €${position.margin.toFixed(2)}`} position="top">
            <span className="cursor-help">
              Margin: €{position.margin.toFixed(2)}
            </span>
          </Tooltip>
        </div>
      )}

      {/* Health Metrics (collapsible) */}
      {showRiskBadge && health && expandedRisk && (
        <div className="mt-2 animate-fade-in">
          <PositionHealthBadge health={health} />
        </div>
      )}
    </div>
  );
}

/**
 * Summary component for multiple positions
 */
interface PositionsSummaryProps {
  positions: PositionCardData[];
}

export function PositionsSummary({ positions }: PositionsSummaryProps) {
  // P&L calculation helper (same as in PositionCard, with guard for invalid price)
  const calculateGrossPnL = (pos: PositionCardData): number => {
    const { side, volume, entryPrice, currentPrice, fee } = pos;
    // If currentPrice is 0 or invalid, use entryPrice to show 0 P&L (minus fees)
    const effectivePrice = currentPrice > 0 ? currentPrice : entryPrice;
    if (side === 'long') {
      return (effectivePrice - entryPrice) * volume - fee;
    } else {
      return (entryPrice - effectivePrice) * volume - fee;
    }
  };

  const totalPnLWithFees = positions.reduce((sum, p) => sum + calculateGrossPnL(p), 0);
  const totalRollover = positions.reduce((sum, p) => sum + p.rolloverCost, 0);
  const totalFees = positions.reduce((sum, p) => sum + p.fee, 0);
  const totalNetPnL = totalPnLWithFees - totalRollover;

  return (
    <div className="mt-3 pt-3 border-t border-primary space-y-1 text-sm">
      <div className="flex items-center justify-between text-tertiary">
        <span>P&L (after fees):</span>
        <span className={`mono ${totalPnLWithFees >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {totalPnLWithFees >= 0 ? '+' : ''}€{totalPnLWithFees.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between text-tertiary text-xs">
        <Tooltip
          content={
            <div>
              <div>Opening Fees: €{totalFees.toFixed(2)} (already in P&L)</div>
              <div>Rollover Costs: €{totalRollover.toFixed(2)}</div>
            </div>
          }
          position="top"
        >
          <span className="cursor-help">Total Rollover:</span>
        </Tooltip>
        <span className="mono text-warning">
          -€{totalRollover.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between pt-1 border-t border-primary/50">
        <span className="text-secondary font-medium">Total Net P&L:</span>
        <span className={`font-bold mono ${totalNetPnL >= 0 ? 'text-success' : 'text-danger'}`}>
          {totalNetPnL >= 0 ? '+' : ''}€{totalNetPnL.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

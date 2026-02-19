'use client';

import { useState, useCallback } from 'react';
import type {
  PositionState,
  PositionSizingResult,
  DCASignal,
  ExitSignal,
  TradingEngineConfig,
} from '@/lib/trading/v2-types';
import type { TradingRecommendation } from '@/lib/kraken/types';
import type {
  QuickEntryParams,
  QuickCloseParams,
  QuickDCAParams,
  QuickTrailingStopParams,
  QuickTakeProfitParams,
  QuickActionParams,
} from './types';
import { QuickConfirmModal } from './QuickConfirmModal';

// ============================================================================
// PROPS
// ============================================================================

export interface DashboardActionsProps {
  mode: 'idle' | 'active';
  testMode: boolean;
  currentPrice: number;
  orderInFlight: boolean;

  // Data from v2 engine
  position: PositionState | null;
  sizing: PositionSizingResult | null;
  dcaSignal: DCASignal | null;
  exitSignal: ExitSignal | null;
  config: TradingEngineConfig;
  recommendation: TradingRecommendation | null;

  // Action callbacks
  onEntryExecute?: (params: QuickEntryParams) => Promise<void>;
  onCloseExecute?: (params: QuickCloseParams) => Promise<void>;
  onDCAExecute?: (params: QuickDCAParams) => Promise<void>;
  onTrailingStopExecute?: (params: QuickTrailingStopParams) => Promise<void>;
  onTakeProfitExecute?: (params: QuickTakeProfitParams) => Promise<void>;
  onOpenTradeDrawer?: () => void;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function DashboardActions({
  mode,
  testMode,
  currentPrice,
  orderInFlight,
  position,
  sizing,
  dcaSignal,
  exitSignal,
  config,
  recommendation,
  onEntryExecute,
  onCloseExecute,
  onDCAExecute,
  onTrailingStopExecute,
  onTakeProfitExecute,
  onOpenTradeDrawer,
}: DashboardActionsProps) {
  const [modalAction, setModalAction] = useState<QuickActionParams | null>(null);
  const [selectedExitPercent, setSelectedExitPercent] = useState<number>(100);
  const [trailingOffset, setTrailingOffset] = useState<number>(3);
  const [tpPrice, setTpPrice] = useState<number>(0);

  // Determine if any callbacks are provided
  const hasCallbacks = onEntryExecute || onCloseExecute || onDCAExecute || onTrailingStopExecute || onTakeProfitExecute;
  if (!hasCallbacks) return null;

  const disabled = orderInFlight;

  const handleModalConfirm = async (modifiedAction: QuickActionParams) => {
    switch (modifiedAction.type) {
      case 'entry':
        await onEntryExecute?.(modifiedAction.params);
        break;
      case 'close':
        await onCloseExecute?.(modifiedAction.params);
        break;
      case 'dca':
        await onDCAExecute?.(modifiedAction.params);
        break;
      case 'trailing-stop':
        await onTrailingStopExecute?.(modifiedAction.params);
        break;
      case 'take-profit':
        await onTakeProfitExecute?.(modifiedAction.params);
        break;
    }
  };

  if (mode === 'idle') {
    return (
      <>
        <IdleActions
          sizing={sizing}
          recommendation={recommendation}
          config={config}
          currentPrice={currentPrice}
          disabled={disabled}
          onAction={setModalAction}
          onOpenTradeDrawer={onOpenTradeDrawer}
        />
        <QuickConfirmModal
          isOpen={modalAction !== null}
          onClose={() => setModalAction(null)}
          onConfirm={handleModalConfirm}
          action={modalAction || { type: 'entry', params: { direction: 'long', entryMode: 'full', volume: 0, marginToUse: 0, marginPercent: 0, leverage: 10, confidence: 0 } }}
          testMode={testMode}
          currentPrice={currentPrice}
        />
      </>
    );
  }

  // Active position mode
  const pos = position;
  if (!pos || !pos.isOpen) return null;

  const isProfitable = pos.unrealizedPnL > 0;
  const hasExitSignal = exitSignal?.shouldExit ?? false;
  const hasDCA = dcaSignal?.shouldDCA && pos.dcaCount < config.positionSizing.maxDCACount;
  const defaultExitPercent = exitSignal?.suggestedExitPercent || 100;

  return (
    <>
      <div className="space-y-2">
        {/* Close Position */}
        {onCloseExecute && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              {([25, 50, 75, 100] as const).map((pct) => (
                <button
                  key={pct}
                  onClick={() => setSelectedExitPercent(pct)}
                  className={`flex-1 py-1 text-xs font-semibold rounded transition-colors ${
                    selectedExitPercent === pct
                      ? 'bg-white/20 text-primary'
                      : 'bg-tertiary/50 text-tertiary hover:text-secondary'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
            <button
              disabled={disabled}
              onClick={() => {
                const pct = selectedExitPercent || defaultExitPercent;
                setModalAction({
                  type: 'close',
                  params: {
                    exitPercent: pct,
                    volumeToClose: pos.totalVolume * pct / 100,
                    isEngineRecommended: hasExitSignal,
                  },
                });
              }}
              className={`w-full py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                hasExitSignal
                  ? 'bg-red-500 hover:bg-red-400 text-white animate-pulse'
                  : 'bg-gray-600 hover:bg-gray-500 text-white'
              }`}
            >
              {hasExitSignal
                ? `EXIT ${selectedExitPercent}% - ${exitSignal?.urgency?.toUpperCase()}`
                : `CLOSE ${selectedExitPercent}%`}
            </button>
          </div>
        )}

        {/* DCA Button */}
        {onDCAExecute && (
          <button
            disabled={disabled || !hasDCA}
            onClick={() => {
              if (!dcaSignal || !hasDCA) return;
              const marginAvailable = pos.totalMarginUsed > 0
                ? (pos.totalMarginUsed / (pos.totalMarginPercent / 100)) - pos.totalMarginUsed
                : 0;
              const dcaMarginPercent = dcaSignal.suggestedMarginPercent || config.positionSizing.dcaMarginPercent;
              const totalEquity = pos.totalMarginUsed / (pos.totalMarginPercent / 100);
              const dcaMargin = totalEquity * (dcaMarginPercent / 100);
              const dcaVolume = currentPrice > 0 ? (dcaMargin * config.positionSizing.leverage) / currentPrice : 0;

              setModalAction({
                type: 'dca',
                params: {
                  dcaLevel: dcaSignal.dcaLevel,
                  direction: pos.direction,
                  volume: dcaVolume,
                  marginToUse: Math.min(dcaMargin, marginAvailable),
                  confidence: dcaSignal.confidence,
                  currentAvgPrice: pos.avgPrice,
                  currentVolume: pos.totalVolume,
                },
              });
            }}
            className={`w-full py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              hasDCA
                ? 'bg-blue-500 hover:bg-blue-400 text-white'
                : 'bg-gray-700 text-gray-500'
            }`}
          >
            {pos.dcaCount >= config.positionSizing.maxDCACount
              ? 'MAX DCA REACHED'
              : hasDCA
                ? `DCA LEVEL ${dcaSignal!.dcaLevel} - ${dcaSignal!.confidence}%`
                : 'DCA (waiting for signal)'}
          </button>
        )}

        {/* Trailing Stop + Take Profit row */}
        {isProfitable && (onTrailingStopExecute || onTakeProfitExecute) && (
          <div className="flex gap-2">
            {/* Trailing Stop */}
            {onTrailingStopExecute && (
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={trailingOffset}
                    onChange={(e) => setTrailingOffset(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    className="w-14 text-xs mono bg-tertiary rounded px-1.5 py-1 text-center border border-primary focus:outline-none focus:border-blue-500"
                    step="0.5"
                    min="0.1"
                  />
                  <span className="text-xs text-tertiary">%</span>
                </div>
                <button
                  disabled={disabled}
                  onClick={() => {
                    setModalAction({
                      type: 'trailing-stop',
                      params: {
                        direction: pos.direction,
                        offset: trailingOffset,
                        offsetType: 'percent',
                        volume: pos.totalVolume,
                      },
                    });
                  }}
                  className="w-full py-1.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  TRAIL STOP
                </button>
              </div>
            )}

            {/* Take Profit */}
            {onTakeProfitExecute && (
              <div className="flex-1 space-y-1">
                <input
                  type="number"
                  value={tpPrice || currentPrice}
                  onChange={(e) => setTpPrice(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs mono bg-tertiary rounded px-1.5 py-1 text-center border border-primary focus:outline-none focus:border-blue-500"
                  step="0.0001"
                  min="0"
                />
                <button
                  disabled={disabled}
                  onClick={() => {
                    setModalAction({
                      type: 'take-profit',
                      params: {
                        direction: pos.direction,
                        price: tpPrice || currentPrice,
                        volume: pos.totalVolume,
                      },
                    });
                  }}
                  className="w-full py-1.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  TAKE PROFIT
                </button>
              </div>
            )}
          </div>
        )}

        {/* Custom Order link */}
        {onOpenTradeDrawer && (
          <button
            onClick={onOpenTradeDrawer}
            className="w-full text-xs text-tertiary hover:text-secondary transition-colors py-1"
          >
            Open full trade panel
          </button>
        )}
      </div>

      <QuickConfirmModal
        isOpen={modalAction !== null}
        onClose={() => setModalAction(null)}
        onConfirm={handleModalConfirm}
        action={modalAction || { type: 'close', params: { exitPercent: 100, volumeToClose: 0, isEngineRecommended: false } }}
        testMode={testMode}
        currentPrice={currentPrice}
      />
    </>
  );
}

// ============================================================================
// IDLE ACTIONS
// ============================================================================

function IdleActions({
  sizing,
  recommendation,
  config,
  currentPrice,
  disabled,
  onAction,
  onOpenTradeDrawer,
}: {
  sizing: PositionSizingResult | null;
  recommendation: TradingRecommendation | null;
  config: TradingEngineConfig;
  currentPrice: number;
  disabled: boolean;
  onAction: (action: QuickActionParams) => void;
  onOpenTradeDrawer?: () => void;
}) {
  if (!sizing || !recommendation) {
    return onOpenTradeDrawer ? (
      <button
        onClick={onOpenTradeDrawer}
        className="w-full text-xs text-tertiary hover:text-secondary transition-colors py-1"
      >
        Open full trade panel
      </button>
    ) : null;
  }

  // Determine trade direction from recommendation
  const direction = recommendation.action === 'SHORT' ? 'short'
    : recommendation.action === 'LONG' ? 'long'
    : (recommendation.short.strength > recommendation.long.strength ? 'short' : 'long');

  return (
    <div className="space-y-2">
      {sizing.shouldEnter ? (
        <button
          disabled={disabled}
          onClick={() => {
            onAction({
              type: 'entry',
              params: {
                direction: direction as 'long' | 'short',
                entryMode: sizing.entryMode as 'full' | 'cautious',
                volume: sizing.volume,
                marginToUse: sizing.marginToUse,
                marginPercent: sizing.marginPercent,
                leverage: config.positionSizing.leverage,
                confidence: recommendation.confidence,
              },
            });
          }}
          className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            sizing.entryMode === 'full'
              ? direction === 'long'
                ? 'bg-green-500 hover:bg-green-400 text-black'
                : 'bg-red-500 hover:bg-red-400 text-white'
              : direction === 'long'
                ? 'bg-amber-500 hover:bg-amber-400 text-black'
                : 'bg-amber-600 hover:bg-amber-500 text-white'
          }`}
        >
          {sizing.entryMode === 'full'
            ? `FULL ${direction.toUpperCase()} ${sizing.marginPercent.toFixed(0)}%`
            : `CAUTIOUS ${direction.toUpperCase()} ${sizing.marginPercent.toFixed(0)}%`}
          <span className="block text-xs opacity-75 font-normal mt-0.5">
            {recommendation.confidence}% confidence - {sizing.volume.toFixed(1)} XRP
          </span>
        </button>
      ) : (
        <div className="w-full py-2 rounded-lg text-sm text-center text-tertiary bg-tertiary/30">
          {sizing.skipReason || 'No entry signal'}
        </div>
      )}

      {onOpenTradeDrawer && (
        <button
          onClick={onOpenTradeDrawer}
          className="w-full text-xs text-tertiary hover:text-secondary transition-colors py-1"
        >
          Open full trade panel
        </button>
      )}
    </div>
  );
}

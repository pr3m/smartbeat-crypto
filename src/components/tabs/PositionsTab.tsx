'use client';

import { useState, useMemo } from 'react';
import { useToast } from '@/components/Toast';
import { PositionAnalysisModal } from '@/components/PositionAnalysisModal';
import { PositionCard, PositionsSummary, type PositionCardData } from '@/components/PositionCard';
import { useTradingData } from '@/components/TradingDataProvider';
import { calculatePositionHealth, calculateKrakenLiquidationPrice, type PositionHealthMetrics } from '@/lib/trading/position-health';
import type { MarketSnapshot, TimeframeSnapshot } from '@/lib/ai/types';

interface PositionsTabProps {
  testMode: boolean;
  currentPrice: number;
  onPositionChange?: () => void;
}

type FilterType = 'all' | 'long' | 'short' | 'profitable' | 'losing';

export function PositionsTab({ testMode, currentPrice, onPositionChange }: PositionsTabProps) {
  const { addToast } = useToast();
  const [filter, setFilter] = useState<FilterType>('all');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<PositionCardData | null>(null);

  // Use TradingDataProvider for positions and market data
  const {
    openPositions: livePositions,
    openPositionsLoading: liveLoading,
    simulatedPositions,
    simulatedPositionsLoading,
    refreshOpenPositions,
    refreshSimulatedPositions,
    tradeBalance,
    tfData,
    btcTrend,
    btcChange,
    fearGreed,
    high24h,
    low24h,
    volume24h,
    openPrice,
  } = useTradingData();

  const loading = testMode ? simulatedPositionsLoading : liveLoading;

  // Estimate rollover fees for positions without actual data
  const estimateRolloverFees = (cost: number, openTime: number): number => {
    if (!openTime || isNaN(openTime) || !cost || isNaN(cost)) {
      return 0;
    }
    const hoursSinceOpen = (Date.now() - openTime) / (1000 * 60 * 60);
    if (hoursSinceOpen < 0) return 0;
    const rolloverPeriods = Math.floor(hoursSinceOpen / 4);
    return cost * 0.00015 * rolloverPeriods;
  };

  // Transform positions to PositionCardData format
  const positionCardData = useMemo((): PositionCardData[] => {
    if (testMode) {
      return simulatedPositions
        .filter(p => p.isOpen)
        .map(p => {
          const openTime = new Date(p.openedAt).getTime();
          return {
            id: p.id,
            pair: p.pair,
            side: p.side,
            leverage: p.leverage,
            entryPrice: p.avgEntryPrice,
            currentPrice,
            volume: p.volume,
            margin: p.totalCost / p.leverage,
            fee: p.totalFees,
            rolloverCost: estimateRolloverFees(p.totalCost, openTime),
            hasActualRollover: false,
            openTime,
          };
        });
    } else {
      return livePositions.map(p => {
        const hasActualRollover = p.actualRolloverCost > 0;
        return {
          id: p.id,
          pair: p.pair,
          side: p.type === 'buy' ? 'long' : 'short',
          leverage: p.leverage,
          entryPrice: p.cost / p.volume,
          currentPrice,
          volume: p.volume,
          margin: p.margin,
          fee: p.fee,
          rolloverCost: hasActualRollover ? p.actualRolloverCost : estimateRolloverFees(p.cost, p.openTime),
          hasActualRollover,
          openTime: p.openTime,
        };
      });
    }
  }, [testMode, simulatedPositions, livePositions, currentPrice]);

  // Calculate health metrics for live positions
  const positionHealthMap = useMemo(() => {
    if (testMode) return new Map<string, PositionHealthMetrics>();

    const map = new Map<string, PositionHealthMetrics>();
    const equity = tradeBalance?.e ? parseFloat(tradeBalance.e) : 2000;
    const tb = tradeBalance?.tb ? parseFloat(tradeBalance.tb) : equity;

    for (const pos of livePositions) {
      const entryPrice = pos.cost / pos.volume;
      const side = pos.type === 'buy' ? 'long' : 'short';

      const liquidationPrice = calculateKrakenLiquidationPrice({
        side,
        entryPrice,
        volume: pos.volume,
        marginUsed: pos.margin,
        leverage: pos.leverage,
        equity,
        tradeBalance: tb,
      });

      const health = calculatePositionHealth({
        side,
        entryPrice,
        currentPrice,
        liquidationPrice,
        leverage: pos.leverage,
        marginUsed: pos.margin,
        equity,
        openedAt: new Date(pos.openTime),
      });
      map.set(pos.id, health);
    }

    return map;
  }, [testMode, livePositions, currentPrice, tradeBalance?.e, tradeBalance?.tb]);

  // Build market snapshot for AI analysis
  const marketSnapshot = useMemo((): MarketSnapshot | undefined => {
    if (!currentPrice || currentPrice === 0) return undefined;

    const buildTimeframeSnapshot = (interval: number): TimeframeSnapshot | null => {
      const data = tfData[interval];
      if (!data?.indicators) return null;

      const ind = data.indicators;
      return {
        bias: ind.signal || 'neutral',
        rsi: ind.rsi || 50,
        macd: ind.macd?.value || 0,
        macdSignal: ind.macd?.signal || 0,
        bbPosition: ind.bollinger?.position || 50,
        bbUpper: ind.bollinger?.upper || 0,
        bbLower: ind.bollinger?.lower || 0,
        atr: ind.atr || 0,
        atrPercent: currentPrice > 0 ? ((ind.atr || 0) / currentPrice) * 100 : 0,
        volumeRatio: ind.volumeRatio || 1,
        score: ind.score || 0,
      };
    };

    const priceChange24h = openPrice > 0 ? ((currentPrice - openPrice) / openPrice) * 100 : 0;

    return {
      timestamp: new Date().toISOString(),
      pair: 'XRPEUR',
      currentPrice,
      priceChange24h,
      high24h,
      low24h,
      volume24h,
      btc: {
        trend: btcTrend,
        change24h: btcChange,
      },
      timeframes: {
        '5m': buildTimeframeSnapshot(5),
        '15m': buildTimeframeSnapshot(15),
        '1h': buildTimeframeSnapshot(60),
        '4h': buildTimeframeSnapshot(240),
      },
      recommendation: null,
      fearGreed: fearGreed || undefined,
    };
  }, [currentPrice, tfData, openPrice, high24h, low24h, volume24h, btcTrend, btcChange, fearGreed]);

  // Calculate P&L for a position (used for filtering)
  // Guard against invalid currentPrice (shows 0 P&L minus fees if price unavailable)
  const calculatePnL = (pos: PositionCardData): number => {
    const effectivePrice = pos.currentPrice > 0 ? pos.currentPrice : pos.entryPrice;
    if (pos.side === 'long') {
      return (effectivePrice - pos.entryPrice) * pos.volume - pos.fee;
    } else {
      return (pos.entryPrice - effectivePrice) * pos.volume - pos.fee;
    }
  };

  const refreshPositions = () => {
    if (testMode) {
      refreshSimulatedPositions(true);
    } else {
      refreshOpenPositions(true);
    }
  };

  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  const handleClosePosition = (positionId: string) => {
    if (!testMode) {
      addToast({
        title: 'Live Trading',
        message: 'Please use Kraken directly to close live positions',
        type: 'info',
      });
      return;
    }
    // Show confirmation dialog
    setConfirmCloseId(positionId);
  };

  const executeClosePosition = async (positionId: string) => {
    setConfirmCloseId(null);
    setClosingId(positionId);
    try {
      const res = await fetch('/api/simulated/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, closePrice: currentPrice }),
      });

      const data = await res.json();

      if (data.success) {
        addToast({
          title: 'Position Closed',
          message: `P&L: €${data.realizedPnl?.toFixed(2) || '0'}`,
          type: data.realizedPnl >= 0 ? 'success' : 'error',
        });
        refreshPositions();
        onPositionChange?.();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      addToast({
        title: 'Failed to Close',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setClosingId(null);
    }
  };

  // Filter positions
  const filteredPositions = positionCardData.filter(p => {
    const pnl = calculatePnL(p);
    switch (filter) {
      case 'long':
        return p.side === 'long';
      case 'short':
        return p.side === 'short';
      case 'profitable':
        return pnl >= 0;
      case 'losing':
        return pnl < 0;
      default:
        return true;
    }
  });

  // Calculate totals for summary card
  const totalPnL = filteredPositions.reduce((sum, p) => sum + calculatePnL(p), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Mode Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {testMode ? '🧪 Test Positions' : '⚡ Live Positions'}
          </h2>
          <p className="text-sm text-secondary">
            {filteredPositions.length} open position{filteredPositions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
          testMode
            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
            : 'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {testMode ? 'Paper Trading' : 'Real Money'}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'long', 'short', 'profitable', 'losing'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? 'bg-blue-500 text-white'
                : 'bg-tertiary text-secondary hover:bg-primary'
            }`}
          >
            {f === 'all' && 'All'}
            {f === 'long' && '↑ Long'}
            {f === 'short' && '↓ Short'}
            {f === 'profitable' && '✓ Profitable'}
            {f === 'losing' && '✗ Losing'}
          </button>
        ))}
      </div>

      {/* Summary Card */}
      {filteredPositions.length > 0 && (
        <div className="card p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-tertiary uppercase">Total P&L</div>
              <div className={`text-xl font-bold ${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {totalPnL >= 0 ? '+' : ''}€{totalPnL.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary uppercase">Current Price</div>
              <div className="text-xl font-bold">€{currentPrice.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-xs text-tertiary uppercase">Positions</div>
              <div className="text-xl font-bold">{filteredPositions.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* Positions List */}
      {filteredPositions.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">📭</div>
          <h3 className="text-lg font-semibold mb-1">No Open Positions</h3>
          <p className="text-secondary text-sm">
            {filter === 'all'
              ? 'Open a position from the Setup tab to get started.'
              : `No ${filter} positions found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPositions.map(position => {
            const health = positionHealthMap.get(position.id);
            const isClosing = closingId === position.id;

            return (
              <PositionCard
                key={position.id}
                position={position}
                health={health}
                showAnalyzeButton
                showCloseButton
                showRiskBadge={!testMode}
                showRolloverDetails
                showNetPnL
                onAnalyze={() => setSelectedPosition(position)}
                onClose={() => handleClosePosition(position.id)}
                isClosing={isClosing}
              />
            );
          })}

          {/* Summary */}
          <PositionsSummary positions={filteredPositions} />
        </div>
      )}

      {/* Position Analysis Modal */}
      {selectedPosition && (() => {
        const health = positionHealthMap.get(selectedPosition.id);
        const equity = tradeBalance?.e ? parseFloat(tradeBalance.e) : 2000;
        const tb = tradeBalance?.tb ? parseFloat(tradeBalance.tb) : equity;

        const liquidationPrice = calculateKrakenLiquidationPrice({
          side: selectedPosition.side,
          entryPrice: selectedPosition.entryPrice,
          volume: selectedPosition.volume,
          marginUsed: selectedPosition.margin,
          leverage: selectedPosition.leverage,
          equity,
          tradeBalance: tb,
        });

        const pnl = calculatePnL(selectedPosition);
        const pnlPercent = selectedPosition.margin > 0 ? (pnl / selectedPosition.margin) * 100 : 0;
        const hoursOpen = (Date.now() - selectedPosition.openTime) / (1000 * 60 * 60);

        return (
          <PositionAnalysisModal
            isOpen={true}
            onClose={() => setSelectedPosition(null)}
            positionId={selectedPosition.id}
            positionData={{
              pair: selectedPosition.pair,
              side: selectedPosition.side,
              leverage: selectedPosition.leverage,
              entryPrice: selectedPosition.entryPrice,
              currentPrice: selectedPosition.currentPrice,
              liquidationPrice,
              volume: selectedPosition.volume,
              unrealizedPnl: pnl,
              pnlPercent,
              marginUsed: selectedPosition.margin,
              hoursOpen,
            }}
            health={health || {
              riskLevel: 'low',
              liquidationDistance: 100,
              marginLevel: 1000,
              hoursOpen,
              isOverdue: hoursOpen > 72,
              healthScore: 90,
            }}
            marketSnapshot={marketSnapshot}
          />
        );
      })()}

      {/* Close Position Confirmation Modal */}
      {confirmCloseId && (() => {
        const position = positionCardData.find(p => p.id === confirmCloseId);
        if (!position) return null;
        const pnl = calculatePnL(position);
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
                  Close {position.side.toUpperCase()} {position.volume.toFixed(2)} XRP
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-tertiary rounded-lg p-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary">Entry Price</span>
                    <span className="mono">€{position.entryPrice.toFixed(4)}</span>
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
                <p className="text-sm text-tertiary text-center">
                  This will close your position at the current market price.
                </p>
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

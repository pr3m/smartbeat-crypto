'use client';

import { useCallback, useMemo, useState } from 'react';
import { HelpIcon } from '@/components/Tooltip';
import { useTradingData } from '@/components/TradingDataProvider';
import { PositionAnalysisModal } from './PositionAnalysisModal';
import { PositionCard, PositionsSummary, type PositionCardData } from './PositionCard';
import { calculatePositionHealth, calculateKrakenLiquidationPrice, type PositionHealthMetrics } from '@/lib/trading/position-health';
import type { MarketSnapshot, TimeframeSnapshot } from '@/lib/ai/types';

interface Position {
  id: string;
  pair: string;
  type: 'buy' | 'sell'; // buy = long, sell = short
  cost: number;
  fee: number;
  volume: number;
  margin: number;
  value: number;
  net: number;
  leverage: number;  // Actual leverage from Kraken
  openTime: number;
  rollovertm: number;
  actualRolloverCost: number; // From ledger
}

interface OpenPositionsProps {
  currentPrice: number;
  onClose?: () => void;
}

export function OpenPositions({ currentPrice, onClose }: OpenPositionsProps) {
  const [analyzingPosition, setAnalyzingPosition] = useState<Position | null>(null);
  const {
    openPositions: positions,
    openPositionsLoading: loading,
    openPositionsError: error,
    refreshOpenPositions,
    tradeBalance,
    // Market data for AI analysis
    tfData,
    btcTrend,
    btcChange,
    fearGreed,
    high24h,
    low24h,
    volume24h,
    openPrice,
  } = useTradingData();

  const handleRefresh = useCallback(() => {
    refreshOpenPositions(true);
  }, [refreshOpenPositions]);

  // Estimate rollover fees for positions without actual data
  const estimateRolloverFees = (position: Position): number => {
    if (!position.openTime || isNaN(position.openTime) || !position.cost || isNaN(position.cost)) {
      return 0;
    }
    const hoursSinceOpen = (Date.now() - position.openTime) / (1000 * 60 * 60);
    if (hoursSinceOpen < 0) return 0;
    const rolloverPeriods = Math.floor(hoursSinceOpen / 4);
    return position.cost * 0.00015 * rolloverPeriods;
  };

  // Calculate health metrics for all positions using Kraken's actual liquidation formula
  const positionHealthMap = useMemo(() => {
    const map = new Map<string, PositionHealthMetrics>();
    const equity = tradeBalance?.e ? parseFloat(tradeBalance.e) : 2000;
    const tb = tradeBalance?.tb ? parseFloat(tradeBalance.tb) : equity;

    for (const pos of positions) {
      const entryPrice = pos.cost / pos.volume;
      const side = pos.type === 'buy' ? 'long' : 'short';
      const leverage = pos.leverage;

      const liquidationPrice = calculateKrakenLiquidationPrice({
        side,
        entryPrice,
        volume: pos.volume,
        marginUsed: pos.margin,
        leverage,
        equity,
        tradeBalance: tb,
      });

      const health = calculatePositionHealth({
        side,
        entryPrice,
        currentPrice,
        liquidationPrice,
        leverage,
        marginUsed: pos.margin,
        equity,
        openedAt: new Date(pos.openTime),
      });
      map.set(pos.id, health);
    }

    return map;
  }, [positions, currentPrice, tradeBalance?.e, tradeBalance?.tb]);

  // Build market snapshot for AI position analysis
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

  // Transform positions to PositionCardData format
  const positionCardData = useMemo((): PositionCardData[] => {
    return positions.map(pos => {
      const hasActualRollover = pos.actualRolloverCost > 0;
      return {
        id: pos.id,
        pair: pos.pair,
        side: pos.type === 'buy' ? 'long' : 'short',
        leverage: pos.leverage,
        entryPrice: pos.cost / pos.volume,
        currentPrice,
        volume: pos.volume,
        margin: pos.margin,
        fee: pos.fee,
        rolloverCost: hasActualRollover ? pos.actualRolloverCost : estimateRolloverFees(pos),
        hasActualRollover,
        openTime: pos.openTime,
      };
    });
  }, [positions, currentPrice]);

  // Calculate real-time P&L for modal
  const calculateRealTimePnL = (position: Position): number => {
    if (!currentPrice || currentPrice === 0) return position.net;
    const entryPrice = position.cost / position.volume;
    const currentValue = position.volume * currentPrice;
    if (position.type === 'buy') {
      return currentValue - position.cost - position.fee;
    } else {
      return position.cost - currentValue - position.fee;
    }
  };

  // Don't render if no positions and not loading
  if (!loading && positions.length === 0) {
    return null;
  }

  // Don't render if error (no API keys)
  if (error === 'API keys not configured') {
    return null;
  }

  return (
    <div className="card p-4 border-2 border-blue-500/60 bg-blue-500/10">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="px-2 py-0.5 rounded bg-red-500/30 text-red-300 text-xs font-bold">LIVE</span>
          <span className="text-secondary">Open Positions</span>
          <HelpIcon
            tooltip={
              <div>
                <strong>Your Open Margin Positions</strong>
                <p className="mt-1">Shows real-time P&L based on current market price.</p>
                <p className="mt-2 text-yellow-400">Remember: Close within 72h to avoid excessive rollover fees!</p>
              </div>
            }
            position="right"
          />
        </h3>
        <button
          onClick={handleRefresh}
          className="text-xs text-secondary hover:text-primary transition-colors"
          title="Refresh positions"
        >
          ↻ Refresh
        </button>
      </div>

      {loading && (
        <div className="text-center py-4 text-secondary">
          Loading positions...
        </div>
      )}

      {error && error !== 'API keys not configured' && (
        <div className="text-center py-4 text-danger text-sm">
          {error}
        </div>
      )}

      {!loading && !error && positions.length > 0 && (
        <div className="space-y-3">
          {positionCardData.map((cardData, index) => {
            const originalPosition = positions[index];
            const health = positionHealthMap.get(originalPosition.id);

            return (
              <PositionCard
                key={cardData.id}
                position={cardData}
                health={health}
                showAnalyzeButton
                showRiskBadge
                showRolloverDetails
                showNetPnL
                onAnalyze={() => setAnalyzingPosition(originalPosition)}
              />
            );
          })}

          {/* Summary */}
          <PositionsSummary positions={positionCardData} />
        </div>
      )}

      {/* Position Analysis Modal */}
      {analyzingPosition && positionHealthMap.get(analyzingPosition.id) && (() => {
        const entryPrice = analyzingPosition.cost / analyzingPosition.volume;
        const side = analyzingPosition.type === 'buy' ? 'long' : 'short';
        const equity = tradeBalance?.e ? parseFloat(tradeBalance.e) : 2000;
        const tb = tradeBalance?.tb ? parseFloat(tradeBalance.tb) : equity;

        const liquidationPrice = calculateKrakenLiquidationPrice({
          side,
          entryPrice,
          volume: analyzingPosition.volume,
          marginUsed: analyzingPosition.margin,
          leverage: analyzingPosition.leverage,
          equity,
          tradeBalance: tb,
        });

        return (
          <PositionAnalysisModal
            isOpen={true}
            onClose={() => setAnalyzingPosition(null)}
            positionId={analyzingPosition.id}
            positionData={{
              pair: analyzingPosition.pair,
              side,
              leverage: analyzingPosition.leverage,
              entryPrice,
              currentPrice,
              liquidationPrice,
              volume: analyzingPosition.volume,
              unrealizedPnl: calculateRealTimePnL(analyzingPosition),
              pnlPercent: (calculateRealTimePnL(analyzingPosition) / analyzingPosition.margin) * 100,
              marginUsed: analyzingPosition.margin,
              hoursOpen: positionHealthMap.get(analyzingPosition.id)!.hoursOpen,
            }}
            health={positionHealthMap.get(analyzingPosition.id)!}
            marketSnapshot={marketSnapshot}
          />
        );
      })()}
    </div>
  );
}

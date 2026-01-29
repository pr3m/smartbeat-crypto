'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useKrakenWebSocketV2, type MicrostructureData } from '@/hooks/useKrakenWebSocketV2';
import { OrderBookDepth } from './OrderBookDepth';
import { TradeFlow } from './TradeFlow';
import { CVDChart } from './CVDChart';
import { SpreadMonitor } from './SpreadMonitor';
import { LargeOrderAlert } from './LargeOrderAlert';
import { Tooltip, HelpIcon } from '@/components/Tooltip';
import type { MicrostructureInput } from '@/lib/kraken/types';

interface MarketMicrostructureProps {
  pair?: string;
  onDataChange?: (data: MicrostructureInput | null) => void;
}

export function MarketMicrostructure({ pair = 'XRP/EUR', onDataChange }: MarketMicrostructureProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Only connect when expanded (lazy connection)
  const { status, data, aggregated, resetCVD } = useKrakenWebSocketV2(pair, isExpanded);

  // Use aggregated summary for recommendations (updated every minute for stability)
  const recommendationInput = useMemo((): MicrostructureInput | null => {
    if (aggregated.history.length > 0) {
      return aggregated.summary;
    }
    return null;
  }, [aggregated.history.length, aggregated.summary]);

  // Notify parent of data changes only when aggregated data updates (once per minute)
  useEffect(() => {
    onDataChange?.(recommendationInput);
  }, [recommendationInput, onDataChange]);

  const handleToggle = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  return (
    <div className="card overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={handleToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-tertiary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-xs text-tertiary uppercase tracking-wider flex items-center gap-2">
            Market Microstructure
            <HelpIcon
              tooltip={
                <div className="max-w-xs">
                  <strong>Market Microstructure</strong>
                  <p className="mt-1">Real-time order flow analysis for short-term trading decisions.</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    <li><strong>Order Book:</strong> Shows bid/ask imbalance</li>
                    <li><strong>Trade Flow:</strong> Real-time time & sales</li>
                    <li><strong>CVD:</strong> Cumulative Volume Delta (net buying pressure)</li>
                    <li><strong>Spread:</strong> Current spread monitoring</li>
                    <li><strong>Whales:</strong> Large order detection</li>
                  </ul>
                  <p className="mt-2 text-tertiary">Click to expand/collapse</p>
                </div>
              }
              position="right"
            />
          </h3>
          {isExpanded && (
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  status.connected
                    ? 'bg-green-500 animate-pulse-live'
                    : status.reconnecting
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-red-500'
                }`}
              />
              <span className="text-xs text-secondary">
                {status.connected ? 'Live' : status.reconnecting ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isExpanded && data.orderBook && (
            <div className="flex items-center gap-2 text-xs">
              <span className={`${data.orderBook.imbalance > 0.2 ? 'text-green-500' : data.orderBook.imbalance < -0.2 ? 'text-red-500' : 'text-secondary'}`}>
                {Math.abs(data.orderBook.imbalance * 100).toFixed(0)}% {data.orderBook.imbalance > 0 ? 'Bid' : 'Ask'}
              </span>
              <span className="text-tertiary">|</span>
              <span className={`${data.cvd >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                CVD: {data.cvd >= 0 ? '+' : ''}{(data.cvd / 1000).toFixed(1)}K
              </span>
            </div>
          )}
          <svg
            className={`w-5 h-5 text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-4 pt-0 space-y-4">
          {/* Connection error */}
          {status.error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
              {status.error}
            </div>
          )}

          {/* Top row: Order Book + Trade Flow */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-primary/30 rounded-lg p-3 h-80">
              <OrderBookDepth orderBook={data.orderBook} />
            </div>
            <div className="bg-primary/30 rounded-lg p-3 h-80">
              <TradeFlow trades={data.trades} />
            </div>
          </div>

          {/* Bottom row: CVD Chart + Spread & Whales */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2 bg-primary/30 rounded-lg p-3 h-56">
              <CVDChart
                cvd={data.cvd}
                cvdHistory={data.cvdHistory}
                onReset={resetCVD}
              />
            </div>
            <div className="bg-primary/30 rounded-lg p-3 space-y-4">
              <div>
                <div className="text-xs text-tertiary mb-2">Spread Monitor</div>
                <SpreadMonitor
                  orderBook={data.orderBook}
                  spreadHistory={data.spreadHistory}
                />
              </div>
            </div>
          </div>

          {/* Large Orders section */}
          <div className="bg-primary/30 rounded-lg p-3">
            <div className="text-xs text-tertiary mb-2 flex items-center gap-2">
              Large Order Detection
              <span className="text-secondary">({data.largeOrders.length} detected)</span>
            </div>
            <LargeOrderAlert largeOrders={data.largeOrders} />
          </div>

          {/* Aggregated Signals - for recommendations (updates every minute) */}
          {aggregated.history.length > 0 && (
            <Tooltip
              content={
                <div className="max-w-xs">
                  <strong>Aggregated Flow Signals</strong>
                  <p className="mt-1">5-minute aggregated signals used for trade recommendations. Updates every minute for stability.</p>
                  <p className="mt-1 text-tertiary">Based on {aggregated.history.length} minute(s) of data.</p>
                </div>
              }
              position="top"
              block
            >
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 cursor-help">
                <div className="text-xs text-blue-400 mb-2 flex items-center gap-2">
                  Aggregated Signals (5-min)
                  <span className="text-blue-300">• Used for recommendations</span>
                </div>
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  <div>
                    <div className="text-tertiary">Imbalance</div>
                    <div className={`font-semibold ${
                      aggregated.signals.imbalanceTrend === 'bullish' ? 'text-green-500' :
                      aggregated.signals.imbalanceTrend === 'bearish' ? 'text-red-500' : 'text-secondary'
                    }`}>
                      {aggregated.signals.imbalanceTrend === 'bullish' ? '↑ Bullish' :
                       aggregated.signals.imbalanceTrend === 'bearish' ? '↓ Bearish' : '— Neutral'}
                    </div>
                  </div>
                  <div>
                    <div className="text-tertiary">CVD</div>
                    <div className={`font-semibold ${
                      aggregated.signals.cvdMomentum.includes('buy') ? 'text-green-500' :
                      aggregated.signals.cvdMomentum.includes('sell') ? 'text-red-500' : 'text-secondary'
                    }`}>
                      {aggregated.signals.cvdMomentum === 'strong_buy' ? '⬆ Strong' :
                       aggregated.signals.cvdMomentum === 'buy' ? '↑ Buying' :
                       aggregated.signals.cvdMomentum === 'strong_sell' ? '⬇ Strong' :
                       aggregated.signals.cvdMomentum === 'sell' ? '↓ Selling' : '— Neutral'}
                    </div>
                  </div>
                  <div>
                    <div className="text-tertiary">Flow</div>
                    <div className={`font-semibold ${
                      aggregated.signals.flowDominance === 'buyers' ? 'text-green-500' :
                      aggregated.signals.flowDominance === 'sellers' ? 'text-red-500' : 'text-secondary'
                    }`}>
                      {aggregated.signals.flowDominance === 'buyers' ? '↑ Buyers' :
                       aggregated.signals.flowDominance === 'sellers' ? '↓ Sellers' : '— Balanced'}
                    </div>
                  </div>
                  <div>
                    <div className="text-tertiary">Spread</div>
                    <div className={`font-semibold ${
                      aggregated.signals.spreadCondition === 'tight' ? 'text-green-500' :
                      aggregated.signals.spreadCondition === 'wide' ? 'text-yellow-500' : 'text-secondary'
                    }`}>
                      {aggregated.signals.spreadCondition === 'tight' ? '✓ Tight' :
                       aggregated.signals.spreadCondition === 'wide' ? '⚠ Wide' : '— Normal'}
                    </div>
                  </div>
                  <div>
                    <div className="text-tertiary">Whales</div>
                    <div className={`font-semibold ${
                      aggregated.signals.whaleActivity === 'accumulating' ? 'text-green-500' :
                      aggregated.signals.whaleActivity === 'distributing' ? 'text-red-500' : 'text-secondary'
                    }`}>
                      {aggregated.signals.whaleActivity === 'accumulating' ? '🐋 Buying' :
                       aggregated.signals.whaleActivity === 'distributing' ? '🐋 Selling' : '— None'}
                    </div>
                  </div>
                </div>
              </div>
            </Tooltip>
          )}

          {/* Real-time Trading signals summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tooltip
              content="Strong bid imbalance suggests buying pressure. >60% indicates institutional buying."
              position="top"
              block
            >
              <div className={`p-3 rounded text-center ${
                data.orderBook && data.orderBook.imbalance > 0.6
                  ? 'bg-green-500/20 border border-green-500/50'
                  : data.orderBook && data.orderBook.imbalance < -0.6
                  ? 'bg-red-500/20 border border-red-500/50'
                  : 'bg-tertiary/30'
              }`}>
                <div className="text-xs text-tertiary">Imbalance</div>
                <div className={`text-lg font-bold ${
                  data.orderBook && data.orderBook.imbalance > 0.2
                    ? 'text-green-500'
                    : data.orderBook && data.orderBook.imbalance < -0.2
                    ? 'text-red-500'
                    : 'text-secondary'
                }`}>
                  {data.orderBook ? `${(data.orderBook.imbalance * 100).toFixed(0)}%` : '-'}
                </div>
              </div>
            </Tooltip>

            <Tooltip
              content="Positive CVD = net buying pressure. Rising CVD with flat price = accumulation (bullish)."
              position="top"
              block
            >
              <div className={`p-3 rounded text-center ${
                data.cvd > 10000
                  ? 'bg-green-500/20 border border-green-500/50'
                  : data.cvd < -10000
                  ? 'bg-red-500/20 border border-red-500/50'
                  : 'bg-tertiary/30'
              }`}>
                <div className="text-xs text-tertiary">CVD</div>
                <div className={`text-lg font-bold ${
                  data.cvd >= 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {data.cvd >= 0 ? '+' : ''}{(data.cvd / 1000).toFixed(1)}K
                </div>
              </div>
            </Tooltip>

            <Tooltip
              content="Spread in basis points. Wide spread indicates low liquidity or high volatility."
              position="top"
              block
            >
              <div className={`p-3 rounded text-center bg-tertiary/30`}>
                <div className="text-xs text-tertiary">Spread</div>
                <div className="text-lg font-bold text-secondary">
                  {data.orderBook ? `${(data.orderBook.spreadPercent * 100).toFixed(1)}bp` : '-'}
                </div>
              </div>
            </Tooltip>

            <Tooltip
              content="Count of large orders (>€5K) in current session. Clusters indicate whale activity."
              position="top"
              block
            >
              <div className={`p-3 rounded text-center ${
                data.largeOrders.length > 5 ? 'bg-yellow-500/20 border border-yellow-500/50' : 'bg-tertiary/30'
              }`}>
                <div className="text-xs text-tertiary">Whales</div>
                <div className="text-lg font-bold text-secondary">
                  {data.largeOrders.length}
                </div>
              </div>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

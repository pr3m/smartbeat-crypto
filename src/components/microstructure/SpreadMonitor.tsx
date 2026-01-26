'use client';

import { useMemo } from 'react';
import type { OrderBookData } from '@/lib/kraken/types';
import { calculateAverageSpread } from '@/lib/trading/microstructure';
import { Tooltip, HelpIcon } from '@/components/Tooltip';

interface SpreadMonitorProps {
  orderBook: OrderBookData | null;
  spreadHistory: Array<{ time: number; spread: number; spreadPercent: number }>;
}

export function SpreadMonitor({ orderBook, spreadHistory }: SpreadMonitorProps) {
  const stats = useMemo(() => {
    const { avgSpread, avgSpreadPercent } = calculateAverageSpread(spreadHistory);
    return { avgSpread, avgSpreadPercent };
  }, [spreadHistory]);

  if (!orderBook) {
    return (
      <div className="flex items-center justify-center text-secondary text-sm py-4">
        Waiting for data...
      </div>
    );
  }

  const { spread, spreadPercent, midPrice } = orderBook;
  const spreadBps = spreadPercent * 100; // Convert to basis points

  // Determine spread status
  const isWide = stats.avgSpreadPercent > 0 && spreadPercent > stats.avgSpreadPercent * 1.5;
  const isNarrow = stats.avgSpreadPercent > 0 && spreadPercent < stats.avgSpreadPercent * 0.7;

  const statusColor = isWide ? 'text-yellow-500' : isNarrow ? 'text-green-500' : 'text-secondary';
  const statusText = isWide ? 'Wide' : isNarrow ? 'Tight' : 'Normal';

  return (
    <div className="flex flex-col gap-2">
      {/* Current spread */}
      <Tooltip
        content={
          <div className="max-w-xs">
            <strong>Current Spread</strong>
            <p className="mt-1">The gap between best bid and best ask price. This is your immediate cost to enter/exit.</p>
            <p className="mt-1 text-tertiary">{isWide ? 'Wide spread = higher slippage risk for market orders. Consider limit orders.' : isNarrow ? 'Tight spread = good liquidity, lower trading costs.' : 'Normal spread for this pair.'}</p>
          </div>
        }
        position="left"
        block
      >
        <div className="flex items-center justify-between cursor-help">
          <span className="text-xs text-tertiary flex items-center">
            Spread
            <HelpIcon
              tooltip={
                <div className="max-w-xs">
                  <strong>Why Spread Matters for 10x Trades</strong>
                  <p className="mt-1">With leverage, spread costs are amplified. A 0.1% spread costs you 1% on a 10x position.</p>
                  <ul className="mt-2 text-xs">
                    <li><span className="text-green-500">Tight</span>: Good for entries/exits</li>
                    <li><span className="text-yellow-500">Wide</span>: Volatility or low liquidity - be cautious</li>
                  </ul>
                </div>
              }
              position="right"
            />
          </span>
          <div className="flex items-center gap-2">
            <span className="mono text-sm">€{spread.toFixed(5)}</span>
            <span className={`text-xs font-semibold ${statusColor}`}>
              {statusText}
            </span>
          </div>
        </div>
      </Tooltip>

      {/* Spread in percentage and bps */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-tertiary">Percent</span>
        <span className="mono text-secondary">{spreadPercent.toFixed(4)}%</span>
      </div>

      <Tooltip
        content={
          <div className="max-w-xs">
            <strong>Basis Points (bps)</strong>
            <p className="mt-1">1 basis point = 0.01%. Common way to express small percentages in trading.</p>
            <p className="mt-1 text-tertiary">10 bps spread on 10x leverage = 100 bps (1%) effective cost.</p>
          </div>
        }
        position="left"
        block
      >
        <div className="flex items-center justify-between text-xs cursor-help">
          <span className="text-tertiary">Basis Points</span>
          <span className="mono text-secondary">{spreadBps.toFixed(2)} bps</span>
        </div>
      </Tooltip>

      {/* Average spread comparison */}
      {stats.avgSpreadPercent > 0 && (
        <Tooltip
          content={
            <div className="max-w-xs">
              <strong>Session Average Spread</strong>
              <p className="mt-1">Average spread since you opened this section. Use to compare current spread.</p>
              <p className="mt-1 text-tertiary">If current &gt; 1.5x average = Wide. If current &lt; 0.7x average = Tight.</p>
            </div>
          }
          position="left"
          block
        >
          <div className="flex items-center justify-between text-xs pt-2 border-t border-primary cursor-help">
            <span className="text-tertiary">Avg Spread</span>
            <span className="mono text-secondary">{stats.avgSpreadPercent.toFixed(4)}%</span>
          </div>
        </Tooltip>
      )}

      {/* Visual spread indicator */}
      <Tooltip
        content={
          <div className="max-w-xs">
            <strong>Spread Gauge</strong>
            <p className="mt-1">Visual comparison of current spread vs session average.</p>
            <ul className="mt-2 text-xs">
              <li><span className="text-green-500">Green</span>: Below average (good)</li>
              <li><span className="text-blue-500">Blue</span>: Normal range</li>
              <li><span className="text-yellow-500">Yellow</span>: Above average (caution)</li>
            </ul>
          </div>
        }
        position="top"
        block
      >
        <div className="mt-1 cursor-help">
          <div className="flex justify-between text-xs text-tertiary mb-1">
            <span>Tight</span>
            <span>Wide</span>
          </div>
          <div className="h-2 bg-primary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isWide ? 'bg-yellow-500' : isNarrow ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{
                width: `${Math.min(
                  100,
                  stats.avgSpreadPercent > 0
                    ? (spreadPercent / (stats.avgSpreadPercent * 2)) * 100
                    : 50
                )}%`,
              }}
            />
          </div>
        </div>
      </Tooltip>

      {/* Warning for wide spread */}
      {isWide && (
        <Tooltip
          content={
            <div className="max-w-xs">
              <strong>Wide Spread Warning</strong>
              <p className="mt-1">Current spread is 1.5x+ higher than average. This often happens during:</p>
              <ul className="mt-2 text-xs">
                <li>• High volatility / news events</li>
                <li>• Low liquidity periods (weekends, holidays)</li>
                <li>• Market makers pulling liquidity</li>
              </ul>
              <p className="mt-2 text-tertiary">Consider using limit orders or waiting for spread to normalize.</p>
            </div>
          }
          position="top"
          block
        >
          <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-500 cursor-help">
            Spread is wider than normal - expect higher slippage
          </div>
        </Tooltip>
      )}
    </div>
  );
}

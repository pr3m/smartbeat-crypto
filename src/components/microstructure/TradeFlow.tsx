'use client';

import { useMemo } from 'react';
import type { TradeEntry } from '@/lib/kraken/types';
import { formatQty, formatEurValue } from '@/lib/trading/microstructure';
import { Tooltip, HelpIcon } from '@/components/Tooltip';

interface TradeFlowProps {
  trades: TradeEntry[];
  maxDisplay?: number;
}

export function TradeFlow({ trades, maxDisplay = 25 }: TradeFlowProps) {
  const displayTrades = useMemo(() => trades.slice(0, maxDisplay), [trades, maxDisplay]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (displayTrades.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-secondary text-sm">
        Waiting for trades...
      </div>
    );
  }

  // Calculate recent volume stats
  const recentTrades = trades.slice(0, 100);
  const buyVolume = recentTrades
    .filter(t => t.side === 'buy')
    .reduce((s, t) => s + t.eurValue, 0);
  const sellVolume = recentTrades
    .filter(t => t.side === 'sell')
    .reduce((s, t) => s + t.eurValue, 0);
  const totalVolume = buyVolume + sellVolume;
  const buyPercent = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-xs text-tertiary flex items-center">
          Trade Flow (Time & Sales)
          <HelpIcon
            tooltip={
              <div className="max-w-xs">
                <strong>Time & Sales Tape</strong>
                <p className="mt-1">Real-time feed of executed trades. Shows who is actively buying/selling at market price.</p>
                <ul className="mt-2 text-xs">
                  <li><span className="text-green-500">Green</span>: Market buy (lifted the ask)</li>
                  <li><span className="text-red-500">Red</span>: Market sell (hit the bid)</li>
                  <li><strong>Highlighted</strong>: Large orders (&gt;€5K)</li>
                </ul>
              </div>
            }
            position="right"
          />
        </div>
        <div className="text-xs text-secondary">{trades.length} trades</div>
      </div>

      {/* Buy/Sell ratio bar */}
      <div className="mb-2 flex-shrink-0">
        <div className="flex h-2 rounded overflow-hidden">
          <div
            className="bg-green-500 transition-all duration-300"
            style={{ width: `${buyPercent}%` }}
          />
          <div
            className="bg-red-500 transition-all duration-300"
            style={{ width: `${100 - buyPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1">
          <span className="text-green-500">{buyPercent.toFixed(0)}% Buy</span>
          <span className="text-red-500">{(100 - buyPercent).toFixed(0)}% Sell</span>
        </div>
      </div>

      {/* Trade list - justify-start ensures content fills from top */}
      <div className="flex-1 min-h-[100px] overflow-y-auto flex flex-col justify-start gap-0.5">
        {displayTrades.map((trade, i) => (
          <div
            key={`${trade.id}-${trade.timestamp}-${i}`}
            className={`flex items-center justify-between px-2 py-1 rounded text-xs transition-colors ${
              trade.isLarge
                ? trade.side === 'buy'
                  ? 'bg-green-500/30 border border-green-500/50'
                  : 'bg-red-500/30 border border-red-500/50'
                : 'bg-tertiary/30'
            }`}
          >
            <div className="flex items-center gap-2">
              {/* Side indicator */}
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  trade.side === 'buy' ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              {/* Time */}
              <span className="text-tertiary mono w-16">{formatTime(trade.timestamp)}</span>
            </div>

            {/* Price */}
            <span
              className={`mono font-medium ${
                trade.side === 'buy' ? 'text-green-500' : 'text-red-500'
              }`}
            >
              €{trade.price.toFixed(4)}
            </span>

            {/* Quantity */}
            <span className="mono text-secondary w-16 text-right">
              {formatQty(trade.qty)}
            </span>

            {/* EUR value */}
            <span
              className={`mono w-14 text-right ${
                trade.isLarge ? 'font-bold' : ''
              } ${trade.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}
            >
              €{formatEurValue(trade.eurValue)}
            </span>
          </div>
        ))}
      </div>

      {/* Footer stats */}
      <div className="flex-shrink-0 mt-2 pt-2 border-t border-primary">
        <div className="flex justify-between text-xs">
          <div>
            <span className="text-tertiary">Buy: </span>
            <span className="text-green-500 mono">€{formatEurValue(buyVolume)}</span>
          </div>
          <div>
            <span className="text-tertiary">Sell: </span>
            <span className="text-red-500 mono">€{formatEurValue(sellVolume)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

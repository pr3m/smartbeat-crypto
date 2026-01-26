'use client';

import type { OrderBookData } from '@/lib/kraken/types';
import { formatQty, formatEurValue } from '@/lib/trading/microstructure';
import { Tooltip, HelpIcon } from '@/components/Tooltip';

interface OrderBookDepthProps {
  orderBook: OrderBookData | null;
}

export function OrderBookDepth({ orderBook }: OrderBookDepthProps) {
  if (!orderBook) {
    return (
      <div className="h-full flex items-center justify-center text-secondary text-sm">
        Waiting for order book data...
      </div>
    );
  }

  const { bids, asks, imbalance, spreadPercent, midPrice } = orderBook;

  // Calculate max volume for bar scaling
  const maxBidVolume = Math.max(...bids.map(b => b.qty * b.price));
  const maxAskVolume = Math.max(...asks.map(a => a.qty * a.price));
  const maxVolume = Math.max(maxBidVolume, maxAskVolume);

  // Get imbalance status
  const imbalancePercent = Math.abs(imbalance * 100).toFixed(0);
  const imbalanceSide = imbalance > 0 ? 'Bids' : imbalance < 0 ? 'Asks' : 'Even';
  const imbalanceColor = imbalance > 0.2 ? 'text-green-500' : imbalance < -0.2 ? 'text-red-500' : 'text-secondary';

  // Display top 10 levels
  const displayBids = bids.slice(0, 10);
  const displayAsks = asks.slice(0, 10);

  // Calculate bid/ask ratio for visual bar (0-100)
  const bidRatio = ((imbalance + 1) / 2) * 100;

  return (
    <div className="h-full flex flex-col">
      {/* Header - matches Trade Flow header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-xs text-tertiary flex items-center">
          Order Book Depth
          <HelpIcon
            tooltip={
              <div className="max-w-xs">
                <strong>Order Book Depth</strong>
                <p className="mt-1">Shows pending buy (bid) and sell (ask) orders at each price level.</p>
                <p className="mt-1 text-tertiary">Bar width represents order volume.</p>
              </div>
            }
            position="right"
          />
        </div>
        <Tooltip
          content={
            <div className="max-w-xs">
              <strong>Order Book Imbalance</strong>
              <p className="mt-1">{imbalance > 0.2 ? 'More bids - buying pressure' : imbalance < -0.2 ? 'More asks - selling pressure' : 'Balanced'}</p>
            </div>
          }
          position="left"
        >
          <div className={`text-xs font-semibold ${imbalanceColor} cursor-help`}>
            {imbalancePercent}% {imbalanceSide}
          </div>
        </Tooltip>
      </div>

      {/* Ratio bar - matches Trade Flow's buy/sell bar */}
      <div className="mb-2">
        <div className="flex h-2 rounded overflow-hidden">
          <div
            className="bg-green-500 transition-all duration-300"
            style={{ width: `${bidRatio}%` }}
          />
          <div
            className="bg-red-500 transition-all duration-300"
            style={{ width: `${100 - bidRatio}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1">
          <span className="text-secondary mono">€{midPrice.toFixed(4)}</span>
          <span className="text-tertiary">{spreadPercent.toFixed(3)}% spread</span>
        </div>
      </div>

      {/* Order book visualization */}
      <div className="flex-1 min-h-[100px] flex gap-2 overflow-hidden">
        {/* Bids (left) */}
        <div className="flex-1 flex flex-col gap-0.5 overflow-y-auto">
          {displayBids.map((bid, i) => {
            const volume = bid.qty * bid.price;
            const barWidth = maxVolume > 0 ? (volume / maxVolume) * 100 : 0;
            return (
              <div key={i} className="relative h-5 flex items-center flex-shrink-0">
                <div
                  className="absolute right-0 h-full bg-green-500/20 rounded-l"
                  style={{ width: `${barWidth}%` }}
                />
                <div className="relative z-10 flex w-full justify-between px-1 text-xs">
                  <span className="mono text-green-500">{bid.price.toFixed(4)}</span>
                  <span className="mono text-secondary">{formatQty(bid.qty)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Asks (right) */}
        <div className="flex-1 flex flex-col gap-0.5 overflow-y-auto">
          {displayAsks.map((ask, i) => {
            const volume = ask.qty * ask.price;
            const barWidth = maxVolume > 0 ? (volume / maxVolume) * 100 : 0;
            return (
              <div key={i} className="relative h-5 flex items-center flex-shrink-0">
                <div
                  className="absolute left-0 h-full bg-red-500/20 rounded-r"
                  style={{ width: `${barWidth}%` }}
                />
                <div className="relative z-10 flex w-full justify-between px-1 text-xs">
                  <span className="mono text-secondary">{formatQty(ask.qty)}</span>
                  <span className="mono text-red-500">{ask.price.toFixed(4)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Total volume summary */}
      <div className="flex-shrink-0 mt-2 pt-2 border-t border-primary">
        <div className="flex justify-between text-xs">
          <div>
            <span className="text-tertiary">Bid Vol: </span>
            <span className="text-green-500 mono">€{formatEurValue(bids.reduce((s, b) => s + b.qty * b.price, 0))}</span>
          </div>
          <div>
            <span className="text-tertiary">Ask Vol: </span>
            <span className="text-red-500 mono">€{formatEurValue(asks.reduce((s, a) => s + a.qty * a.price, 0))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, useRef } from 'react';
import type { TradeEntry } from '@/lib/kraken/types';
import { formatEurValue, formatQty, identifyOrderClusters } from '@/lib/trading/microstructure';
import { Tooltip, HelpIcon } from '@/components/Tooltip';

interface LargeOrderAlertProps {
  largeOrders: TradeEntry[];
}

export function LargeOrderAlert({ largeOrders }: LargeOrderAlertProps) {
  const [flashingIds, setFlashingIds] = useState<Set<number>>(new Set());
  const prevIdsRef = useRef<Set<number>>(new Set());

  // Detect new large orders and flash them
  useEffect(() => {
    const currentIds = new Set(largeOrders.map(o => o.id));
    const newIds = new Set<number>();

    currentIds.forEach(id => {
      if (!prevIdsRef.current.has(id)) {
        newIds.add(id);
      }
    });

    if (newIds.size > 0) {
      setFlashingIds(prev => new Set([...prev, ...newIds]));

      // Remove flash after animation
      setTimeout(() => {
        setFlashingIds(prev => {
          const updated = new Set(prev);
          newIds.forEach(id => updated.delete(id));
          return updated;
        });
      }, 1000);
    }

    prevIdsRef.current = currentIds;
  }, [largeOrders]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Identify clusters
  const clusters = identifyOrderClusters(largeOrders, 60000);

  const displayOrders = largeOrders.slice(0, 10);

  return (
    <div className="flex flex-col gap-2">
      {/* Cluster alerts */}
      {clusters.length > 0 && (
        <div className="mb-2">
          {clusters.slice(0, 2).map((cluster, i) => (
            <Tooltip
              key={i}
              content={
                <div className="max-w-xs">
                  <strong>Whale Cluster Detected</strong>
                  <p className="mt-1">
                    {cluster.side === 'buy'
                      ? 'Multiple large buy orders in quick succession. Often indicates institutional accumulation.'
                      : 'Multiple large sell orders in quick succession. Often indicates institutional distribution.'}
                  </p>
                  <p className="mt-1 text-tertiary">
                    {cluster.side === 'buy'
                      ? 'Bullish signal - smart money may be buying.'
                      : 'Bearish signal - smart money may be selling.'}
                  </p>
                </div>
              }
              position="top"
              block
            >
              <div
                className={`p-2 rounded text-xs mb-1 cursor-help ${
                  cluster.side === 'buy'
                    ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                    : 'bg-red-500/20 border border-red-500/50 text-red-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {cluster.side === 'buy' ? '🐋' : '🐻'}
                  </span>
                  <div>
                    <div className="font-semibold">
                      {cluster.count}x Large {cluster.side === 'buy' ? 'Buys' : 'Sells'} Cluster
                    </div>
                    <div className="text-tertiary">
                      €{formatEurValue(cluster.totalVolume)} total in last minute
                    </div>
                  </div>
                </div>
              </div>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Recent large orders */}
      {displayOrders.length === 0 ? (
        <Tooltip
          content={
            <div className="max-w-xs">
              <strong>Large Order Detection</strong>
              <p className="mt-1">Monitors for trades exceeding €5,000 in value. Large orders often indicate institutional activity or whales.</p>
              <p className="mt-1 text-tertiary">Watch for clusters of large orders - they reveal smart money movements.</p>
            </div>
          }
          position="top"
          block
        >
          <div className="text-center text-secondary text-sm py-4 cursor-help">
            No large orders detected yet
            <div className="text-xs text-tertiary mt-1">
              (Threshold: €5,000+)
            </div>
          </div>
        </Tooltip>
      ) : (
        <div className="space-y-1">
          {displayOrders.map((order, i) => {
            const isFlashing = flashingIds.has(order.id);
            return (
              <div
                key={`${order.id}-${order.timestamp}-${i}`}
                className={`flex items-center justify-between p-2 rounded text-xs transition-all ${
                  isFlashing
                    ? order.side === 'buy'
                      ? 'bg-green-500/40 animate-pulse'
                      : 'bg-red-500/40 animate-pulse'
                    : order.side === 'buy'
                    ? 'bg-green-500/10'
                    : 'bg-red-500/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${
                      order.side === 'buy'
                        ? 'bg-green-500/30 text-green-500'
                        : 'bg-red-500/30 text-red-500'
                    }`}
                  >
                    {order.side === 'buy' ? '↑' : '↓'}
                  </div>
                  <div>
                    <div
                      className={`font-semibold ${
                        order.side === 'buy' ? 'text-green-500' : 'text-red-500'
                      }`}
                    >
                      €{formatEurValue(order.eurValue)}
                    </div>
                    <div className="text-tertiary">
                      {formatQty(order.qty)} @ €{order.price.toFixed(4)}
                    </div>
                  </div>
                </div>
                <div className="text-tertiary mono">
                  {formatTime(order.timestamp)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      {largeOrders.length > 0 && (
        <Tooltip
          content={
            <div className="max-w-xs">
              <strong>Large Order Balance</strong>
              <p className="mt-1">Count of large orders ({'>'}€5K) by side during this session.</p>
              <p className="mt-1 text-tertiary">
                {(() => {
                  const buys = largeOrders.filter(o => o.side === 'buy').length;
                  const sells = largeOrders.filter(o => o.side === 'sell').length;
                  if (buys > sells * 1.5) return 'More large buys than sells - whales may be accumulating.';
                  if (sells > buys * 1.5) return 'More large sells than buys - whales may be distributing.';
                  return 'Relatively balanced large order activity.';
                })()}
              </p>
            </div>
          }
          position="top"
          block
        >
          <div className="flex justify-between mt-2 pt-2 border-t border-primary text-xs cursor-help">
            <div>
              <span className="text-tertiary">Large Buys: </span>
              <span className="text-green-500 mono">
                {largeOrders.filter(o => o.side === 'buy').length}
              </span>
            </div>
            <div>
              <span className="text-tertiary">Large Sells: </span>
              <span className="text-red-500 mono">
                {largeOrders.filter(o => o.side === 'sell').length}
              </span>
            </div>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

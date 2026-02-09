'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { OHLCData } from '@/lib/kraken/types';

const KRAKEN_WS_URL = 'wss://ws.kraken.com';

// Default pairs and intervals - defined outside component to avoid re-creation
const DEFAULT_PAIRS = ['XRP/EUR', 'XBT/EUR'];
const DEFAULT_INTERVALS = [5, 15, 60, 240];

export interface TickerData {
  price: number;
  bid: number;
  ask: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  vwap: number;
}

export interface WebSocketStatus {
  connected: boolean;
  error: string | null;
  reconnecting: boolean;
}

export function useKrakenWebSocket(
  pairs: string[] = DEFAULT_PAIRS,
  ohlcIntervals: number[] = DEFAULT_INTERVALS
) {
  const [status, setStatus] = useState<WebSocketStatus>({
    connected: false,
    error: null,
    reconnecting: false,
  });

  const [tickers, setTickers] = useState<Record<string, TickerData>>({});
  const [ohlcData, setOhlcData] = useState<Record<string, Record<number, OHLCData[]>>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const subscriptionsRef = useRef<Set<string>>(new Set());

  // Throttle state updates to prevent excessive re-renders
  const lastTickerUpdateRef = useRef(0);
  const pendingTickerUpdatesRef = useRef<Record<string, TickerData>>({});
  const tickerThrottleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const TICKER_THROTTLE_MS = 100; // Max 10 updates per second

  // Store pairs and intervals in refs to avoid dependency issues
  const pairsRef = useRef(pairs);
  const intervalsRef = useRef(ohlcIntervals);

  // Update refs if props change
  useEffect(() => {
    pairsRef.current = pairs;
    intervalsRef.current = ohlcIntervals;
  }, [pairs, ohlcIntervals]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(KRAKEN_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Kraken WebSocket connected');
        setStatus({ connected: true, error: null, reconnecting: false });
        reconnectAttempts.current = 0;

        const currentPairs = pairsRef.current;
        const currentIntervals = intervalsRef.current;

        // Subscribe to ticker for all pairs
        const tickerSubscription = {
          event: 'subscribe',
          pair: currentPairs,
          subscription: { name: 'ticker' },
        };
        ws.send(JSON.stringify(tickerSubscription));

        // Subscribe to OHLC for XRP/EUR at different intervals
        for (const interval of currentIntervals) {
          const ohlcSubscription = {
            event: 'subscribe',
            pair: ['XRP/EUR'],
            subscription: { name: 'ohlc', interval },
          };
          ws.send(JSON.stringify(ohlcSubscription));
        }

        // Subscribe to trades for real-time price updates
        const tradeSubscription = {
          event: 'subscribe',
          pair: currentPairs,
          subscription: { name: 'trade' },
        };
        ws.send(JSON.stringify(tradeSubscription));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle system messages
          if (data.event) {
            if (data.event === 'subscriptionStatus') {
              if (data.status === 'subscribed') {
                subscriptionsRef.current.add(data.channelName);
              }
            } else if (data.event === 'heartbeat') {
              // Heartbeat - connection is alive
            } else if (data.event === 'systemStatus') {
              console.log('Kraken system status:', data.status);
            }
            return;
          }

          // Handle ticker updates - format: [channelID, data, channelName, pair]
          if (Array.isArray(data) && data.length >= 4) {
            const [, payload, channelName, pair] = data;

            if (channelName === 'ticker' && payload) {
              // Ticker format: { a: [ask], b: [bid], c: [close, volume], v: [volume], p: [vwap], t: [trades], l: [low], h: [high], o: [open] }
              const tickerUpdate: TickerData = {
                price: parseFloat(payload.c?.[0] || '0'),
                bid: parseFloat(payload.b?.[0] || '0'),
                ask: parseFloat(payload.a?.[0] || '0'),
                open: parseFloat(payload.o?.[0] || '0'),
                high: parseFloat(payload.h?.[1] || payload.h?.[0] || '0'), // 24h high
                low: parseFloat(payload.l?.[1] || payload.l?.[0] || '0'), // 24h low
                volume: parseFloat(payload.v?.[1] || payload.v?.[0] || '0'), // 24h volume
                vwap: parseFloat(payload.p?.[1] || payload.p?.[0] || '0'),
              };

              const normalizedPair = pair.replace('/', '');

              // Throttle ticker updates using the same mechanism as trade updates
              pendingTickerUpdatesRef.current[normalizedPair] = tickerUpdate;

              const now = Date.now();
              const timeSinceLastUpdate = now - lastTickerUpdateRef.current;

              if (timeSinceLastUpdate >= TICKER_THROTTLE_MS) {
                lastTickerUpdateRef.current = now;
                const updates = { ...pendingTickerUpdatesRef.current };
                pendingTickerUpdatesRef.current = {};

                setTickers((prev) => {
                  const next = { ...prev };
                  for (const [pairKey, update] of Object.entries(updates)) {
                    next[pairKey] = update as TickerData;
                  }
                  return next;
                });
              } else if (!tickerThrottleTimeoutRef.current) {
                tickerThrottleTimeoutRef.current = setTimeout(() => {
                  tickerThrottleTimeoutRef.current = null;
                  lastTickerUpdateRef.current = Date.now();
                  const updates = { ...pendingTickerUpdatesRef.current };
                  pendingTickerUpdatesRef.current = {};

                  if (Object.keys(updates).length > 0) {
                    setTickers((prev) => {
                      const next = { ...prev };
                      for (const [pairKey, update] of Object.entries(updates)) {
                        next[pairKey] = update as TickerData;
                      }
                      return next;
                    });
                  }
                }, TICKER_THROTTLE_MS - timeSinceLastUpdate);
              }
            }

            // Handle OHLC updates - format: [channelID, [time, etime, open, high, low, close, vwap, volume, count], channelName, pair]
            if (channelName.startsWith('ohlc-') && Array.isArray(payload)) {
              const interval = parseInt(channelName.split('-')[1], 10);
              const [time, , open, high, low, close, , volume] = payload;

              const candle: OHLCData = {
                time: parseFloat(time) * 1000,
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume),
                vwap: 0,
                count: 0,
              };

              const normalizedPair = pair.replace('/', '');
              setOhlcData((prev) => {
                const pairData = prev[normalizedPair] || {};
                const intervalData = pairData[interval] || [];

                // Update last candle or add new one
                const lastCandle = intervalData[intervalData.length - 1];
                if (lastCandle && Math.abs(lastCandle.time - candle.time) < interval * 60 * 1000) {
                  // Update existing candle
                  const updated = [...intervalData];
                  updated[updated.length - 1] = candle;
                  return {
                    ...prev,
                    [normalizedPair]: { ...pairData, [interval]: updated },
                  };
                } else {
                  // Add new candle
                  return {
                    ...prev,
                    [normalizedPair]: {
                      ...pairData,
                      [interval]: [...intervalData.slice(-200), candle],
                    },
                  };
                }
              });
            }

            // Handle trade updates for real-time price - throttled to prevent excessive re-renders
            if (channelName === 'trade' && Array.isArray(payload)) {
              // Trade format: [[price, volume, time, side, orderType, misc], ...]
              const lastTrade = payload[payload.length - 1];
              if (lastTrade) {
                const tradePrice = parseFloat(lastTrade[0]);
                const normalizedPair = pair.replace('/', '');

                // Store pending update
                pendingTickerUpdatesRef.current[normalizedPair] = {
                  ...pendingTickerUpdatesRef.current[normalizedPair],
                  price: tradePrice,
                };

                // Throttle state updates
                const now = Date.now();
                const timeSinceLastUpdate = now - lastTickerUpdateRef.current;

                if (timeSinceLastUpdate >= TICKER_THROTTLE_MS) {
                  // Enough time passed, apply pending updates immediately
                  lastTickerUpdateRef.current = now;
                  const updates = { ...pendingTickerUpdatesRef.current };
                  pendingTickerUpdatesRef.current = {};

                  setTickers((prev) => {
                    const next = { ...prev };
                    for (const [pairKey, priceUpdate] of Object.entries(updates)) {
                      if (next[pairKey]) {
                        next[pairKey] = { ...next[pairKey], ...priceUpdate };
                      }
                    }
                    return next;
                  });
                } else if (!tickerThrottleTimeoutRef.current) {
                  // Schedule a throttled update
                  tickerThrottleTimeoutRef.current = setTimeout(() => {
                    tickerThrottleTimeoutRef.current = null;
                    lastTickerUpdateRef.current = Date.now();
                    const updates = { ...pendingTickerUpdatesRef.current };
                    pendingTickerUpdatesRef.current = {};

                    if (Object.keys(updates).length > 0) {
                      setTickers((prev) => {
                        const next = { ...prev };
                        for (const [pairKey, priceUpdate] of Object.entries(updates)) {
                          if (next[pairKey]) {
                            next[pairKey] = { ...next[pairKey], ...priceUpdate };
                          }
                        }
                        return next;
                      });
                    }
                  }, TICKER_THROTTLE_MS - timeSinceLastUpdate);
                }
              }
            }
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        // WebSocket errors are expected during initial connection or reconnection
        // The onclose handler will trigger reconnection logic
        setStatus((prev) => ({ ...prev, error: 'WebSocket error' }));
      };

      ws.onclose = (event) => {
        console.log('Kraken WebSocket closed:', event.code, event.reason);
        setStatus({ connected: false, error: null, reconnecting: true });
        subscriptionsRef.current.clear();

        // Attempt reconnection
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setStatus({ connected: false, error: 'Max reconnection attempts reached', reconnecting: false });
        }
      };
    } catch (err) {
      console.warn('WebSocket connection failed, will retry:', err);
      setStatus({ connected: false, error: 'Failed to connect', reconnecting: false });
    }
  }, []); // No dependencies - uses refs

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (tickerThrottleTimeoutRef.current) {
      clearTimeout(tickerThrottleTimeoutRef.current);
      tickerThrottleTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus({ connected: false, error: null, reconnecting: false });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    tickers,
    ohlcData,
    reconnect: connect,
  };
}

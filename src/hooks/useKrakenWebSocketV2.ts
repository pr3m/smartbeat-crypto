'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WSv2BookLevel, OrderBookData, TradeEntry, MicrostructureSnapshot, AggregatedMicrostructure, MicrostructureInput } from '@/lib/kraken/types';

const KRAKEN_WS_V2_URL = 'wss://ws.kraken.com/v2';
const BOOK_DEPTH = 25;
const TRADE_HISTORY_LIMIT = 500;
const LARGE_ORDER_THRESHOLD_EUR = 5000;
const AGGREGATION_INTERVAL_MS = 60000; // 1 minute
const SNAPSHOT_HISTORY_LIMIT = 30; // Keep 30 minutes of history

export interface WSv2Status {
  connected: boolean;
  error: string | null;
  reconnecting: boolean;
}

export interface MicrostructureData {
  orderBook: OrderBookData | null;
  trades: TradeEntry[];
  cvd: number; // Cumulative Volume Delta
  cvdHistory: Array<{ time: number; value: number; price: number }>;
  largeOrders: TradeEntry[];
  spreadHistory: Array<{ time: number; spread: number; spreadPercent: number }>;
}

// Data collected within current aggregation period
interface PeriodData {
  startTime: number;
  imbalances: number[];
  spreads: number[];
  cvdStart: number;
  trades: TradeEntry[];
  prices: number[];
}

export function useKrakenWebSocketV2(
  pair: string = 'XRP/EUR',
  enabled: boolean = true
) {
  const [status, setStatus] = useState<WSv2Status>({
    connected: false,
    error: null,
    reconnecting: false,
  });

  const [data, setData] = useState<MicrostructureData>({
    orderBook: null,
    trades: [],
    cvd: 0,
    cvdHistory: [],
    largeOrders: [],
    spreadHistory: [],
  });

  // Track page visibility to reduce updates when tab is hidden
  const isPageVisibleRef = useRef(true);
  useEffect(() => {
    const handleVisibility = () => {
      isPageVisibleRef.current = document.visibilityState === 'visible';
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Aggregated microstructure for stable recommendations
  const [aggregated, setAggregated] = useState<AggregatedMicrostructure>({
    current: null,
    history: [],
    signals: {
      imbalanceTrend: 'neutral',
      cvdMomentum: 'neutral',
      flowDominance: 'balanced',
      spreadCondition: 'normal',
      whaleActivity: 'none',
    },
    summary: {
      imbalance: 0,
      cvd: 0,
      cvdHistory: [],
      spreadPercent: 0,
      avgSpreadPercent: 0,
      recentLargeBuys: 0,
      recentLargeSells: 0,
    },
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Internal book state for maintaining order book
  const bidsRef = useRef<Map<number, number>>(new Map());
  const asksRef = useRef<Map<number, number>>(new Map());
  const cvdRef = useRef(0);
  const lastUpdateRef = useRef(0);

  // Aggregation state
  const aggregationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const periodDataRef = useRef<PeriodData>({
    startTime: Date.now(),
    imbalances: [],
    spreads: [],
    cvdStart: 0,
    trades: [],
    prices: [],
  });

  // Throttle state updates
  const throttleRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdateRef = useRef(false);

  // Kraken v2 book levels are objects: {price: string, qty: string}
  interface BookLevel {
    price: string;
    qty: string;
  }

  const processBookSnapshot = useCallback((bids: BookLevel[], asks: BookLevel[]) => {
    bidsRef.current.clear();
    asksRef.current.clear();

    if (Array.isArray(bids)) {
      bids.forEach((level) => {
        if (level && typeof level === 'object' && 'price' in level && 'qty' in level) {
          const p = parseFloat(level.price);
          const q = parseFloat(level.qty);
          if (q > 0) bidsRef.current.set(p, q);
        }
      });
    }

    if (Array.isArray(asks)) {
      asks.forEach((level) => {
        if (level && typeof level === 'object' && 'price' in level && 'qty' in level) {
          const p = parseFloat(level.price);
          const q = parseFloat(level.qty);
          if (q > 0) asksRef.current.set(p, q);
        }
      });
    }
  }, []);

  const processBookUpdate = useCallback((bids: BookLevel[], asks: BookLevel[]) => {
    if (Array.isArray(bids)) {
      bids.forEach((level) => {
        if (level && typeof level === 'object' && 'price' in level && 'qty' in level) {
          const p = parseFloat(level.price);
          const q = parseFloat(level.qty);
          if (q === 0) {
            bidsRef.current.delete(p);
          } else {
            bidsRef.current.set(p, q);
          }
        }
      });
    }

    if (Array.isArray(asks)) {
      asks.forEach((level) => {
        if (level && typeof level === 'object' && 'price' in level && 'qty' in level) {
          const p = parseFloat(level.price);
          const q = parseFloat(level.qty);
          if (q === 0) {
            asksRef.current.delete(p);
          } else {
            asksRef.current.set(p, q);
          }
        }
      });
    }
  }, []);

  const getOrderBookData = useCallback((): OrderBookData | null => {
    if (bidsRef.current.size === 0 || asksRef.current.size === 0) {
      return null;
    }

    // Sort bids descending, asks ascending
    const sortedBids = Array.from(bidsRef.current.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, BOOK_DEPTH)
      .map(([price, qty]) => ({ price, qty }));

    const sortedAsks = Array.from(asksRef.current.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, BOOK_DEPTH)
      .map(([price, qty]) => ({ price, qty }));

    if (sortedBids.length === 0 || sortedAsks.length === 0) {
      return null;
    }

    const bestBid = sortedBids[0].price;
    const bestAsk = sortedAsks[0].price;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPercent = (spread / midPrice) * 100;

    // Calculate imbalance (sum of bid volume vs ask volume)
    const bidVolume = sortedBids.reduce((sum, l) => sum + l.qty * l.price, 0);
    const askVolume = sortedAsks.reduce((sum, l) => sum + l.qty * l.price, 0);
    const totalVolume = bidVolume + askVolume;
    const imbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;

    return {
      bids: sortedBids,
      asks: sortedAsks,
      imbalance,
      spread,
      spreadPercent,
      midPrice,
      timestamp: Date.now(),
    };
  }, []);

  const scheduleUpdate = useCallback(() => {
    // Skip UI updates when page is hidden to prevent rendering overhead
    if (!isPageVisibleRef.current) {
      return;
    }

    // If already throttled, mark pending and return
    if (throttleRef.current) {
      pendingUpdateRef.current = true;
      return;
    }

    const orderBook = getOrderBookData();
    if (orderBook) {
      setData(prev => {
        // Add spread to history (max 300 entries)
        const newSpreadHistory = [
          ...prev.spreadHistory.slice(-299),
          {
            time: Date.now(),
            spread: orderBook.spread,
            spreadPercent: orderBook.spreadPercent,
          },
        ];

        return {
          ...prev,
          orderBook,
          spreadHistory: newSpreadHistory,
        };
      });
    }
    lastUpdateRef.current = Date.now();

    // Set throttle - don't recurse, just check pending flag once
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
      if (pendingUpdateRef.current && isPageVisibleRef.current) {
        pendingUpdateRef.current = false;
        // Get fresh order book data and update once more
        const freshOrderBook = getOrderBookData();
        if (freshOrderBook) {
          setData(prev => ({
            ...prev,
            orderBook: freshOrderBook,
            spreadHistory: [
              ...prev.spreadHistory.slice(-299),
              {
                time: Date.now(),
                spread: freshOrderBook.spread,
                spreadPercent: freshOrderBook.spreadPercent,
              },
            ],
          }));
        }
      }
    }, 100); // 100ms throttle = 10 FPS
  }, [getOrderBookData]);

  // Track seen trade IDs to avoid duplicate processing
  const seenTradeIds = useRef<Set<number>>(new Set());

  const processTrade = useCallback((trade: {
    price: string;
    qty: string;
    side: string;
    ord_type: string;
    trade_id: number;
    timestamp: string;
  }) => {
    // Skip if we've already processed this trade ID
    if (seenTradeIds.current.has(trade.trade_id)) {
      return;
    }
    seenTradeIds.current.add(trade.trade_id);

    // Limit the size of the seen set to prevent memory issues
    if (seenTradeIds.current.size > TRADE_HISTORY_LIMIT * 2) {
      const arr = Array.from(seenTradeIds.current);
      seenTradeIds.current = new Set(arr.slice(-TRADE_HISTORY_LIMIT));
    }

    const price = parseFloat(trade.price);
    const qty = parseFloat(trade.qty);
    const side = trade.side as 'buy' | 'sell';
    const timestamp = new Date(trade.timestamp).getTime();
    const eurValue = price * qty;
    const isLarge = eurValue >= LARGE_ORDER_THRESHOLD_EUR;

    // Update CVD (always, even when page hidden, to keep calculations accurate)
    const delta = side === 'buy' ? eurValue : -eurValue;
    cvdRef.current += delta;

    // Skip UI state updates when page is hidden to prevent rendering overhead
    if (!isPageVisibleRef.current) {
      return;
    }

    const tradeEntry: TradeEntry = {
      id: trade.trade_id,
      price,
      qty,
      side,
      ordType: trade.ord_type,
      timestamp,
      isLarge,
      eurValue,
    };

    setData(prev => {
      // Add trade to history (limit to TRADE_HISTORY_LIMIT)
      const newTrades = [tradeEntry, ...prev.trades].slice(0, TRADE_HISTORY_LIMIT);

      // Add to CVD history
      const newCvdHistory = [
        ...prev.cvdHistory.slice(-299),
        { time: timestamp, value: cvdRef.current, price },
      ];

      // Track large orders separately
      const newLargeOrders = isLarge
        ? [tradeEntry, ...prev.largeOrders].slice(0, 50)
        : prev.largeOrders;

      return {
        ...prev,
        trades: newTrades,
        cvd: cvdRef.current,
        cvdHistory: newCvdHistory,
        largeOrders: newLargeOrders,
      };
    });
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(KRAKEN_WS_V2_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Kraken WebSocket v2 connected');
        setStatus({ connected: true, error: null, reconnecting: false });
        reconnectAttempts.current = 0;

        // Subscribe to book (25 levels)
        const bookSubscription = {
          method: 'subscribe',
          params: {
            channel: 'book',
            symbol: [pair],
            depth: BOOK_DEPTH,
          },
        };
        ws.send(JSON.stringify(bookSubscription));

        // Subscribe to trades
        const tradeSubscription = {
          method: 'subscribe',
          params: {
            channel: 'trade',
            symbol: [pair],
          },
        };
        ws.send(JSON.stringify(tradeSubscription));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle subscription confirmations
          if (msg.method === 'subscribe' && msg.success) {
            console.log('Subscribed to:', msg.result?.channel);
            return;
          }

          // Handle heartbeat
          if (msg.channel === 'heartbeat') {
            return;
          }

          // Handle book data
          if (msg.channel === 'book') {
            const bookData = msg.data?.[0];
            if (!bookData) return;

            if (msg.type === 'snapshot') {
              processBookSnapshot(bookData.bids || [], bookData.asks || []);
            } else if (msg.type === 'update') {
              processBookUpdate(bookData.bids || [], bookData.asks || []);
            }
            scheduleUpdate();
          }

          // Handle trade data
          if (msg.channel === 'trade') {
            const trades = msg.data;
            if (Array.isArray(trades)) {
              trades.forEach((trade) => {
                // Kraken v2 trade format has fields directly on the object
                if (trade && typeof trade === 'object') {
                  processTrade({
                    price: String(trade.price || '0'),
                    qty: String(trade.qty || '0'),
                    side: trade.side || 'buy',
                    ord_type: trade.ord_type || 'market',
                    trade_id: trade.trade_id || Date.now(),
                    timestamp: trade.timestamp || new Date().toISOString(),
                  });
                }
              });
            }
          }
        } catch (err) {
          console.error('Error parsing WSv2 message:', err);
        }
      };

      ws.onerror = () => {
        // WebSocket errors are expected during initial connection or reconnection
        // The onclose handler will trigger reconnection logic
        setStatus(prev => ({ ...prev, error: 'WebSocket error' }));
      };

      ws.onclose = (event) => {
        console.log('Kraken WebSocket v2 closed:', event.code, event.reason);
        setStatus({ connected: false, error: null, reconnecting: true });

        // Clear book state
        bidsRef.current.clear();
        asksRef.current.clear();

        // Attempt reconnection
        if (enabled && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          console.log(`WSv2 reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          setStatus({ connected: false, error: 'Max reconnection attempts reached', reconnecting: false });
        }
      };
    } catch (err) {
      console.warn('WebSocket v2 connection failed, will retry:', err);
      setStatus({ connected: false, error: 'Failed to connect', reconnecting: false });
    }
  }, [enabled, pair, processBookSnapshot, processBookUpdate, scheduleUpdate, processTrade]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus({ connected: false, error: null, reconnecting: false });
  }, []);

  // Reset CVD
  const resetCVD = useCallback(() => {
    cvdRef.current = 0;
    setData(prev => ({
      ...prev,
      cvd: 0,
      cvdHistory: [],
    }));
  }, []);

  // Create a snapshot from period data
  const createSnapshot = useCallback((): MicrostructureSnapshot | null => {
    const period = periodDataRef.current;
    if (period.trades.length === 0 && period.imbalances.length === 0) {
      return null;
    }

    const buyTrades = period.trades.filter(t => t.side === 'buy');
    const sellTrades = period.trades.filter(t => t.side === 'sell');
    const avgImbalance = period.imbalances.length > 0
      ? period.imbalances.reduce((a, b) => a + b, 0) / period.imbalances.length
      : 0;
    const avgSpread = period.spreads.length > 0
      ? period.spreads.reduce((a, b) => a + b, 0) / period.spreads.length
      : 0;

    const cvdDelta = cvdRef.current - period.cvdStart;
    let cvdTrend: 'rising' | 'falling' | 'neutral' = 'neutral';
    if (cvdDelta > 1000) cvdTrend = 'rising';
    else if (cvdDelta < -1000) cvdTrend = 'falling';

    return {
      timestamp: period.startTime,
      avgImbalance,
      endImbalance: period.imbalances[period.imbalances.length - 1] || 0,
      maxImbalance: Math.max(...period.imbalances.map(Math.abs), 0),
      cvdStart: period.cvdStart,
      cvdEnd: cvdRef.current,
      cvdDelta,
      cvdTrend,
      buyVolume: buyTrades.reduce((s, t) => s + t.eurValue, 0),
      sellVolume: sellTrades.reduce((s, t) => s + t.eurValue, 0),
      buyCount: buyTrades.length,
      sellCount: sellTrades.length,
      avgSpreadPercent: avgSpread,
      maxSpreadPercent: Math.max(...period.spreads, 0),
      largeBuys: buyTrades.filter(t => t.isLarge).length,
      largeSells: sellTrades.filter(t => t.isLarge).length,
      openPrice: period.prices[0] || 0,
      closePrice: period.prices[period.prices.length - 1] || 0,
      highPrice: Math.max(...period.prices, 0),
      lowPrice: period.prices.length > 0 ? Math.min(...period.prices) : 0,
    };
  }, []);

  // Derive signals from snapshot history
  const deriveSignals = useCallback((history: MicrostructureSnapshot[]): AggregatedMicrostructure['signals'] => {
    if (history.length === 0) {
      return {
        imbalanceTrend: 'neutral',
        cvdMomentum: 'neutral',
        flowDominance: 'balanced',
        spreadCondition: 'normal',
        whaleActivity: 'none',
      };
    }

    const recent = history.slice(-5); // Last 5 periods

    // Imbalance trend (are imbalances consistently positive/negative?)
    const avgImbalances = recent.map(s => s.avgImbalance);
    const imbalanceSum = avgImbalances.reduce((a, b) => a + b, 0);
    let imbalanceTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (imbalanceSum > 0.5) imbalanceTrend = 'bullish';
    else if (imbalanceSum < -0.5) imbalanceTrend = 'bearish';

    // CVD momentum (sum of CVD deltas)
    const cvdDeltas = recent.map(s => s.cvdDelta);
    const cvdSum = cvdDeltas.reduce((a, b) => a + b, 0);
    let cvdMomentum: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell' = 'neutral';
    if (cvdSum > 10000) cvdMomentum = 'strong_buy';
    else if (cvdSum > 3000) cvdMomentum = 'buy';
    else if (cvdSum < -10000) cvdMomentum = 'strong_sell';
    else if (cvdSum < -3000) cvdMomentum = 'sell';

    // Flow dominance (total buy vs sell volume)
    const totalBuyVol = recent.reduce((s, p) => s + p.buyVolume, 0);
    const totalSellVol = recent.reduce((s, p) => s + p.sellVolume, 0);
    const totalVol = totalBuyVol + totalSellVol;
    let flowDominance: 'buyers' | 'sellers' | 'balanced' = 'balanced';
    if (totalVol > 0) {
      const buyRatio = totalBuyVol / totalVol;
      if (buyRatio > 0.6) flowDominance = 'buyers';
      else if (buyRatio < 0.4) flowDominance = 'sellers';
    }

    // Spread condition (recent average spread)
    const avgSpreads = recent.map(s => s.avgSpreadPercent);
    const avgSpread = avgSpreads.reduce((a, b) => a + b, 0) / avgSpreads.length;
    let spreadCondition: 'tight' | 'normal' | 'wide' = 'normal';
    if (avgSpread < 0.03) spreadCondition = 'tight';
    else if (avgSpread > 0.08) spreadCondition = 'wide';

    // Whale activity (large order imbalance)
    const largeBuys = recent.reduce((s, p) => s + p.largeBuys, 0);
    const largeSells = recent.reduce((s, p) => s + p.largeSells, 0);
    let whaleActivity: 'accumulating' | 'distributing' | 'none' = 'none';
    if (largeBuys > largeSells + 2) whaleActivity = 'accumulating';
    else if (largeSells > largeBuys + 2) whaleActivity = 'distributing';

    return { imbalanceTrend, cvdMomentum, flowDominance, spreadCondition, whaleActivity };
  }, []);

  // Create summary MicrostructureInput from aggregated data
  const createSummary = useCallback((history: MicrostructureSnapshot[], currentCvd: number): MicrostructureInput => {
    if (history.length === 0) {
      return {
        imbalance: 0,
        cvd: currentCvd,
        cvdHistory: [],
        spreadPercent: 0,
        avgSpreadPercent: 0,
        recentLargeBuys: 0,
        recentLargeSells: 0,
      };
    }

    const recent = history.slice(-5);
    const avgImbalance = recent.reduce((s, p) => s + p.avgImbalance, 0) / recent.length;
    const avgSpread = recent.reduce((s, p) => s + p.avgSpreadPercent, 0) / recent.length;
    const latestSpread = recent[recent.length - 1]?.avgSpreadPercent || 0;

    // Build CVD history from snapshots
    const cvdHistory = history.slice(-30).map(s => ({
      time: s.timestamp,
      value: s.cvdEnd,
      price: s.closePrice,
    }));

    return {
      imbalance: avgImbalance,
      cvd: currentCvd,
      cvdHistory,
      spreadPercent: latestSpread,
      avgSpreadPercent: avgSpread,
      recentLargeBuys: recent.reduce((s, p) => s + p.largeBuys, 0),
      recentLargeSells: recent.reduce((s, p) => s + p.largeSells, 0),
    };
  }, []);

  // Aggregation effect - runs every minute
  useEffect(() => {
    if (!enabled) return;

    // Initialize period start
    periodDataRef.current.startTime = Date.now();
    periodDataRef.current.cvdStart = cvdRef.current;

    aggregationIntervalRef.current = setInterval(() => {
      const snapshot = createSnapshot();

      // Reset period data for next interval
      periodDataRef.current = {
        startTime: Date.now(),
        imbalances: [],
        spreads: [],
        cvdStart: cvdRef.current,
        trades: [],
        prices: [],
      };

      if (snapshot) {
        setAggregated(prev => {
          const newHistory = [...prev.history, snapshot].slice(-SNAPSHOT_HISTORY_LIMIT);
          const signals = deriveSignals(newHistory);
          const summary = createSummary(newHistory, cvdRef.current);

          return {
            current: snapshot,
            history: newHistory,
            signals,
            summary,
          };
        });
      }
    }, AGGREGATION_INTERVAL_MS);

    return () => {
      if (aggregationIntervalRef.current) {
        clearInterval(aggregationIntervalRef.current);
        aggregationIntervalRef.current = null;
      }
    };
  }, [enabled, createSnapshot, deriveSignals, createSummary]);

  // Collect data into current period when order book updates
  useEffect(() => {
    if (data.orderBook) {
      periodDataRef.current.imbalances.push(data.orderBook.imbalance);
      periodDataRef.current.spreads.push(data.orderBook.spreadPercent);
      if (data.orderBook.midPrice > 0) {
        periodDataRef.current.prices.push(data.orderBook.midPrice);
      }
    }
  }, [data.orderBook]);

  // Collect trades into current period
  useEffect(() => {
    if (data.trades.length > 0) {
      const latestTrade = data.trades[0];
      // Only add if it's a new trade (not already in period)
      const periodTrades = periodDataRef.current.trades;
      if (periodTrades.length === 0 || periodTrades[periodTrades.length - 1].id !== latestTrade.id) {
        periodDataRef.current.trades.push(latestTrade);
      }
    }
  }, [data.trades]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    status,
    data,
    aggregated,
    reconnect: connect,
    resetCVD,
  };
}

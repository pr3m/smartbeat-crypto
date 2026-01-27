'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { calculateIndicators, calculateBTCTrend } from '@/lib/trading/indicators';
import type { OHLCData, TimeframeData, TradeBalance } from '@/lib/kraken/types';
import { useKrakenWebSocket, type WebSocketStatus } from '@/hooks/useKrakenWebSocket';

export const TRADING_TIMEFRAMES = [
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 60, label: '1H' },
  { value: 240, label: '4H' },
];

export const TRADING_REFRESH_INTERVAL_SEC = 60;
const TRADING_REFRESH_INTERVAL_MS = TRADING_REFRESH_INTERVAL_SEC * 1000;
const RELOAD_THROTTLE_KEY = 'trading:lastOhlcFetchAt';

export interface Position {
  id: string;
  pair: string;
  type: 'buy' | 'sell';
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

export interface SimulatedBalanceData {
  eurBalance: number;
  cryptoValue: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  marginLevel: number | null;
  totalRealizedPnl: number;
  totalFeesPaid: number;
  openPositionsCount: number;
}

export interface SimulatedPosition {
  id: string;
  pair: string;
  side: 'long' | 'short';
  volume: number;
  avgEntryPrice: number;
  leverage: number;
  totalCost: number;
  totalFees: number;
  isOpen: boolean;
  openedAt: string;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  unrealizedPnlLevered?: number;
  unrealizedPnlLeveredPercent?: number;
  liquidationPrice?: number;
  marginUsed?: number;
  currentValue?: number;
}

export interface OpenOrder {
  id: string;
  pair: string;
  type: 'buy' | 'sell';
  orderType: 'limit' | 'stop-loss' | 'take-profit';
  price: number;
  volume: number;
  leverage: number;
  status: string;
  createdAt: string;
}

export interface FearGreedData {
  value: number;
  classification: string;
  timestamp: string;
}

interface TradingDataContextValue {
  wsStatus: WebSocketStatus;
  price: number;
  openPrice: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  bestBid: number;
  bestAsk: number;
  btcChange: number;
  btcTrend: 'bull' | 'bear' | 'neut';
  tfData: Record<number, TimeframeData>;
  loading: boolean;
  error: string | null;
  nextRefresh: number;
  refreshOhlc: (force?: boolean) => void;
  tradeBalance: TradeBalance | null;
  tradeBalanceLoading: boolean;
  tradeBalanceError: string | null;
  refreshTradeBalance: (force?: boolean) => void;
  openPositions: Position[];
  openPositionsLoading: boolean;
  openPositionsError: string | null;
  refreshOpenPositions: (force?: boolean) => void;
  simulatedBalance: SimulatedBalanceData | null;
  simulatedBalanceLoading: boolean;
  simulatedBalanceError: string | null;
  refreshSimulatedBalance: (force?: boolean) => void;
  simulatedPositions: SimulatedPosition[];
  simulatedPositionsLoading: boolean;
  simulatedPositionsError: string | null;
  refreshSimulatedPositions: (force?: boolean) => void;
  hasOpenSimulatedPosition: boolean;
  openOrders: OpenOrder[];
  openOrdersLoading: boolean;
  refreshOpenOrders: (force?: boolean) => void;
  fearGreed: FearGreedData | null;
  fearGreedLoading: boolean;
  refreshFearGreed: (force?: boolean) => void;
}

const TradingDataContext = createContext<TradingDataContextValue | null>(null);

interface TradingDataProviderProps {
  children: ReactNode;
  testMode: boolean;
  enabled?: boolean;
}

export function TradingDataProvider({ children, testMode, enabled = true }: TradingDataProviderProps) {
  const { status: wsStatus, tickers } = useKrakenWebSocket();
  const [price, setPrice] = useState(0);
  const [openPrice, setOpenPrice] = useState(0);
  const [high24h, setHigh24h] = useState(0);
  const [low24h, setLow24h] = useState(0);
  const [volume24h, setVolume24h] = useState(0);
  const [bestBid, setBestBid] = useState(0);
  const [bestAsk, setBestAsk] = useState(0);
  const [btcChange, setBtcChange] = useState(0);
  const [btcTrend, setBtcTrend] = useState<'bull' | 'bear' | 'neut'>('neut');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextRefresh, setNextRefresh] = useState(TRADING_REFRESH_INTERVAL_SEC);
  const [tfData, setTfData] = useState<Record<number, TimeframeData>>({
    5: { ohlc: [], indicators: null },
    15: { ohlc: [], indicators: null },
    60: { ohlc: [], indicators: null },
    240: { ohlc: [], indicators: null },
  });

  const [tradeBalance, setTradeBalance] = useState<TradeBalance | null>(null);
  const [tradeBalanceLoading, setTradeBalanceLoading] = useState(false);
  const [tradeBalanceError, setTradeBalanceError] = useState<string | null>(null);

  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [openPositionsLoading, setOpenPositionsLoading] = useState(false);
  const [openPositionsError, setOpenPositionsError] = useState<string | null>(null);

  const [simulatedBalance, setSimulatedBalance] = useState<SimulatedBalanceData | null>(null);
  const [simulatedBalanceLoading, setSimulatedBalanceLoading] = useState(false);
  const [simulatedBalanceError, setSimulatedBalanceError] = useState<string | null>(null);

  const [simulatedPositions, setSimulatedPositions] = useState<SimulatedPosition[]>([]);
  const [simulatedPositionsLoading, setSimulatedPositionsLoading] = useState(false);
  const [simulatedPositionsError, setSimulatedPositionsError] = useState<string | null>(null);

  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [openOrdersLoading, setOpenOrdersLoading] = useState(true); // Start as true to prevent flash
  const [lastOrderFillCheck, setLastOrderFillCheck] = useState(0);

  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);
  const [fearGreedLoading, setFearGreedLoading] = useState(false);

  const [isVisible, setIsVisible] = useState(true);

  const ohlcLoadingRef = useRef(false);
  const lastOhlcFetchRef = useRef(0);
  const lastTradeBalanceFetchRef = useRef(0);
  const lastOpenPositionsFetchRef = useRef(0);
  const lastSimBalanceFetchRef = useRef(0);
  const lastSimPositionsFetchRef = useRef(0);
  const lastOpenOrdersFetchRef = useRef(0);
  const lastFearGreedFetchRef = useRef(0);
  const priceRef = useRef(0);
  const initialMountRef = useRef(true);

  useEffect(() => {
    const handleVisibility = () => setIsVisible(document.visibilityState === 'visible');
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = Number(window.sessionStorage.getItem(RELOAD_THROTTLE_KEY));
    if (!Number.isNaN(stored) && stored > 0) {
      lastOhlcFetchRef.current = stored;
      const elapsed = Date.now() - stored;
      if (elapsed < TRADING_REFRESH_INTERVAL_MS) {
        setNextRefresh(Math.max(0, TRADING_REFRESH_INTERVAL_SEC - Math.floor(elapsed / 1000)));
      }
    }
  }, []);

  useEffect(() => {
    const xrpTicker = tickers['XRPEUR'];
    if (xrpTicker) {
      setPrice(xrpTicker.price || 0);
      if (xrpTicker.open > 0) setOpenPrice(xrpTicker.open);
      if (xrpTicker.high > 0) setHigh24h(xrpTicker.high);
      if (xrpTicker.low > 0) setLow24h(xrpTicker.low);
      if (xrpTicker.volume > 0) setVolume24h(xrpTicker.volume);
      if (xrpTicker.bid) setBestBid(xrpTicker.bid);
      if (xrpTicker.ask) setBestAsk(xrpTicker.ask);
    }

    const btcTicker = tickers['XBTEUR'];
    if (btcTicker && btcTicker.open > 0) {
      const change = ((btcTicker.price - btcTicker.open) / btcTicker.open) * 100;
      setBtcChange(change);
      const { trend } = calculateBTCTrend(change);
      setBtcTrend(trend);
    }
  }, [tickers]);

  useEffect(() => {
    priceRef.current = price;
  }, [price]);

  const refreshOhlc = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!isVisible && !force) return;
    if (ohlcLoadingRef.current) return;

    const now = Date.now();
    if (!force && now - lastOhlcFetchRef.current < TRADING_REFRESH_INTERVAL_MS) {
      return;
    }

    ohlcLoadingRef.current = true;
    lastOhlcFetchRef.current = now;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(RELOAD_THROTTLE_KEY, String(now));
    }

    try {
      const responses = await Promise.all(
        TRADING_TIMEFRAMES.map(tf =>
          fetch(`/api/kraken/public/ohlc?pair=XRPEUR&interval=${tf.value}`)
        )
      );

      const newTfData: Record<number, TimeframeData> = {
        5: { ohlc: [], indicators: null },
        15: { ohlc: [], indicators: null },
        60: { ohlc: [], indicators: null },
        240: { ohlc: [], indicators: null },
      };

      for (let i = 0; i < TRADING_TIMEFRAMES.length; i += 1) {
        const tf = TRADING_TIMEFRAMES[i].value;
        const response = responses[i];
        if (!response.ok) {
          console.error(`Failed to fetch OHLC for ${tf}m:`, response.status);
          continue;
        }

        const ohlcResult = await response.json();
        if (!ohlcResult.error && ohlcResult.data) {
          const ohlc: OHLCData[] = ohlcResult.data;
          const indicators = calculateIndicators(ohlc);
          newTfData[tf] = { ohlc, indicators };
        }
      }

      setTfData(newTfData);
      setLoading(false);
      setError(null);
      setNextRefresh(TRADING_REFRESH_INTERVAL_SEC);
    } catch (err) {
      console.error('Load error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setLoading(false);
      setNextRefresh(TRADING_REFRESH_INTERVAL_SEC);
    } finally {
      ohlcLoadingRef.current = false;
    }
  }, [enabled, isVisible]);

  const fetchTradeBalance = useCallback(async (force = false) => {
    if (testMode) return;
    if (!enabled) return;
    if (!isVisible && !force) return;

    const now = Date.now();
    if (!force && now - lastTradeBalanceFetchRef.current < TRADING_REFRESH_INTERVAL_MS) {
      return;
    }

    lastTradeBalanceFetchRef.current = now;
    setTradeBalanceLoading(true);
    setTradeBalanceError(null);

    try {
      const res = await fetch('/api/kraken/private/trade-balance');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch trade balance');
      }
      const data = await res.json();
      setTradeBalance(data);
    } catch (err) {
      setTradeBalanceError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setTradeBalanceLoading(false);
    }
  }, [enabled, isVisible, testMode]);

  const fetchSimulatedBalance = useCallback(async (force = false) => {
    if (!testMode) return;
    if (!enabled) return;
    if (!isVisible && !force) return;

    const now = Date.now();
    if (!force && now - lastSimBalanceFetchRef.current < TRADING_REFRESH_INTERVAL_MS) {
      return;
    }

    lastSimBalanceFetchRef.current = now;
    setSimulatedBalanceLoading(true);
    setTradeBalanceLoading(true);
    setSimulatedBalanceError(null);
    setTradeBalanceError(null);

    try {
      const res = await fetch('/api/simulated/balance');
      const data = await res.json();

      if (!res.ok || data.success === false) {
        const errorMsg = data.error || 'Failed to fetch balance';
        setSimulatedBalanceError(errorMsg);
        setTradeBalanceError(errorMsg);
        return;
      }

      setSimulatedBalance(data);
      setTradeBalance({
        eb: data.eurBalance.toString(),
        tb: data.eurBalance.toString(),
        m: data.marginUsed.toString(),
        n: '0',
        c: '0',
        v: '0',
        e: data.equity.toString(),
        mf: data.freeMargin.toString(),
        ml: data.marginLevel?.toString(),
      });
      setSimulatedBalanceError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to connect to server';
      setSimulatedBalanceError(errorMsg);
      setTradeBalanceError(errorMsg);
    } finally {
      setSimulatedBalanceLoading(false);
      setTradeBalanceLoading(false);
    }
  }, [enabled, isVisible, testMode]);

  const fetchOpenPositions = useCallback(async (force = false) => {
    if (testMode) return;
    if (!enabled) return;
    if (!isVisible && !force) return;

    const now = Date.now();
    if (!force && now - lastOpenPositionsFetchRef.current < TRADING_REFRESH_INTERVAL_MS) {
      return;
    }

    lastOpenPositionsFetchRef.current = now;
    setOpenPositionsLoading(true);
    setOpenPositionsError(null);

    try {
      const res = await fetch('/api/kraken/private/positions');
      if (!res.ok) {
        if (res.status === 401) {
          setOpenPositionsError('API keys not configured');
          setOpenPositions([]);
          return;
        }
        throw new Error('Failed to fetch positions');
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      // Debug: Log raw position data to see what Kraken returns
      console.log('[Positions] Raw Kraken data:', JSON.stringify(data, null, 2));

      const parsedPositions: Position[] = Object.entries(data).map(([id, pos]: [string, any]) => {
        // Parse time - Kraken returns Unix timestamp in seconds (can be number or string)
        const rawTime = pos.time;
        let openTime: number;
        if (rawTime) {
          // Handle both number and string formats
          const timeInSeconds = typeof rawTime === 'string' ? parseFloat(rawTime) : rawTime;
          openTime = timeInSeconds * 1000; // Convert to milliseconds
        } else {
          console.warn('[Positions] Missing time field for position:', id, 'Raw pos:', pos);
          openTime = Date.now();
        }

        // Parse leverage - Kraken may return as string like "10.00000000"
        // If not available, calculate from cost/margin
        const rawLeverage = pos.leverage;
        const cost = parseFloat(pos.cost || '0');
        const margin = parseFloat(pos.margin || '0');
        let leverage: number;
        if (rawLeverage) {
          leverage = parseFloat(rawLeverage);
        } else if (margin > 0) {
          // Calculate leverage from cost/margin
          leverage = Math.round(cost / margin);
        } else {
          leverage = 1;
        }
        console.log('[Positions] Leverage for position:', id, { rawLeverage, cost, margin, calculatedLeverage: leverage });

        return {
          id,
          pair: pos.pair || '',
          type: pos.type || 'buy',
          cost: parseFloat(pos.cost || '0'),
          fee: parseFloat(pos.fee || '0'),
          volume: parseFloat(pos.vol || '0'),
          margin: parseFloat(pos.margin || '0'),
          value: parseFloat(pos.value || '0'),
          net: parseFloat(pos.net || '0'),
          leverage,
          openTime,
          rollovertm: pos.rollovertm ? parseFloat(pos.rollovertm) * 1000 : 0,
          actualRolloverCost: 0, // Will be fetched separately from ledger
        };
      });

      const xrpPositions = parsedPositions.filter(p =>
        p.pair.includes('XRP') || p.pair.includes('XXRP')
      );

      // Consolidate positions by pair and type (buy/sell)
      // Multiple orders may make up a single logical position
      const consolidatedMap = new Map<string, Position>();
      for (const pos of xrpPositions) {
        const key = `${pos.pair}-${pos.type}`;
        const existing = consolidatedMap.get(key);
        if (existing) {
          // Aggregate: sum volumes, costs, fees, margins; use earliest open time
          consolidatedMap.set(key, {
            id: `${key}-consolidated`, // Composite ID
            pair: pos.pair,
            type: pos.type,
            cost: existing.cost + pos.cost,
            fee: existing.fee + pos.fee,
            volume: existing.volume + pos.volume,
            margin: existing.margin + pos.margin,
            value: existing.value + pos.value,
            net: existing.net + pos.net,
            leverage: pos.leverage, // Same leverage for same pair
            openTime: Math.min(existing.openTime, pos.openTime), // Earliest open time
            rollovertm: Math.max(existing.rollovertm, pos.rollovertm),
            actualRolloverCost: existing.actualRolloverCost + pos.actualRolloverCost,
          });
        } else {
          consolidatedMap.set(key, { ...pos, id: `${key}-consolidated` });
        }
      }
      const consolidatedPositions = Array.from(consolidatedMap.values());

      // Fetch actual rollover costs from ledger for each position
      const positionsWithRollover = await Promise.all(
        consolidatedPositions.map(async (position) => {
          try {
            // Extract asset from pair (e.g., "XRPEUR" -> "XRP")
            const asset = position.pair.replace(/EUR$|USD$|GBP$|ZEUR$|ZUSD$|ZGBP$/, '').replace(/^X/, '');
            const res = await fetch(
              `/api/kraken/private/rollover-costs?openTime=${position.openTime}&asset=${asset}`
            );
            if (res.ok) {
              const data = await res.json();
              return { ...position, actualRolloverCost: data.totalRolloverCost || 0 };
            }
          } catch (err) {
            console.warn('Failed to fetch rollover costs for position:', position.id, err);
          }
          return position;
        })
      );

      setOpenPositions(positionsWithRollover);
      setOpenPositionsError(null);
    } catch (err) {
      console.error('Failed to fetch positions:', err);
      setOpenPositionsError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setOpenPositionsLoading(false);
    }
  }, [enabled, isVisible, testMode]);

  const fetchSimulatedPositions = useCallback(async (force = false) => {
    if (!testMode) return;
    if (!enabled) return;
    if (!isVisible && !force) return;

    const now = Date.now();
    if (!force && now - lastSimPositionsFetchRef.current < TRADING_REFRESH_INTERVAL_MS) {
      return;
    }

    lastSimPositionsFetchRef.current = now;
    setSimulatedPositionsLoading(true);
    setSimulatedPositionsError(null);

    try {
      const currentPrice = priceRef.current || 0;
      const res = await fetch(`/api/simulated/positions?open=true&currentPrice=${currentPrice}`);
      const data = await res.json();

      if (!res.ok || data.success === false) {
        const errorMsg = data.error || 'Failed to fetch positions';
        setSimulatedPositionsError(errorMsg);
        return;
      }

      setSimulatedPositions(data.positions || []);
      setSimulatedPositionsError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to connect to server';
      setSimulatedPositionsError(errorMsg);
      console.error('Error fetching simulated positions:', err);
    } finally {
      setSimulatedPositionsLoading(false);
    }
  }, [enabled, isVisible, testMode]);

  const refreshTradeBalance = useCallback((force = false) => {
    if (testMode) {
      fetchSimulatedBalance(force);
      return;
    }
    fetchTradeBalance(force);
  }, [fetchSimulatedBalance, fetchTradeBalance, testMode]);

  const refreshOpenPositions = useCallback((force = false) => {
    fetchOpenPositions(force);
  }, [fetchOpenPositions]);

  const refreshSimulatedBalance = useCallback((force = false) => {
    fetchSimulatedBalance(force);
  }, [fetchSimulatedBalance]);

  const refreshSimulatedPositions = useCallback((force = false) => {
    fetchSimulatedPositions(force);
  }, [fetchSimulatedPositions]);

  const fetchOpenOrders = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!isVisible && !force) return;

    const now = Date.now();
    if (!force && now - lastOpenOrdersFetchRef.current < TRADING_REFRESH_INTERVAL_MS) {
      return;
    }

    lastOpenOrdersFetchRef.current = now;
    setOpenOrdersLoading(true);

    try {
      const endpoint = testMode ? '/api/simulated/orders?status=open' : '/api/kraken/private/orders?status=open';
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();

      // Check for error response
      if (data.error) {
        console.error('Orders API error:', data.error);
        return; // Don't clear existing orders on error
      }

      // Map to OpenOrder interface
      const orders: OpenOrder[] = (data.orders || []).map((o: Record<string, unknown>) => ({
        id: o.id,
        pair: o.pair,
        type: o.type,
        orderType: o.orderType || 'limit',
        price: o.price || 0,
        volume: o.volume || 0,
        leverage: o.leverage || 1,
        status: o.status,
        createdAt: o.createdAt,
      }));

      setOpenOrders(orders);
    } catch (err) {
      console.error('Error fetching open orders:', err);
      // Don't clear orders on error - keep showing previous orders
    } finally {
      setOpenOrdersLoading(false);
    }
  }, [enabled, isVisible, testMode]);

  const refreshOpenOrders = useCallback((force = false) => {
    fetchOpenOrders(force);
  }, [fetchOpenOrders]);

  // Fear & Greed Index fetch - 5 minute cache (matches API cache)
  const FEAR_GREED_CACHE_MS = 5 * 60 * 1000;

  const fetchFearGreed = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!isVisible && !force) return;

    const now = Date.now();
    if (!force && now - lastFearGreedFetchRef.current < FEAR_GREED_CACHE_MS) {
      return;
    }

    lastFearGreedFetchRef.current = now;
    setFearGreedLoading(true);

    try {
      const res = await fetch('/api/fear-greed');
      if (!res.ok) throw new Error('Failed to fetch fear greed');
      const data = await res.json();
      if (data.value !== undefined) {
        setFearGreed({
          value: data.value,
          classification: data.classification,
          timestamp: data.timestamp || new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Error fetching fear greed:', err);
    } finally {
      setFearGreedLoading(false);
    }
  }, [enabled, isVisible]);

  const refreshFearGreed = useCallback((force = false) => {
    fetchFearGreed(force);
  }, [fetchFearGreed]);

  useEffect(() => {
    if (!enabled) return;
    // Force fetch on initial mount to ensure data loads reliably
    const forceInitial = initialMountRef.current;
    initialMountRef.current = false;
    refreshOhlc(forceInitial);
    const interval = setInterval(() => refreshOhlc(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshOhlc]);

  useEffect(() => {
    const interval = setInterval(() => {
      const last = lastOhlcFetchRef.current;
      if (!last) return;
      const elapsed = Date.now() - last;
      const remaining = Math.max(0, TRADING_REFRESH_INTERVAL_SEC - Math.floor(elapsed / 1000));
      setNextRefresh(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refreshTradeBalance();
    const interval = setInterval(() => refreshTradeBalance(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshTradeBalance]);

  useEffect(() => {
    if (!enabled || testMode) return;
    refreshOpenPositions();
    const interval = setInterval(() => refreshOpenPositions(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshOpenPositions, testMode]);

  useEffect(() => {
    if (!enabled || !testMode) return;
    refreshSimulatedBalance();
    const interval = setInterval(() => refreshSimulatedBalance(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshSimulatedBalance, testMode]);

  useEffect(() => {
    if (!enabled || !testMode) return;
    refreshSimulatedPositions();
    const interval = setInterval(() => refreshSimulatedPositions(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshSimulatedPositions, testMode]);

  useEffect(() => {
    if (!enabled) return;
    refreshOpenOrders();
    const interval = setInterval(() => refreshOpenOrders(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshOpenOrders]);

  // Fetch Fear & Greed on mount and refresh every 5 minutes
  useEffect(() => {
    if (!enabled) return;
    refreshFearGreed();
    const interval = setInterval(() => refreshFearGreed(), FEAR_GREED_CACHE_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshFearGreed, FEAR_GREED_CACHE_MS]);

  // Check and fill limit orders when price changes (test mode only)
  useEffect(() => {
    if (!testMode || !enabled || !price || price <= 0) return;

    // Throttle checks to every 2 seconds minimum
    const now = Date.now();
    if (now - lastOrderFillCheck < 2000) return;
    setLastOrderFillCheck(now);

    // Only check if there are open orders
    if (openOrders.length === 0) return;

    const checkAndFillOrders = async () => {
      try {
        const res = await fetch('/api/simulated/orders/fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPrice: price }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.filled > 0) {
            // Refresh everything when orders fill
            refreshOpenOrders(true);
            refreshSimulatedPositions(true);
            refreshSimulatedBalance(true);
          }
        }
      } catch (err) {
        console.error('Error checking limit orders:', err);
      }
    };

    checkAndFillOrders();
  }, [price, testMode, enabled, openOrders.length, lastOrderFillCheck, refreshOpenOrders, refreshSimulatedPositions, refreshSimulatedBalance]);

  const hasOpenSimulatedPosition = useMemo(() => {
    if (simulatedBalance?.openPositionsCount !== undefined) {
      return simulatedBalance.openPositionsCount > 0;
    }
    return simulatedPositions.length > 0;
  }, [simulatedBalance, simulatedPositions]);

  const value = useMemo<TradingDataContextValue>(() => ({
    wsStatus,
    price,
    openPrice,
    high24h,
    low24h,
    volume24h,
    bestBid,
    bestAsk,
    btcChange,
    btcTrend,
    tfData,
    loading,
    error,
    nextRefresh,
    refreshOhlc,
    tradeBalance,
    tradeBalanceLoading,
    tradeBalanceError,
    refreshTradeBalance,
    openPositions,
    openPositionsLoading,
    openPositionsError,
    refreshOpenPositions,
    simulatedBalance,
    simulatedBalanceLoading,
    simulatedBalanceError,
    refreshSimulatedBalance,
    simulatedPositions,
    simulatedPositionsLoading,
    simulatedPositionsError,
    refreshSimulatedPositions,
    hasOpenSimulatedPosition,
    openOrders,
    openOrdersLoading,
    refreshOpenOrders,
    fearGreed,
    fearGreedLoading,
    refreshFearGreed,
  }), [
    wsStatus,
    price,
    openPrice,
    high24h,
    low24h,
    volume24h,
    bestBid,
    bestAsk,
    btcChange,
    btcTrend,
    tfData,
    loading,
    error,
    nextRefresh,
    refreshOhlc,
    tradeBalance,
    tradeBalanceLoading,
    tradeBalanceError,
    refreshTradeBalance,
    openPositions,
    openPositionsLoading,
    openPositionsError,
    refreshOpenPositions,
    simulatedBalance,
    simulatedBalanceLoading,
    simulatedBalanceError,
    refreshSimulatedBalance,
    simulatedPositions,
    simulatedPositionsLoading,
    simulatedPositionsError,
    refreshSimulatedPositions,
    hasOpenSimulatedPosition,
    openOrders,
    openOrdersLoading,
    refreshOpenOrders,
    fearGreed,
    fearGreedLoading,
    refreshFearGreed,
  ]);

  return (
    <TradingDataContext.Provider value={value}>
      {children}
    </TradingDataContext.Provider>
  );
}

export function useTradingData() {
  const context = useContext(TradingDataContext);
  if (!context) {
    throw new Error('useTradingData must be used within TradingDataProvider');
  }
  return context;
}

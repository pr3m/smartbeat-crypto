'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { calculateIndicators, calculateBTCTrend, evaluateBTCTrends } from '@/lib/trading/indicators';
import type { OHLCData, TimeframeData, TradeBalance } from '@/lib/kraken/types';
import type { BTCTimeframeTrend } from '@/lib/trading/v2-types';
import { getDefaultStrategy } from '@/lib/trading/strategies';
import { useKrakenWebSocket, type WebSocketStatus } from '@/hooks/useKrakenWebSocket';

export const TRADING_TIMEFRAMES = [
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 60, label: '1H' },
  { value: 240, label: '4H' },
  { value: 1440, label: '1D' },
];

export const TRADING_REFRESH_INTERVAL_SEC = 60;
const TRADING_REFRESH_INTERVAL_MS = TRADING_REFRESH_INTERVAL_SEC * 1000;
const RELOAD_THROTTLE_KEY = 'trading:lastOhlcFetchAt';

export interface RawPositionEntry {
  id: string;           // Kraken position ID
  ordertxid: string;    // Order txid (for grouping partial fills)
  price: number;        // cost / vol
  volume: number;
  cost: number;
  fee: number;
  margin: number;
  timestamp: number;    // ms
}

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
  rolloverRatePer4h: number;  // Parsed from Kraken's terms field (e.g. 0.0001 for 0.01%)
  rawEntries: RawPositionEntry[]; // Individual Kraken position entries for DCA detection
}

export interface SimulatedBalanceData {
  eurBalance: number;
  cryptoValue: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  marginLevel: number | null;
  unrealizedPnl: number;
  totalRealizedPnl: number;
  totalFeesPaid: number;
  openPositionsCount: number;
  liquidated?: boolean;
  liquidationMessage?: string;
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

export interface DraftOrder {
  id: string;
  pair: string;
  side: 'buy' | 'sell';
  orderType: string;
  price: number | null;
  price2: number | null;
  volume: number;
  displayVolume: number | null;
  leverage: number;
  trailingOffset: number | null;
  trailingOffsetType: string | null;
  source: 'manual' | 'ai';
  aiSetupType: string | null;
  aiAnalysisId: string | null;
  activationCriteria: string | null;
  invalidation: string | null;
  positionSizePct: number | null;
  status: string;
  testMode: boolean;
  submittedOrderId: string | null;
  createdAt: string;
  updatedAt: string;
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
  btcTfTrends: BTCTimeframeTrend[];
  tfData: Record<number, TimeframeData>;
  loading: boolean;
  error: string | null;
  getNextRefresh: () => number;
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
  refreshSimulatedPositions: (force?: boolean, overridePrice?: number) => void;
  hasOpenSimulatedPosition: boolean;
  openOrders: OpenOrder[];
  openOrdersLoading: boolean;
  refreshOpenOrders: (force?: boolean) => void;
  fearGreed: FearGreedData | null;
  fearGreedLoading: boolean;
  refreshFearGreed: (force?: boolean) => void;
  draftOrders: DraftOrder[];
  draftOrdersLoading: boolean;
  refreshDraftOrders: (force?: boolean) => void;
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
  const [btcTfTrends, setBtcTfTrends] = useState<BTCTimeframeTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // nextRefresh is tracked via nextRefreshRef (set up near the countdown timer effect)
  // to avoid putting a per-second-changing value into context.
  const [tfData, setTfData] = useState<Record<number, TimeframeData>>({
    5: { ohlc: [], indicators: null },
    15: { ohlc: [], indicators: null },
    60: { ohlc: [], indicators: null },
    240: { ohlc: [], indicators: null },
    1440: { ohlc: [], indicators: null },
  });

  const [tradeBalance, setTradeBalance] = useState<TradeBalance | null>(null);
  const [tradeBalanceLoading, setTradeBalanceLoading] = useState(false);
  const [tradeBalanceError, setTradeBalanceError] = useState<string | null>(null);

  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [openPositionsLoading, setOpenPositionsLoading] = useState(true); // Start true to prevent flash
  const [openPositionsError, setOpenPositionsError] = useState<string | null>(null);

  const [simulatedBalance, setSimulatedBalance] = useState<SimulatedBalanceData | null>(null);
  const [simulatedBalanceLoading, setSimulatedBalanceLoading] = useState(true); // Start true to prevent flash
  const [simulatedBalanceError, setSimulatedBalanceError] = useState<string | null>(null);

  const [simulatedPositions, setSimulatedPositions] = useState<SimulatedPosition[]>([]);
  const [simulatedPositionsLoading, setSimulatedPositionsLoading] = useState(true); // Start true to prevent flash
  const [simulatedPositionsError, setSimulatedPositionsError] = useState<string | null>(null);

  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [openOrdersLoading, setOpenOrdersLoading] = useState(true); // Start as true to prevent flash
  const lastOrderFillCheckRef = useRef(0);

  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);
  const [fearGreedLoading, setFearGreedLoading] = useState(false);

  const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
  const [draftOrdersLoading, setDraftOrdersLoading] = useState(false);

  const [isVisible, setIsVisible] = useState(true);

  const ohlcLoadingRef = useRef(false);
  const lastOhlcFetchRef = useRef(0);
  const lastTradeBalanceFetchRef = useRef(0);
  const lastOpenPositionsFetchRef = useRef(0);
  const lastSimBalanceFetchRef = useRef(0);
  const lastSimPositionsFetchRef = useRef(0);
  const lastOpenOrdersFetchRef = useRef(0);
  const lastFearGreedFetchRef = useRef(0);
  const lastDraftOrdersFetchRef = useRef(0);
  const priceRef = useRef(0);
  const initialMountRef = useRef(true);
  const hadInitialPriceRef = useRef(false);

  // Throttle ticker updates to prevent excessive re-renders (100ms minimum between updates)
  const lastTickerUpdateRef = useRef(0);
  const pendingTickerRef = useRef<typeof tickers | null>(null);
  const tickerThrottleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        nextRefreshRef.current = (Math.max(0, TRADING_REFRESH_INTERVAL_SEC - Math.floor(elapsed / 1000)));
      }
    }
  }, []);

  // Process ticker updates with throttling to prevent excessive re-renders
  const processTickerUpdate = useCallback((tickerData: typeof tickers) => {
    const xrpTicker = tickerData['XRPEUR'];
    if (xrpTicker) {
      setPrice(xrpTicker.price || 0);
      if (xrpTicker.open > 0) setOpenPrice(xrpTicker.open);
      if (xrpTicker.high > 0) setHigh24h(xrpTicker.high);
      if (xrpTicker.low > 0) setLow24h(xrpTicker.low);
      if (xrpTicker.volume > 0) setVolume24h(xrpTicker.volume);
      if (xrpTicker.bid) setBestBid(xrpTicker.bid);
      if (xrpTicker.ask) setBestAsk(xrpTicker.ask);
    }

    const btcTicker = tickerData['XBTEUR'];
    if (btcTicker && btcTicker.open > 0) {
      const change = ((btcTicker.price - btcTicker.open) / btcTicker.open) * 100;
      setBtcChange(change);
      const { trend } = calculateBTCTrend(change);
      setBtcTrend(trend);
    }
  }, []);

  // Throttled ticker update effect - limits updates to max 10 per second
  useEffect(() => {
    const THROTTLE_MS = 100; // 100ms between updates = max 10 updates/sec
    const now = Date.now();
    const timeSinceLastUpdate = now - lastTickerUpdateRef.current;

    if (timeSinceLastUpdate >= THROTTLE_MS) {
      // Enough time has passed, update immediately
      lastTickerUpdateRef.current = now;
      processTickerUpdate(tickers);
    } else {
      // Store pending update for later
      pendingTickerRef.current = tickers;

      // Only schedule if we don't already have a pending timeout
      if (!tickerThrottleTimeoutRef.current) {
        tickerThrottleTimeoutRef.current = setTimeout(() => {
          tickerThrottleTimeoutRef.current = null;
          if (pendingTickerRef.current) {
            lastTickerUpdateRef.current = Date.now();
            processTickerUpdate(pendingTickerRef.current);
            pendingTickerRef.current = null;
          }
        }, THROTTLE_MS - timeSinceLastUpdate);
      }
    }
    // Note: No cleanup needed - timeout is self-clearing and uses ref for latest data
  }, [tickers, processTickerUpdate]);

  // Cleanup timeout on unmount only
  useEffect(() => {
    return () => {
      if (tickerThrottleTimeoutRef.current) {
        clearTimeout(tickerThrottleTimeoutRef.current);
        tickerThrottleTimeoutRef.current = null;
      }
    };
  }, []);

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
      // Determine which BTC timeframes the active strategy needs
      const strat = getDefaultStrategy();
      const btcIntervals = strat.btcAlignment?.timeframes ?? [];

      // Fetch XRP OHLC + BTC OHLC in parallel
      const [xrpResponses, ...btcResponses] = await Promise.all([
        Promise.all(
          TRADING_TIMEFRAMES.map(tf =>
            fetch(`/api/kraken/public/ohlc?pair=XRPEUR&interval=${tf.value}`)
          )
        ),
        ...btcIntervals.map(interval =>
          fetch(`/api/kraken/public/ohlc?pair=XBTEUR&interval=${interval}`)
        ),
      ]);

      // Process XRP OHLC
      const newTfData: Record<number, TimeframeData> = {
        5: { ohlc: [], indicators: null },
        15: { ohlc: [], indicators: null },
        60: { ohlc: [], indicators: null },
        240: { ohlc: [], indicators: null },
        1440: { ohlc: [], indicators: null },
      };

      for (let i = 0; i < TRADING_TIMEFRAMES.length; i += 1) {
        const tf = TRADING_TIMEFRAMES[i].value;
        const response = xrpResponses[i];
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

      // Process BTC OHLC and calculate per-timeframe trends
      if (strat.btcAlignment && btcIntervals.length > 0) {
        const btcOhlcByInterval: Record<number, OHLCData[]> = {};
        for (let i = 0; i < btcIntervals.length; i++) {
          const interval = btcIntervals[i];
          const response = btcResponses[i];
          if (!response || !response.ok) continue;
          const result = await response.json();
          if (!result.error && result.data) {
            btcOhlcByInterval[interval] = result.data;
          }
        }
        const trends = evaluateBTCTrends(btcOhlcByInterval, strat.btcAlignment);
        setBtcTfTrends(trends);
      }

      setTfData(newTfData);
      setLoading(false);
      setError(null);
      nextRefreshRef.current = (TRADING_REFRESH_INTERVAL_SEC);
    } catch (err) {
      console.error('Load error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setLoading(false);
      nextRefreshRef.current = (TRADING_REFRESH_INTERVAL_SEC);
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
      // Pass current price so balance API can compute unrealized P&L and check liquidation
      const currentPrice = priceRef.current || 0;
      const url = currentPrice > 0
        ? `/api/simulated/balance?currentPrice=${currentPrice}`
        : '/api/simulated/balance';
      const res = await fetch(url);
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
        n: (data.unrealizedPnl ?? 0).toString(),
        c: '0',
        v: '0',
        e: data.equity.toString(),
        mf: data.freeMargin.toString(),
        ml: data.marginLevel?.toString(),
      });
      setSimulatedBalanceError(null);

      // If liquidation occurred, refresh positions too
      if (data.liquidated) {
        // Clear positions directly since they were force-closed
        setSimulatedPositions([]);
      }
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

        const parsedCost = parseFloat(pos.cost || '0');
        const parsedVol = parseFloat(pos.vol || '0');
        const parsedFee = parseFloat(pos.fee || '0');
        const parsedMargin = parseFloat(pos.margin || '0');

        // Parse rollover rate from Kraken's terms field (e.g. "0.0100% per 4 hours")
        let rolloverRatePer4h = 0;
        if (pos.terms) {
          const match = pos.terms.match(/([\d.]+)%\s*per\s*4\s*hours?/i);
          if (match) {
            rolloverRatePer4h = parseFloat(match[1]) / 100; // Convert "0.0100" % to 0.0001
          }
        }

        return {
          id,
          pair: pos.pair || '',
          type: pos.type || 'buy',
          cost: parsedCost,
          fee: parsedFee,
          volume: parsedVol,
          margin: parsedMargin,
          value: parseFloat(pos.value || '0'),
          net: parseFloat(pos.net || '0'),
          leverage,
          openTime,
          rollovertm: pos.rollovertm ? parseFloat(pos.rollovertm) * 1000 : 0,
          actualRolloverCost: 0, // Will be fetched separately from ledger
          rolloverRatePer4h,
          rawEntries: [{
            id,
            ordertxid: pos.ordertxid || '',
            price: parsedVol > 0 ? parsedCost / parsedVol : 0,
            volume: parsedVol,
            cost: parsedCost,
            fee: parsedFee,
            margin: parsedMargin,
            timestamp: openTime,
          }],
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
            rolloverRatePer4h: pos.rolloverRatePer4h || existing.rolloverRatePer4h, // Use any non-zero rate
            rawEntries: [...existing.rawEntries, ...pos.rawEntries],
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
            const params = new URLSearchParams({
              openTime: String(position.openTime),
              asset,
              costBasis: String(position.cost),
              rolloverRate: String(position.rolloverRatePer4h),
            });
            const res = await fetch(`/api/kraken/private/rollover-costs?${params}`);
            if (res.ok) {
              const data = await res.json();
              console.log('[Rollover] Response for', asset, data);
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

  const fetchSimulatedPositions = useCallback(async (force = false, overridePrice?: number) => {
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
      // Use override price if provided, otherwise use ref
      const currentPrice = overridePrice ?? priceRef.current ?? 0;
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

  const refreshSimulatedPositions = useCallback((force = false, overridePrice?: number) => {
    fetchSimulatedPositions(force, overridePrice);
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

  // Draft Orders fetch
  const fetchDraftOrders = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!isVisible && !force) return;

    const now = Date.now();
    if (!force && now - lastDraftOrdersFetchRef.current < TRADING_REFRESH_INTERVAL_MS) {
      return;
    }

    lastDraftOrdersFetchRef.current = now;
    setDraftOrdersLoading(true);

    try {
      // Filter drafts by current mode (testMode)
      const res = await fetch(`/api/draft-orders?status=pending&testMode=${testMode}`);
      if (!res.ok) throw new Error('Failed to fetch draft orders');
      const data = await res.json();

      if (data.error) {
        console.error('Draft Orders API error:', data.error);
        return;
      }

      setDraftOrders(data.drafts || []);
    } catch (err) {
      console.error('Error fetching draft orders:', err);
    } finally {
      setDraftOrdersLoading(false);
    }
  }, [enabled, isVisible, testMode]);

  const refreshDraftOrders = useCallback((force = false) => {
    fetchDraftOrders(force);
  }, [fetchDraftOrders]);

  useEffect(() => {
    if (!enabled) return;
    // Force fetch on initial mount to ensure data loads reliably
    const forceInitial = initialMountRef.current;
    initialMountRef.current = false;
    refreshOhlc(forceInitial);
    const interval = setInterval(() => refreshOhlc(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshOhlc]);

  // Background OHLC refresh: runs every 3 minutes when tab is hidden
  // so notifications can still fire from updated signal data
  const BACKGROUND_REFRESH_MS = 3 * 60 * 1000;
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      if (document.hidden) {
        refreshOhlc(true);
      }
    }, BACKGROUND_REFRESH_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshOhlc]);

  // Countdown timer updates a ref (not state) to avoid re-rendering 14+ context consumers every second.
  // The page component reads this via getNextRefresh() and manages its own local state for display.
  const nextRefreshRef = useRef(TRADING_REFRESH_INTERVAL_SEC);
  useEffect(() => {
    const interval = setInterval(() => {
      const last = lastOhlcFetchRef.current;
      if (!last) return;
      const elapsed = Date.now() - last;
      nextRefreshRef.current = Math.max(0, TRADING_REFRESH_INTERVAL_SEC - Math.floor(elapsed / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refreshTradeBalance();
    const interval = setInterval(() => refreshTradeBalance(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshTradeBalance]);

  // Initial fetch of live positions - wait for price to ensure UI can display current price
  useEffect(() => {
    if (!enabled || testMode) return;
    if (price <= 0) return; // Wait for WebSocket to provide price
    if (hadInitialPriceRef.current) return; // Already done initial fetch

    hadInitialPriceRef.current = true;
    refreshOpenPositions();
  }, [enabled, testMode, price, refreshOpenPositions]);

  // Periodic refresh of live positions (separate from initial fetch)
  useEffect(() => {
    if (!enabled || testMode) return;

    const interval = setInterval(() => refreshOpenPositions(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, testMode, refreshOpenPositions]);

  useEffect(() => {
    if (!enabled || !testMode) return;
    refreshSimulatedBalance();
    const interval = setInterval(() => refreshSimulatedBalance(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshSimulatedBalance, testMode]);

  // Initial fetch of simulated positions - wait for price to be available to avoid flicker
  useEffect(() => {
    if (!enabled || !testMode) return;
    if (price <= 0) return; // Wait for WebSocket to provide price
    if (hadInitialPriceRef.current) return; // Already done initial fetch

    hadInitialPriceRef.current = true;
    refreshSimulatedPositions(true, price);
  }, [enabled, testMode, price, refreshSimulatedPositions]);

  // Periodic refresh of simulated positions (separate from initial fetch)
  useEffect(() => {
    if (!enabled || !testMode) return;

    const interval = setInterval(() => refreshSimulatedPositions(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, testMode, refreshSimulatedPositions]);

  // Reset price-aware fetch flag when testMode changes
  useEffect(() => {
    hadInitialPriceRef.current = false;
  }, [testMode]);

  // Clear stale data when switching modes to prevent cross-contamination
  // Without this, switching from test→live leaves simulatedPositions in state,
  // causing useV2Engine to show a stale simulated position instead of the real one
  useEffect(() => {
    if (!testMode) {
      setSimulatedPositions([]);
      setSimulatedBalanceLoading(false);
      setSimulatedPositionsLoading(false);
    } else {
      setOpenPositions([]);
      setOpenPositionsLoading(false);
    }
  }, [testMode]);

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

  // Fetch Draft Orders on mount and periodically refresh
  // Force refresh when testMode changes to show mode-specific drafts
  useEffect(() => {
    if (!enabled) return;
    refreshDraftOrders(true); // Force refresh to handle mode change
    const interval = setInterval(() => refreshDraftOrders(), TRADING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshDraftOrders, testMode]);

  // Check and fill limit orders when price changes (test mode only)
  // Also runs when positions are open (for liquidation checks via balance API)
  // Uses refs for throttling and latest values to avoid re-render cascades
  const openOrdersRef = useRef(openOrders);
  openOrdersRef.current = openOrders;
  const simulatedPositionsRef = useRef(simulatedPositions);
  simulatedPositionsRef.current = simulatedPositions;
  const simulatedBalanceRef = useRef(simulatedBalance);
  simulatedBalanceRef.current = simulatedBalance;
  const refreshOpenOrdersRef = useRef(refreshOpenOrders);
  refreshOpenOrdersRef.current = refreshOpenOrders;
  const refreshSimulatedPositionsRef = useRef(refreshSimulatedPositions);
  refreshSimulatedPositionsRef.current = refreshSimulatedPositions;
  const refreshSimulatedBalanceRef = useRef(refreshSimulatedBalance);
  refreshSimulatedBalanceRef.current = refreshSimulatedBalance;

  useEffect(() => {
    if (!testMode || !enabled || !price || price <= 0) return;

    // Throttle checks to every 2 seconds minimum
    const now = Date.now();
    if (now - lastOrderFillCheckRef.current < 2000) return;
    lastOrderFillCheckRef.current = now;

    // Check if there are open orders OR open positions (positions need liquidation monitoring)
    const hasOpenOrders = openOrdersRef.current.length > 0;
    const hasOpenPositions = simulatedPositionsRef.current.length > 0 || (simulatedBalanceRef.current?.openPositionsCount ?? 0) > 0;
    if (!hasOpenOrders && !hasOpenPositions) return;

    const checkAndFillOrders = async () => {
      try {
        // Only call fill endpoint if there are open orders
        if (hasOpenOrders) {
          const res = await fetch('/api/simulated/orders/fill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPrice: price }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.filled > 0) {
              refreshOpenOrdersRef.current(true);
              refreshSimulatedPositionsRef.current(true);
              refreshSimulatedBalanceRef.current(true);
              return; // Balance refresh will handle liquidation check
            }
          }
        }

        // If positions are open, refresh balance to trigger liquidation check
        // (balance API now checks margin level and auto-liquidates if < 80%)
        if (hasOpenPositions) {
          refreshSimulatedBalanceRef.current(true);
        }
      } catch (err) {
        console.error('Error checking limit orders:', err);
      }
    };

    checkAndFillOrders();
  }, [price, testMode, enabled]);

  const hasOpenSimulatedPosition = useMemo(() => {
    if (simulatedBalance?.openPositionsCount !== undefined) {
      return simulatedBalance.openPositionsCount > 0;
    }
    return simulatedPositions.length > 0;
  }, [simulatedBalance, simulatedPositions]);

  // Stable getter for countdown — avoids putting a per-second changing value in context
  const getNextRefresh = useCallback(() => nextRefreshRef.current, []);

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
    btcTfTrends,
    tfData,
    loading,
    error,
    getNextRefresh,
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
    draftOrders,
    draftOrdersLoading,
    refreshDraftOrders,
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
    btcTfTrends,
    tfData,
    loading,
    error,
    getNextRefresh,
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
    draftOrders,
    draftOrdersLoading,
    refreshDraftOrders,
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

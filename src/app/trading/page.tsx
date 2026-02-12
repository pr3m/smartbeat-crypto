'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { generateRecommendation } from '@/lib/trading/recommendation';
import { getTradingSession } from '@/lib/trading/session';
import type { TradingRecommendation, MicrostructureInput, LiquidationInput, Indicators, OHLCData } from '@/lib/kraken/types';
import type { MarketSnapshot, AIAnalysisResponse, OpenPositionData } from '@/lib/ai/types';
import { buildChartContext, formatChartContextForAI } from '@/lib/trading/chart-context';
import { TradingDataProvider, useTradingData, TRADING_TIMEFRAMES, TRADING_REFRESH_INTERVAL_SEC } from '@/components/TradingDataProvider';
import { useChatStore } from '@/stores/chatStore';
import { useToast } from '@/components/Toast';
import { requestNotificationPermission } from '@/components/Toast';
import { Tooltip, HelpIcon } from '@/components/Tooltip';
import { TradeExecutionPanel, type EditingOrderData, type EditingDraftData } from '@/components/TradeExecutionPanel';
import { type OpenOrderData } from '@/components/OpenOrders';
import { type DraftOrder } from '@/components/DraftOrders';
import { TradeDrawer } from '@/components/TradeDrawer';
import { FloatingTradeButton } from '@/components/FloatingTradeButton';
import { SimulatedBalance } from '@/components/SimulatedBalance';
import { SimulatedPositions } from '@/components/SimulatedPositions';
import { TradeHistory } from '@/components/TradeHistory';
import { TradeAnalysisPanel } from '@/components/TradeAnalysisPanel';
import { TradingTabs, type TradingTab } from '@/components/TradingTabs';
import { SetupTab } from '@/components/tabs/SetupTab';
import { OrdersTab } from '@/components/tabs/OrdersTab';
import { PositionsTab } from '@/components/tabs/PositionsTab';
import { HistoryTab } from '@/components/tabs/HistoryTab';
import { ReportsTab } from '@/components/tabs/ReportsTab';
import { FearGreedGauge } from '@/components/FearGreedGauge';
import type { LiquidationAnalysis } from '@/lib/trading/liquidation';
import { getLiquidationInput } from '@/lib/trading/liquidation';
import { LiquidationHeatmap } from '@/components/LiquidationHeatmap';
import { useTradeNotifications } from '@/hooks/useTradeNotifications';
import { useV2Engine } from '@/hooks/useV2Engine';
import { PositionDashboard } from '@/components/PositionDashboard';
import { AccountWidget } from '@/components/dashboard/AccountWidget';
import { getDefaultStrategy, getStrategy, listStrategies } from '@/lib/trading/strategies';
import type {
  QuickEntryParams,
  QuickCloseParams,
  QuickDCAParams,
  QuickTrailingStopParams,
  QuickTakeProfitParams,
} from '@/components/dashboard/types';

export default function TradingPage() {
  const [testMode, setTestMode] = useState(true);

  // Sync from localStorage after hydration to avoid mismatch
  useEffect(() => {
    const stored = localStorage.getItem('smartbeat:tradingMode');
    if (stored !== null) {
      setTestMode(stored === 'paper');
    }
  }, []);

  const handleSetTestMode: Dispatch<SetStateAction<boolean>> = useCallback((value) => {
    setTestMode((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      localStorage.setItem('smartbeat:tradingMode', next ? 'paper' : 'live');
      return next;
    });
  }, []);

  return (
    <TradingDataProvider testMode={testMode}>
      <TradingPageContent testMode={testMode} setTestMode={handleSetTestMode} />
    </TradingDataProvider>
  );
}

const TIMEFRAMES = TRADING_TIMEFRAMES;
const REFRESH_INTERVAL = TRADING_REFRESH_INTERVAL_SEC;

interface TradingPageContentProps {
  testMode: boolean;
  setTestMode: Dispatch<SetStateAction<boolean>>;
}

function TradingPageContent({ testMode, setTestMode }: TradingPageContentProps) {
  const {
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
    getNextRefresh,
    refreshOhlc,
    refreshOpenPositions,
    refreshSimulatedBalance,
    refreshSimulatedPositions,
    hasOpenSimulatedPosition,
    openPositions,
    simulatedPositions,
    fearGreed,
    openOrders,
    draftOrders,
  } = useTradingData();
  const setTradingMode = useChatStore((s) => s.setTradingMode);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [displayTf, setDisplayTf] = useState<number>(15);

  // Local countdown state — isolated from the shared context to avoid re-rendering 14+ consumers every second
  const [nextRefresh, setNextRefresh] = useState(REFRESH_INTERVAL);
  useEffect(() => {
    const interval = setInterval(() => {
      setNextRefresh(getNextRefresh());
    }, 1000);
    return () => clearInterval(interval);
  }, [getNextRefresh]);
  const [recommendation, setRecommendation] = useState<TradingRecommendation | null>(null);
  const lastRecommendationRef = useRef<string | null>(null);
  const [strategyName, setStrategyName] = useState(() => getDefaultStrategy().meta.name);
  const strategyOptions = useMemo(() => listStrategies(), []);

  // Sync trading mode to chat store so AI knows paper vs live
  useEffect(() => {
    setTradingMode(testMode ? 'paper' : 'live');
  }, [testMode, setTradingMode]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TradingTab>('setup');
  const [positionsCount, setPositionsCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);

  // Calculate orders count (open orders + pending drafts)
  const pendingDrafts = draftOrders.filter(d => d.status === 'pending');
  const ordersCount = openOrders.length + pendingDrafts.length;

  // Strategy (moved up so callbacks can reference strategy.liquidation)
  const strategy = useMemo(() => {
    try {
      return getStrategy(strategyName);
    } catch {
      return getDefaultStrategy();
    }
  }, [strategyName]);

  // Microstructure data from Market Microstructure section
  const [microData, setMicroData] = useState<MicrostructureInput | null>(null);

  // Liquidation data from Liquidation Heatmap section
  const [liqData, setLiqData] = useState<LiquidationInput | null>(null);
  const [showLiquidationModal, setShowLiquidationModal] = useState(false);

  // AI Analysis state
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);

  // Drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showTradeAnalysis, setShowTradeAnalysis] = useState(false);
  const [analysisPositionId, setAnalysisPositionId] = useState<string | undefined>();

  // Order editing state
  const [editingOrder, setEditingOrder] = useState<EditingOrderData | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditingDraftData | null>(null);

  // Toast notifications (must be before callbacks that use it)
  const { addToast } = useToast();

  // Callback for MarketMicrostructure component
  const handleMicrostructureData = useCallback((data: MicrostructureInput | null) => {
    setMicroData(data);
  }, []);

  // Callback for LiquidationHeatmap component
  const handleLiquidationData = useCallback((analysis: LiquidationAnalysis | null) => {
    if (analysis) {
      setLiqData(getLiquidationInput(analysis, strategy.liquidation));
    } else {
      setLiqData(null);
    }
  }, [strategy.liquidation]);

  const handleOrderExecuted = useCallback(() => {
    refreshSimulatedBalance(true);
    refreshSimulatedPositions(true);
    refreshOpenPositions(true);
  }, [refreshOpenPositions, refreshSimulatedBalance, refreshSimulatedPositions]);

  // Order-in-flight guard for dashboard action buttons
  const [orderInFlight, setOrderInFlight] = useState(false);

  // Quick Entry handler
  const handleQuickEntry = useCallback(async (params: QuickEntryParams) => {
    setOrderInFlight(true);
    try {
      const side = params.direction === 'long' ? 'buy' : 'sell';
      const isLimit = !!params.limitPrice;
      const orderType = isLimit ? 'limit' : 'market';
      const execPrice = isLimit ? params.limitPrice! : price;

      if (testMode) {
        const body: Record<string, unknown> = {
          pair: 'XRPEUR',
          type: side,
          orderType,
          volume: params.volume,
          leverage: params.leverage,
          marketPrice: price,
        };
        if (isLimit) body.price = params.limitPrice;

        const res = await fetch('/api/simulated/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Order failed');
        addToast({
          title: `${params.direction.toUpperCase()} Entry ${isLimit ? 'Placed' : 'Filled'}`,
          message: `${params.volume.toFixed(1)} XRP ${orderType} @ ${execPrice.toFixed(4)}`,
          type: 'success', duration: 5000,
        });
      } else {
        const body: Record<string, string> = {
          pair: 'XRPEUR',
          type: side,
          ordertype: orderType,
          volume: params.volume.toString(),
          leverage: params.leverage.toString(),
        };
        if (isLimit) body.price = params.limitPrice!.toString();

        const res = await fetch('/api/kraken/private/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || data.error?.length) throw new Error(data.error?.[0] || 'Order failed');
        addToast({
          title: `${params.direction.toUpperCase()} Entry Submitted`,
          message: `${params.volume.toFixed(1)} XRP ${orderType}${isLimit ? ` @ ${execPrice.toFixed(4)}` : ''}`,
          type: 'success', duration: 5000,
        });
      }
      handleOrderExecuted();
    } finally {
      setOrderInFlight(false);
    }
  }, [testMode, price, addToast, handleOrderExecuted]);

  // Quick Close handler
  const handleQuickClose = useCallback(async (params: QuickCloseParams) => {
    setOrderInFlight(true);
    try {
      if (testMode) {
        // Find the open simulated position
        const posRes = await fetch('/api/simulated/positions?open=true&pair=XRPEUR');
        const posData = await posRes.json();
        const openPos = posData.positions?.[0];
        if (!openPos) throw new Error('No open position found');

        const res = await fetch('/api/simulated/positions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positionId: openPos.id,
            closePrice: price,
            closeVolume: params.exitPercent < 100 ? params.volumeToClose : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Close failed');
        const pnl = data.realizedPnl ?? 0;
        addToast({
          title: `Closed ${params.exitPercent}% Position`,
          message: `P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} EUR`,
          type: pnl >= 0 ? 'success' : 'error',
          duration: 7000,
        });
      } else {
        // Live: opposite-side market order with reduce-only
        const openPos = openPositions[0];
        if (!openPos) throw new Error('No open position found');
        const closeSide = openPos.type === 'buy' ? 'sell' : 'buy';
        const res = await fetch('/api/kraken/private/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            type: closeSide,
            ordertype: 'market',
            volume: params.volumeToClose.toString(),
            leverage: (openPos.margin > 0 ? Math.round(openPos.cost / openPos.margin) : 10).toString(),
            reduce_only: true,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error?.length) throw new Error(data.error?.[0] || 'Close failed');
        addToast({ title: `Close ${params.exitPercent}% Submitted`, message: 'Market close order sent', type: 'success', duration: 5000 });
      }
      handleOrderExecuted();
    } finally {
      setOrderInFlight(false);
    }
  }, [testMode, price, openPositions, addToast, handleOrderExecuted]);

  // Quick DCA handler
  const handleQuickDCA = useCallback(async (params: QuickDCAParams) => {
    setOrderInFlight(true);
    try {
      const side = params.direction === 'long' ? 'buy' : 'sell';
      if (testMode) {
        const res = await fetch('/api/simulated/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            type: side,
            orderType: 'market',
            volume: params.volume,
            leverage: 10,
            marketPrice: price,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'DCA order failed');
        addToast({ title: `DCA Level ${params.dcaLevel} Filled`, message: `${params.volume.toFixed(1)} XRP @ ${price.toFixed(4)}`, type: 'success', duration: 5000 });
      } else {
        const res = await fetch('/api/kraken/private/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            type: side,
            ordertype: 'market',
            volume: params.volume.toString(),
            leverage: '10',
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error?.length) throw new Error(data.error?.[0] || 'DCA order failed');
        addToast({ title: `DCA Level ${params.dcaLevel} Submitted`, message: `${params.volume.toFixed(1)} XRP market order`, type: 'success', duration: 5000 });
      }
      handleOrderExecuted();
    } finally {
      setOrderInFlight(false);
    }
  }, [testMode, price, addToast, handleOrderExecuted]);

  // Quick Trailing Stop handler
  const handleQuickTrailingStop = useCallback(async (params: QuickTrailingStopParams) => {
    setOrderInFlight(true);
    try {
      // Trailing stop: opposite side to close position
      const side = params.direction === 'long' ? 'sell' : 'buy';
      if (testMode) {
        const res = await fetch('/api/simulated/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            type: side,
            orderType: 'trailing-stop',
            volume: params.volume,
            leverage: 10,
            marketPrice: price,
            trailingOffset: params.offset,
            trailingOffsetType: params.offsetType,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Trailing stop failed');
        addToast({ title: 'Trailing Stop Placed', message: `${params.offset}${params.offsetType === 'percent' ? '%' : ''} offset`, type: 'success', duration: 5000 });
      } else {
        const trailingStopOffset = params.offsetType === 'percent'
          ? `${params.offset}`
          : `${params.offset}`;
        const res = await fetch('/api/kraken/private/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            type: side,
            ordertype: 'trailing-stop',
            volume: params.volume.toString(),
            leverage: '10',
            price: trailingStopOffset,
            reduce_only: true,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error?.length) throw new Error(data.error?.[0] || 'Trailing stop failed');
        addToast({ title: 'Trailing Stop Submitted', message: `${params.offset}${params.offsetType === 'percent' ? '%' : ''} offset`, type: 'success', duration: 5000 });
      }
      handleOrderExecuted();
    } finally {
      setOrderInFlight(false);
    }
  }, [testMode, price, addToast, handleOrderExecuted]);

  // Quick Take Profit handler
  const handleQuickTakeProfit = useCallback(async (params: QuickTakeProfitParams) => {
    setOrderInFlight(true);
    try {
      // Take profit: opposite side to close position
      const side = params.direction === 'long' ? 'sell' : 'buy';
      if (testMode) {
        const res = await fetch('/api/simulated/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            type: side,
            orderType: 'take-profit',
            volume: params.volume,
            leverage: 10,
            marketPrice: price,
            price: params.price,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Take profit failed');
        addToast({ title: 'Take Profit Placed', message: `Target: ${params.price.toFixed(4)} EUR`, type: 'success', duration: 5000 });
      } else {
        const res = await fetch('/api/kraken/private/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            type: side,
            ordertype: 'take-profit',
            volume: params.volume.toString(),
            leverage: '10',
            price: params.price.toString(),
            reduce_only: true,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error?.length) throw new Error(data.error?.[0] || 'Take profit failed');
        addToast({ title: 'Take Profit Submitted', message: `Target: ${params.price.toFixed(4)} EUR`, type: 'success', duration: 5000 });
      }
      handleOrderExecuted();
    } finally {
      setOrderInFlight(false);
    }
  }, [testMode, price, addToast, handleOrderExecuted]);

  // Handle analyze click from trade history
  const handleAnalyzeClick = useCallback((positionId: string) => {
    setAnalysisPositionId(positionId);
    setShowTradeAnalysis(true);
  }, []);

  // Handle edit order from OpenOrders component
  const handleEditOrder = useCallback((order: OpenOrderData) => {
    setEditingOrder({
      id: order.id,
      type: order.type,
      orderType: order.orderType,
      price: order.price,
      volume: order.volume,
      leverage: order.leverage,
    });
    setIsDrawerOpen(true);
  }, []);

  // Handle cancel edit
  const handleCancelEdit = useCallback(() => {
    setEditingOrder(null);
    setEditingDraft(null);
  }, []);

  // Handle edit draft from DraftOrders component
  const handleEditDraft = useCallback((draft: DraftOrder) => {
    setEditingDraft({
      id: draft.id,
      side: draft.side,
      orderType: draft.orderType,
      price: draft.price || undefined,
      price2: draft.price2 || undefined,
      volume: draft.volume,
      leverage: draft.leverage,
      trailingOffset: draft.trailingOffset || undefined,
      trailingOffsetType: draft.trailingOffsetType as 'percent' | 'absolute' | undefined,
      displayVolume: draft.displayVolume || undefined,
      aiSetupType: draft.aiSetupType || undefined,
    });
    setIsDrawerOpen(true);
  }, []);

  // Build market snapshot for AI analysis
  const buildMarketSnapshot = useCallback((): MarketSnapshot => {
    const buildTimeframeSnapshot = (indicators: Indicators | null) => {
      if (!indicators) return null;
      return {
        bias: indicators.bias,
        trendStrength: indicators.trendStrength, // NEW: trend strength indicator
        rsi: indicators.rsi,
        macd: indicators.macd,
        macdSignal: indicators.macdSignal,
        histogram: indicators.histogram, // NEW: MACD histogram for momentum
        bbPosition: indicators.bbPos,
        bbUpper: indicators.bbUpper,
        bbLower: indicators.bbLower,
        atr: indicators.atr,
        atrPercent: price > 0 ? (indicators.atr / price) * 100 : 0,
        volumeRatio: indicators.volRatio,
        score: indicators.score,
      };
    };

    // Build chart context from OHLC data for AI visual analysis
    let chartContextString: string | undefined;
    try {
      const ohlcByInterval: Record<number, OHLCData[]> = {
        5: tfData[5].ohlc,
        15: tfData[15].ohlc,
        60: tfData[60].ohlc,
        240: tfData[240].ohlc,
        1440: tfData[1440]?.ohlc || [], // Include daily
      };

      // Only build chart context if we have sufficient data
      const hasEnoughData = Object.entries(ohlcByInterval)
        .filter(([key]) => key !== '1440') // Daily may have less data
        .every(([, ohlc]) => ohlc.length >= 20);
      if (hasEnoughData) {
        const chartContext = buildChartContext(ohlcByInterval, 'XRP/EUR');
        chartContextString = formatChartContextForAI(chartContext);
      }
    } catch (err) {
      console.warn('Failed to build chart context:', err);
    }

    // Build open position data from simulated (test mode) or real positions
    let openPositionData: OpenPositionData | undefined;
    if (testMode && simulatedPositions.length > 0) {
      const pos = simulatedPositions[0]; // Use first open position
      openPositionData = {
        isOpen: pos.isOpen,
        side: pos.side,
        entryPrice: pos.avgEntryPrice,
        volume: pos.volume,
        unrealizedPnl: pos.unrealizedPnl,
        unrealizedPnlPercent: pos.unrealizedPnlPercent,
        leverage: pos.leverage,
        liquidationPrice: pos.liquidationPrice,
        openTime: pos.openedAt,
      };
    } else if (!testMode && openPositions.length > 0) {
      const pos = openPositions[0];
      const entryPrice = pos.cost / pos.volume;
      const currentValue = pos.volume * price;
      const unrealizedPnl = pos.type === 'buy'
        ? currentValue - pos.cost
        : pos.cost - currentValue;
      const unrealizedPnlPercent = pos.cost > 0 ? (unrealizedPnl / pos.cost) * 100 : 0;
      openPositionData = {
        isOpen: true,
        side: pos.type === 'buy' ? 'long' : 'short',
        entryPrice,
        volume: pos.volume,
        unrealizedPnl,
        unrealizedPnlPercent,
        leverage: pos.margin > 0 ? pos.cost / pos.margin : 1,
        openTime: new Date(pos.openTime).toISOString(),
      };
    }

    // Get trading session context
    const tradingSession = getTradingSession();

    return {
      timestamp: new Date().toISOString(),
      pair: 'XRP/EUR',
      currentPrice: price,
      priceChange24h: openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : 0,
      high24h,
      low24h,
      volume24h,
      btc: {
        trend: btcTrend,
        change24h: btcChange,
      },
      timeframes: {
        '5m': buildTimeframeSnapshot(tfData[5].indicators),
        '15m': buildTimeframeSnapshot(tfData[15].indicators),
        '1h': buildTimeframeSnapshot(tfData[60].indicators),
        '4h': buildTimeframeSnapshot(tfData[240].indicators),
        '1d': buildTimeframeSnapshot(tfData[1440]?.indicators || null), // Daily timeframe for primary trend
      },
      recommendation: recommendation ? {
        action: recommendation.action,
        confidence: recommendation.confidence,
        reason: recommendation.reason,
        longScore: recommendation.longScore,
        shortScore: recommendation.shortScore,
        totalItems: recommendation.totalItems,
        // NEW: Include strength-based long/short analysis
        long: recommendation.long ? {
          grade: recommendation.long.grade,
          strength: recommendation.long.strength,
          reasons: recommendation.long.reasons,
          warnings: recommendation.long.warnings,
        } : undefined,
        short: recommendation.short ? {
          grade: recommendation.short.grade,
          strength: recommendation.short.strength,
          reasons: recommendation.short.reasons,
          warnings: recommendation.short.warnings,
        } : undefined,
        warnings: recommendation.warnings,
        momentumAlert: recommendation.momentumAlert || null,
      } : null,
      microstructure: microData ? {
        imbalance: microData.imbalance,
        cvdTrend: recommendation?.flowStatus?.cvdTrend || 'neutral',
        spreadPercent: microData.spreadPercent,
        whaleActivity: recommendation?.flowStatus?.whaleActivity || 'none',
      } : null,
      liquidation: liqData ? {
        bias: liqData.bias,
        biasStrength: liqData.biasStrength,
        fundingRate: liqData.fundingRate,
      } : null,
      chartContext: chartContextString,
      fearGreed: fearGreed || undefined,
      openPosition: openPositionData,
      tradingSession,
      knifeStatus: recommendation?.knifeStatus ? {
        isKnife: recommendation.knifeStatus.isKnife,
        direction: recommendation.knifeStatus.direction,
        phase: recommendation.knifeStatus.phase,
        brokenLevel: recommendation.knifeStatus.brokenLevel,
        knifeScore: recommendation.knifeStatus.knifeScore,
        reversalReadiness: recommendation.knifeStatus.reversalReadiness,
        gateAction: recommendation.knifeStatus.gateAction,
        sizeMultiplier: recommendation.knifeStatus.sizeMultiplier,
        flipSuggestion: recommendation.knifeStatus.flipSuggestion,
        waitFor: recommendation.knifeStatus.waitFor,
      } : undefined,
      reversalStatus: recommendation?.reversalStatus?.detected ? {
        detected: true,
        phase: recommendation.reversalStatus.phase,
        direction: recommendation.reversalStatus.direction,
        confidence: recommendation.reversalStatus.confidence,
        exhaustionScore: recommendation.reversalStatus.exhaustionScore,
        urgency: recommendation.reversalStatus.urgency,
        description: recommendation.reversalStatus.description,
        patterns: recommendation.reversalStatus.patterns,
      } : undefined,
      candlestickPatterns: (() => {
        const result: Record<string, Array<{ name: string; type: string; reliability: number; strength: number; candlesUsed: number }>> = {};
        const tfMap: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
        for (const [label, minutes] of Object.entries(tfMap)) {
          const patterns = tfData[minutes]?.indicators?.extendedPatterns;
          if (patterns && patterns.length > 0) {
            result[label] = [...patterns]
              .sort((a, b) => (b.reliability * b.strength) - (a.reliability * a.strength))
              .slice(0, 3)
              .map(p => ({ name: p.name, type: p.type, reliability: p.reliability, strength: p.strength, candlesUsed: p.candlesUsed }));
          }
        }
        return Object.keys(result).length > 0 ? result : undefined;
      })(),
    };
  }, [price, openPrice, high24h, low24h, volume24h, btcTrend, btcChange, tfData, recommendation, microData, liqData, testMode, simulatedPositions, openPositions, fearGreed]);

  // Request AI analysis
  const requestAiAnalysis = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);

    try {
      const marketData = buildMarketSnapshot();

      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketData }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to get AI analysis');
      }

      setAiAnalysis(result);
      setShowAiPanel(true);

      addToast({
        title: 'AI Analysis Complete',
        message: `Analysis generated using ${result.model}`,
        type: 'success',
        duration: 5000,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setAiError(errorMessage);
      addToast({
        title: 'AI Analysis Failed',
        message: errorMessage,
        type: 'error',
        duration: 10000,
      });
    } finally {
      setAiLoading(false);
    }
  }, [buildMarketSnapshot, addToast]);

  // Generate recommendation when indicator data changes (not on every price tick)
  // Price is only used for ATR volatility calc — a ref avoids re-running on every tick
  const priceForRecRef = useRef(price);
  priceForRecRef.current = price;

  useEffect(() => {
    // Only generate if we have indicator data
    if (!tfData[240].indicators || !tfData[60].indicators || !tfData[15].indicators || !tfData[5].indicators) {
      return;
    }

    const rec = generateRecommendation(
      tfData[240],
      tfData[60],
      tfData[15],
      tfData[5],
      btcTrend,
      btcChange,
      microData, // Pass microstructure data for flow analysis
      liqData, // Pass liquidation data for liq bias analysis
      tfData[1440], // Daily timeframe for trend filter (NEW)
      priceForRecRef.current // Current price for ATR volatility calculation
    );

    console.log('Generated recommendation:', rec?.action, 'Long:', rec?.longScore, 'Short:', rec?.shortScore, 'Flow:', rec?.flowStatus?.status, 'Liq:', rec?.liquidationStatus?.bias);
    setRecommendation(rec);

    // Check for new signal (only if action changes and is not WAIT)
    if (rec && rec.action !== 'WAIT' && rec.action !== lastRecommendationRef.current) {
      // Toast notification (browser notifications handled by useTradeNotifications hook)
      addToast({
        title: `🎯 Signal: ${rec.action}`,
        message: rec.reason,
        type: 'signal',
        duration: 15000,
      });
    }

    lastRecommendationRef.current = rec?.action || null;
  }, [tfData, btcTrend, btcChange, microData, liqData, addToast]);

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission().then(granted => {
      setNotificationsEnabled(granted);
    });
  }, []);

  // Strategy selection persistence
  useEffect(() => {
    const stored = localStorage.getItem('smartbeat:strategyName');
    if (stored && strategyOptions.includes(stored)) {
      setStrategyName(stored);
    }
  }, [strategyOptions]);

  useEffect(() => {
    localStorage.setItem('smartbeat:strategyName', strategyName);
  }, [strategyName]);

  // V2 Engine: position state, DCA signals, exit signals, sizing
  const v2 = useV2Engine(recommendation, strategy);

  // Background trade notifications (signals, P&L, DCA, RSI, volume, order fills)
  const { markOrderCancelled } = useTradeNotifications({
    recommendation,
    tfData,
    price,
    simulatedPositions,
    openPositions,
    openOrders,
    testMode,
    notificationsEnabled,
    dcaSignal: v2.output.dcaSignal,
    exitSignal: v2.output.exitSignal,
  });

  // Fetch reports count on mount
  useEffect(() => {
    fetch('/api/ai/reports?limit=1')
      .then(r => r.json())
      .then(d => {
        if (d.success) setReportsCount(d.total);
      })
      .catch(console.error);
  }, []);

  // Fetch history count on mount and when testMode changes
  useEffect(() => {
    const endpoint = testMode
      ? '/api/simulated/positions/history'
      : '/api/trading/history';

    fetch(endpoint)
      .then(r => r.json())
      .then(d => {
        setHistoryCount((d.positions || []).length);
      })
      .catch(console.error);
  }, [testMode]);

  // Update positions count when simulated positions change
  useEffect(() => {
    if (testMode) {
      fetch('/api/simulated/positions')
        .then(r => r.json())
        .then(d => {
          const openCount = (d.positions || []).filter((p: { isOpen: boolean }) => p.isOpen).length;
          setPositionsCount(openCount);
        })
        .catch(console.error);
    } else {
      fetch('/api/kraken/private/positions')
        .then(r => r.json())
        .then(d => {
          const openCount = (d.positions || []).filter((p: { isOpen: boolean }) => p.isOpen).length;
          setPositionsCount(openCount);
        })
        .catch(console.error);
    }
  }, [testMode]);

  const priceChange = openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : 0;
  const currentIndicators = tfData[displayTf].indicators;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-900/50 border border-red-500 text-white">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Status Bar */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${wsStatus.connected ? 'bg-green-500 animate-pulse-live' : wsStatus.reconnecting ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-secondary">
              {wsStatus.connected ? 'Live' : wsStatus.reconnecting ? 'Reconnecting...' : 'Disconnected'}
            </span>
          </div>
          {/* Refresh countdown */}
          <Tooltip content={`OHLC data refreshes every ${REFRESH_INTERVAL}s. Click to refresh now.`} position="bottom">
            <button
              onClick={() => {
                refreshOhlc(true);
              }}
              className="flex items-center gap-2 text-xs text-tertiary hover:text-secondary transition-colors"
            >
              <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${((REFRESH_INTERVAL - nextRefresh) / REFRESH_INTERVAL) * 100}%` }}
                />
              </div>
              <span className="mono w-6">{nextRefresh}s</span>
            </button>
          </Tooltip>
          {loading && (
            <span className="text-sm text-yellow-500">Loading...</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Strategy Selector */}
          <Tooltip content="Select trading strategy" position="left">
            <label className="text-sm px-2 py-1 rounded bg-tertiary text-secondary border border-transparent flex items-center gap-2">
              <span className="text-xs text-tertiary">Strategy</span>
              <select
                value={strategyName}
                onChange={(event) => setStrategyName(event.target.value)}
                className="bg-transparent text-secondary text-sm focus:outline-none"
              >
                {strategyOptions.map((name: string) => (
                  <option key={name} value={name} className="bg-secondary">
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </Tooltip>
          {/* Test Mode Toggle */}
          <Tooltip content={
            <div>
              <strong>{testMode ? 'Test Mode (Paper Trading)' : 'Live Mode'}</strong>
              <p className="mt-1">
                {testMode
                  ? 'Orders are simulated - no real money at risk.'
                  : 'Orders will be sent to Kraken - real money!'}
              </p>
            </div>
          } position="left">
            <button
              onClick={() => {
                const newMode = !testMode;
                setTestMode(newMode);
                addToast({
                  title: newMode ? 'Test Mode Enabled' : 'Live Mode Enabled',
                  message: newMode
                    ? 'Orders will be simulated - no real money'
                    : 'Warning: Orders will use real money!',
                  type: newMode ? 'success' : 'error',
                  duration: 5000,
                });
              }}
              className={`text-sm px-3 py-1 rounded transition-colors font-semibold ${
                testMode
                  ? 'test-mode-badge'
                  : 'bg-red-500/20 text-red-400 border border-red-500/50'
              }`}
            >
              {testMode ? '🧪 Test Mode' : '⚡ Live Mode'}
            </button>
          </Tooltip>

          {/* Notifications Toggle */}
          <Tooltip content={
            <div>
              <strong>Browser Notifications</strong>
              <p className="mt-1">Get alerts when trading signals change.</p>
            </div>
          } position="left">
            <button
              onClick={async () => {
                if (!notificationsEnabled) {
                  const granted = await requestNotificationPermission();
                  setNotificationsEnabled(granted);
                  if (granted) {
                    addToast({ title: 'Notifications enabled', message: 'You will receive alerts for new signals', type: 'success' });
                  }
                } else {
                  setNotificationsEnabled(false);
                  addToast({ title: 'Notifications disabled', message: 'You will not receive browser alerts', type: 'info' });
                }
              }}
              className={`text-sm px-3 py-1 rounded transition-colors ${notificationsEnabled ? 'bg-green-500/20 text-green-400 border border-green-500/50' : 'bg-tertiary text-secondary border border-transparent'}`}
            >
              {notificationsEnabled ? '🔔 Alerts On' : '🔕 Alerts Off'}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Tab Navigation */}
      <TradingTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        counts={{
          orders: ordersCount,
          positions: positionsCount,
          history: historyCount,
          reports: reportsCount,
        }}
      />

      {/* Tab Content */}
      {activeTab === 'setup' && (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content - Left Column */}
          <div className="lg:col-span-2">
            <SetupTab
              price={price}
              priceChange={priceChange}
              high24h={high24h}
              low24h={low24h}
              volume24h={volume24h}
              testMode={testMode}
              displayTf={displayTf}
              setDisplayTf={setDisplayTf}
              tfData={tfData}
              TIMEFRAMES={TIMEFRAMES}
              currentIndicators={currentIndicators}
              btcTrend={btcTrend}
              btcChange={btcChange}
              recommendation={recommendation}
              loading={loading}
              aiAnalysis={aiAnalysis}
              aiLoading={aiLoading}
              showAiPanel={showAiPanel}
              setShowAiPanel={setShowAiPanel}
              requestAiAnalysis={requestAiAnalysis}
              aiError={aiError}
              setAiError={setAiError}
              handleMicrostructureData={handleMicrostructureData}
              handleLiquidationData={handleLiquidationData}
              handleOrderExecuted={handleOrderExecuted}
              onEditOrder={handleEditOrder}
              onOrderCancelled={markOrderCancelled}
              addToast={addToast}
            />
          </div>

          {/* Sidebar - Right Column */}
        <div className="space-y-4">
          {/* Account Balance Widget */}
          <AccountWidget testMode={testMode} />

          {/* V2 Position Dashboard */}
          <PositionDashboard
            position={v2.output.position}
            exitSignal={v2.output.exitSignal}
            dcaSignal={v2.output.dcaSignal}
            sizing={v2.output.sizing}
            summary={v2.output.summary}
            currentPrice={price}
            config={v2.config}
            strategyName={v2.strategyName}
            testMode={testMode}
            recommendation={recommendation}
            orderInFlight={orderInFlight}
            onEntryExecute={handleQuickEntry}
            onCloseExecute={handleQuickClose}
            onDCAExecute={handleQuickDCA}
            onTrailingStopExecute={handleQuickTrailingStop}
            onTakeProfitExecute={handleQuickTakeProfit}
            onOpenTradeDrawer={() => setIsDrawerOpen(true)}
          />

          {/* Entry Checklist */}
          <div className="card p-4">
            <h3 className="text-xs text-tertiary uppercase tracking-wider mb-3 flex items-center gap-2">
              Entry Checklist
              <HelpIcon
                tooltip={
                  <div>
                    <strong>Entry Checklist</strong>
                    <p className="mt-1">
                      Need 5/{recommendation?.totalItems || 6} base conditions for entry signal.
                    </p>
                    <p className="mt-2 text-green-400">Green ✓ = condition met</p>
                    <p className="text-red-400">Red ✗ = not met</p>
                    {(recommendation?.checklist?.flowConfirm || recommendation?.checklist?.liqBias) && (
                      <p className="mt-2 text-blue-400">
                        {recommendation?.checklist?.flowConfirm && 'Flow Confirm requires Market Microstructure expanded. '}
                        {recommendation?.checklist?.liqBias && 'Liq Bias requires Liquidation Analysis expanded.'}
                      </p>
                    )}
                  </div>
                }
                position="left"
              />
            </h3>

            {/* Setup Status */}
            <div className="mb-3 p-2 rounded text-sm text-center"
                 style={{
                   background: recommendation && recommendation.longScore >= 4 && recommendation.longScore > recommendation.shortScore
                     ? 'rgba(63, 185, 80, 0.15)'
                     : recommendation && recommendation.shortScore >= 4 && recommendation.shortScore > recommendation.longScore
                     ? 'rgba(248, 81, 73, 0.15)'
                     : 'rgba(255, 255, 255, 0.05)',
                   borderLeft: `3px solid ${
                     recommendation && recommendation.longScore >= 4 && recommendation.longScore > recommendation.shortScore
                       ? '#3fb950'
                       : recommendation && recommendation.shortScore >= 4 && recommendation.shortScore > recommendation.longScore
                       ? '#f85149'
                       : '#6e7681'
                   }`
                 }}>
              {!recommendation
                ? '⏳ Loading setup...'
                : recommendation.longScore >= 4 && recommendation.longScore > recommendation.shortScore
                ? '🟢 LONG setup forming'
                : recommendation.shortScore >= 4 && recommendation.shortScore > recommendation.longScore
                ? '🔴 SHORT setup forming'
                : recommendation.longScore >= 3 || recommendation.shortScore >= 3
                ? '🟡 Setup developing'
                : '⚪ No clear setup'}
            </div>

            {/* Checklist Items */}
            <div className="space-y-1">
              {recommendation && recommendation.checklist ? (
                Object.entries(recommendation.checklist).map(([key, item]) => {
                  const tooltips: Record<string, { title: string; desc: string }> = {
                    trend1d: {
                      title: 'Daily Trend Filter',
                      desc: 'The daily timeframe provides macro context. Counter-trend entries on the daily are higher risk. Weight: 10.',
                    },
                    trend4h: {
                      title: '4H Trend Direction',
                      desc: 'The 4-hour timeframe sets the overall trend. For LONG: need bullish bias. For SHORT: need bearish bias. Weight: 18.',
                    },
                    setup1h: {
                      title: '1H Setup Confirmation',
                      desc: 'The 1-hour timeframe confirms the setup. Should align with 4H trend direction. Weight: 38.',
                    },
                    entry15m: {
                      title: '15m Entry Timing',
                      desc: 'Multi-signal entry timing (RSI + BB + MACD + EMA20 confluence). Catches the entry point. Weight: 18.',
                    },
                    volume: {
                      title: 'Volume Confirmation',
                      desc: 'Context-aware volume: pullbacks need low vol (0.5-1.3x), breakouts need high vol (>1.3x). Weight: 6.',
                    },
                    btcAlign: {
                      title: 'BTC Correlation',
                      desc: 'Bitcoin trend should not oppose your trade. XRP often follows BTC direction. Weight: 8.',
                    },
                    macdMomentum: {
                      title: 'MACD Momentum',
                      desc: 'MACD histogram confirms momentum direction. Dead zone (near zero) = neutral. Weight: 6.',
                    },
                    rsiExtreme: {
                      title: 'RSI Extreme Level',
                      desc: 'RSI should be at an extreme level for high-probability reversals. LONG needs RSI <35 (oversold). SHORT needs RSI >65 (overbought).',
                    },
                    flowConfirm: {
                      title: 'Flow Confirmation',
                      desc: 'Real-time order flow should support your trade direction. Expand Market Microstructure section to enable. Weight: 4.',
                    },
                    liqBias: {
                      title: 'Liquidation Bias',
                      desc: 'Liquidation structure should align with trade direction. Expand Liquidation Analysis to enable. Weight: 6.',
                    },
                    reversalSignal: {
                      title: 'Reversal Detection',
                      desc: 'Multi-timeframe candlestick pattern confluence detecting direction reversals. Phases: exhaustion → indecision → initiation → confirmation. Boosts reversal direction, penalizes exhausted direction. Weight: 12.',
                    },
                    marketStructure: {
                      title: 'Market Structure',
                      desc: 'Swing point analysis (HH/HL vs LH/LL) from 4H (60%) and 1H (40%). Uptrend near swing low = strong long. Downtrend with lower lows = strong short. Weight: 10.',
                    },
                    keyLevelProximity: {
                      title: 'Key Level Proximity',
                      desc: 'How close price is to confluent S/R levels from multiple timeframes. Includes risk/reward ratio calculation. Near support for longs = good. Near resistance for shorts = good. Weight: 8.',
                    },
                  };
                  const tip = tooltips[key] || { title: key, desc: '' };

                  const labels: Record<string, string> = {
                    trend1d: '1D trend',
                    trend4h: '4H trend',
                    setup1h: '1H setup',
                    entry15m: '15m entry',
                    volume: 'Volume',
                    btcAlign: 'BTC aligned',
                    macdMomentum: 'MACD momentum',
                    rsiExtreme: 'RSI extreme',
                    flowConfirm: 'Flow confirm',
                    liqBias: 'Liq bias',
                    reversalSignal: 'Reversal',
                    marketStructure: 'Structure',
                    keyLevelProximity: 'Key Levels',
                  };

                  return (
                    <Tooltip
                      key={key}
                      content={
                        <div className="max-w-xs">
                          <strong>{tip.title}</strong>
                          <p className="mt-1 text-xs">{tip.desc}</p>
                        </div>
                      }
                      position="left"
                      block
                    >
                      <div className={`flex items-center gap-2 py-1.5 border-b border-primary/50 text-sm ${key === 'reversalSignal' ? 'bg-orange-500/5' : key === 'flowConfirm' ? 'bg-blue-500/5' : key === 'liqBias' ? 'bg-purple-500/5' : key === 'marketStructure' ? 'bg-cyan-500/5' : key === 'keyLevelProximity' ? 'bg-amber-500/5' : ''}`}>
                        <div
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                            item.pass ? 'bg-green-500 text-black' : 'bg-red-500/80 text-white'
                          }`}
                        >
                          {item.pass ? '✓' : '✗'}
                        </div>
                        <span className="flex-1 text-secondary text-xs">
                          {labels[key] || key}
                        </span>
                        <span className="mono text-xs text-tertiary">{item.value}</span>
                      </div>
                    </Tooltip>
                  );
                })
              ) : (
                <div className="text-center text-secondary text-sm py-4">
                  Loading checklist...
                </div>
              )}
            </div>

            {/* Score Summary */}
            <div className="mt-3 p-2 bg-primary rounded flex justify-between text-sm">
              <span>
                LONG: <strong className={recommendation && recommendation.longScore >= 5 ? 'text-green-500' : recommendation && recommendation.longScore >= 3 ? 'text-yellow-500' : ''}>{recommendation?.longScore || 0}</strong>/{recommendation?.totalItems || 6}
              </span>
              <span>
                SHORT: <strong className={recommendation && recommendation.shortScore >= 5 ? 'text-red-500' : recommendation && recommendation.shortScore >= 3 ? 'text-yellow-500' : ''}>{recommendation?.shortScore || 0}</strong>/{recommendation?.totalItems || 6}
              </span>
            </div>

            {/* Reversal Status */}
            {recommendation?.reversalStatus?.detected && (
              <Tooltip
                content={
                  <div className="text-xs leading-relaxed space-y-1.5">
                    <div className="font-semibold">Reversal Detection</div>
                    <div>Detects when the current price direction is running out of steam using candlestick patterns across 5m and 15m timeframes.</div>
                    <div className="space-y-0.5 text-gray-300">
                      <div><span className="text-white font-medium">Phase:</span> {
                        recommendation.reversalStatus.phase === 'exhaustion' ? 'Momentum fading — earliest signal, lowest certainty'
                        : recommendation.reversalStatus.phase === 'indecision' ? 'Doji/spinning tops appearing — market can\'t decide'
                        : recommendation.reversalStatus.phase === 'initiation' ? 'First reversal pattern appeared — direction changing'
                        : 'Multi-timeframe patterns confirmed — high confidence reversal'
                      }</div>
                      <div><span className="text-white font-medium">Confidence {recommendation.reversalStatus.confidence}%:</span> Based on pattern count, multi-TF confluence, RSI divergence, and volume spikes</div>
                      <div><span className="text-white font-medium">Exhaustion {recommendation.reversalStatus.exhaustionScore}%:</span> How spent the current direction is (shrinking bodies, declining volume)</div>
                      <div><span className="text-white font-medium">Urgency:</span> {
                        recommendation.reversalStatus.urgency === 'immediate' ? 'Act now — confirmed reversal with high confidence'
                        : recommendation.reversalStatus.urgency === 'developing' ? 'Developing — reversal forming, prepare to act'
                        : 'Early warning — first signs, monitor closely'
                      }</div>
                    </div>
                  </div>
                }
                position="bottom"
                maxWidth="380px"
                block
              >
                <div className={`mt-3 p-3 rounded-lg border text-xs ${
                  recommendation.reversalStatus.direction === 'bullish'
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`font-semibold ${
                      recommendation.reversalStatus.direction === 'bullish' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      ↺ {recommendation.reversalStatus.direction === 'bullish' ? 'Bullish' : 'Bearish'} Reversal — {recommendation.reversalStatus.phase}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      recommendation.reversalStatus.confidence >= 70 ? 'bg-green-500/30 text-green-300'
                      : recommendation.reversalStatus.confidence >= 50 ? 'bg-yellow-500/30 text-yellow-300'
                      : 'bg-tertiary/30 text-tertiary'
                    }`}>
                      {recommendation.reversalStatus.confidence}%
                    </span>
                  </div>
                  <div className="flex gap-3 text-tertiary">
                    <span>Exhaustion: {recommendation.reversalStatus.exhaustionScore}%</span>
                    <span>Urgency: {recommendation.reversalStatus.urgency.replace('_', ' ')}</span>
                  </div>
                  {recommendation.reversalStatus.patterns.length > 0 && (
                    <div className="mt-1 text-secondary">
                      Patterns: {recommendation.reversalStatus.patterns.join(', ')}
                    </div>
                  )}
                </div>
              </Tooltip>
            )}
          </div>

          {/* Liquidation Bias Summary */}
          <div
            onClick={() => setShowLiquidationModal(true)}
            className={`card p-4 cursor-pointer hover:ring-1 transition-all ${
              liqData?.bias === 'short_squeeze'
                ? 'bg-green-500/10 hover:ring-green-500/50'
                : liqData?.bias === 'long_squeeze'
                ? 'bg-red-500/10 hover:ring-red-500/50'
                : 'hover:ring-blue-500/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs text-tertiary uppercase tracking-wider">
                Liquidation Bias
              </h3>
              <span className="text-xs text-tertiary">Click for details →</span>
            </div>
            {liqData ? (
              <>
                <div className={`text-lg font-bold ${
                  liqData.bias === 'short_squeeze'
                    ? 'text-green-500'
                    : liqData.bias === 'long_squeeze'
                    ? 'text-red-500'
                    : 'text-secondary'
                }`}>
                  {liqData.bias === 'short_squeeze'
                    ? '↑ Short Squeeze Potential'
                    : liqData.bias === 'long_squeeze'
                    ? '↓ Long Squeeze Potential'
                    : '— Neutral'}
                </div>
                <div className="flex justify-between text-xs mt-2">
                  {liqData.nearestUpside && (
                    <span className="text-green-500">
                      Target ↑: €{liqData.nearestUpside < 10 ? liqData.nearestUpside.toFixed(4) : liqData.nearestUpside.toFixed(2)}
                    </span>
                  )}
                  {liqData.nearestDownside && (
                    <span className="text-red-500">
                      Target ↓: €{liqData.nearestDownside < 10 ? liqData.nearestDownside.toFixed(4) : liqData.nearestDownside.toFixed(2)}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-tertiary">Loading...</div>
            )}
          </div>

          {/* Fear & Greed Index */}
          <FearGreedGauge />

          {/* Trade Panel Button */}
          <button
            onClick={() => setIsDrawerOpen(true)}
            className={`w-full py-3 rounded-lg font-semibold transition-all ${
              testMode
                ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-black hover:from-orange-400 hover:to-orange-500'
                : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-400 hover:to-blue-500'
            }`}
          >
            {testMode ? '🧪 Open Test Trade Panel' : '⚡ Open Trade Panel'}
          </button>
        </div>
        </div>
      )}

      {/* Orders Tab - Full Width */}
      {activeTab === 'orders' && (
        <OrdersTab
          testMode={testMode}
          onEditOrder={handleEditOrder}
          onEditDraft={handleEditDraft}
          onOrderCancelled={markOrderCancelled}
        />
      )}

      {/* Positions Tab - Full Width */}
      {activeTab === 'positions' && (
        <PositionsTab
          testMode={testMode}
          currentPrice={price}
          onPositionChange={() => {
            handleOrderExecuted();
            // Refresh positions count
            const endpoint = testMode ? '/api/simulated/positions' : '/api/kraken/private/positions';
            fetch(endpoint)
              .then(r => r.json())
              .then(d => {
                const openCount = (d.positions || []).filter((p: { isOpen: boolean }) => p.isOpen).length;
                setPositionsCount(openCount);
              })
              .catch(console.error);
            // Refresh history count when position changes (might have closed)
            const historyEndpoint = testMode
              ? '/api/simulated/positions/history'
              : '/api/trading/history';
            fetch(historyEndpoint)
              .then(r => r.json())
              .then(d => {
                setHistoryCount((d.positions || []).length);
              })
              .catch(console.error);
          }}
        />
      )}

      {/* History Tab - Full Width */}
      {activeTab === 'history' && (
        <HistoryTab testMode={testMode} />
      )}

      {/* Reports Tab - Full Width */}
      {activeTab === 'reports' && (
        <ReportsTab
          onReportsCountChange={setReportsCount}
          testMode={testMode}
        />
      )}

      {/* Floating Trade Button (bottom-right) */}
      <FloatingTradeButton
        onClick={() => setIsDrawerOpen(true)}
        testMode={testMode}
        hasOpenPosition={testMode ? hasOpenSimulatedPosition : false}
      />

      {/* Trade Drawer */}
      <TradeDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        testMode={testMode}
      >
        <div className="space-y-4">
          {/* Trade Execution Panel */}
          <TradeExecutionPanel
            currentPrice={price}
            bestBid={bestBid || price * 0.9999}
            bestAsk={bestAsk || price * 1.0001}
            testMode={testMode}
            editingOrder={editingOrder}
            editingDraft={editingDraft}
            onOrderExecuted={handleOrderExecuted}
            onCancelEdit={handleCancelEdit}
          />

          {/* Simulated Trading Content (test mode only) */}
          {testMode && (
            <>
              {/* Simulated Balance */}
              <div className="border-t border-primary">
                <SimulatedBalance />
              </div>

              {/* Simulated Positions */}
              <div className="border-t border-primary">
                <SimulatedPositions
                  currentPrice={price}
                  onPositionChange={handleOrderExecuted}
                />
              </div>

              {/* Trade History */}
              <div className="border-t border-primary">
                <TradeHistory onAnalyzeClick={handleAnalyzeClick} />
              </div>

              {/* AI Trade Analysis */}
              {showTradeAnalysis && (
                <div className="border-t border-primary">
                  <TradeAnalysisPanel
                    positionId={analysisPositionId}
                    onClose={() => {
                      setShowTradeAnalysis(false);
                      setAnalysisPositionId(undefined);
                    }}
                  />
                </div>
              )}

              {/* Batch Analysis Button */}
              {!showTradeAnalysis && (
                <div className="p-4 border-t border-primary">
                  <button
                    onClick={() => {
                      setAnalysisPositionId(undefined);
                      setShowTradeAnalysis(true);
                    }}
                    className="w-full py-2.5 px-4 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30 text-sm font-semibold transition-colors"
                  >
                    📊 Analyze All Trades with AI
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </TradeDrawer>

      {/* Liquidation Heatmap Modal */}
      {showLiquidationModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowLiquidationModal(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-secondary rounded-xl shadow-2xl m-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-secondary border-b border-primary p-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Liquidation Heatmap</h2>
              <button
                onClick={() => setShowLiquidationModal(false)}
                className="text-tertiary hover:text-primary transition-colors p-1"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Modal Content - LiquidationHeatmap with auto-expand */}
            <div className="p-4">
              <LiquidationHeatmapExpanded
                candles={tfData[displayTf].ohlc}
                currentPrice={price}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper for LiquidationHeatmap that auto-expands on mount
function LiquidationHeatmapExpanded({
  candles,
  currentPrice,
}: {
  candles: OHLCData[];
  currentPrice: number;
}) {
  return (
    <LiquidationHeatmap
      candles={candles}
      currentPrice={currentPrice}
      defaultExpanded={true}
    />
  );
}

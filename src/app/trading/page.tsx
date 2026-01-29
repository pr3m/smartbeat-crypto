'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { generateRecommendation } from '@/lib/trading/recommendation';
import { getTradingSession } from '@/lib/trading/session';
import type { TradingRecommendation, MicrostructureInput, LiquidationInput, Indicators, OHLCData } from '@/lib/kraken/types';
import type { MarketSnapshot, AIAnalysisResponse, OpenPositionData } from '@/lib/ai/types';
import { buildChartContext, formatChartContextForAI } from '@/lib/trading/chart-context';
import { TradingDataProvider, useTradingData, TRADING_TIMEFRAMES, TRADING_REFRESH_INTERVAL_SEC } from '@/components/TradingDataProvider';
import { useToast } from '@/components/Toast';
import { requestNotificationPermission, sendBrowserNotification } from '@/components/Toast';
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

export default function TradingPage() {
  const [testMode, setTestMode] = useState(true);

  return (
    <TradingDataProvider testMode={testMode}>
      <TradingPageContent testMode={testMode} setTestMode={setTestMode} />
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
    nextRefresh,
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [displayTf, setDisplayTf] = useState<number>(15);
  const [recommendation, setRecommendation] = useState<TradingRecommendation | null>(null);
  const lastRecommendationRef = useRef<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<TradingTab>('setup');
  const [positionsCount, setPositionsCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);

  // Calculate orders count (open orders + pending drafts)
  const pendingDrafts = draftOrders.filter(d => d.status === 'pending');
  const ordersCount = openOrders.length + pendingDrafts.length;

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
      setLiqData(getLiquidationInput(analysis));
    } else {
      setLiqData(null);
    }
  }, []);

  const handleOrderExecuted = useCallback(() => {
    refreshSimulatedBalance(true);
    refreshSimulatedPositions(true);
    refreshOpenPositions(true);
  }, [refreshOpenPositions, refreshSimulatedBalance, refreshSimulatedPositions]);

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
        rsi: indicators.rsi,
        macd: indicators.macd,
        macdSignal: indicators.macdSignal,
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
      };

      // Only build chart context if we have sufficient data
      const hasEnoughData = Object.values(ohlcByInterval).every(ohlc => ohlc.length >= 20);
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
      },
      recommendation: recommendation ? {
        action: recommendation.action,
        confidence: recommendation.confidence,
        reason: recommendation.reason,
        longScore: recommendation.longScore,
        shortScore: recommendation.shortScore,
        totalItems: recommendation.totalItems,
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

  // Generate recommendation when data changes
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
      liqData // Pass liquidation data for liq bias analysis
    );

    console.log('Generated recommendation:', rec?.action, 'Long:', rec?.longScore, 'Short:', rec?.shortScore, 'Flow:', rec?.flowStatus?.status, 'Liq:', rec?.liquidationStatus?.bias);
    setRecommendation(rec);

    // Check for new signal (only if action changes and is not WAIT)
    if (rec && rec.action !== 'WAIT' && rec.action !== lastRecommendationRef.current) {
      // Toast notification
      addToast({
        title: `🎯 Signal: ${rec.action}`,
        message: rec.reason,
        type: 'signal',
        duration: 15000,
      });

      // Browser notification
      if (notificationsEnabled) {
        sendBrowserNotification(
          `Trading Signal: ${rec.action}`,
          rec.reason,
          { tag: 'trading-signal', renotify: true }
        );
      }
    }

    lastRecommendationRef.current = rec?.action || null;
  }, [tfData, btcTrend, btcChange, microData, liqData, notificationsEnabled, addToast]);

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission().then(granted => {
      setNotificationsEnabled(granted);
    });
  }, []);

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
              addToast={addToast}
            />
          </div>

          {/* Sidebar - Right Column */}
        <div className="space-y-4">
          {/* Entry Checklist - Now at top of sidebar */}
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
                    trend4h: {
                      title: '4H Trend Direction',
                      desc: 'The 4-hour timeframe sets the overall trend. For LONG: need bullish bias. For SHORT: need bearish bias. This is the most important filter (40% weight).',
                    },
                    setup1h: {
                      title: '1H Setup Confirmation',
                      desc: 'The 1-hour timeframe confirms the setup. Should align with 4H trend direction. Provides 30% weight to the signal.',
                    },
                    entry15m: {
                      title: '15m Entry Timing',
                      desc: 'The 15-minute RSI times your entry. For LONG: RSI should be oversold (<35). For SHORT: RSI should be overbought (>65). This catches the reversal point.',
                    },
                    volume: {
                      title: 'Volume Confirmation',
                      desc: 'Current volume should be >1.3x the 20-period average. High volume confirms institutional interest and increases probability of follow-through.',
                    },
                    btcAlign: {
                      title: 'BTC Correlation',
                      desc: 'Bitcoin trend should not oppose your trade. For LONG: BTC should not be bearish. For SHORT: BTC should not be bullish. XRP often follows BTC direction.',
                    },
                    rsiExtreme: {
                      title: 'RSI Extreme Level',
                      desc: 'RSI should be at an extreme level for high-probability reversals. LONG needs RSI <35 (oversold). SHORT needs RSI >65 (overbought).',
                    },
                    flowConfirm: {
                      title: 'Flow Confirmation (Option B)',
                      desc: 'Real-time order flow should support your trade direction. For LONG: need bid imbalance >20% OR rising CVD. For SHORT: need ask imbalance >20% OR falling CVD. Expand Market Microstructure section to enable.',
                    },
                    liqBias: {
                      title: 'Liquidation Bias',
                      desc: 'Liquidation structure should align with your trade direction. For LONG: need short squeeze potential (shorts stacked above). For SHORT: need long squeeze potential (longs stacked below). Expand Liquidation Analysis section to enable.',
                    },
                  };
                  const tip = tooltips[key] || { title: key, desc: '' };

                  const labels: Record<string, string> = {
                    trend4h: '4H trend',
                    setup1h: '1H setup',
                    entry15m: '15m entry',
                    volume: 'Volume >1.3x',
                    btcAlign: 'BTC aligned',
                    rsiExtreme: 'RSI extreme',
                    flowConfirm: 'Flow confirm',
                    liqBias: 'Liq bias',
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
                      <div className={`flex items-center gap-2 py-1.5 border-b border-primary/50 text-sm ${key === 'flowConfirm' ? 'bg-blue-500/5' : key === 'liqBias' ? 'bg-purple-500/5' : ''}`}>
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

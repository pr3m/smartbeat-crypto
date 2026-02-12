'use client';

import { useMemo } from 'react';
import type { TradingRecommendation, MicrostructureInput, OHLCData, Indicators } from '@/lib/kraken/types';
import type { AIAnalysisResponse } from '@/lib/ai/types';
import type { LiquidationAnalysis } from '@/lib/trading/liquidation';
import { CandlestickChart } from '@/components/CandlestickChart';
import { Tooltip, HelpIcon } from '@/components/Tooltip';
import { getTradingSession } from '@/lib/trading/session';
import { MarketMicrostructure } from '@/components/microstructure';
import { LiquidationHeatmap } from '@/components/LiquidationHeatmap';
import { AIAnalysisPanel } from '@/components/AIAnalysisPanel';
import { OpenPositions } from '@/components/OpenPositions';
import { SimulatedPositions } from '@/components/SimulatedPositions';
import { OpenOrders, type OpenOrderData } from '@/components/OpenOrders';

interface TimeframeData {
  value: number;
  label: string;
}

interface TfDataEntry {
  ohlc: OHLCData[];
  indicators: Indicators | null;
}

interface SetupTabProps {
  // Price data
  price: number;
  priceChange: number;
  high24h: number;
  low24h: number;
  volume24h: number;

  // Mode
  testMode: boolean;

  // Timeframe data
  displayTf: number;
  setDisplayTf: (tf: number) => void;
  tfData: Record<number, TfDataEntry>;
  TIMEFRAMES: TimeframeData[];

  // Indicators
  currentIndicators: Indicators | null;
  btcTrend: 'bull' | 'bear' | 'neut';
  btcChange: number;

  // Recommendation
  recommendation: TradingRecommendation | null;
  loading: boolean;

  // AI Analysis
  aiAnalysis: AIAnalysisResponse | null;
  aiLoading: boolean;
  showAiPanel: boolean;
  setShowAiPanel: (show: boolean) => void;
  requestAiAnalysis: () => void;
  aiError: string | null;
  setAiError: (error: string | null) => void;

  // Microstructure & Liquidation callbacks
  handleMicrostructureData: (data: MicrostructureInput | null) => void;
  handleLiquidationData: (analysis: LiquidationAnalysis | null) => void;

  // Position updates
  handleOrderExecuted: () => void;

  // Order editing
  onEditOrder?: (order: OpenOrderData) => void;
  onOrderCancelled?: (orderId: string) => void;

  // Toast
  addToast: (toast: { title: string; message: string; type: 'success' | 'error' | 'signal' | 'info' | 'warning'; duration?: number }) => void;
}

/** Plain-language tooltips for each candlestick pattern */
const CANDLESTICK_TOOLTIPS: Record<string, string> = {
  // Single-candle patterns
  doji: 'Buyers and sellers are evenly matched — the market can\'t decide. Often appears before a direction change, especially after a strong move.',
  long_legged_doji: 'Wild swings in both directions, but price ended where it started. Shows extreme indecision — a big move may follow.',
  dragonfly_doji: 'Price dropped sharply but buyers pushed it all the way back up. At a bottom, this often signals buyers are stepping in.',
  gravestone_doji: 'Price spiked up but sellers pushed it all the way back down. At a top, this often signals sellers are taking over.',
  hammer: 'Price fell hard during the candle but buyers fought back, closing near the top. Classic "bottom is in" signal after a decline.',
  inverted_hammer: 'Price tried to rally but couldn\'t hold gains. Still bullish after a decline — it shows buyers are starting to test higher prices.',
  shooting_star: 'Price spiked up then collapsed back down. After a rally, this signals buyers are losing steam and a pullback may follow.',
  hanging_man: 'Looks like a hammer, but appears at the top of a rally. Warns that selling pressure is creeping in despite the uptrend.',
  spinning_top: 'Small body with wicks on both sides — neither buyers nor sellers won. The trend may be losing conviction.',
  bullish_marubozu: 'All-green candle with no wicks — buyers dominated from open to close. Shows very strong buying pressure.',
  bearish_marubozu: 'All-red candle with no wicks — sellers dominated from open to close. Shows very strong selling pressure.',
  bullish_belt_hold: 'Opens at the low and closes near the high after a decline. Buyers grabbed control right from the open — bullish shift.',
  bearish_belt_hold: 'Opens at the high and closes near the low after a rally. Sellers took over from the open — bearish shift.',

  // Two-candle patterns
  bullish_engulfing: 'A large green candle completely swallows the previous red candle. One of the strongest reversal signals — buyers overwhelmed sellers.',
  bearish_engulfing: 'A large red candle completely swallows the previous green candle. Sellers overwhelmed buyers — strong warning of a downturn.',
  piercing_line: 'After a red candle, the next opens lower but closes above the midpoint. Buyers are fighting back — potential bottom forming.',
  dark_cloud_cover: 'After a green candle, the next opens higher but closes below the midpoint. Sellers are pushing back — potential top forming.',
  tweezer_bottom: 'Two candles touch the same low — the market tested that price twice and held. Support level confirmed, often marks a bottom.',
  tweezer_top: 'Two candles touch the same high — the market tested that price twice and failed. Resistance confirmed, often marks a top.',
  bullish_harami: 'A small green candle fits inside the previous red candle. Selling pressure is fading — the decline may be losing steam.',
  bearish_harami: 'A small red candle fits inside the previous green candle. Buying pressure is fading — the rally may be losing steam.',
  bullish_kicker: 'A gap up followed by strong buying — one of the most powerful bullish signals. Sentiment shifted dramatically overnight.',
  bearish_kicker: 'A gap down followed by strong selling — one of the most powerful bearish signals. Sentiment shifted dramatically overnight.',
  matching_low: 'Two candles close at the same low, forming a double bottom. This price level is acting as strong support.',
  matching_high: 'Two candles close at the same high, forming a double top. This price level is acting as strong resistance.',

  // Three-candle patterns
  morning_star: 'Red candle, tiny indecision candle, then strong green candle. Classic three-act reversal: selling, hesitation, buying takeover.',
  evening_star: 'Green candle, tiny indecision candle, then strong red candle. Classic three-act reversal: buying, hesitation, selling takeover.',
  three_white_soldiers: 'Three consecutive strong green candles — buyers are firmly in control. Very strong bullish momentum signal.',
  three_black_crows: 'Three consecutive strong red candles — sellers are firmly in control. Very strong bearish momentum signal.',
  three_inside_up: 'Harami pattern confirmed by a third green candle breaking higher. The reversal from bearish to bullish is confirmed.',
  three_inside_down: 'Harami pattern confirmed by a third red candle breaking lower. The reversal from bullish to bearish is confirmed.',
  bullish_abandoned_baby: 'A gap-down doji followed by a gap-up green candle. Extremely rare and powerful — sellers completely exhausted.',
  bearish_abandoned_baby: 'A gap-up doji followed by a gap-down red candle. Extremely rare and powerful — buyers completely exhausted.',
  three_outside_up: 'Engulfing pattern confirmed by a third green candle. Strong bullish reversal — the momentum shift is validated.',
  three_outside_down: 'Engulfing pattern confirmed by a third red candle. Strong bearish reversal — the momentum shift is validated.',
  tri_star: 'Three doji candles in a row — extreme indecision building up. A big directional move often follows this tension.',
  advance_block: 'Three green candles, but each is weaker than the last. Buying is slowing down — the rally may be running out of fuel.',
  deliberation: 'Two strong green candles followed by a small one. The rally is hesitating — potential top forming.',

  // Continuation patterns
  rising_three_methods: 'A strong green candle, brief pullback, then another strong green candle. The uptrend paused to catch its breath and is resuming.',
  falling_three_methods: 'A strong red candle, brief bounce, then another strong red candle. The downtrend paused briefly and is resuming.',
  mat_hold: 'Bullish continuation where a brief dip stays within the prior candle\'s range. The uptrend is healthy and likely to continue.',
  upside_tasuki_gap: 'A gap up followed by a slight pullback that doesn\'t fill the gap. Buyers still in charge — trend continues up.',
  downside_tasuki_gap: 'A gap down followed by a slight bounce that doesn\'t fill the gap. Sellers still in charge — trend continues down.',
};

function getCandlestickTooltip(patternName: string, patternType: string): string {
  const tooltip = CANDLESTICK_TOOLTIPS[patternName];
  if (tooltip) return tooltip;

  // Fallback for unknown patterns
  if (patternType.includes('bullish')) return 'A bullish pattern suggesting potential upward price movement.';
  if (patternType.includes('bearish')) return 'A bearish pattern suggesting potential downward price movement.';
  if (patternType === 'indecision') return 'An indecision pattern — the market is uncertain. Watch for the next candle to confirm direction.';
  return 'A candlestick pattern that may signal a change in price direction.';
}

export function SetupTab({
  price,
  priceChange,
  high24h,
  low24h,
  volume24h,
  testMode,
  displayTf,
  setDisplayTf,
  tfData,
  TIMEFRAMES,
  currentIndicators,
  btcTrend,
  btcChange,
  recommendation,
  loading,
  aiAnalysis,
  aiLoading,
  showAiPanel,
  setShowAiPanel,
  requestAiAnalysis,
  aiError,
  setAiError,
  handleMicrostructureData,
  handleLiquidationData,
  handleOrderExecuted,
  onEditOrder,
  onOrderCancelled,
  addToast,
}: SetupTabProps) {
  // Memoize chartData to prevent new array reference on every render when data is missing
  const chartData = useMemo(() => tfData[displayTf]?.ohlc || [], [tfData, displayTf]);

  const formatVolume = (v: number) => {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v.toFixed(0);
  };

  const getBiasLabel = (bias: string | undefined) => {
    if (bias === 'bullish') return '↑ BULL';
    if (bias === 'bearish') return '↓ BEAR';
    return '— NEUT';
  };

  return (
    <div className="space-y-4">
      {/* Open Orders */}
      <OpenOrders testMode={testMode} onEditOrder={onEditOrder} onOrderCancelled={onOrderCancelled} defaultCollapsed />

      {/* Open Positions - Show real or simulated based on mode */}
      {testMode ? (
        <SimulatedPositions
          currentPrice={price}
          onPositionChange={handleOrderExecuted}
        />
      ) : (
        <OpenPositions currentPrice={price} defaultCollapsed />
      )}

      {/* Recommendation Box */}
      <div
        className={`card p-5 text-center border-2 ${
          recommendation?.action === 'LONG' || recommendation?.action === 'SPIKE ↑'
            ? 'border-green-500 bg-green-500/10'
            : recommendation?.action === 'SHORT' || recommendation?.action === 'SPIKE ↓'
            ? 'border-red-500 bg-red-500/10'
            : 'border-yellow-500/50 bg-yellow-500/5'
        }`}
      >
        <div className="text-xs text-tertiary uppercase tracking-wider mb-1">
          Recommendation
        </div>
        <div
          className={`text-3xl font-extrabold mb-2 ${
            recommendation?.action === 'LONG' || recommendation?.action === 'SPIKE ↑'
              ? 'text-green-500'
              : recommendation?.action === 'SHORT' || recommendation?.action === 'SPIKE ↓'
              ? 'text-red-500'
              : 'text-yellow-500'
          }`}
        >
          {loading ? 'LOADING...' : recommendation?.action || 'WAIT'}
        </div>
        <div className="text-sm text-secondary mb-3 min-h-[40px]">
          {loading ? 'Fetching market data...' : recommendation?.reason || 'Waiting for indicator data...'}
        </div>

        {/* Flow Status Indicator */}
        {recommendation?.flowStatus && (
          <Tooltip
            content={
              <div className="text-xs">
                <strong>Flow Analysis</strong>
                <p className="mt-1">Real-time order flow assessment:</p>
                <div className="mt-2 space-y-1">
                  <div>Imbalance: {(recommendation.flowStatus.imbalance * 100).toFixed(0)}%</div>
                  <div>CVD Trend: {recommendation.flowStatus.cvdTrend}</div>
                  <div>Spread: {recommendation.flowStatus.spreadStatus}</div>
                  <div>Whales: {recommendation.flowStatus.whaleActivity}</div>
                  {recommendation.flowStatus.hasDivergence && (
                    <div className="text-yellow-400">Divergence: {recommendation.flowStatus.divergenceType}</div>
                  )}
                </div>
              </div>
            }
            position="bottom"
          >
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-3 cursor-help ${
              recommendation.flowStatus.status === 'aligned'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : recommendation.flowStatus.status === 'opposing'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                recommendation.flowStatus.status === 'aligned'
                  ? 'bg-green-500'
                  : recommendation.flowStatus.status === 'opposing'
                  ? 'bg-red-500'
                  : 'bg-gray-500'
              }`} />
              Flow {recommendation.flowStatus.status === 'aligned' ? 'Aligned' : recommendation.flowStatus.status === 'opposing' ? 'Opposing' : 'Neutral'}
              {recommendation.flowStatus.adjustments.total !== 0 && (
                <span className={recommendation.flowStatus.adjustments.total > 0 ? 'text-green-400' : 'text-red-400'}>
                  ({recommendation.flowStatus.adjustments.total > 0 ? '+' : ''}{recommendation.flowStatus.adjustments.total}%)
                </span>
              )}
            </div>
          </Tooltip>
        )}

        {/* Knife Status Indicator */}
        {recommendation?.knifeStatus?.isKnife && (
          <Tooltip
            content={
              <div className="text-xs">
                <strong>Knife Detection</strong>
                <p className="mt-1">{recommendation.knifeStatus.direction === 'falling' ? 'Falling' : 'Rising'} knife detected:</p>
                <div className="mt-2 space-y-1">
                  <div>Phase: {recommendation.knifeStatus.phase}</div>
                  <div>Broken Level: {recommendation.knifeStatus.brokenLevel?.toFixed(5)}</div>
                  <div>Knife Score: {recommendation.knifeStatus.knifeScore}%</div>
                  <div>Reversal Readiness: {recommendation.knifeStatus.reversalReadiness}%</div>
                  <div>Gate: {recommendation.knifeStatus.gateAction}</div>
                  <div>Size Multiplier: {(recommendation.knifeStatus.sizeMultiplier * 100).toFixed(0)}%</div>
                  {recommendation.knifeStatus.waitFor.length > 0 && (
                    <div className="text-yellow-400">Wait for: {recommendation.knifeStatus.waitFor.join(', ')}</div>
                  )}
                  {recommendation.knifeStatus.flipSuggestion && (
                    <div className="text-blue-400">
                      Consider {recommendation.knifeStatus.direction === 'falling' ? 'SHORT' : 'LONG'} instead
                    </div>
                  )}
                </div>
              </div>
            }
            position="bottom"
          >
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-3 ml-2 cursor-help ${
              recommendation.knifeStatus.gateAction === 'block'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : recommendation.knifeStatus.gateAction === 'warn'
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                : 'bg-green-500/20 text-green-400 border border-green-500/30'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                recommendation.knifeStatus.gateAction === 'block'
                  ? 'bg-red-500'
                  : recommendation.knifeStatus.gateAction === 'warn'
                  ? 'bg-yellow-500'
                  : 'bg-green-500'
              }`} />
              {recommendation.knifeStatus.direction === 'falling' ? 'Falling' : 'Rising'} Knife: {recommendation.knifeStatus.phase}
            </div>
          </Tooltip>
        )}

        {/* Confidence */}
        <Tooltip
          content={
            <div className="text-xs">
              <strong>Confidence Breakdown</strong>
              <div className="mt-2">
                <div>Base (indicators): {recommendation?.baseConfidence || 0}%</div>
                {recommendation?.flowStatus && (
                  <div>Flow adjustment: {recommendation.flowStatus.adjustments.total > 0 ? '+' : ''}{recommendation.flowStatus.adjustments.total}%</div>
                )}
                <div className="mt-1 pt-1 border-t border-gray-600 font-semibold">
                  Final: {recommendation?.confidence || 0}%
                </div>
              </div>
            </div>
          }
          position="bottom"
        >
          <div className="inline-flex items-center gap-2 bg-tertiary px-4 py-2 rounded-full text-sm cursor-help">
            <span className="text-secondary">Confidence:</span>
            <div className="w-20 h-2 bg-primary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${recommendation?.confidence || 0}%`,
                  backgroundColor:
                    (recommendation?.confidence || 0) > 60
                      ? 'var(--green)'
                      : (recommendation?.confidence || 0) > 40
                      ? 'var(--yellow)'
                      : 'var(--red)',
                }}
              />
            </div>
            <span className="font-semibold w-8">{recommendation?.confidence || 0}%</span>
          </div>
        </Tooltip>

        {/* AI Analysis Button */}
        <div className="mt-4 pt-3 border-t border-primary/30">
          <button
            onClick={requestAiAnalysis}
            disabled={aiLoading || loading || !recommendation}
            className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              aiLoading
                ? 'bg-purple-500/20 text-purple-400 cursor-wait'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg hover:shadow-purple-500/25'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {aiLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyzing with AI...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Get AI Trade Analysis
              </>
            )}
          </button>
          {aiAnalysis && (
            <button
              onClick={() => setShowAiPanel(true)}
              className="w-full mt-2 py-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              View last analysis ({new Date(aiAnalysis.timestamp).toLocaleTimeString()})
            </button>
          )}
        </div>
      </div>

      {/* AI Analysis Panel */}
      {showAiPanel && aiAnalysis && (
        <AIAnalysisPanel
          analysis={aiAnalysis}
          onClose={() => setShowAiPanel(false)}
          onCopyInput={() => {
            navigator.clipboard.writeText(aiAnalysis.inputData);
            addToast({ title: 'Copied', message: 'Input data copied to clipboard', type: 'success', duration: 2000 });
          }}
          onCopyAnalysis={() => {
            navigator.clipboard.writeText(aiAnalysis.analysis);
            addToast({ title: 'Copied', message: 'Analysis copied to clipboard', type: 'success', duration: 2000 });
          }}
          testMode={testMode}
        />
      )}

      {/* AI Error Display */}
      {aiError && (
        <div className="card p-4 border border-red-500/30 bg-red-900/20">
          <div className="flex items-center gap-2 text-red-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-semibold">AI Analysis Error</span>
          </div>
          <p className="text-sm text-red-300 mt-2">{aiError}</p>
          <button
            onClick={() => setAiError(null)}
            className="text-xs text-red-400 hover:text-red-300 mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Price Display */}
      <div className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold mono">
              €{price > 0 ? price.toFixed(4) : '-.----'}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-sm font-semibold ${
                priceChange >= 0 ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
              }`}
            >
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
            {/* Session Badge */}
            {(() => {
              const session = getTradingSession();
              const sessionColors: Record<string, string> = {
                overlap_europe_us: 'bg-green-500/20 text-green-400 border-green-500/30',
                europe: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                us: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                asia: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
                transition: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
              };
              const sessionLabels: Record<string, string> = {
                overlap_europe_us: 'EU+US',
                europe: 'Europe',
                us: 'US',
                asia: 'Asia',
                transition: 'Late',
              };
              return (
                <Tooltip
                  content={<div className="text-xs max-w-xs"><strong>Trading Session</strong><p className="mt-1">{session.description}</p><p className="mt-1 text-tertiary">{session.marketHours}</p></div>}
                  position="bottom"
                >
                  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${sessionColors[session.phase] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                    {session.isWeekend ? '🔇 ' : ''}{sessionLabels[session.phase] || session.phase}
                  </span>
                </Tooltip>
              );
            })()}
          </div>
          <div className="flex gap-6 text-xs">
            <div className="text-center">
              <div className="text-tertiary mb-0.5">24h High</div>
              <div className="mono text-secondary">€{high24h > 0 ? high24h.toFixed(4) : '-.----'}</div>
            </div>
            <div className="text-center">
              <div className="text-tertiary mb-0.5">24h Low</div>
              <div className="mono text-secondary">€{low24h > 0 ? low24h.toFixed(4) : '-.----'}</div>
            </div>
            <div className="text-center">
              <div className="text-tertiary mb-0.5">Volume</div>
              <div className="mono text-secondary">{volume24h > 0 ? formatVolume(volume24h) : '-'}</div>
            </div>
          </div>
        </div>
        {/* Spread Warning Bar */}
        {recommendation?.flowStatus?.spreadStatus === 'wide' && (
          <div className="mt-2 px-3 py-1.5 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span>Wide spread detected — entry costs may be higher than normal</span>
          </div>
        )}
        {/* Nearest S/R Levels */}
        {recommendation?.checklist?.keyLevelProximity && (
          <div className="mt-2 flex items-center gap-3 text-xs text-tertiary">
            <span className="text-amber-400/80">S/R:</span>
            <span className="mono">{recommendation.checklist.keyLevelProximity.value}</span>
          </div>
        )}
      </div>

      {/* MTF Analysis */}
      <div className="card p-4">
        <h3 className="text-xs text-tertiary uppercase tracking-wider mb-3 flex items-center gap-2">
          Multi-Timeframe Analysis
          <HelpIcon
            tooltip={
              <div>
                <strong>Multi-Timeframe Analysis</strong>
                <p className="mt-1">Click a timeframe to see its indicators below.</p>
                <p className="mt-2"><strong>4H (40%)</strong> - Trend direction</p>
                <p><strong>1H (30%)</strong> - Setup confirmation</p>
                <p><strong>15m (20%)</strong> - Entry timing</p>
                <p><strong>5m (10%)</strong> - Spike detection</p>
              </div>
            }
            position="right"
          />
        </h3>

        <div className="grid grid-cols-4 gap-3 mb-4">
          {TIMEFRAMES.slice().reverse().map(tf => {
            const ind = tfData[tf.value]?.indicators;
            const rsiSignal = ind ? (ind.rsi < 35 ? '+2' : ind.rsi < 45 ? '+1' : ind.rsi > 65 ? '-2' : ind.rsi > 55 ? '-1' : '0') : '-';
            const macdSignal = ind ? (ind.macd > 0 ? '+1' : ind.macd < 0 ? '-1' : '0') : '-';
            const bbSignal = ind ? (ind.bbPos < 0.3 ? '+1' : ind.bbPos > 0.7 ? '-1' : '0') : '-';

            return (
              <Tooltip
                key={tf.value}
                content={
                  <div className="text-xs">
                    <strong>{tf.label} Bias Score: {ind?.score || 0}</strong>
                    <div className="mt-1 space-y-0.5">
                      <div>RSI {ind?.rsi?.toFixed(0) || '-'}: <span className={rsiSignal.startsWith('+') ? 'text-green-400' : rsiSignal.startsWith('-') ? 'text-red-400' : ''}>{rsiSignal}</span></div>
                      <div>MACD: <span className={macdSignal.startsWith('+') ? 'text-green-400' : macdSignal.startsWith('-') ? 'text-red-400' : ''}>{macdSignal}</span></div>
                      <div>BB% {ind ? (ind.bbPos * 100).toFixed(0) + '%' : '-'}: <span className={bbSignal.startsWith('+') ? 'text-green-400' : bbSignal.startsWith('-') ? 'text-red-400' : ''}>{bbSignal}</span></div>
                    </div>
                  </div>
                }
                position="bottom"
                block
              >
                <button
                  className={`w-full py-3 px-2 rounded-lg text-center transition-all ${
                    displayTf === tf.value ? 'ring-2 ring-blue-500' : ''
                  } ${ind?.bias === 'bullish' ? 'bg-green-500/10 border border-green-500/50' : ind?.bias === 'bearish' ? 'bg-red-500/10 border border-red-500/50' : 'bg-tertiary border border-transparent'}`}
                  onClick={() => setDisplayTf(tf.value)}
                >
                  <div className="text-xs text-tertiary uppercase mb-1">{tf.label}</div>
                  <div className={`font-bold text-sm ${ind?.bias === 'bullish' ? 'text-green-500' : ind?.bias === 'bearish' ? 'text-red-500' : 'text-secondary'}`}>
                    {ind ? getBiasLabel(ind.bias) : '...'}
                  </div>
                  <div className="text-[10px] text-tertiary mt-1 flex justify-center gap-1">
                    <span className={ind && ind.rsi < 45 ? 'text-green-500' : ind && ind.rsi > 55 ? 'text-red-500' : ''}>R{ind?.rsi?.toFixed(0) || '-'}</span>
                    <span className={ind && ind.macd > 0 ? 'text-green-500' : ind && ind.macd < 0 ? 'text-red-500' : ''}>M{ind?.macd && ind.macd > 0 ? '+' : ind?.macd && ind.macd < 0 ? '-' : '0'}</span>
                    <span className={ind && ind.bbPos < 0.3 ? 'text-green-500' : ind && ind.bbPos > 0.7 ? 'text-red-500' : ''}>B{ind ? (ind.bbPos * 100).toFixed(0) : '-'}</span>
                  </div>
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* Current Indicators Row */}
        <div className="border-t border-primary pt-3">
          <div className="text-xs text-tertiary uppercase mb-2">
            {TIMEFRAMES.find(t => t.value === displayTf)?.label} Indicators
          </div>
          <div className="grid grid-cols-6 gap-2">
            {[
              {
                label: 'RSI',
                value: currentIndicators?.rsi?.toFixed(1) || '-',
                signal: currentIndicators ? (currentIndicators.rsi < 35 ? 'Oversold' : currentIndicators.rsi > 65 ? 'Overbought' : 'Neutral') : '-',
                color: currentIndicators ? (currentIndicators.rsi < 35 ? 'text-green-500' : currentIndicators.rsi > 65 ? 'text-red-500' : 'text-secondary') : 'text-secondary',
              },
              {
                label: 'MACD',
                value: currentIndicators ? (currentIndicators.macd * 10000).toFixed(1) : '-',
                signal: currentIndicators ? (currentIndicators.macd > 0 ? 'Bullish' : 'Bearish') : '-',
                color: currentIndicators?.macd && currentIndicators.macd > 0 ? 'text-green-500' : 'text-red-500',
              },
              {
                label: 'BB%',
                value: currentIndicators ? (currentIndicators.bbPos * 100).toFixed(0) + '%' : '-',
                signal: currentIndicators ? (currentIndicators.bbPos < 0.2 ? 'Lower' : currentIndicators.bbPos > 0.8 ? 'Upper' : 'Middle') : '-',
                color: currentIndicators ? (currentIndicators.bbPos < 0.2 ? 'text-green-500' : currentIndicators.bbPos > 0.8 ? 'text-red-500' : 'text-secondary') : 'text-secondary',
              },
              {
                label: 'ATR%',
                value: currentIndicators && price > 0 ? ((currentIndicators.atr / price) * 100).toFixed(2) + '%' : '-',
                signal: currentIndicators && price > 0 && (currentIndicators.atr / price) * 100 > 2 ? 'High Vol' : 'Normal',
                color: currentIndicators && price > 0 && (currentIndicators.atr / price) * 100 > 2 ? 'text-yellow-500' : 'text-secondary',
              },
              {
                label: 'Vol',
                value: currentIndicators?.volRatio ? currentIndicators.volRatio.toFixed(2) + 'x' : '-',
                signal: currentIndicators ? (currentIndicators.volRatio > 1.5 ? 'High' : 'Avg') : '-',
                color: currentIndicators?.volRatio && currentIndicators.volRatio > 1.5 ? 'text-green-500' : 'text-secondary',
              },
              {
                label: 'BTC',
                value: btcChange.toFixed(1) + '%',
                signal: btcTrend === 'bull' ? 'Bullish' : btcTrend === 'bear' ? 'Bearish' : 'Neutral',
                color: btcTrend === 'bull' ? 'text-green-500' : btcTrend === 'bear' ? 'text-red-500' : 'text-secondary',
              },
            ].map((ind, i) => (
              <div key={i} className="bg-tertiary/30 rounded p-2 text-center">
                <div className="text-xs text-tertiary uppercase">{ind.label}</div>
                <div className="mono font-semibold text-sm">{ind.value}</div>
                <div className={`text-xs ${ind.color}`}>{ind.signal}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Candlestick Patterns for selected TF */}
        {currentIndicators?.extendedPatterns && currentIndicators.extendedPatterns.length > 0 && (
          <div className="border-t border-primary pt-3 mt-3">
            <div className="text-xs text-tertiary uppercase mb-2 flex items-center gap-2">
              {TIMEFRAMES.find(t => t.value === displayTf)?.label} Candlestick Patterns
              <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">
                {currentIndicators.extendedPatterns.length}
              </span>
              <HelpIcon tooltip={
                <div className="space-y-1">
                  <div className="font-semibold">Candlestick Patterns</div>
                  <div>Classic price action patterns detected on the last few candles. Hover each pattern for details.</div>
                  <div className="space-y-0.5 text-gray-300">
                    <div><span className="text-white font-medium">Rel (Reliability):</span> How often this pattern correctly predicts the next move historically</div>
                    <div><span className="text-white font-medium">Str (Strength):</span> How strong the current instance is based on candle proportions and context</div>
                  </div>
                  <div className="text-gray-400">Multi-candle patterns (2-3) are more reliable than single-candle patterns.</div>
                </div>
              } />
            </div>
            <div className="space-y-1.5">
              {currentIndicators.extendedPatterns
                .sort((a, b) => (b.reliability * b.strength) - (a.reliability * a.strength))
                .slice(0, 5)
                .map((pattern, i) => {
                  const typeColors: Record<string, { bg: string; text: string; icon: string }> = {
                    reversal_bullish: { bg: 'bg-green-500/10 border-green-500/30', text: 'text-green-400', icon: '↑' },
                    reversal_bearish: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-400', icon: '↓' },
                    continuation_bullish: { bg: 'bg-blue-500/10 border-blue-500/30', text: 'text-blue-400', icon: '→' },
                    continuation_bearish: { bg: 'bg-blue-500/10 border-blue-500/30', text: 'text-blue-400', icon: '→' },
                    indecision: { bg: 'bg-yellow-500/10 border-yellow-500/30', text: 'text-yellow-400', icon: '◆' },
                  };
                  const colors = typeColors[pattern.type] || typeColors.indecision;
                  const reliabilityBar = Math.round(pattern.reliability * 100);
                  const strengthBar = Math.round(pattern.strength * 100);
                  const tooltipText = getCandlestickTooltip(pattern.name, pattern.type);

                  return (
                    <Tooltip
                      key={`${pattern.name}-${i}`}
                      content={<div className="text-xs leading-relaxed">{tooltipText}</div>}
                      position="top"
                      maxWidth="320px"
                      block
                    >
                      <div
                        className={`flex items-center gap-2 p-2 rounded-lg border ${colors.bg} text-xs`}
                      >
                        <span className={`text-base ${colors.text}`}>{colors.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${colors.text} capitalize`}>
                              {pattern.name.replace(/_/g, ' ')}
                            </span>
                            <span className="text-tertiary">
                              {pattern.candlesUsed}-candle
                            </span>
                          </div>
                          <div className="text-tertiary truncate">{pattern.description}</div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <div className="flex items-center gap-1">
                            <span className="text-tertiary">Rel</span>
                            <div className="w-12 h-1.5 bg-tertiary/30 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${reliabilityBar >= 70 ? 'bg-green-500' : reliabilityBar >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                style={{ width: `${reliabilityBar}%` }}
                              />
                            </div>
                            <span className="mono w-7 text-right">{reliabilityBar}%</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-tertiary">Str</span>
                            <div className="w-12 h-1.5 bg-tertiary/30 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${strengthBar >= 70 ? 'bg-green-500' : strengthBar >= 50 ? 'bg-yellow-500' : 'bg-orange-500'}`}
                                style={{ width: `${strengthBar}%` }}
                              />
                            </div>
                            <span className="mono w-7 text-right">{strengthBar}%</span>
                          </div>
                        </div>
                      </div>
                    </Tooltip>
                  );
                })}
            </div>
          </div>
        )}
        {currentIndicators && (!currentIndicators.extendedPatterns || currentIndicators.extendedPatterns.length === 0) && (
          <div className="border-t border-primary pt-3 mt-3">
            <div className="text-xs text-tertiary uppercase mb-2">
              {TIMEFRAMES.find(t => t.value === displayTf)?.label} Candlestick Patterns
            </div>
            <div className="text-xs text-tertiary/60 py-2 text-center">No patterns detected</div>
          </div>
        )}
      </div>

      {/* Candlestick Chart */}
      <CandlestickChart
        data={chartData}
        height={280}
        selectedTimeframe={displayTf}
        onTimeframeChange={setDisplayTf}
      />

      {/* Market Microstructure */}
      <MarketMicrostructure pair="XRP/EUR" onDataChange={handleMicrostructureData} />

      {/* Liquidation Heatmap */}
      <LiquidationHeatmap
        candles={chartData}
        currentPrice={price}
        onAnalysisChange={handleLiquidationData}
      />
    </div>
  );
}

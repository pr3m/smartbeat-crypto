'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Tooltip, HelpIcon } from '@/components/Tooltip';
import type { OHLCData } from '@/lib/kraken/types';
import {
  analyzeLiquidations,
  type LiquidationAnalysis,
  type LiquidationZone,
} from '@/lib/trading/liquidation';
import type { LiquidationApiResponse } from '@/app/api/liquidation/route';
import {
  buildLiquidationHeatmap,
  type LiquidationHeatmap as HeatmapResult,
  type HeatmapZone,
  type HeatmapInput,
} from '@/lib/trading/liquidation-heatmap';

// Shallow comparison for LiquidationAnalysis to prevent unnecessary parent updates
function isAnalysisEqual(a: LiquidationAnalysis | null, b: LiquidationAnalysis | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.bias === b.bias &&
    a.biasStrength === b.biasStrength &&
    a.nearestShortLiquidation === b.nearestShortLiquidation &&
    a.nearestLongLiquidation === b.nearestLongLiquidation &&
    a.fundingRate === b.fundingRate
  );
}

interface LiquidationHeatmapProps {
  candles: OHLCData[];
  currentPrice: number;
  onAnalysisChange?: (analysis: LiquidationAnalysis | null) => void;
  defaultExpanded?: boolean;
}

export function LiquidationHeatmap({ candles, currentPrice, onAnalysisChange, defaultExpanded = false }: LiquidationHeatmapProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [krakenData, setKrakenData] = useState<LiquidationApiResponse | null>(null);
  const [depthData, setDepthData] = useState<HeatmapInput['orderBook'] | null>(null);
  const [tradesData, setTradesData] = useState<HeatmapInput['recentTrades'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all data sources in parallel
  const fetchAllData = useCallback(async () => {
    if (!isExpanded) return;

    setLoading(true);
    setError(null);
    try {
      const [futuresRes, depthRes, tradesRes] = await Promise.allSettled([
        fetch('/api/liquidation'),
        fetch('/api/kraken/public/depth?pair=XXRPZEUR&count=500'),
        fetch('/api/kraken/public/trades?pair=XXRPZEUR'),
      ]);

      // Parse futures
      if (futuresRes.status === 'fulfilled' && futuresRes.value.ok) {
        const data: LiquidationApiResponse = await futuresRes.value.json();
        setKrakenData(data);
      }

      // Parse order book depth
      if (depthRes.status === 'fulfilled' && depthRes.value.ok) {
        try {
          const d = await depthRes.value.json();
          if (d.walls) {
            setDepthData({
              walls: d.walls,
              bidTotalEur: d.bidTotalEur,
              askTotalEur: d.askTotalEur,
              imbalance: d.imbalance,
              timestamp: d.timestamp,
            });
          }
        } catch { /* ignore */ }
      }

      // Parse recent trades
      if (tradesRes.status === 'fulfilled' && tradesRes.value.ok) {
        try {
          const t = await tradesRes.value.json();
          if (t.cascades !== undefined) {
            setTradesData({
              cascades: t.cascades,
              largeTrades: t.largeTrades || [],
              timestamp: t.timestamp,
            });
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      setError('Failed to fetch liquidation data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isExpanded]);

  // Fetch on expand and periodically
  useEffect(() => {
    fetchAllData();
    if (isExpanded) {
      const interval = setInterval(fetchAllData, 60000); // Every minute
      return () => clearInterval(interval);
    }
  }, [isExpanded, fetchAllData]);

  // Legacy analysis (for signal engine callback compatibility)
  const analysis = useMemo(() => {
    if (candles.length < 10 || currentPrice <= 0) return null;
    return analyzeLiquidations(
      candles,
      currentPrice,
      krakenData?.xrp.openInterest,
      krakenData?.xrp.fundingRate
    );
  }, [candles, currentPrice, krakenData?.xrp.openInterest, krakenData?.xrp.fundingRate]);

  // NEW: Composite heatmap from all signal sources
  const heatmap = useMemo<HeatmapResult | null>(() => {
    if (candles.length < 10 || currentPrice <= 0) return null;

    const input: HeatmapInput = {
      pair: 'XXRPZEUR',
      currentPrice,
      ohlcByTimeframe: { 15: candles }, // Primary TF from props
      rangePercent: 15,
    };

    // Add order book walls
    if (depthData) {
      input.orderBook = depthData;
    }

    // Add trade cascades
    if (tradesData) {
      input.recentTrades = tradesData;
    }

    // Add futures data
    if (krakenData) {
      input.futures = {
        xrpFundingRate: krakenData.xrp.fundingRate,
        xrpOpenInterest: krakenData.xrp.openInterest,
        xrpOpenInterestUsd: krakenData.xrp.openInterestUsd,
        btcFundingRate: krakenData.btc.fundingRate,
        marketBias: krakenData.marketBias,
        timestamp: krakenData.timestamp,
      };
    }

    return buildLiquidationHeatmap(input);
  }, [candles, currentPrice, depthData, tradesData, krakenData]);

  // Notify parent (legacy callback for signal engine)
  const prevAnalysisRef = useRef<LiquidationAnalysis | null>(null);
  useEffect(() => {
    if (!isAnalysisEqual(analysis, prevAnalysisRef.current)) {
      prevAnalysisRef.current = analysis;
      onAnalysisChange?.(analysis);
    }
  }, [analysis, onAnalysisChange]);

  const handleToggle = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  // Format numbers
  const formatPrice = (price: number) => price < 10 ? price.toFixed(4) : price.toFixed(2);
  const formatNumber = (num: number) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toFixed(0);
  };
  const formatPercent = (num: number) => `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;

  // Score color gradient
  const getScoreColor = (score: number, type: 'long_liquidation' | 'short_liquidation') => {
    const intensity = Math.min(1, score / 80); // Normalize to 0-1
    if (type === 'short_liquidation') {
      // Green = bullish fuel (short liq above)
      return `rgba(34, 197, 94, ${0.15 + intensity * 0.65})`;
    }
    // Red = bearish fuel (long liq below)
    return `rgba(239, 68, 68, ${0.15 + intensity * 0.65})`;
  };

  const getScoreTextColor = (score: number) => {
    if (score >= 60) return 'text-primary font-bold';
    if (score >= 40) return 'text-secondary font-semibold';
    return 'text-tertiary';
  };

  // Signal source icons
  const signalSourceIcon = (source: string) => {
    switch (source) {
      case 'volume_profile': return 'VP';
      case 'order_book_wall': return 'OB';
      case 'round_number': return 'RN';
      case 'oi_funding_bias': return 'OI';
      case 'cascade_scar': return 'CS';
      case 'atr_leverage_map': return 'ATR';
      case 'multi_tf_confluence': return 'MTF';
      case 'swing_level': return 'SL';
      default: return '?';
    }
  };

  // Render a heatmap zone bar
  const renderHeatmapZone = (zone: HeatmapZone, maxScore: number) => {
    const barWidth = Math.max(8, (zone.score / maxScore) * 100);
    const isAbove = zone.type === 'short_liquidation';

    // Group signals by source
    const signalSources = [...new Set(zone.signals.map(s => s.source))];

    return (
      <Tooltip
        key={`${zone.priceFrom}-${zone.type}`}
        content={
          <div className="text-xs max-w-xs">
            <p className="font-bold mb-1">
              €{formatPrice(zone.priceFrom)} – €{formatPrice(zone.priceTo)}
            </p>
            <p><strong>Score:</strong> {zone.score}/100</p>
            <p><strong>Distance:</strong> {Math.abs(zone.distancePercent).toFixed(1)}% {isAbove ? 'above' : 'below'}</p>
            <p><strong>Type:</strong> {isAbove ? 'Short liq (bullish fuel)' : 'Long liq (bearish fuel)'}</p>
            {zone.dominantLeverages.length > 0 && (
              <p><strong>Leverage tiers:</strong> {zone.dominantLeverages.map(l => `${l}x`).join(', ')}</p>
            )}
            {zone.recentlySweep && (
              <p className="text-yellow-400 mt-1">Partially swept by recent cascade</p>
            )}
            {zone.estimatedValueAtRisk && (
              <p><strong>Est. value at risk:</strong> €{formatNumber(zone.estimatedValueAtRisk)}</p>
            )}
            <div className="mt-2 border-t border-secondary/20 pt-1">
              <p className="font-semibold mb-0.5">Contributing signals:</p>
              {zone.signals.slice(0, 6).map((s, i) => (
                <p key={i} className="text-tertiary">
                  <span className="text-secondary">[{signalSourceIcon(s.source)}]</span> {s.detail}
                </p>
              ))}
              {zone.signals.length > 6 && (
                <p className="text-tertiary">+{zone.signals.length - 6} more signals</p>
              )}
            </div>
          </div>
        }
        position="left"
        block
      >
        <div className="flex items-center gap-1.5 py-[3px] cursor-help group hover:bg-tertiary/20 rounded px-1 -mx-1 transition-colors">
          {/* Price label */}
          <span className="text-xs mono w-[4.5rem] text-right text-secondary shrink-0">
            €{formatPrice(zone.priceMid)}
          </span>

          {/* Score bar */}
          <div className="flex-1 h-4 bg-primary rounded overflow-hidden relative">
            <div
              className="h-full transition-all duration-300 rounded"
              style={{
                width: `${barWidth}%`,
                backgroundColor: getScoreColor(zone.score, zone.type),
              }}
            />
            {/* Signal source badges inside bar */}
            {zone.score >= 25 && (
              <div className="absolute inset-0 flex items-center px-1 gap-0.5">
                {signalSources.slice(0, 4).map(src => (
                  <span
                    key={src}
                    className="text-[8px] font-bold bg-black/40 text-white/80 rounded px-0.5 leading-tight"
                  >
                    {signalSourceIcon(src)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Score */}
          <span className={`text-xs mono w-8 text-right shrink-0 ${getScoreTextColor(zone.score)}`}>
            {zone.score.toFixed(0)}
          </span>

          {/* Distance */}
          <span className="text-xs text-tertiary w-12 text-right shrink-0">
            {Math.abs(zone.distancePercent).toFixed(1)}%
          </span>

          {/* Sweep indicator */}
          {zone.recentlySweep && (
            <span className="text-yellow-500 text-[10px] shrink-0" title="Recently swept">
              ~
            </span>
          )}
        </div>
      </Tooltip>
    );
  };

  // Get bias color
  const getBiasColor = (bias: string) => {
    if (bias === 'short_squeeze') return 'text-green-500';
    if (bias === 'long_squeeze') return 'text-red-500';
    return 'text-secondary';
  };

  const getMarketBiasColor = (direction: string) => {
    if (direction === 'bullish') return 'text-green-500';
    if (direction === 'bearish') return 'text-red-500';
    return 'text-secondary';
  };

  const getSweepRiskColor = (risk: string) => {
    if (risk === 'high') return 'text-red-500';
    if (risk === 'medium') return 'text-yellow-500';
    return 'text-green-500';
  };

  // Max score for scaling bars
  const maxScore = heatmap
    ? Math.max(
        ...heatmap.aboveZones.map(z => z.score),
        ...heatmap.belowZones.map(z => z.score),
        10
      )
    : 100;

  // Data source indicators
  const dataSources = {
    volumeProfile: candles.length >= 10,
    orderBook: !!depthData,
    trades: !!tradesData,
    futures: !!krakenData,
  };
  const sourceCount = Object.values(dataSources).filter(Boolean).length;

  return (
    <div className="card overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={handleToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-tertiary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-xs text-tertiary uppercase tracking-wider flex items-center gap-2">
            Liquidation Heatmap
            <HelpIcon
              tooltip={
                <div className="max-w-xs">
                  <strong>Composite Liquidation Heatmap</strong>
                  <p className="mt-1">Estimates where leveraged positions are clustered using 8 signal sources:</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    <li><span className="text-secondary">[VP]</span> Volume Profile — entry clusters</li>
                    <li><span className="text-secondary">[OB]</span> Order Book — visible liquidity walls</li>
                    <li><span className="text-secondary">[RN]</span> Round Numbers — psychological levels</li>
                    <li><span className="text-secondary">[OI]</span> OI + Funding — directional crowding</li>
                    <li><span className="text-secondary">[CS]</span> Cascades — past liquidation scars</li>
                    <li><span className="text-secondary">[ATR]</span> Volatility — reachability estimate</li>
                    <li><span className="text-secondary">[MTF]</span> Multi-TF — cross-timeframe confirmation</li>
                    <li><span className="text-secondary">[SL]</span> Swing Levels — structural levels</li>
                  </ul>
                  <p className="mt-2 text-tertiary">Score 0-100 = probability of liquidation cluster. Price magnets toward high-score zones.</p>
                </div>
              }
              position="right"
            />
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {!isExpanded && heatmap && (
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${
                heatmap.magnetDirection === 'up' ? 'text-green-500' :
                heatmap.magnetDirection === 'down' ? 'text-red-500' : 'text-secondary'
              }`}>
                {heatmap.magnetDirection === 'up' ? '↑ Magnet Up' :
                 heatmap.magnetDirection === 'down' ? '↓ Magnet Down' : '— Balanced'}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                heatmap.sweepRisk === 'high' ? 'bg-red-500/20 text-red-400' :
                heatmap.sweepRisk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-green-500/20 text-green-400'
              }`}>
                {heatmap.sweepRisk}
              </span>
            </div>
          )}
          {!isExpanded && !heatmap && analysis && (
            <span className={`text-xs font-semibold ${getBiasColor(analysis.bias)}`}>
              {analysis.bias === 'short_squeeze' ? '↑ Short Squeeze' :
               analysis.bias === 'long_squeeze' ? '↓ Long Squeeze' : '— Neutral'}
            </span>
          )}
          <svg
            className={`w-5 h-5 text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-4 pt-0 space-y-4">
          {error && (
            <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Data Source Indicators */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-tertiary mr-1">Sources ({sourceCount}/4):</span>
            {[
              { key: 'volumeProfile', label: 'Volume Profile', active: dataSources.volumeProfile },
              { key: 'orderBook', label: 'Order Book', active: dataSources.orderBook },
              { key: 'trades', label: 'Trade Flow', active: dataSources.trades },
              { key: 'futures', label: 'Futures', active: dataSources.futures },
            ].map(src => (
              <span
                key={src.key}
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  src.active
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-tertiary/20 text-tertiary border border-transparent'
                }`}
              >
                {src.label}
              </span>
            ))}
          </div>

          {/* Kraken Futures Metrics Row */}
          {krakenData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Tooltip
                content={
                  <div className="max-w-xs">
                    <strong>XRP Funding Rate</strong>
                    <p className="mt-1">
                      {krakenData.xrp.fundingRate > 0
                        ? 'Positive = Longs pay shorts. Market is long-heavy.'
                        : 'Negative = Shorts pay longs. Market is short-heavy.'}
                    </p>
                    <p className="mt-1 text-tertiary">
                      Annualized: {krakenData.xrp.fundingAnnualized.toFixed(1)}% APR
                    </p>
                  </div>
                }
                position="bottom"
                block
              >
                <div className="p-2 bg-tertiary/30 rounded text-center cursor-help">
                  <div className="text-xs text-tertiary">XRP Funding</div>
                  <div className={`text-sm font-bold ${
                    krakenData.xrp.fundingRate > 0.0001 ? 'text-red-500' :
                    krakenData.xrp.fundingRate < -0.0001 ? 'text-green-500' : 'text-secondary'
                  }`}>
                    {formatPercent(krakenData.xrp.fundingRate * 100)}
                  </div>
                </div>
              </Tooltip>

              <Tooltip
                content={
                  <div className="max-w-xs">
                    <strong>XRP Open Interest</strong>
                    <p className="mt-1">Total outstanding perpetual futures on Kraken.</p>
                    <p className="mt-1 text-tertiary">${formatNumber(krakenData.xrp.openInterestUsd)} USD</p>
                  </div>
                }
                position="bottom"
                block
              >
                <div className="p-2 bg-tertiary/30 rounded text-center cursor-help">
                  <div className="text-xs text-tertiary">XRP OI</div>
                  <div className="text-sm font-bold text-secondary">
                    {formatNumber(krakenData.xrp.openInterest)} XRP
                  </div>
                </div>
              </Tooltip>

              <Tooltip
                content={
                  <div className="max-w-xs">
                    <strong>BTC Funding (Market Indicator)</strong>
                    <p className="mt-1">{krakenData.marketBias.reason}</p>
                  </div>
                }
                position="bottom"
                block
              >
                <div className={`p-2 rounded text-center cursor-help ${
                  krakenData.marketBias.direction === 'bullish' ? 'bg-green-500/20 border border-green-500/30' :
                  krakenData.marketBias.direction === 'bearish' ? 'bg-red-500/20 border border-red-500/30' :
                  'bg-tertiary/30'
                }`}>
                  <div className="text-xs text-tertiary">BTC Funding</div>
                  <div className={`text-sm font-bold ${getMarketBiasColor(krakenData.marketBias.direction)}`}>
                    {krakenData.btc.fundingAnnualized.toFixed(0)}% APR
                  </div>
                </div>
              </Tooltip>

              <Tooltip
                content={
                  <div className="max-w-xs">
                    <strong>Market Leverage Bias</strong>
                    <p className="mt-1">{krakenData.marketBias.reason}</p>
                    <p className="mt-1 text-tertiary">Strength: {(krakenData.marketBias.strength * 100).toFixed(0)}%</p>
                  </div>
                }
                position="bottom"
                block
              >
                <div className={`p-2 rounded text-center cursor-help ${
                  krakenData.marketBias.direction === 'bullish' ? 'bg-green-500/20 border border-green-500/30' :
                  krakenData.marketBias.direction === 'bearish' ? 'bg-red-500/20 border border-red-500/30' :
                  'bg-tertiary/30'
                }`}>
                  <div className="text-xs text-tertiary">Market Bias</div>
                  <div className={`text-sm font-bold ${getMarketBiasColor(krakenData.marketBias.direction)}`}>
                    {krakenData.marketBias.direction === 'bullish' ? '↑ Bullish' :
                     krakenData.marketBias.direction === 'bearish' ? '↓ Bearish' : '— Neutral'}
                  </div>
                </div>
              </Tooltip>
            </div>
          )}

          {loading && !heatmap && (
            <div className="text-center text-secondary text-sm py-4">
              Loading liquidation data...
            </div>
          )}

          {/* === COMPOSITE HEATMAP VISUALIZATION === */}
          {heatmap && (
            <div className="space-y-3">
              {/* Header row: score legend */}
              <div className="flex items-center justify-between text-[10px] text-tertiary px-1">
                <span>Price Level</span>
                <div className="flex items-center gap-3">
                  <span>Score</span>
                  <span>Dist</span>
                </div>
              </div>

              {/* Short liquidations (above price) — bullish fuel */}
              <div>
                <div className="text-xs text-tertiary mb-1 flex items-center gap-2">
                  <span className="text-green-500 font-medium">Short Liquidations</span>
                  <span className="text-secondary">(above price — bullish fuel)</span>
                  <span className="text-tertiary">({heatmap.aboveZones.length} zones)</span>
                </div>
                <div className="space-y-0 max-h-40 overflow-y-auto">
                  {heatmap.aboveZones.length > 0 ? (
                    heatmap.aboveZones
                      .slice(0, 10)
                      .map(zone => renderHeatmapZone(zone, maxScore))
                  ) : (
                    <div className="text-xs text-tertiary py-2">No significant short liquidation zones</div>
                  )}
                </div>
              </div>

              {/* Current Price Divider */}
              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-blue-500" />
                <span className="text-xs font-bold text-blue-500">
                  Current: €{formatPrice(currentPrice)}
                </span>
                <div className="flex-1 h-px bg-blue-500" />
              </div>

              {/* Long liquidations (below price) — bearish fuel */}
              <div>
                <div className="text-xs text-tertiary mb-1 flex items-center gap-2">
                  <span className="text-red-500 font-medium">Long Liquidations</span>
                  <span className="text-secondary">(below price — bearish fuel)</span>
                  <span className="text-tertiary">({heatmap.belowZones.length} zones)</span>
                </div>
                <div className="space-y-0 max-h-40 overflow-y-auto">
                  {heatmap.belowZones.length > 0 ? (
                    heatmap.belowZones
                      .slice(0, 10)
                      .map(zone => renderHeatmapZone(zone, maxScore))
                  ) : (
                    <div className="text-xs text-tertiary py-2">No significant long liquidation zones</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* === SUMMARY PANEL === */}
          {heatmap && (
            <div className={`p-3 rounded border ${
              heatmap.magnetDirection === 'up'
                ? 'bg-green-500/10 border-green-500/40'
                : heatmap.magnetDirection === 'down'
                ? 'bg-red-500/10 border-red-500/40'
                : 'bg-tertiary/20 border-secondary/30'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs text-tertiary">Magnet Direction</div>
                  <div className={`text-lg font-bold ${
                    heatmap.magnetDirection === 'up' ? 'text-green-500' :
                    heatmap.magnetDirection === 'down' ? 'text-red-500' : 'text-secondary'
                  }`}>
                    {heatmap.magnetDirection === 'up' ? '↑ Price Pulled Up' :
                     heatmap.magnetDirection === 'down' ? '↓ Price Pulled Down' : '— Balanced'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-tertiary">Sweep Risk</div>
                  <div className={`text-lg font-bold ${getSweepRiskColor(heatmap.sweepRisk)}`}>
                    {heatmap.sweepRisk.toUpperCase()}
                  </div>
                </div>
              </div>

              {/* Top magnets */}
              {heatmap.topMagnets.length > 0 && (
                <div className="mt-2 pt-2 border-t border-secondary/20">
                  <div className="text-[10px] text-tertiary uppercase tracking-wider mb-1">Top Magnet Zones</div>
                  <div className="grid grid-cols-3 gap-2">
                    {heatmap.topMagnets.map((mag, i) => (
                      <Tooltip
                        key={i}
                        content={
                          <div className="text-xs">
                            <p><strong>Score:</strong> {mag.score}/100</p>
                            <p><strong>Type:</strong> {mag.type === 'short_liquidation' ? 'Short liq (bullish)' : 'Long liq (bearish)'}</p>
                            <p><strong>Signals:</strong> {mag.signals.length}</p>
                            {mag.dominantLeverages.length > 0 && (
                              <p><strong>Leverages:</strong> {mag.dominantLeverages.map(l => `${l}x`).join(', ')}</p>
                            )}
                          </div>
                        }
                        position="top"
                        block
                      >
                        <div className={`text-center p-1.5 rounded cursor-help ${
                          mag.type === 'short_liquidation' ? 'bg-green-500/15' : 'bg-red-500/15'
                        }`}>
                          <div className="text-[10px] text-tertiary">#{i + 1}</div>
                          <div className={`text-xs font-bold ${
                            mag.type === 'short_liquidation' ? 'text-green-400' : 'text-red-400'
                          }`}>
                            €{formatPrice(mag.priceMid)}
                          </div>
                          <div className="text-[10px] text-secondary">
                            {mag.score} pts · {Math.abs(mag.distancePercent).toFixed(1)}%
                          </div>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}

              {/* Asymmetry ratio */}
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-tertiary">Asymmetry:</span>
                <span className={`font-medium ${
                  heatmap.asymmetryRatio > 1.5 ? 'text-green-500' :
                  heatmap.asymmetryRatio < 0.67 ? 'text-red-500' : 'text-secondary'
                }`}>
                  {heatmap.asymmetryRatio > 1.5 ? 'More fuel above (bullish)' :
                   heatmap.asymmetryRatio < 0.67 ? 'More fuel below (bearish)' :
                   'Balanced'}
                  {' '}({heatmap.asymmetryRatio.toFixed(2)}x)
                </span>
              </div>

              {/* Cascade detection summary */}
              {tradesData && tradesData.cascades.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-yellow-500">~</span>
                  <span className="text-tertiary">
                    {tradesData.cascades.length} recent cascade{tradesData.cascades.length > 1 ? 's' : ''} detected
                    {' '}({tradesData.cascades.filter(c => c.side === 'sell').length} sell, {tradesData.cascades.filter(c => c.side === 'buy').length} buy)
                  </span>
                </div>
              )}

              {/* Order book imbalance */}
              {depthData && (
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="text-tertiary">Book imbalance:</span>
                  <span className={`font-medium ${
                    depthData.imbalance > 0.15 ? 'text-green-500' :
                    depthData.imbalance < -0.15 ? 'text-red-500' : 'text-secondary'
                  }`}>
                    {depthData.imbalance > 0.15 ? 'Bid heavy' :
                     depthData.imbalance < -0.15 ? 'Ask heavy' : 'Balanced'}
                    {' '}({(depthData.imbalance * 100).toFixed(1)}%)
                  </span>
                  <span className="text-tertiary">
                    · {depthData.walls.length} wall{depthData.walls.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

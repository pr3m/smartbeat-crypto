'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Tooltip, HelpIcon } from '@/components/Tooltip';
import type { OHLCData } from '@/lib/kraken/types';
import {
  analyzeLiquidations,
  type LiquidationAnalysis,
  type LiquidationZone,
} from '@/lib/trading/liquidation';
import type { LiquidationApiResponse } from '@/app/api/liquidation/route';

interface LiquidationHeatmapProps {
  candles: OHLCData[];
  currentPrice: number;
  onAnalysisChange?: (analysis: LiquidationAnalysis | null) => void;
  defaultExpanded?: boolean;
}

export function LiquidationHeatmap({ candles, currentPrice, onAnalysisChange, defaultExpanded = false }: LiquidationHeatmapProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [krakenData, setKrakenData] = useState<LiquidationApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch Kraken Futures data
  const fetchKrakenData = useCallback(async () => {
    if (!isExpanded) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/liquidation');
      if (!response.ok) throw new Error('Failed to fetch');
      const data: LiquidationApiResponse = await response.json();
      setKrakenData(data);
    } catch (err) {
      setError('Failed to fetch liquidation data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isExpanded]);

  // Fetch on expand and periodically
  useEffect(() => {
    fetchKrakenData();
    if (isExpanded) {
      const interval = setInterval(fetchKrakenData, 60000); // Every minute
      return () => clearInterval(interval);
    }
  }, [isExpanded, fetchKrakenData]);

  // Analyze liquidation levels
  const analysis = useMemo(() => {
    if (candles.length < 10 || currentPrice <= 0) return null;

    return analyzeLiquidations(
      candles,
      currentPrice,
      krakenData?.xrp.openInterest,
      krakenData?.xrp.fundingRate
    );
  }, [candles, currentPrice, krakenData?.xrp.openInterest, krakenData?.xrp.fundingRate]);

  // Notify parent
  useEffect(() => {
    onAnalysisChange?.(analysis);
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

  // Render zone bar
  const renderZoneBar = (zone: LiquidationZone, maxStrength: number, isShort: boolean) => {
    const width = Math.max(10, (zone.totalStrength / maxStrength) * 100);
    const distancePercent = isShort
      ? ((zone.priceFrom - currentPrice) / currentPrice) * 100
      : ((currentPrice - zone.priceFrom) / currentPrice) * 100;

    return (
      <Tooltip
        key={zone.priceFrom}
        content={
          <div className="text-xs">
            <p><strong>Price:</strong> €{formatPrice(zone.priceFrom)}</p>
            <p><strong>Distance:</strong> {distancePercent.toFixed(1)}%</p>
            <p><strong>Type:</strong> {isShort ? 'Short' : 'Long'} liquidations</p>
            <p><strong>Strength:</strong> {(zone.totalStrength * 100).toFixed(0)}%</p>
            <p className="mt-1 text-tertiary">
              {isShort
                ? 'Shorts liquidate here if price rises. Acts as fuel for upward move.'
                : 'Longs liquidate here if price drops. Acts as fuel for downward move.'}
            </p>
          </div>
        }
        position="left"
        block
      >
        <div className="flex items-center gap-2 py-0.5 cursor-help">
          <span className="text-xs mono w-16 text-right text-secondary">
            €{formatPrice(zone.priceFrom)}
          </span>
          <div className="flex-1 h-3 bg-primary rounded overflow-hidden">
            <div
              className={`h-full transition-all ${
                isShort ? 'bg-green-500/60' : 'bg-red-500/60'
              }`}
              style={{ width: `${width}%` }}
            />
          </div>
          <span className="text-xs text-tertiary w-12">
            {distancePercent.toFixed(1)}%
          </span>
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

  // Max strength for scaling
  const maxStrength = analysis
    ? Math.max(
        ...analysis.shortLiquidationZones.map(z => z.totalStrength),
        ...analysis.longLiquidationZones.map(z => z.totalStrength),
        0.1
      )
    : 1;

  return (
    <div className="card overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={handleToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-tertiary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-xs text-tertiary uppercase tracking-wider flex items-center gap-2">
            Liquidation Analysis
            <HelpIcon
              tooltip={
                <div className="max-w-xs">
                  <strong>Liquidation Heatmap</strong>
                  <p className="mt-1">Estimates where leveraged positions would be liquidated based on price action.</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    <li><span className="text-green-500">Green bars (above)</span>: Short liquidations - bullish fuel</li>
                    <li><span className="text-red-500">Red bars (below)</span>: Long liquidations - bearish fuel</li>
                    <li><strong>Funding Rate:</strong> Positive = longs pay shorts (crowded long)</li>
                  </ul>
                  <p className="mt-2 text-tertiary">Price tends to move toward liquidation clusters.</p>
                </div>
              }
              position="right"
            />
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {!isExpanded && analysis && (
            <span className={`text-xs font-semibold ${getBiasColor(analysis.bias)}`}>
              {analysis.bias === 'short_squeeze'
                ? '↑ Short Squeeze'
                : analysis.bias === 'long_squeeze'
                ? '↓ Long Squeeze'
                : '— Neutral'}
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

          {/* Kraken Futures Data */}
          {krakenData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {/* XRP Funding Rate */}
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

              {/* XRP Open Interest */}
              <Tooltip
                content={
                  <div className="max-w-xs">
                    <strong>XRP Open Interest</strong>
                    <p className="mt-1">Total value of outstanding perpetual futures contracts on Kraken.</p>
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

              {/* BTC Funding (Market Indicator) */}
              <Tooltip
                content={
                  <div className="max-w-xs">
                    <strong>BTC Funding (Market Indicator)</strong>
                    <p className="mt-1">{krakenData.marketBias.reason}</p>
                    <p className="mt-1 text-tertiary">
                      BTC funding indicates overall market leverage positioning.
                    </p>
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

              {/* Market Bias */}
              <Tooltip
                content={
                  <div className="max-w-xs">
                    <strong>Market Leverage Bias</strong>
                    <p className="mt-1">{krakenData.marketBias.reason}</p>
                    <p className="mt-1 text-tertiary">
                      Strength: {(krakenData.marketBias.strength * 100).toFixed(0)}%
                    </p>
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

          {loading && !analysis && (
            <div className="text-center text-secondary text-sm py-4">
              Loading liquidation data...
            </div>
          )}

          {/* Liquidation Heatmap Visualization */}
          {analysis && (
            <div className="space-y-3">
              {/* Short liquidations (above price) */}
              <div>
                <div className="text-xs text-tertiary mb-1 flex items-center gap-2">
                  <span className="text-green-500">Short Liquidations</span>
                  <span className="text-secondary">(above price - bullish fuel)</span>
                </div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {analysis.shortLiquidationZones.length > 0 ? (
                    analysis.shortLiquidationZones
                      .slice(0, 8)
                      .map(zone => renderZoneBar(zone, maxStrength, true))
                  ) : (
                    <div className="text-xs text-tertiary py-2">No significant short liquidation zones detected</div>
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

              {/* Long liquidations (below price) */}
              <div>
                <div className="text-xs text-tertiary mb-1 flex items-center gap-2">
                  <span className="text-red-500">Long Liquidations</span>
                  <span className="text-secondary">(below price - bearish fuel)</span>
                </div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {analysis.longLiquidationZones.length > 0 ? (
                    analysis.longLiquidationZones
                      .slice(0, 8)
                      .map(zone => renderZoneBar(zone, maxStrength, false))
                  ) : (
                    <div className="text-xs text-tertiary py-2">No significant long liquidation zones detected</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Analysis Summary */}
          {analysis && (
            <Tooltip
              content={
                <div className="max-w-xs">
                  <strong>Liquidation Bias Analysis</strong>
                  <p className="mt-1">
                    {analysis.bias === 'short_squeeze'
                      ? 'More short liquidations stacked above. Price has upward magnet - shorts will add buying pressure if price rises.'
                      : analysis.bias === 'long_squeeze'
                      ? 'More long liquidations stacked below. Price has downward magnet - longs will add selling pressure if price drops.'
                      : 'Balanced liquidation levels. No clear directional bias from liquidation structure.'}
                  </p>
                  <p className="mt-1 text-tertiary">
                    Strength: {(analysis.biasStrength * 100).toFixed(0)}%
                  </p>
                </div>
              }
              position="top"
              block
            >
              <div className={`p-3 rounded text-center cursor-help ${
                analysis.bias === 'short_squeeze' ? 'bg-green-500/20 border border-green-500/50' :
                analysis.bias === 'long_squeeze' ? 'bg-red-500/20 border border-red-500/50' :
                'bg-tertiary/30'
              }`}>
                <div className="text-xs text-tertiary">Liquidation Bias</div>
                <div className={`text-lg font-bold ${getBiasColor(analysis.bias)}`}>
                  {analysis.bias === 'short_squeeze'
                    ? '↑ Short Squeeze Potential'
                    : analysis.bias === 'long_squeeze'
                    ? '↓ Long Squeeze Potential'
                    : '— Neutral'}
                </div>
                <div className="text-xs text-secondary mt-1">
                  {analysis.nearestShortLiquidation && (
                    <span className="text-green-500 mr-3">
                      Target ↑: €{formatPrice(analysis.nearestShortLiquidation)}
                    </span>
                  )}
                  {analysis.nearestLongLiquidation && (
                    <span className="text-red-500">
                      Target ↓: €{formatPrice(analysis.nearestLongLiquidation)}
                    </span>
                  )}
                </div>
              </div>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

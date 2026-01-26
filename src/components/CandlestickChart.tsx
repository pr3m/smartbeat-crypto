'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData, UTCTimestamp } from 'lightweight-charts';
import type { OHLCData } from '@/lib/kraken/types';

interface CandlestickChartProps {
  data: OHLCData[];
  height?: number;
  onTimeframeChange?: (tf: number) => void;
  selectedTimeframe?: number;
}

const TIMEFRAMES = [
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 60, label: '1H' },
  { value: 240, label: '4H' },
];

// Indicator calculation helpers (full series)
function calculateSMASeries(closes: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calculateEMASeries(data: number[], period: number): number[] {
  if (data.length < period) return data.map(() => NaN);

  const multiplier = 2 / (period + 1);
  const emaValues: number[] = new Array(period - 1).fill(NaN);

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  emaValues.push(sum / period);

  for (let i = period; i < data.length; i++) {
    emaValues.push((data[i] - emaValues[i - 1]) * multiplier + emaValues[i - 1]);
  }

  return emaValues;
}

function calculateBollingerBandsSeries(closes: number[], period = 20, stdDevMultiplier = 2) {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const sma = slice.reduce((a, b) => a + b, 0) / period;
      const squaredDiffs = slice.map(p => Math.pow(p - sma, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
      const stdDev = Math.sqrt(variance);

      middle.push(sma);
      upper.push(sma + stdDevMultiplier * stdDev);
      lower.push(sma - stdDevMultiplier * stdDev);
    }
  }

  return { upper, middle, lower };
}

function calculateRSISeries(closes: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(NaN);
  if (closes.length < period + 1) return closes.map(() => NaN);

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }

  return result;
}

function calculateMACDSeries(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast = calculateEMASeries(closes, fastPeriod);
  const emaSlow = calculateEMASeries(closes, slowPeriod);

  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(emaFast[i]) || isNaN(emaSlow[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(emaFast[i] - emaSlow[i]);
    }
  }

  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalEma = calculateEMASeries(validMacd, signalPeriod);

  const signalLine: number[] = [];
  let signalIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i])) {
      signalLine.push(NaN);
    } else {
      signalLine.push(signalEma[signalIdx] || NaN);
      signalIdx++;
    }
  }

  const histogram: number[] = macdLine.map((m, i) =>
    isNaN(m) || isNaN(signalLine[i]) ? NaN : m - signalLine[i]
  );

  return { macdLine, signalLine, histogram };
}

function calculateATRSeries(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const result: number[] = [NaN];
  if (highs.length < period + 1) return highs.map(() => NaN);

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  for (let i = 0; i < period - 1; i++) {
    result.push(NaN);
  }

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }

  return result;
}

type IndicatorVisibility = {
  bollingerBands: boolean;
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  rsi: boolean;
  macd: boolean;
  atr: boolean;
};

export function CandlestickChart({
  data,
  height = 300,
  onTimeframeChange,
  selectedTimeframe = 15,
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const atrContainerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const atrChartRef = useRef<IChartApi | null>(null);

  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma200Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistogramRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const atrSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);
  const [indicators, setIndicators] = useState<IndicatorVisibility>({
    bollingerBands: true,
    sma20: false,
    sma50: true,
    sma200: true,
    rsi: true,
    macd: true,
    atr: false,
  });

  // Calculate heights dynamically based on visible indicators
  const visibleIndicatorCount = [indicators.rsi, indicators.macd, indicators.atr].filter(Boolean).length;
  const headerHeight = 100; // Header + indicator toggles + labels
  const indicatorLabelHeight = 24; // Label above each indicator panel

  const getHeights = () => {
    if (!isFullscreen) {
      return { chartHeight: height, indicatorHeight: 80 };
    }

    const availableHeight = windowHeight - headerHeight - (visibleIndicatorCount * indicatorLabelHeight);

    if (visibleIndicatorCount === 0) {
      return { chartHeight: availableHeight, indicatorHeight: 0 };
    }

    // Give main chart 60% of space, divide rest among indicators
    const mainChartRatio = 0.6;
    const chartHeight = Math.floor(availableHeight * mainChartRatio);
    const indicatorHeight = Math.floor((availableHeight * (1 - mainChartRatio)) / visibleIndicatorCount);

    return { chartHeight, indicatorHeight };
  };

  const { chartHeight, indicatorHeight } = getHeights();

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      fullscreenRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      if (isFs) {
        setWindowHeight(window.innerHeight);
      }
    };
    const handleResize = () => {
      if (isFullscreen) {
        setWindowHeight(window.innerHeight);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('resize', handleResize);
    };
  }, [isFullscreen]);

  // Initialize charts
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: '#161b22' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#58a6ff', width: 1 as const, style: 2 as const, labelBackgroundColor: '#58a6ff' },
        horzLine: { color: '#58a6ff', width: 1 as const, style: 2 as const, labelBackgroundColor: '#58a6ff' },
      },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
    };

    // Main chart
    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
      width: chartContainerRef.current.clientWidth,
      height: chartHeight,
      rightPriceScale: { ...chartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.2 } },
    });
    chartRef.current = chart;

    // Candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });
    candlestickSeriesRef.current = candlestickSeries;

    // Volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#58a6ff',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    // Bollinger Bands
    const bbUpper = chart.addSeries(LineSeries, { color: 'rgba(33, 150, 243, 0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbMiddle = chart.addSeries(LineSeries, { color: 'rgba(33, 150, 243, 0.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbLower = chart.addSeries(LineSeries, { color: 'rgba(33, 150, 243, 0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    bbUpperRef.current = bbUpper;
    bbMiddleRef.current = bbMiddle;
    bbLowerRef.current = bbLower;

    // Moving Averages
    const sma20 = chart.addSeries(LineSeries, { color: '#f7931a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const sma50 = chart.addSeries(LineSeries, { color: '#9c27b0', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const sma200 = chart.addSeries(LineSeries, { color: '#e91e63', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    sma20Ref.current = sma20;
    sma50Ref.current = sma50;
    sma200Ref.current = sma200;

    // RSI Chart
    if (rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        ...chartOptions,
        width: rsiContainerRef.current.clientWidth,
        height: indicatorHeight,
        rightPriceScale: { ...chartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
      });
      rsiChartRef.current = rsiChart;

      const rsiSeries = rsiChart.addSeries(LineSeries, { color: '#f7931a', lineWidth: 2, priceLineVisible: false });
      rsiSeriesRef.current = rsiSeries;

      // Add RSI levels (30 and 70)
      rsiSeries.createPriceLine({ price: 70, color: 'rgba(248, 81, 73, 0.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
      rsiSeries.createPriceLine({ price: 30, color: 'rgba(63, 185, 80, 0.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
      rsiSeries.createPriceLine({ price: 50, color: 'rgba(139, 148, 158, 0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    }

    // MACD Chart
    if (macdContainerRef.current) {
      const macdChart = createChart(macdContainerRef.current, {
        ...chartOptions,
        width: macdContainerRef.current.clientWidth,
        height: indicatorHeight,
        rightPriceScale: { ...chartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
      });
      macdChartRef.current = macdChart;

      const macdHistogram = macdChart.addSeries(HistogramSeries, { color: '#26a69a', priceFormat: { type: 'price' }, priceLineVisible: false });
      const macdLine = macdChart.addSeries(LineSeries, { color: '#2196f3', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      const macdSignal = macdChart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      macdHistogramRef.current = macdHistogram;
      macdLineRef.current = macdLine;
      macdSignalRef.current = macdSignal;

      // Zero line
      macdLine.createPriceLine({ price: 0, color: 'rgba(139, 148, 158, 0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    }

    // ATR Chart
    if (atrContainerRef.current) {
      const atrChart = createChart(atrContainerRef.current, {
        ...chartOptions,
        width: atrContainerRef.current.clientWidth,
        height: indicatorHeight,
        rightPriceScale: { ...chartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
      });
      atrChartRef.current = atrChart;

      const atrSeries = atrChart.addSeries(LineSeries, { color: '#00bcd4', lineWidth: 2, priceLineVisible: false });
      atrSeriesRef.current = atrSeries;
    }

    setIsReady(true);

    // Sync time scales
    const syncTimeScale = (sourceChart: IChartApi, targetCharts: (IChartApi | null)[]) => {
      sourceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) {
          targetCharts.forEach(tc => tc?.timeScale().setVisibleLogicalRange(range));
        }
      });
    };

    syncTimeScale(chart, [rsiChartRef.current, macdChartRef.current, atrChartRef.current]);

    // Handle resize
    const handleResize = () => {
      const width = chartContainerRef.current?.clientWidth || 0;
      chartRef.current?.applyOptions({ width });
      rsiChartRef.current?.applyOptions({ width });
      macdChartRef.current?.applyOptions({ width });
      atrChartRef.current?.applyOptions({ width });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      rsiChartRef.current?.remove();
      macdChartRef.current?.remove();
      atrChartRef.current?.remove();
      chartRef.current = null;
      setIsReady(false);
    };
  }, [chartHeight, indicatorHeight]);

  // Update chart height on fullscreen change or indicator toggle
  useEffect(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({ height: chartHeight, width: chartContainerRef.current.clientWidth });
    }
    if (rsiChartRef.current && rsiContainerRef.current) {
      rsiChartRef.current.applyOptions({ height: indicatorHeight, width: rsiContainerRef.current.clientWidth });
    }
    if (macdChartRef.current && macdContainerRef.current) {
      macdChartRef.current.applyOptions({ height: indicatorHeight, width: macdContainerRef.current.clientWidth });
    }
    if (atrChartRef.current && atrContainerRef.current) {
      atrChartRef.current.applyOptions({ height: indicatorHeight, width: atrContainerRef.current.clientWidth });
    }
  }, [chartHeight, indicatorHeight, isFullscreen, windowHeight]);

  // Update data
  useEffect(() => {
    if (!isReady || !candlestickSeriesRef.current || !volumeSeriesRef.current) return;

    if (!data.length) {
      candlestickSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      return;
    }

    const closes = data.map(d => d.close);
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);

    // Candlestick data
    const candleData: CandlestickData<UTCTimestamp>[] = data.map((d) => ({
      time: Math.floor(d.time / 1000) as UTCTimestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    // Volume data
    const volumeData: HistogramData<UTCTimestamp>[] = data.map((d) => ({
      time: Math.floor(d.time / 1000) as UTCTimestamp,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(63, 185, 80, 0.5)' : 'rgba(248, 81, 73, 0.5)',
    }));

    candlestickSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Calculate and set indicator data
    const bb = calculateBollingerBandsSeries(closes);
    const sma20Data = calculateSMASeries(closes, 20);
    const sma50Data = calculateSMASeries(closes, 50);
    const sma200Data = calculateSMASeries(closes, 200);
    const rsiData = calculateRSISeries(closes);
    const macd = calculateMACDSeries(closes);
    const atrData = calculateATRSeries(highs, lows, closes);

    // IMPORTANT: Do NOT filter out NaN values - keep all data points with same timestamps
    // as the main chart so that logical range indices align correctly across all charts
    const toLineData = (values: number[]): LineData<UTCTimestamp>[] =>
      values.map((v, i) => ({
        time: Math.floor(data[i].time / 1000) as UTCTimestamp,
        value: isNaN(v) ? undefined : v,
      } as LineData<UTCTimestamp>));

    // Bollinger Bands
    if (bbUpperRef.current && bbMiddleRef.current && bbLowerRef.current) {
      bbUpperRef.current.setData(toLineData(bb.upper));
      bbMiddleRef.current.setData(toLineData(bb.middle));
      bbLowerRef.current.setData(toLineData(bb.lower));
      bbUpperRef.current.applyOptions({ visible: indicators.bollingerBands });
      bbMiddleRef.current.applyOptions({ visible: indicators.bollingerBands });
      bbLowerRef.current.applyOptions({ visible: indicators.bollingerBands });
    }

    // SMAs
    if (sma20Ref.current) {
      sma20Ref.current.setData(toLineData(sma20Data));
      sma20Ref.current.applyOptions({ visible: indicators.sma20 });
    }
    if (sma50Ref.current) {
      sma50Ref.current.setData(toLineData(sma50Data));
      sma50Ref.current.applyOptions({ visible: indicators.sma50 });
    }
    if (sma200Ref.current) {
      sma200Ref.current.setData(toLineData(sma200Data));
      sma200Ref.current.applyOptions({ visible: indicators.sma200 });
    }

    // RSI
    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.setData(toLineData(rsiData));
    }

    // MACD - keep all data points for proper time alignment
    if (macdLineRef.current && macdSignalRef.current && macdHistogramRef.current) {
      macdLineRef.current.setData(toLineData(macd.macdLine));
      macdSignalRef.current.setData(toLineData(macd.signalLine));
      macdHistogramRef.current.setData(
        macd.histogram.map((v, i) => ({
          time: Math.floor(data[i].time / 1000) as UTCTimestamp,
          value: isNaN(v) ? 0 : v,
          color: isNaN(v) ? 'transparent' : v >= 0 ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)',
        })) as HistogramData<UTCTimestamp>[]
      );
    }

    // ATR
    if (atrSeriesRef.current) {
      atrSeriesRef.current.setData(toLineData(atrData));
    }

    // Set visible range to show last 50 candles for a zoomed-in view
    // This gives users a closer look at recent candlestick patterns
    const visibleCandles = 50;
    const dataLength = data.length;
    if (dataLength > visibleCandles) {
      const from = dataLength - visibleCandles;
      const to = dataLength;
      const range = { from, to };
      chartRef.current?.timeScale().setVisibleLogicalRange(range);
      rsiChartRef.current?.timeScale().setVisibleLogicalRange(range);
      macdChartRef.current?.timeScale().setVisibleLogicalRange(range);
      atrChartRef.current?.timeScale().setVisibleLogicalRange(range);
    } else {
      // If less than 50 candles, fit all content
      chartRef.current?.timeScale().fitContent();
      rsiChartRef.current?.timeScale().fitContent();
      macdChartRef.current?.timeScale().fitContent();
      atrChartRef.current?.timeScale().fitContent();
    }
  }, [data, isReady, selectedTimeframe, indicators]);

  const toggleIndicator = (key: keyof IndicatorVisibility) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      ref={fullscreenRef}
      className={`card ${isFullscreen ? 'fixed inset-0 z-50 rounded-none overflow-hidden' : ''}`}
      style={{ backgroundColor: isFullscreen ? '#0d1117' : undefined }}
    >
      <div className={isFullscreen ? 'p-4 h-full flex flex-col' : 'p-4'}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="text-sm text-secondary font-semibold">XRP/EUR</div>
            {/* Timeframe selector */}
            <div className="flex gap-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => onTimeframeChange?.(tf.value)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    selectedTimeframe === tf.value
                      ? 'bg-blue-500 text-white'
                      : 'bg-tertiary text-secondary hover:text-primary'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded bg-tertiary text-secondary hover:text-primary transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Indicator toggles */}
        <div className="flex flex-wrap gap-2 mb-3 text-xs">
          <button
            onClick={() => toggleIndicator('bollingerBands')}
            className={`px-2 py-1 rounded transition-colors ${indicators.bollingerBands ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50' : 'bg-tertiary text-tertiary'}`}
          >
            BB
          </button>
          <button
            onClick={() => toggleIndicator('sma20')}
            className={`px-2 py-1 rounded transition-colors ${indicators.sma20 ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50' : 'bg-tertiary text-tertiary'}`}
          >
            SMA20
          </button>
          <button
            onClick={() => toggleIndicator('sma50')}
            className={`px-2 py-1 rounded transition-colors ${indicators.sma50 ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50' : 'bg-tertiary text-tertiary'}`}
          >
            SMA50
          </button>
          <button
            onClick={() => toggleIndicator('sma200')}
            className={`px-2 py-1 rounded transition-colors ${indicators.sma200 ? 'bg-pink-500/20 text-pink-400 border border-pink-500/50' : 'bg-tertiary text-tertiary'}`}
          >
            SMA200
          </button>
          <div className="w-px bg-tertiary mx-1" />
          <button
            onClick={() => toggleIndicator('rsi')}
            className={`px-2 py-1 rounded transition-colors ${indicators.rsi ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50' : 'bg-tertiary text-tertiary'}`}
          >
            RSI
          </button>
          <button
            onClick={() => toggleIndicator('macd')}
            className={`px-2 py-1 rounded transition-colors ${indicators.macd ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-tertiary text-tertiary'}`}
          >
            MACD
          </button>
          <button
            onClick={() => toggleIndicator('atr')}
            className={`px-2 py-1 rounded transition-colors ${indicators.atr ? 'bg-teal-500/20 text-teal-400 border border-teal-500/50' : 'bg-tertiary text-tertiary'}`}
          >
            ATR
          </button>
        </div>

        {/* Main chart */}
        <div ref={chartContainerRef} className="w-full relative">
          {!data.length && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/50 z-10">
              <div className="text-secondary">Loading chart data...</div>
            </div>
          )}
        </div>

        {/* RSI panel */}
        <div className={`mt-1 ${indicators.rsi ? '' : 'hidden'}`}>
          <div className="text-xs text-tertiary mb-1 flex items-center gap-2">
            <span className="w-3 h-0.5 bg-orange-500 inline-block"></span>
            RSI (14)
          </div>
          <div ref={rsiContainerRef} className="w-full" />
        </div>

        {/* MACD panel */}
        <div className={`mt-1 ${indicators.macd ? '' : 'hidden'}`}>
          <div className="text-xs text-tertiary mb-1 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-blue-500 inline-block"></span>
              MACD
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-orange-500 inline-block"></span>
              Signal
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 bg-teal-500/50 inline-block"></span>
              Histogram
            </span>
          </div>
          <div ref={macdContainerRef} className="w-full" />
        </div>

        {/* ATR panel */}
        <div className={`mt-1 ${indicators.atr ? '' : 'hidden'}`}>
          <div className="text-xs text-tertiary mb-1 flex items-center gap-2">
            <span className="w-3 h-0.5 bg-cyan-500 inline-block"></span>
            ATR (14)
          </div>
          <div ref={atrContainerRef} className="w-full" />
        </div>
      </div>
    </div>
  );
}

export type { CandlestickChartProps };

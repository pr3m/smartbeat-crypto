'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  UTCTimestamp,
} from 'lightweight-charts';
import { useArenaStore } from '@/stores/arenaStore';

const AGENT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4',
  '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe',
];

interface OHLCCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function ArenaChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLineRefs = useRef<Map<string, ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>(new Map());

  const agents = useArenaStore((s) => s.agents);
  const sessionStatus = useArenaStore((s) => s.sessionStatus);

  const [candles, setCandles] = useState<OHLCCandle[]>([]);
  const [chartError, setChartError] = useState(false);

  // Fetch OHLC data
  const fetchOHLC = useCallback(async () => {
    try {
      const res = await fetch('/api/kraken/public/ohlc?pair=XRPEUR&interval=1');
      if (!res.ok) {
        setChartError(true);
        return;
      }
      const data = await res.json();
      if (data.data && Array.isArray(data.data)) {
        setCandles(data.data);
        setChartError(false);
      }
    } catch {
      setChartError(true);
    }
  }, []);

  // Only fetch when session is active; fetch immediately on start, then poll
  useEffect(() => {
    if (sessionStatus === 'idle') return;
    fetchOHLC();
    const interval = setInterval(fetchOHLC, 15000);
    return () => clearInterval(interval);
  }, [fetchOHLC, sessionStatus]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 340,
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
      rightPriceScale: {
        borderColor: '#30363d',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });
    candleSeriesRef.current = candleSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      priceLineRefs.current.clear();
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const chartData: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: Math.floor(c.time / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeriesRef.current.setData(chartData);

    // Show last 60 candles
    const len = chartData.length;
    if (len > 60) {
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: len - 60, to: len });
    } else {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles]);

  // Draw agent entry price lines
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    // Remove old price lines
    priceLineRefs.current.forEach((line) => {
      series.removePriceLine(line);
    });
    priceLineRefs.current.clear();

    // Add lines for agents with open positions
    agents.forEach((agent) => {
      if (!agent.position || !agent.position.isOpen) return;
      const color = AGENT_COLORS[agent.colorIndex] || AGENT_COLORS[0];
      const line = series.createPriceLine({
        price: agent.position.avgEntryPrice,
        color,
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: agent.name,
      });
      priceLineRefs.current.set(agent.agentId, line);
    });
  }, [agents]);

  return (
    <div className="arena-card">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-primary">XRP/EUR</h3>
        <span className="text-xs text-tertiary">1m candles</span>
      </div>
      <div ref={containerRef} className="w-full">
        {candles.length === 0 && (
          <div className="flex items-center justify-center h-[340px] text-sm text-tertiary">
            {sessionStatus === 'idle'
              ? 'Start a session to load chart'
              : chartError
                ? 'Chart error — retrying...'
                : 'Loading chart...'}
          </div>
        )}
      </div>
    </div>
  );
}

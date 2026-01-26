'use client';

import { useEffect, useRef, useMemo } from 'react';
import { formatEurValue } from '@/lib/trading/microstructure';
import { Tooltip, HelpIcon } from '@/components/Tooltip';

interface CVDChartProps {
  cvd: number;
  cvdHistory: Array<{ time: number; value: number; price: number }>;
  onReset?: () => void;
}

export function CVDChart({ cvd, cvdHistory, onReset }: CVDChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate divergence signal
  const divergenceSignal = useMemo(() => {
    if (cvdHistory.length < 20) return null;

    const recent = cvdHistory.slice(-20);
    const first = recent[0];
    const last = recent[recent.length - 1];

    const priceChange = ((last.price - first.price) / first.price) * 100;
    const cvdChange = last.value - first.value;

    // Bullish divergence: price down, CVD up
    if (priceChange < -0.1 && cvdChange > 500) {
      return { type: 'bullish' as const, message: 'Hidden accumulation' };
    }
    // Bearish divergence: price up, CVD down
    if (priceChange > 0.1 && cvdChange < -500) {
      return { type: 'bearish' as const, message: 'Distribution detected' };
    }
    return null;
  }, [cvdHistory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cvdHistory.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get actual canvas dimensions
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 10, right: 10, bottom: 20, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    // Get data range
    const values = cvdHistory.map(h => h.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || 1;

    // Scale functions
    const scaleX = (i: number) => padding.left + (i / (cvdHistory.length - 1)) * chartWidth;
    const scaleY = (v: number) => padding.top + chartHeight - ((v - minValue) / valueRange) * chartHeight;

    // Draw zero line if in range
    if (minValue <= 0 && maxValue >= 0) {
      ctx.strokeStyle = '#30363d';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const zeroY = scaleY(0);
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(width - padding.right, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Zero label
      ctx.fillStyle = '#6e7681';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('0', padding.left - 5, zeroY + 3);
    }

    // Draw CVD line
    ctx.strokeStyle = cvd >= 0 ? '#3fb950' : '#f85149';
    ctx.lineWidth = 2;
    ctx.beginPath();

    cvdHistory.forEach((point, i) => {
      const x = scaleX(i);
      const y = scaleY(point.value);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, scaleY(maxValue), 0, scaleY(minValue));
    if (cvd >= 0) {
      gradient.addColorStop(0, 'rgba(63, 185, 80, 0.3)');
      gradient.addColorStop(1, 'rgba(63, 185, 80, 0)');
    } else {
      gradient.addColorStop(0, 'rgba(248, 81, 73, 0)');
      gradient.addColorStop(1, 'rgba(248, 81, 73, 0.3)');
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    cvdHistory.forEach((point, i) => {
      const x = scaleX(i);
      const y = scaleY(point.value);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    // Close path to zero or bottom
    const zeroY = minValue <= 0 && maxValue >= 0 ? scaleY(0) : height - padding.bottom;
    ctx.lineTo(scaleX(cvdHistory.length - 1), zeroY);
    ctx.lineTo(scaleX(0), zeroY);
    ctx.closePath();
    ctx.fill();

    // Draw labels
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(formatEurValue(maxValue), padding.left - 5, padding.top + 10);
    ctx.fillText(formatEurValue(minValue), padding.left - 5, height - padding.bottom);

    // Current value on right
    ctx.textAlign = 'left';
    ctx.fillStyle = cvd >= 0 ? '#3fb950' : '#f85149';
    ctx.font = 'bold 11px monospace';
    const lastY = scaleY(cvdHistory[cvdHistory.length - 1].value);
    ctx.fillText(`€${formatEurValue(cvd)}`, width - padding.right + 5, Math.max(lastY + 4, padding.top + 10));

  }, [cvd, cvdHistory]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-tertiary flex items-center">
            Cumulative Volume Delta
            <HelpIcon
              tooltip={
                <div className="max-w-xs">
                  <strong>CVD (Cumulative Volume Delta)</strong>
                  <p className="mt-1">Running total of buy volume minus sell volume. Measures net buying/selling pressure over time.</p>
                  <ul className="mt-2 text-xs">
                    <li><span className="text-green-500">Rising CVD</span>: Consistent buying pressure</li>
                    <li><span className="text-red-500">Falling CVD</span>: Consistent selling pressure</li>
                  </ul>
                  <p className="mt-2 text-tertiary">Key signal: CVD divergence from price indicates hidden accumulation/distribution.</p>
                </div>
              }
              position="right"
            />
          </span>
          {divergenceSignal && (
            <Tooltip
              content={
                <div className="max-w-xs">
                  <strong>CVD Divergence Detected</strong>
                  <p className="mt-1">
                    {divergenceSignal.type === 'bullish'
                      ? 'Price is falling but CVD is rising - buyers are quietly accumulating. Bullish signal.'
                      : 'Price is rising but CVD is falling - sellers are distributing. Bearish signal.'}
                  </p>
                </div>
              }
              position="bottom"
            >
              <span
                className={`text-xs px-1.5 py-0.5 rounded cursor-help ${
                  divergenceSignal.type === 'bullish'
                    ? 'bg-green-500/20 text-green-500'
                    : 'bg-red-500/20 text-red-500'
                }`}
              >
                {divergenceSignal.message}
              </span>
            </Tooltip>
          )}
        </div>
        {onReset && (
          <Tooltip content="Reset CVD counter to zero" position="left">
            <button
              onClick={onReset}
              className="text-xs text-secondary hover:text-white transition-colors"
            >
              Reset
            </button>
          </Tooltip>
        )}
      </div>

      {/* CVD value display */}
      <Tooltip
        content={
          <div className="max-w-xs">
            <strong>Current CVD Value</strong>
            <p className="mt-1">{cvd >= 0 ? `€${formatEurValue(cvd)} more in buy volume than sell volume since tracking started.` : `€${formatEurValue(Math.abs(cvd))} more in sell volume than buy volume since tracking started.`}</p>
            <p className="mt-1 text-tertiary">For 10x trades: Look for CVD confirming your direction. Opposing CVD = higher risk.</p>
          </div>
        }
        position="bottom"
        block
      >
        <div className="flex items-center justify-center mb-2 cursor-help">
          <span
            className={`text-2xl font-bold mono ${
              cvd >= 0 ? 'text-green-500' : 'text-red-500'
            }`}
          >
            {cvd >= 0 ? '+' : ''}€{formatEurValue(cvd)}
          </span>
        </div>
      </Tooltip>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {cvdHistory.length < 2 ? (
          <div className="h-full flex items-center justify-center text-secondary text-sm">
            Collecting data...
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ display: 'block' }}
          />
        )}
      </div>

      {/* Legend */}
      <Tooltip
        content={
          <div className="max-w-xs">
            <strong>How to Read CVD</strong>
            <ul className="mt-1 text-xs space-y-1">
              <li><strong>CVD rising + Price rising</strong>: Healthy trend, buyers in control</li>
              <li><strong>CVD rising + Price flat/down</strong>: Accumulation (bullish divergence)</li>
              <li><strong>CVD falling + Price falling</strong>: Healthy downtrend</li>
              <li><strong>CVD falling + Price rising</strong>: Distribution (bearish divergence)</li>
            </ul>
          </div>
        }
        position="top"
        block
      >
        <div className="flex justify-center gap-4 mt-2 text-xs text-tertiary cursor-help">
          <span><span className="text-green-500">+CVD</span> = Net buying pressure</span>
          <span><span className="text-red-500">-CVD</span> = Net selling pressure</span>
        </div>
      </Tooltip>
    </div>
  );
}

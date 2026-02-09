'use client';

interface StrategyBarsProps {
  strategy: Record<string, unknown>;  // TradingStrategy object
  sessionDurationHours?: number;
}

function Bar({ label, value, max, color, displayValue }: {
  label: string;
  value: number;
  max: number;
  color: string;
  displayValue?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-tertiary w-24 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 rounded bg-tertiary overflow-hidden">
        <div
          className="h-full rounded transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="mono text-secondary w-12 text-right shrink-0">
        {displayValue ?? value.toFixed(0)}
      </span>
    </div>
  );
}

function TimeframeBar({ weights }: { weights: Record<string, number> }) {
  const keys = ['5m', '15m', '1h', '4h', '1d'] as const;
  const colors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6'];
  const total = keys.reduce((s, k) => s + (weights[k] || 0), 0) || 100;

  return (
    <div className="space-y-1">
      <div className="text-xs text-tertiary">Timeframe Weights</div>
      <div className="flex h-3 rounded overflow-hidden">
        {keys.map((k, i) => {
          const pct = ((weights[k] || 0) / total) * 100;
          return pct > 0 ? (
            <div
              key={k}
              style={{ width: `${pct}%`, backgroundColor: colors[i] }}
              className="relative group"
              title={`${k}: ${weights[k] || 0}%`}
            >
              {pct >= 15 && (
                <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-medium">
                  {k}
                </span>
              )}
            </div>
          ) : null;
        })}
      </div>
      <div className="flex justify-between text-[9px] text-tertiary">
        {keys.map((k, i) => (
          <span key={k} style={{ color: colors[i] }}>{k}: {weights[k] || 0}%</span>
        ))}
      </div>
    </div>
  );
}

export function StrategyBars({ strategy, sessionDurationHours = 4 }: StrategyBarsProps) {
  const s = strategy as Record<string, Record<string, unknown>>;
  const ps = (s.positionSizing || {}) as Record<string, number>;
  const tb = (s.timebox || {}) as Record<string, number>;
  const tw = (s.timeframeWeights || {}) as Record<string, number>;
  const sig = (s.signals || {}) as Record<string, number>;
  const spike = (s.spike || {}) as Record<string, number>;
  const exit = (s.exit || {}) as Record<string, number>;

  return (
    <div className="space-y-2">
      {/* Timeframe weights stacked bar */}
      <TimeframeBar weights={tw} />

      {/* Entry thresholds */}
      <Bar label="Min Confidence" value={ps.minEntryConfidence || 0} max={100} color="#3b82f6" displayValue={`${ps.minEntryConfidence || 0}%`} />
      <Bar label="Full Confidence" value={ps.fullEntryConfidence || 0} max={100} color="#22c55e" displayValue={`${ps.fullEntryConfidence || 0}%`} />

      {/* Position sizing */}
      <Bar label="Full Margin" value={ps.fullEntryMarginPercent || 0} max={20} color="#f59e0b" displayValue={`${ps.fullEntryMarginPercent || 0}%`} />
      <Bar label="Cautious Margin" value={ps.cautiousEntryMarginPercent || 0} max={20} color="#f59e0b" displayValue={`${ps.cautiousEntryMarginPercent || 0}%`} />
      <Bar label="Max Total" value={ps.maxTotalMarginPercent || 0} max={80} color="#ef4444" displayValue={`${ps.maxTotalMarginPercent || 0}%`} />

      {/* DCA */}
      <Bar label="Max DCA" value={ps.maxDCACount || 0} max={3} color="#8b5cf6" displayValue={`${ps.maxDCACount || 0}`} />
      {(ps.maxDCACount || 0) > 0 && (
        <Bar label="DCA Margin" value={ps.dcaMarginPercent || 0} max={15} color="#8b5cf6" displayValue={`${ps.dcaMarginPercent || 0}%`} />
      )}

      {/* Timebox */}
      <Bar label="Timebox" value={tb.maxHours || 0} max={sessionDurationHours} color="#06b6d4" displayValue={`${tb.maxHours || 0}h`} />

      {/* Exit pressure */}
      <Bar label="Exit Pressure" value={exit.exitPressureThreshold || 0} max={100} color="#ef4444" displayValue={`${exit.exitPressureThreshold || 0}`} />

      {/* Spike detection */}
      <Bar label="RSI Oversold" value={spike.oversoldRSI || 0} max={50} color="#22c55e" displayValue={`${spike.oversoldRSI || 0}`} />
      <Bar label="RSI Overbought" value={spike.overboughtRSI || 0} max={100} color="#ef4444" displayValue={`${spike.overboughtRSI || 0}`} />

      {/* Signal thresholds */}
      <Bar label="Action Threshold" value={sig.actionThreshold || 0} max={100} color="#3b82f6" displayValue={`${sig.actionThreshold || 0}`} />
    </div>
  );
}

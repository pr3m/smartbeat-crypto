'use client';

import { Tooltip } from './Tooltip';
import type { PositionHealthMetrics } from '@/lib/trading/position-health';
import {
  getRiskLevelColors,
  getLiquidationStatusColors,
  getMarginStatusColors,
} from '@/lib/trading/position-health';

interface PositionHealthBadgeProps {
  health: PositionHealthMetrics;
  compact?: boolean;
}

export function PositionHealthBadge({ health, compact = false }: PositionHealthBadgeProps) {
  const riskColors = getRiskLevelColors(health.riskLevel);
  const liqColors = getLiquidationStatusColors(health.liquidationStatus);
  const marginColors = getMarginStatusColors(health.marginStatus);

  if (compact) {
    // Compact version - just the risk level badge
    return (
      <Tooltip
        content={
          <div className="text-xs max-w-xs">
            <strong className={riskColors.text}>Risk: {health.riskLevel.toUpperCase()}</strong>
            {health.riskFactors.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {health.riskFactors.map((factor, i) => (
                  <li key={i}>• {factor}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <span className="text-tertiary">Liq Distance:</span>
                <span className={`ml-1 ${liqColors.text}`}>
                  {health.liquidationDistance >= 100 ? '>100%' : `${health.liquidationDistance.toFixed(1)}%`}
                </span>
              </div>
              <div>
                <span className="text-tertiary">Margin Level:</span>
                <span className={`ml-1 ${marginColors.text}`}>
                  {health.marginLevel.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        }
        position="left"
      >
        <span
          className={`px-2 py-0.5 rounded text-xs font-semibold cursor-help ${riskColors.bg} ${riskColors.text}`}
        >
          {health.riskLevel === 'extreme' && '⚠️ '}
          {health.riskLevel === 'high' && '⚡ '}
          {health.riskLevel.toUpperCase()}
        </span>
      </Tooltip>
    );
  }

  // Full version - detailed health metrics
  return (
    <div className={`rounded-lg p-2 ${riskColors.bg} border ${riskColors.border}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${riskColors.text}`}>
          {health.riskLevel === 'extreme' && '⚠️ '}
          {health.riskLevel === 'high' && '⚡ '}
          Risk: {health.riskLevel.toUpperCase()}
        </span>
        {health.timeStatus && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              health.timeStatus === 'overdue'
                ? 'bg-red-500/30 text-red-400'
                : 'bg-yellow-500/20 text-yellow-400'
            }`}
          >
            {health.timeStatus === 'overdue' ? '⏰ Overdue' : '⏱️ Approaching'}
          </span>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Liquidation Distance */}
        <Tooltip
          content={
            <div>
              <strong>Liquidation Distance</strong>
              <p className="mt-1">
                Distance from current price to liquidation.
                <br />
                &lt;5% = Danger, &lt;10% = Warning, &gt;10% = Safe
                {health.liquidationDistance >= 100 && (
                  <>
                    <br />
                    <span className="text-green-400">&gt;100% means liquidation is very unlikely!</span>
                  </>
                )}
              </p>
            </div>
          }
          position="top"
        >
          <div className={`rounded p-1.5 cursor-help ${liqColors.bg}`}>
            <div className="text-tertiary">Liq Distance</div>
            <div className={`font-semibold mono ${liqColors.text}`}>
              {health.liquidationDistance >= 100 ? '>100%' : `${health.liquidationDistance.toFixed(1)}%`}
            </div>
          </div>
        </Tooltip>

        {/* Margin Level */}
        <Tooltip
          content={
            <div>
              <strong>Margin Level</strong>
              <p className="mt-1">
                Equity / Margin × 100.
                <br />
                &lt;120% = Critical, &lt;200% = Low, &gt;200% = Healthy
              </p>
            </div>
          }
          position="top"
        >
          <div className={`rounded p-1.5 cursor-help ${marginColors.bg}`}>
            <div className="text-tertiary">Margin Level</div>
            <div className={`font-semibold mono ${marginColors.text}`}>
              {health.marginLevel.toFixed(0)}%
            </div>
          </div>
        </Tooltip>

        {/* Time Open */}
        <Tooltip
          content={
            <div>
              <strong>Time Open</strong>
              <p className="mt-1">
                &gt;48h = Approaching rollover fees concern
                <br />
                &gt;72h = Overdue, consider closing
              </p>
            </div>
          }
          position="top"
        >
          <div className="rounded p-1.5 bg-tertiary/30 cursor-help">
            <div className="text-tertiary">Time Open</div>
            <div
              className={`font-semibold mono ${
                health.timeStatus === 'overdue'
                  ? 'text-red-400'
                  : health.timeStatus === 'approaching'
                  ? 'text-yellow-400'
                  : 'text-secondary'
              }`}
            >
              {health.hoursOpen.toFixed(0)}h
            </div>
          </div>
        </Tooltip>

        {/* Est. Rollover */}
        <Tooltip
          content={
            <div>
              <strong>Estimated Rollover Fees</strong>
              <p className="mt-1">
                Kraken charges ~0.015% per 4h for margin positions.
                <br />
                This is an estimate based on time open.
              </p>
            </div>
          }
          position="top"
        >
          <div className="rounded p-1.5 bg-tertiary/30 cursor-help">
            <div className="text-tertiary">Est. Rollover</div>
            <div className="font-semibold mono text-orange-400">
              -€{health.estimatedRolloverFee.toFixed(2)}
            </div>
          </div>
        </Tooltip>
      </div>

      {/* Risk Factors */}
      {health.riskFactors.length > 0 && (
        <div className="mt-2 pt-2 border-t border-primary/50">
          <div className="text-xs text-tertiary mb-1">Risk Factors:</div>
          <ul className="text-xs space-y-0.5">
            {health.riskFactors.slice(0, 3).map((factor, i) => (
              <li key={i} className={riskColors.text}>
                • {factor}
              </li>
            ))}
            {health.riskFactors.length > 3 && (
              <li className="text-tertiary">
                +{health.riskFactors.length - 3} more...
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

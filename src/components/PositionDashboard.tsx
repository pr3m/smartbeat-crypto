'use client';

import { useMemo } from 'react';
import { Tooltip } from '@/components/Tooltip';
import type {
  PositionState,
  PositionPhase,
  DCASignal,
  ExitSignal,
  ExitPressure,
  ExitUrgency,
  EngineSummary,
  PositionSizingResult,
  TradingEngineConfig,
  TimeboxStep,
} from '@/lib/trading/v2-types';
import { DEFAULT_ENGINE_CONFIG } from '@/lib/trading/v2-types';
import type { TradingRecommendation } from '@/lib/kraken/types';
import type {
  QuickEntryParams,
  QuickCloseParams,
  QuickDCAParams,
  QuickTrailingStopParams,
  QuickTakeProfitParams,
} from '@/components/dashboard/types';
import { DashboardActions } from '@/components/dashboard/DashboardActions';

// ============================================================================
// PROPS
// ============================================================================

export interface PositionDashboardProps {
  /** Current position state (null or idle phase = no position) */
  position: PositionState | null;
  /** Current exit signal analysis */
  exitSignal: ExitSignal | null;
  /** Current DCA signal analysis */
  dcaSignal: DCASignal | null;
  /** Position sizing result (for idle state or DCA capacity) */
  sizing: PositionSizingResult | null;
  /** Engine summary for headline/alerts */
  summary: EngineSummary | null;
  /** Current market price */
  currentPrice: number;
  /** Engine configuration (strategy-driven, no hardcoded values) */
  config?: TradingEngineConfig;
  /** Strategy display name */
  strategyName?: string;

  // --- Execution context (all optional for backwards compat) ---
  testMode?: boolean;
  recommendation?: TradingRecommendation | null;
  orderInFlight?: boolean;

  // --- Action callbacks ---
  onEntryExecute?: (params: QuickEntryParams) => Promise<void>;
  onCloseExecute?: (params: QuickCloseParams) => Promise<void>;
  onDCAExecute?: (params: QuickDCAParams) => Promise<void>;
  onTrailingStopExecute?: (params: QuickTrailingStopParams) => Promise<void>;
  onTakeProfitExecute?: (params: QuickTakeProfitParams) => Promise<void>;
  onOpenTradeDrawer?: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

const STATUS_COLORS: Record<EngineSummary['statusColor'], string> = {
  green: 'bg-green-500/15 border-green-500/40 text-green-400',
  yellow: 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400',
  orange: 'bg-orange-500/15 border-orange-500/40 text-orange-400',
  red: 'bg-red-500/15 border-red-500/40 text-red-400',
  gray: 'bg-tertiary border-primary text-secondary',
};

const URGENCY_STYLES: Record<ExitUrgency, { bg: string; text: string; label: string; pulse: boolean }> = {
  monitor: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Monitoring', pulse: false },
  consider: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Consider Exit', pulse: false },
  soon: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Exit Soon', pulse: true },
  immediate: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'EXIT NOW', pulse: true },
};

const PHASE_LABELS: Record<PositionPhase, string> = {
  idle: 'No Position',
  entry: 'Position Open',
  dca_watch: 'Watching for DCA',
  in_dca: 'DCA Active',
  exit_watch: 'Exit Watch',
  exiting: 'Exiting',
  closed: 'Closed',
};

function getTimeColor(hoursElapsed: number, maxHours: number): string {
  const ratio = hoursElapsed / maxHours;
  if (ratio >= 1) return 'text-red-400';
  if (ratio >= 0.75) return 'text-red-400';     // 36-48h
  if (ratio >= 0.5) return 'text-orange-400';    // 24-36h
  if (ratio >= 0.25) return 'text-yellow-400';   // 12-24h
  return 'text-green-400';                        // 0-12h
}

function getTimeLabel(hoursElapsed: number, steps: TimeboxStep[]): string {
  // Walk steps in reverse to find the current step
  for (let i = steps.length - 1; i >= 0; i--) {
    if (hoursElapsed >= steps[i].hours) {
      return steps[i].label;
    }
  }
  return steps[0]?.label || 'Fresh';
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 1) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatPnL(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Idle state - no open position */
function IdleState({
  sizing,
  summary,
  config,
  strategyName,
  actionsSlot,
}: {
  sizing: PositionSizingResult | null;
  summary: EngineSummary | null;
  config: TradingEngineConfig;
  strategyName?: string;
  actionsSlot?: React.ReactNode;
}) {
  return (
    <div className="card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-500" />
          <span className="text-sm font-semibold text-secondary">No Open Position</span>
        </div>
        {strategyName && (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
            {strategyName}
          </span>
        )}
      </div>

      {/* Summary headline if available */}
      {summary && (
        <div className={`p-3 rounded-lg border ${STATUS_COLORS[summary.statusColor]}`}>
          <div className="text-sm font-semibold">{summary.headline}</div>
          {summary.metrics.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-2">
              {summary.metrics.map((m, i) => (
                <span key={i} className="text-xs">
                  <span className="text-tertiary">{m.label}: </span>
                  <span className={`mono font-medium ${m.color || 'text-secondary'}`}>{m.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Entry criteria from strategy config */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 rounded bg-tertiary/30">
          <div className="text-tertiary">Min Confidence</div>
          <div className="mono font-semibold">{config.positionSizing.minEntryConfidence}%</div>
        </div>
        <div className="p-2 rounded bg-tertiary/30">
          <div className="text-tertiary">Full Entry At</div>
          <div className="mono font-semibold">{config.positionSizing.fullEntryConfidence}%+</div>
        </div>
        <div className="p-2 rounded bg-tertiary/30">
          <div className="text-tertiary">Leverage</div>
          <div className="mono font-semibold">{config.positionSizing.leverage}x</div>
        </div>
        <div className="p-2 rounded bg-tertiary/30">
          <div className="text-tertiary">Max Margin</div>
          <div className="mono font-semibold">{config.positionSizing.maxTotalMarginPercent}%</div>
        </div>
      </div>

      {/* Sizing recommendation if available */}
      {sizing && sizing.shouldEnter && (
        <div className={`p-3 rounded-lg border ${
          sizing.entryMode === 'full'
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-yellow-500/10 border-yellow-500/30'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              sizing.entryMode === 'full'
                ? 'bg-green-500 text-black'
                : 'bg-yellow-500 text-black'
            }`}>
              {sizing.entryMode === 'full' ? 'FULL ENTRY' : 'CAUTIOUS ENTRY'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs mt-2">
            <div>
              <span className="text-tertiary">Margin: </span>
              <span className="mono font-medium">{sizing.marginPercent.toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-tertiary">Size: </span>
              <span className="mono font-medium">{sizing.volume.toFixed(1)} XRP</span>
            </div>
            <div>
              <span className="text-tertiary">DCA Cap: </span>
              <span className="mono font-medium">{sizing.remainingDCACapacity.dcasRemaining}</span>
            </div>
          </div>
        </div>
      )}

      {sizing && !sizing.shouldEnter && sizing.skipReason && (
        <div className="p-2 rounded bg-tertiary/30 text-xs text-tertiary text-center">
          {sizing.skipReason}
        </div>
      )}

      {/* Action Buttons */}
      {actionsSlot}

      {/* Alerts */}
      {summary && summary.alerts.length > 0 && (
        <div className="space-y-1">
          {summary.alerts.map((alert, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 px-2 py-1.5 rounded">
              <span className="flex-shrink-0">!</span>
              <span>{alert}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** DCA counter - visual dots showing DCA usage */
function DCACounter({
  dcaCount,
  maxDCA,
  dcaSignal,
}: {
  dcaCount: number;
  maxDCA: number;
  dcaSignal: DCASignal | null;
}) {
  const hasPendingDCA = dcaSignal?.shouldDCA && dcaCount < maxDCA;

  return (
    <Tooltip
      content={
        <div className="text-xs max-w-xs">
          <strong>DCA Status: {dcaCount}/{maxDCA}</strong>
          {dcaSignal && dcaSignal.shouldDCA && (
            <div className="mt-1">
              <div className="text-yellow-400">DCA Signal Active</div>
              <div>Confidence: {dcaSignal.confidence}%</div>
              <div>Type: {dcaSignal.exhaustionType.replace(/_/g, ' ')}</div>
              <div>Drawdown: {dcaSignal.drawdownPercent.toFixed(1)}%</div>
              <div className="mt-1">{dcaSignal.reason}</div>
            </div>
          )}
          {dcaCount >= maxDCA && (
            <div className="mt-1 text-red-400">Max DCA reached - no more entries</div>
          )}
        </div>
      }
      position="bottom"
    >
      <div className="flex items-center gap-1.5 cursor-help">
        <span className="text-xs text-tertiary">DCA</span>
        <div className="flex items-center gap-1">
          {Array.from({ length: maxDCA }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full border-2 transition-all ${
                i < dcaCount
                  ? 'bg-blue-500 border-blue-500'
                  : hasPendingDCA && i === dcaCount
                  ? 'border-yellow-500 bg-yellow-500/30 animate-pulse'
                  : 'border-gray-600 bg-transparent'
              }`}
            />
          ))}
        </div>
        <span className="text-xs mono text-tertiary">{dcaCount}/{maxDCA}</span>
      </div>
    </Tooltip>
  );
}

/** Pressure bar color based on value */
function getPressureBarColor(percent: number): string {
  if (percent >= 75) return 'bg-red-500';
  if (percent >= 50) return 'bg-orange-500';
  if (percent >= 25) return 'bg-yellow-500';
  return 'bg-green-500';
}

/** Short readable label for pressure source */
function pressureLabel(source: string): string {
  switch (source) {
    case 'timebox_expired': return 'Time';
    case 'timebox_approaching': return 'Time';
    case 'momentum_exhaustion': return 'Mom';
    case 'condition_deterioration': return 'Vol';
    case 'anti_greed': return 'Greed';
    case 'trend_reversal': return 'Trend';
    case 'reversal_detected': return 'Rev';
    case 'knife_detected': return 'Knife';
    default: return source.replace(/_/g, ' ').slice(0, 5);
  }
}

/** Full label for tooltip */
function pressureFullLabel(source: string): string {
  switch (source) {
    case 'timebox_expired': return 'Timebox expired';
    case 'timebox_approaching': return 'Timebox approaching';
    case 'momentum_exhaustion': return 'Momentum exhaustion';
    case 'condition_deterioration': return 'Volume decline';
    case 'anti_greed': return 'Anti-greed';
    case 'trend_reversal': return 'Trend reversal';
    case 'reversal_detected': return 'Reversal pattern';
    case 'knife_detected': return 'Knife detected';
    default: return source.replace(/_/g, ' ');
  }
}

/** Inline pressure breakdown - only shows active pressures above threshold */
function PressureBreakdown({ pressures }: { pressures: ExitPressure[] }) {
  // Only show pressures that matter (value > 0), sorted by weighted impact
  const meaningful = pressures
    .filter(p => p.value > 0)
    .sort((a, b) => (b.value * b.weight) - (a.value * a.weight));

  if (meaningful.length === 0) return null;

  return (
    <div className="space-y-1.5 mt-2">
      {meaningful.map((p, i) => {
        const pct = Math.min(Math.round(p.value), 100);
        const barColor = getPressureBarColor(pct);
        return (
          <Tooltip
            key={i}
            content={<div className="text-xs max-w-xs"><strong>{pressureFullLabel(p.source)}</strong><p className="mt-0.5">{p.detail}</p></div>}
            position="bottom"
            block
          >
            <div className="cursor-help">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-tertiary shrink-0 w-[36px]">{pressureLabel(p.source)}</span>
                <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden min-w-[40px]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="mono text-tertiary shrink-0 w-[30px] text-right">{pct}%</span>
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Exit pressure meter with inline breakdown — no duplicate urgency label */
function ExitUrgencyMeter({ exitSignal }: { exitSignal: ExitSignal }) {
  const style = URGENCY_STYLES[exitSignal.urgency];
  const pressurePercent = Math.min(exitSignal.totalPressure, 100);
  const barColor = getPressureBarColor(pressurePercent);

  return (
    <div>
      {/* Main pressure bar */}
      <Tooltip
        content={
          <div className="text-xs max-w-xs">
            <strong>Exit Analysis</strong>
            <div className="mt-1">
              <div>Total Pressure: {Math.round(exitSignal.totalPressure)}%</div>
              <div>Confidence: {exitSignal.confidence}%</div>
              {exitSignal.suggestedExitPercent > 0 && (
                <div>Suggested Exit: {exitSignal.suggestedExitPercent}%</div>
              )}
            </div>
            <div className="mt-2 border-t border-gray-600 pt-1">
              {exitSignal.explanation}
            </div>
          </div>
        }
        position="bottom"
      >
        <div className="cursor-help">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs text-tertiary">Pressure</span>
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor} ${style.pulse ? 'animate-pulse' : ''}`}
                style={{ width: `${pressurePercent}%` }}
              />
            </div>
            <span className={`text-xs mono font-bold min-w-[32px] text-right ${style.text}`}>
              {Math.round(pressurePercent)}%
            </span>
          </div>
        </div>
      </Tooltip>

      {/* Inline pressure breakdown — sorted by impact */}
      <PressureBreakdown pressures={exitSignal.pressures} />

      {exitSignal.shouldExit && exitSignal.suggestedExitPercent > 0 && (
        <div className={`text-xs mt-1.5 font-semibold ${style.text}`}>
          Close {exitSignal.suggestedExitPercent}% of position
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PositionDashboard({
  position,
  exitSignal,
  dcaSignal,
  sizing,
  summary,
  currentPrice,
  config = DEFAULT_ENGINE_CONFIG,
  strategyName,
  testMode = true,
  recommendation,
  orderInFlight = false,
  onEntryExecute,
  onCloseExecute,
  onDCAExecute,
  onTrailingStopExecute,
  onTakeProfitExecute,
  onOpenTradeDrawer,
}: PositionDashboardProps) {
  const isIdle = !position || !position.isOpen || position.phase === 'idle';

  // Labels that duplicate info already shown in the dashboard sections
  const DUPLICATE_METRIC_LABELS = useMemo(() => new Set([
    'P&L', 'PnL', 'Unrealized', 'Time', 'Elapsed', 'Margin', 'Margin Used',
    'Exit Pressure', 'Pressure', 'Timebox', 'Peak P&L', 'HWM',
  ]), []);

  // Filter out metrics that duplicate dashboard info
  const filteredMetrics = useMemo(() => {
    if (!summary) return [];
    return summary.metrics.filter(m => !DUPLICATE_METRIC_LABELS.has(m.label));
  }, [summary, DUPLICATE_METRIC_LABELS]);

  // Build actions slot for idle or active mode
  const hasActions = onEntryExecute || onCloseExecute || onDCAExecute || onTrailingStopExecute || onTakeProfitExecute;

  // Idle state
  if (isIdle) {
    return (
      <IdleState
        sizing={sizing}
        summary={summary}
        config={config}
        strategyName={strategyName}
        actionsSlot={hasActions ? (
          <DashboardActions
            mode="idle"
            testMode={testMode}
            currentPrice={currentPrice}
            orderInFlight={orderInFlight}
            position={position}
            sizing={sizing}
            dcaSignal={dcaSignal}
            exitSignal={exitSignal}
            config={config}
            recommendation={recommendation ?? null}
            onEntryExecute={onEntryExecute}
            onCloseExecute={onCloseExecute}
            onDCAExecute={onDCAExecute}
            onTrailingStopExecute={onTrailingStopExecute}
            onTakeProfitExecute={onTakeProfitExecute}
            onOpenTradeDrawer={onOpenTradeDrawer}
          />
        ) : undefined}
      />
    );
  }

  // Active position
  const pos = position!;
  const isProfitable = pos.unrealizedPnL >= 0;
  const hoursElapsed = pos.timeInTradeMs / (1000 * 60 * 60);
  const isOverdue = hoursElapsed >= config.timebox.maxHours;
  const hasDCASignal = dcaSignal?.shouldDCA && pos.dcaCount < config.positionSizing.maxDCACount;

  return (
    <div className="card overflow-hidden">
      {/* Status Banner */}
      {summary && (
        <div className={`px-4 py-2 border-b ${STATUS_COLORS[summary.statusColor]} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              summary.statusColor === 'green' ? 'bg-green-500' :
              summary.statusColor === 'yellow' ? 'bg-yellow-500' :
              summary.statusColor === 'orange' ? 'bg-orange-500' :
              summary.statusColor === 'red' ? 'bg-red-500 animate-pulse' :
              'bg-gray-500'
            }`} />
            <span className="text-sm font-semibold">{summary.headline}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/30 text-secondary">
              {PHASE_LABELS[pos.phase]}
            </span>
            {strategyName && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {strategyName}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Direction + P&L Hero */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded text-sm font-bold ${
              pos.direction === 'long'
                ? 'bg-green-500 text-black'
                : 'bg-red-500 text-white'
            }`}>
              {pos.direction === 'long' ? 'LONG' : 'SHORT'}
            </span>
            <span className="text-xs text-tertiary">{pos.leverage}x</span>
          </div>

          {/* P&L - largest, most prominent element */}
          <div className="text-right">
            <div className={`text-3xl font-bold mono ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
              {formatPnL(pos.unrealizedPnL)}
            </div>
            <div className={`text-sm mono ${isProfitable ? 'text-green-400/70' : 'text-red-400/70'}`}>
              {pos.unrealizedPnLPercent >= 0 ? '+' : ''}{pos.unrealizedPnLPercent.toFixed(2)}%
              <span className="text-tertiary ml-1">
                ({pos.unrealizedPnLLeveredPercent >= 0 ? '+' : ''}{pos.unrealizedPnLLeveredPercent.toFixed(1)}% lev)
              </span>
            </div>
          </div>
        </div>

        {/* Price Info Row */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Tooltip content={`Volume-weighted average across ${pos.entries.length} entr${pos.entries.length === 1 ? 'y' : 'ies'}`} position="bottom">
            <div className="p-2 rounded bg-tertiary/30 cursor-help">
              <div className="text-xs text-tertiary">Avg Entry</div>
              <div className="mono font-semibold">{pos.avgPrice.toFixed(4)}</div>
            </div>
          </Tooltip>
          <div className="p-2 rounded bg-tertiary/30">
            <div className="text-xs text-tertiary">Current</div>
            <div className="mono font-semibold">{currentPrice.toFixed(4)}</div>
          </div>
          <Tooltip content={`${pos.totalVolume.toFixed(2)} XRP with ${pos.totalMarginUsed.toFixed(2)} margin (${pos.totalMarginPercent.toFixed(0)}% used)`} position="bottom">
            <div className="p-2 rounded bg-tertiary/30 cursor-help">
              <div className="text-xs text-tertiary">Size</div>
              <div className="mono font-semibold">{pos.totalVolume.toFixed(1)} XRP</div>
            </div>
          </Tooltip>
        </div>

        {/* ============================================================ */}
        {/* EXIT MONITORING SECTION — decision-focused                  */}
        {/* ============================================================ */}
        {exitSignal && pos.phase !== 'idle' && (
          <div className={`rounded-lg border p-3 space-y-2 ${
            exitSignal.urgency === 'immediate' ? 'border-red-500/50 bg-red-500/5' :
            exitSignal.urgency === 'soon' ? 'border-orange-500/40 bg-orange-500/5' :
            exitSignal.urgency === 'consider' ? 'border-yellow-500/30 bg-yellow-500/5' :
            'border-primary/40 bg-tertiary/20'
          }`}>
            {/* Header: title + urgency badge */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-secondary">
                {exitSignal.reason === 'knife_detected' ? 'Knife Exit' :
                 exitSignal.reason === 'anti_greed' ? 'Anti-Greed Exit' :
                 exitSignal.reason === 'reversal_detected' ? 'Reversal Exit' :
                 exitSignal.reason === 'trend_reversal' ? 'Trend Reversal' :
                 'Exit Monitor'}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${URGENCY_STYLES[exitSignal.urgency].bg} ${URGENCY_STYLES[exitSignal.urgency].text} ${URGENCY_STYLES[exitSignal.urgency].pulse ? 'animate-pulse' : ''}`}>
                {URGENCY_STYLES[exitSignal.urgency].label}
              </span>
            </div>

            {/* Primary judgment: exit explanation */}
            {exitSignal.explanation && (
              <div className="text-[11px] text-secondary leading-snug">
                {exitSignal.explanation}
              </div>
            )}

            {/* Pressure bar + breakdown */}
            <ExitUrgencyMeter exitSignal={exitSignal} />

            {/* Compact context row: time + regime + peak P&L — only what matters */}
            <div className="flex items-center gap-3 text-[11px] pt-1 border-t border-primary/30">
              {/* Time — compact, no progress bar */}
              <Tooltip
                content={
                  <div className="text-xs max-w-xs">
                    <strong>Time in Trade</strong>
                    <div className="mt-1">
                      <div>Elapsed: {formatDuration(pos.timeInTradeMs)}</div>
                      <div>Max: {config.timebox.maxHours}h</div>
                      <div>{getTimeLabel(hoursElapsed, config.timebox.steps)}</div>
                    </div>
                  </div>
                }
                position="bottom"
              >
                <span className={`cursor-help mono ${getTimeColor(hoursElapsed, config.timebox.maxHours)} ${isOverdue ? 'animate-pulse font-bold' : ''}`}>
                  {formatDuration(pos.timeInTradeMs)}{isOverdue ? ' OD' : ''}/{config.timebox.maxHours}h
                </span>
              </Tooltip>

              {/* Regime badge — if available from recommendation */}
              {recommendation?.regimeStatus && (
                <Tooltip
                  content={
                    <div className="text-xs max-w-xs">
                      <strong>Market Regime</strong>
                      <div className="mt-1">{recommendation.regimeStatus.description}</div>
                      <div>Threshold: {recommendation.regimeStatus.adjustedActionThreshold}</div>
                      <div>Timebox: {recommendation.regimeStatus.adjustedTimeboxMaxHours}h</div>
                    </div>
                  }
                  position="bottom"
                >
                  <span className={`cursor-help px-1 py-0.5 rounded text-[10px] ${
                    recommendation.regimeStatus.regime === 'strong_trend' ? 'bg-green-500/20 text-green-400' :
                    recommendation.regimeStatus.regime === 'trending' ? 'bg-blue-500/20 text-blue-400' :
                    recommendation.regimeStatus.regime === 'low_volatility' ? 'bg-gray-500/20 text-gray-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {recommendation.regimeStatus.regime === 'strong_trend' ? 'Trend' :
                     recommendation.regimeStatus.regime === 'trending' ? 'Trend' :
                     recommendation.regimeStatus.regime === 'low_volatility' ? 'Low vol' :
                     'Range'}
                    {recommendation.regimeStatus.adx > 0 && ` ${Math.round(recommendation.regimeStatus.adx)}`}
                  </span>
                </Tooltip>
              )}

              {/* Peak P&L — only show when HWM is meaningful */}
              {pos.highWaterMarkPnL >= config.antiGreed.minHWMToTrack && (
                <Tooltip
                  content={
                    <div className="text-xs max-w-xs">
                      <strong>Anti-Greed</strong>
                      <div className="mt-1">
                        <div>Peak: {formatPnL(pos.highWaterMarkPnL)}</div>
                        <div>Drawdown: {pos.drawdownFromHWMPercent.toFixed(1)}%</div>
                        <div>Trigger: {config.antiGreed.drawdownThresholdPercent}%</div>
                      </div>
                    </div>
                  }
                  position="bottom"
                >
                  <span className="cursor-help text-tertiary">
                    Peak <span className="mono text-green-400">{formatPnL(pos.highWaterMarkPnL)}</span>
                    {pos.drawdownFromHWMPercent > 10 && (
                      <span className="text-orange-400 ml-0.5">-{pos.drawdownFromHWMPercent.toFixed(0)}%</span>
                    )}
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* Fallback: compact time display when no exit signal */}
        {(!exitSignal || pos.phase === 'idle') && (
          <div className="flex items-center gap-3 text-xs px-1">
            <span className="text-tertiary">Time:</span>
            <span className={`mono ${getTimeColor(hoursElapsed, config.timebox.maxHours)}`}>
              {formatDuration(pos.timeInTradeMs)} / {config.timebox.maxHours}h
            </span>
            {pos.highWaterMarkPnL >= config.antiGreed.minHWMToTrack && (
              <>
                <span className="text-tertiary">Peak:</span>
                <span className="mono text-green-400">{formatPnL(pos.highWaterMarkPnL)}</span>
              </>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TRADE MANAGEMENT SECTION                                      */}
        {/* ============================================================ */}

        {/* DCA Counter + DCA Signal Alert */}
        <div className="p-2 rounded bg-tertiary/30">
          <DCACounter
            dcaCount={pos.dcaCount}
            maxDCA={config.positionSizing.maxDCACount}
            dcaSignal={dcaSignal}
          />
        </div>

        {hasDCASignal && dcaSignal && (
          <div className="p-3 rounded-lg border-2 border-dashed border-blue-500/50 bg-blue-500/10">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-sm font-semibold text-blue-400">DCA Signal: Level {dcaSignal.dcaLevel}</span>
              </div>
              <span className="text-xs mono text-blue-400">{dcaSignal.confidence}% conf</span>
            </div>
            <div className="text-xs text-secondary mb-2">{dcaSignal.reason}</div>
            {dcaSignal.signals.length > 0 && (
              <div className="space-y-0.5">
                {dcaSignal.signals.map((sig, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                      sig.active ? 'bg-green-500 text-black' : 'bg-gray-600 text-gray-400'
                    }`}>
                      {sig.active ? '>' : '-'}
                    </span>
                    <span className={sig.active ? 'text-secondary' : 'text-tertiary'}>
                      {sig.name}
                    </span>
                    <span className="mono text-tertiary ml-auto">{sig.value}</span>
                  </div>
                ))}
              </div>
            )}
            {dcaSignal.warnings.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {dcaSignal.warnings.map((w, i) => (
                  <div key={i} className="text-xs text-yellow-400">! {w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons (active position) */}
        {hasActions && (
          <DashboardActions
            mode="active"
            testMode={testMode}
            currentPrice={currentPrice}
            orderInFlight={orderInFlight}
            position={position}
            sizing={sizing}
            dcaSignal={dcaSignal}
            exitSignal={exitSignal}
            config={config}
            recommendation={recommendation ?? null}
            onEntryExecute={onEntryExecute}
            onCloseExecute={onCloseExecute}
            onDCAExecute={onDCAExecute}
            onTrailingStopExecute={onTrailingStopExecute}
            onTakeProfitExecute={onTakeProfitExecute}
            onOpenTradeDrawer={onOpenTradeDrawer}
          />
        )}

        {/* Margin + Liq Distance Row */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Tooltip
            content={
              <div className="text-xs">
                <strong>Margin Utilization</strong>
                <div className="mt-1">
                  <div>Used: {pos.totalMarginUsed.toFixed(2)} ({pos.totalMarginPercent.toFixed(0)}%)</div>
                  <div>Max allowed: {config.positionSizing.maxTotalMarginPercent}%</div>
                  <div>Fees so far: {pos.totalFees.toFixed(2)}</div>
                  <div>Rollover/4h: {pos.rolloverCostPer4h.toFixed(2)}</div>
                </div>
              </div>
            }
            position="top"
          >
            <div className="p-2 rounded bg-tertiary/30 cursor-help">
              <div className="text-tertiary mb-1">Margin Used</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pos.totalMarginPercent > 70 ? 'bg-red-500' :
                      pos.totalMarginPercent > 50 ? 'bg-orange-500' :
                      'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(pos.totalMarginPercent, 100)}%` }}
                  />
                </div>
                <span className="mono font-semibold">{pos.totalMarginPercent.toFixed(0)}%</span>
              </div>
            </div>
          </Tooltip>

          <Tooltip
            content={
              <div className="text-xs">
                <strong>Liquidation Risk</strong>
                <div className="mt-1">
                  <div>Liq Price: {pos.liquidationPrice > 0 ? pos.liquidationPrice.toFixed(4) : 'N/A'}</div>
                  <div>Distance: {pos.liquidationDistancePercent.toFixed(1)}%</div>
                  <div>Current: {currentPrice.toFixed(4)}</div>
                </div>
              </div>
            }
            position="top"
          >
            <div className="p-2 rounded bg-tertiary/30 cursor-help">
              <div className="text-tertiary mb-1">Liq Distance</div>
              <div className={`mono font-semibold ${
                pos.liquidationDistancePercent < 5 ? 'text-red-400' :
                pos.liquidationDistancePercent < 10 ? 'text-orange-400' :
                pos.liquidationDistancePercent < 20 ? 'text-yellow-400' :
                'text-green-400'
              }`}>
                {pos.liquidationDistancePercent >= 100
                  ? '>100%'
                  : `${pos.liquidationDistancePercent.toFixed(1)}%`}
              </div>
            </div>
          </Tooltip>
        </div>

        {/* Engine Metrics Grid (filtered to skip duplicates) */}
        {filteredMetrics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {filteredMetrics.map((m, i) => (
              <div key={i} className="px-2 py-1 rounded bg-tertiary/30 text-xs">
                <span className="text-tertiary">{m.label}: </span>
                <span className={`mono font-medium ${m.color || 'text-secondary'}`}>{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Alerts */}
        {summary && summary.alerts.length > 0 && (
          <div className="space-y-1">
            {summary.alerts.map((alert, i) => (
              <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${
                summary.statusColor === 'red'
                  ? 'text-red-400 bg-red-500/10'
                  : summary.statusColor === 'orange'
                  ? 'text-orange-400 bg-orange-500/10'
                  : 'text-yellow-400 bg-yellow-500/10'
              }`}>
                <span className="flex-shrink-0">!</span>
                <span>{alert}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

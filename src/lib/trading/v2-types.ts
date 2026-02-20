/**
 * Trading Engine v2 - Type Definitions & Architecture
 *
 * This module defines the complete type system for the v2 trading engine.
 * The v2 engine replaces the old calculatePosition() function with a proper
 * position management system that matches the trader's rules:
 *
 * KEY TRADER RULES:
 * - No stop losses ever (willing to be liquidated)
 * - No predetermined take-profit levels
 * - Max 3 DCA entries, triggered by momentum exhaustion (not fixed %)
 * - 48h timebox with escalating exit pressure
 * - First entry 10-20% of available margin
 * - Total max 60-80% margin after all DCAs
 * - 80% confidence for full entry, 65-79% for cautious entry
 * - 10x leverage on Kraken
 * - Trust 15m and 1H timeframes primarily
 *
 * ARCHITECTURE:
 * - v2-types.ts (this file) - All type definitions
 * - position-sizing.ts - Margin-aware position sizing with DCA capacity
 * - dca-signals.ts - Momentum exhaustion detection for DCA timing
 * - exit-signals.ts - 48h timebox + condition-based exits + anti-greed
 *
 * These modules integrate with the existing:
 * - recommendation.ts (signal generation - modified weights, no stops)
 * - TradingDataProvider.tsx (data flow - adds position state)
 * - trading/page.tsx (UI - adds position dashboard)
 */

import type { Indicators, TradingRecommendation, TimeframeData } from '@/lib/kraken/types';

// ============================================================================
// POSITION STATE
// ============================================================================

/** Direction of the trade */
export type TradeDirection = 'long' | 'short';

/** Current phase of the position lifecycle */
export type PositionPhase =
  | 'idle'         // No position open
  | 'entry'        // Initial entry filled
  | 'dca_watch'    // Watching for DCA opportunities
  | 'in_dca'       // DCA was triggered, monitoring
  | 'exit_watch'   // Conditions forming for exit
  | 'exiting'      // Exit signal active, waiting for fill
  | 'closed';      // Position fully closed

/** Individual entry record (initial or DCA) */
export interface EntryRecord {
  /** Unique identifier for this entry */
  id: string;
  /** Entry type */
  type: 'initial' | 'dca';
  /** DCA level (0 for initial, 1-3 for DCAs) */
  dcaLevel: number;
  /** Entry price */
  price: number;
  /** Volume in base currency (e.g., XRP) */
  volume: number;
  /** Margin allocated for this entry in EUR */
  marginUsed: number;
  /** Margin as % of total available */
  marginPercent: number;
  /** Timestamp of entry */
  timestamp: number;
  /** Confidence score at time of entry */
  confidence: number;
  /** Whether this was a cautious or full entry */
  entryMode: 'full' | 'cautious';
  /** Reason/signal that triggered this entry */
  reason: string;
}

/**
 * Complete position state tracked by the engine.
 * This is the core data structure that all modules read/write.
 */
export interface PositionState {
  /** Whether a position is currently open */
  isOpen: boolean;
  /** Trade direction */
  direction: TradeDirection;
  /** Current lifecycle phase */
  phase: PositionPhase;

  // --- Entry tracking ---
  /** All entries (initial + DCAs) */
  entries: EntryRecord[];
  /** Volume-weighted average entry price */
  avgPrice: number;
  /** Total volume across all entries */
  totalVolume: number;
  /** Total margin used across all entries (EUR) */
  totalMarginUsed: number;
  /** Total margin as % of available margin */
  totalMarginPercent: number;
  /** Number of DCA entries executed (0-3) */
  dcaCount: number;

  // --- P&L tracking ---
  /** Current unrealized P&L in EUR */
  unrealizedPnL: number;
  /** Unrealized P&L as % of margin used */
  unrealizedPnLPercent: number;
  /** Leveraged P&L (unrealizedPnL * leverage-equivalent) */
  unrealizedPnLLevered: number;
  /** Leveraged P&L as % */
  unrealizedPnLLeveredPercent: number;
  /** Highest P&L reached during position (for anti-greed) */
  highWaterMarkPnL: number;
  /** Current drawdown from high water mark in EUR */
  drawdownFromHWM: number;
  /** Current drawdown from HWM as % */
  drawdownFromHWMPercent: number;

  // --- Time tracking ---
  /** Timestamp when position was first opened */
  openedAt: number;
  /** Total time in trade in milliseconds */
  timeInTradeMs: number;
  /** Hours remaining until 48h timebox expires */
  hoursRemaining: number;
  /** Timebox progress 0-1 (1 = expired) */
  timeboxProgress: number;

  // --- Risk tracking ---
  /** Estimated liquidation price */
  liquidationPrice: number;
  /** Distance to liquidation as % of current price */
  liquidationDistancePercent: number;
  /** Current leverage (from Kraken position data) */
  leverage: number;

  // --- Fees ---
  /** Total fees paid so far (trading + rollover) */
  totalFees: number;
  /** Estimated rollover cost per 4h */
  rolloverCostPer4h: number;
}

/**
 * Default/empty position state when no position is open
 */
export const EMPTY_POSITION_STATE: PositionState = {
  isOpen: false,
  direction: 'long',
  phase: 'idle',
  entries: [],
  avgPrice: 0,
  totalVolume: 0,
  totalMarginUsed: 0,
  totalMarginPercent: 0,
  dcaCount: 0,
  unrealizedPnL: 0,
  unrealizedPnLPercent: 0,
  unrealizedPnLLevered: 0,
  unrealizedPnLLeveredPercent: 0,
  highWaterMarkPnL: 0,
  drawdownFromHWM: 0,
  drawdownFromHWMPercent: 0,
  openedAt: 0,
  timeInTradeMs: 0,
  hoursRemaining: 48,
  timeboxProgress: 0,
  liquidationPrice: 0,
  liquidationDistancePercent: 0,
  leverage: 10,
  totalFees: 0,
  rolloverCostPer4h: 0,
};

// ============================================================================
// POSITION SIZING
// ============================================================================

/**
 * Configuration for position sizing calculations.
 * These are the trader's rules encoded as config.
 */
export interface PositionSizingConfig {
  /** Default leverage on Kraken (10x) */
  leverage: number;
  /** Margin % for first entry when confidence >= 80% */
  fullEntryMarginPercent: number;
  /** Margin % for first entry when confidence 65-79% */
  cautiousEntryMarginPercent: number;
  /** Minimum confidence to enter at all */
  minEntryConfidence: number;
  /** Confidence threshold for full entry */
  fullEntryConfidence: number;
  /** Maximum number of DCA entries */
  maxDCACount: number;
  /** Margin % per DCA entry */
  dcaMarginPercent: number;
  /** Maximum total margin % after all entries */
  maxTotalMarginPercent: number;
  /** Minimum margin % to keep free (safety buffer) */
  minFreeMarginPercent: number;
}

// DEFAULT_POSITION_SIZING is derived from the strategy JSON via strategies/index.ts

/**
 * Result of position sizing calculation.
 * Tells the trader exactly what to do.
 */
export interface PositionSizingResult {
  /** Whether entry is recommended */
  shouldEnter: boolean;
  /** Entry mode */
  entryMode: 'full' | 'cautious' | 'skip';
  /** Why we're skipping (if shouldEnter is false) */
  skipReason?: string;
  /** EUR margin to allocate */
  marginToUse: number;
  /** Margin as % of available */
  marginPercent: number;
  /** Position value (margin * leverage) */
  positionValue: number;
  /** Volume in base currency at current price */
  volume: number;
  /** Remaining margin capacity for DCAs after this entry */
  remainingDCACapacity: {
    /** How many more DCAs can fit */
    dcasRemaining: number;
    /** EUR available for future DCAs */
    marginAvailable: number;
    /** Max margin per DCA */
    marginPerDCA: number;
  };
}

// ============================================================================
// DCA SIGNALS
// ============================================================================

/** What type of momentum exhaustion was detected */
export type MomentumExhaustionType =
  | 'rsi_divergence'      // RSI diverging from price (bullish for long DCA)
  | 'volume_dry_up'       // Selling/buying volume drying up
  | 'macd_convergence'    // MACD histogram converging toward zero
  | 'bb_extreme_hold'     // Price holding at BB extreme without continuation
  | 'ema_slope_flatten'   // EMA slope flattening (momentum stalling)
  | 'candle_rejection'    // Wicks showing rejection at levels
  | 'multi_signal';       // Multiple signals aligning

/**
 * DCA signal - tells the engine when to add to a losing position.
 * Only triggers when price has moved against the position AND
 * momentum is exhausting (not just at fixed % drops).
 */
export interface DCASignal {
  /** Whether a DCA should be triggered now */
  shouldDCA: boolean;
  /** Confidence in the DCA signal (0-100) */
  confidence: number;
  /** What DCA level this would be (1, 2, or 3) */
  dcaLevel: number;
  /** Type of momentum exhaustion detected */
  exhaustionType: MomentumExhaustionType;
  /** How much price has moved against the position (%) */
  drawdownPercent: number;
  /** Individual exhaustion signals detected */
  signals: DCAExhaustionSignal[];
  /** Human-readable reason */
  reason: string;
  /** Suggested margin % for this DCA (may be reduced for higher levels) */
  suggestedMarginPercent: number;
  /** Warnings about the DCA */
  warnings: string[];
}

/** Individual exhaustion signal for DCA analysis */
export interface DCAExhaustionSignal {
  /** Signal name */
  name: string;
  /** Whether this signal is active */
  active: boolean;
  /** Signal value for display */
  value: string;
  /** Weight of this signal (0-1) */
  weight: number;
  /** Timeframe this signal was detected on */
  timeframe: '5m' | '15m' | '1h' | '4h';
}

/** No DCA - default state */
export const NO_DCA_SIGNAL: DCASignal = {
  shouldDCA: false,
  confidence: 0,
  dcaLevel: 0,
  exhaustionType: 'multi_signal',
  drawdownPercent: 0,
  signals: [],
  reason: 'No DCA conditions met',
  suggestedMarginPercent: 0,
  warnings: [],
};

// ============================================================================
// EXIT SIGNALS
// ============================================================================

/** What is driving the exit recommendation */
export type ExitReason =
  | 'timebox_expired'           // 48h timebox hit
  | 'timebox_approaching'       // Getting close to 48h
  | 'trend_reversal'            // HTF trend reversed against position
  | 'momentum_exhaustion'       // Favorable momentum exhausting (take profit)
  | 'anti_greed'                // Gave back too much from HWM
  | 'condition_deterioration'   // Entry conditions no longer valid
  | 'knife_detected'            // Knife detection triggered against position
  | 'reversal_detected'         // Candlestick reversal pattern detected against position
  | 'manual_override';          // User/AI forced exit

/** How urgent is the exit */
export type ExitUrgency = 'immediate' | 'soon' | 'consider' | 'monitor';

/**
 * Exit signal - tells the engine when and why to close.
 * No stop losses. No fixed TPs. Condition-based exits only.
 */
export interface ExitSignal {
  /** Whether an exit is recommended */
  shouldExit: boolean;
  /** How urgent the exit is */
  urgency: ExitUrgency;
  /** Primary reason for exit */
  reason: ExitReason;
  /** Confidence in exit signal (0-100) */
  confidence: number;
  /** Human-readable explanation */
  explanation: string;
  /** All active exit pressures */
  pressures: ExitPressure[];
  /** Composite exit pressure score (0-100) */
  totalPressure: number;
  /** Suggested exit % (partial exits possible) */
  suggestedExitPercent: number;
}

/** Individual exit pressure contributing to the decision */
export interface ExitPressure {
  /** Source of pressure */
  source: ExitReason;
  /** Pressure value (0-100) */
  value: number;
  /** Weight of this pressure source */
  weight: number;
  /** Human-readable detail */
  detail: string;
}

/** No exit - default state */
export const NO_EXIT_SIGNAL: ExitSignal = {
  shouldExit: false,
  urgency: 'monitor',
  reason: 'timebox_approaching',
  confidence: 0,
  explanation: 'No exit conditions met',
  pressures: [],
  totalPressure: 0,
  suggestedExitPercent: 0,
};

// ============================================================================
// ANTI-GREED CONFIGURATION
// ============================================================================

/**
 * Anti-greed rules prevent giving back too much profit.
 * Tracks high water mark and triggers exit if drawdown exceeds thresholds.
 */
export interface AntiGreedConfig {
  /** Enable anti-greed protection */
  enabled: boolean;
  /**
   * If P&L drops this % from the high water mark, trigger exit.
   * E.g., 0.50 means if you were up 100 EUR and drop to 50 EUR, exit.
   */
  drawdownThresholdPercent: number;
  /**
   * Minimum P&L in EUR before anti-greed activates.
   * Don't trigger anti-greed on tiny gains.
   */
  minPnLToActivate: number;
  /**
   * Minimum HWM in EUR before tracking drawdown.
   * Prevents noise from small fluctuations.
   */
  minHWMToTrack: number;
}

// DEFAULT_ANTI_GREED is derived from the strategy JSON via strategies/index.ts

// ============================================================================
// TIMEBOX CONFIGURATION
// ============================================================================

/**
 * 48-hour timebox with escalating exit pressure.
 * As time passes, pressure increases, making exit signals more aggressive.
 */
export interface TimeboxConfig {
  /** Maximum hours for a position */
  maxHours: number;
  /** Hour at which exit pressure starts escalating */
  escalationStartHours: number;
  /** Pressure curve: linear, exponential, or step */
  pressureCurve: 'linear' | 'exponential' | 'step';
  /** Step thresholds (only used when pressureCurve = 'step') */
  steps: TimeboxStep[];
}

export interface TimeboxStep {
  /** Hours into the trade */
  hours: number;
  /** Exit pressure at this step (0-100) */
  pressure: number;
  /** Label for display */
  label: string;
}

// DEFAULT_TIMEBOX is derived from the strategy JSON via strategies/index.ts

// ============================================================================
// SIGNAL EVALUATION CONFIG
// ============================================================================

/**
 * Configuration for how signals are evaluated to determine trade direction.
 * These thresholds control when the engine says LONG, SHORT, or WAIT.
 */
export interface SignalEvaluationConfig {
  /** Minimum strength score (0-100) to trigger a LONG or SHORT action */
  actionThreshold: number;
  /** Minimum lead over opposite direction to confirm action */
  directionLeadThreshold: number;
  /** Strength above this = "SIT ON HANDS" (forming but not actionable) */
  sitOnHandsThreshold: number;

  /** MACD histogram dead zone — values below this are treated as neutral (default 0.00005) */
  macdDeadZone?: number;
  /** Hysteresis gap: once a signal fires, it stays until strength drops actionThreshold - this value (default 8) */
  maintainThresholdGap?: number;

  /** Weighted signal scoring for direction strength calculation */
  directionWeights: DirectionWeightMap;

  /** Grade thresholds: strength >= value earns the grade */
  gradeThresholds: {
    A: number;
    B: number;
    C: number;
    D: number;
  };
}

/**
 * Weight map for each signal in the direction strength scoring.
 * Each signal gets a weight; the final score is a weighted average.
 */
export interface DirectionWeightMap {
  '1dTrend': number;
  '4hTrend': number;
  '1hSetup': number;
  '15mEntry': number;
  volume: number;
  btcAlign: number;
  macdMom: number;
  flow: number;
  liq: number;
  candlestick: number;
  reversal: number;
  marketStructure?: number;
  keyLevelProximity?: number;
  rejection?: number;
}

/** Liquidation zone-aware strategy config */
export interface LiquidationStrategyConfig {
  /** Cluster within this % of price = magnet */
  magnetProximityPct: number;
  /** Minimum zone strength for magnet classification */
  magnetMinStrength: number;
  /** Cluster within this % of price = wall */
  wallProximityPct: number;
  /** Minimum zone density for wall classification */
  wallMinDensity: number;
  /** Minimum zone strength for wall classification */
  wallMinStrength: number;
  /** Levels per zone to normalize density */
  densityNormFactor: number;
  /** Asymmetry ratio above this = "strong" */
  strongAsymmetryThreshold: number;
  /** Weight in weighted direction scoring */
  directionWeight: number;
  /** Per-effect confidence scoring */
  scoring: {
    magnetAligned: number;
    magnetOpposing: number;
    wallSupport: number;
    wallBlock: number;
    asymmetryAligned: number;
    asymmetryOpposing: number;
    fundingConfirm: number;
    proximityBonus: number;
  };
}

/** Key level proximity config for S/R scoring and RR checks */
export interface KeyLevelConfig {
  /** Proximity threshold (%) for "near a level" */
  nearProximityPct: number;
  /** Proximity threshold (%) for "strong proximity" (very close) */
  strongProximityPct: number;
  /** Minimum touches for a level to count */
  minTouches: number;
  /** Minimum level strength */
  minStrength: 'strong' | 'moderate' | 'weak';
  /** Minimum risk/reward ratio for entry */
  rrMinRatio: number;
  /** RR below this triggers a warning */
  rrWarningRatio: number;
  /** Multiplier for reversal signal value when reversal occurs at a key S/R level */
  reversalAtLevelMultiplier?: number;
  /** Proximity % for reversal-at-level detection (defaults to nearProximityPct) */
  reversalAtLevelProximityPct?: number;
}

/** Composite S/R rejection config — hard AND gate across level + candle + MACD + volume */
export interface RejectionConfig {
  enabled: boolean;
  /** Within X% of key level (default 1.0) */
  proximityPct: number;
  /** Volume must be >= Nx avg (default 1.2) */
  minVolumeRatio: number;
  /** Min extended pattern strength 0-1 (default 0.3) */
  minCandleStrength: number;
  /** Min |histogram| for confirmation (default 0.00005) */
  minMacdHistMagnitude: number;
  /** Histogram direction must match (default true) */
  requireMacdAlignment: boolean;
  /** Level strength filter */
  minLevelStrength: 'strong' | 'moderate' | 'weak';
  /** Level must have N+ touches (default 2) */
  minLevelTouches: number;
  /** Multiplier when reversal detector also fires (default 1.2) */
  reversalConfluenceBonus: number;
}

/** Fibonacci level configuration */
export interface FibonacciConfig {
  /** Enable Fibonacci level calculation */
  enabled: boolean;
  /** Retracement ratios to calculate */
  ratios: number[];
  /** Extension ratios (for RR estimation, not S/R scoring) */
  extensions: number[];
  /** Which timeframe intervals to compute Fibs on */
  timeframes: number[];
  /** Minimum swing range as multiple of ATR to calculate Fibs */
  minSwingRangeATRMultiple: number;
  /** Regime-based multipliers for Fib touch contribution */
  regimeMultipliers: {
    strong_trend: number;
    trending: number;
    ranging: number;
    low_volatility: number;
  };
}

/** Session filter config - confidence adjustments based on trading session */
export interface SessionFilterConfig {
  /** Enable session-based confidence adjustments */
  enabled: boolean;
  /** Confidence penalty during Asia session (00:00-07:00 UTC) */
  asiaDiscount: number;
  /** Confidence penalty during transition period (21:00-00:00 UTC) */
  transitionDiscount: number;
  /** Confidence penalty during weekend */
  weekendDiscount: number;
  /** Confidence bonus during Europe-US overlap (13:00-16:00 UTC) */
  overlapBonus: number;
}

/** Spread guardrail config - gates/penalizes entry when spread is abnormally wide */
export interface SpreadGuardConfig {
  /** Enable spread guardrail */
  enabled: boolean;
  /** Spread ratio (current/avg) above this triggers a warning */
  warnMultiplier: number;
  /** Spread ratio above this triggers a hard block */
  blockMultiplier: number;
  /** Confidence penalty for block-level spread */
  blockPenalty: number;
  /** Confidence penalty for warn-level spread */
  warnPenalty: number;
}

/** Derivatives config - OI trend + funding extreme enhancements for liq signal */
export interface DerivativesConfig {
  /** OI rising threshold (%) - OI up this much = rising trend */
  oiRisingThresholdPct: number;
  /** OI falling threshold (%) - OI down this much = falling trend */
  oiFallingThresholdPct: number;
  /** Funding rate beyond this = extreme (triggers signal adjustment) */
  fundingExtremeThreshold: number;
}

// ============================================================================
// BTC ALIGNMENT
// ============================================================================

/**
 * Strategy-driven BTC alignment configuration.
 * Each strategy defines which BTC timeframes to evaluate and how.
 */
export interface BTCAlignmentConfig {
  /** BTC OHLC timeframes to evaluate (Kraken interval minutes, e.g. [60, 15]) */
  timeframes: number[];
  /** EMA period for trend detection on each timeframe */
  emaPeriod: number;
  /** Number of recent candles to measure slope over */
  slopeCandles: number;
  /** Slope (% per candle) within this range is considered neutral */
  neutralZonePct: number;
  /** Weight per timeframe (same order as timeframes array, must sum to 1.0) */
  weights: number[];
}

/**
 * Per-timeframe BTC trend result from OHLC analysis.
 */
export interface BTCTimeframeTrend {
  /** Timeframe interval in minutes */
  interval: number;
  /** Trend direction */
  trend: 'bull' | 'bear' | 'neut';
  /** EMA slope (% per candle, positive = rising) */
  slope: number;
  /** Price position relative to EMA (-1 to +1: below/above, scaled by ATR) */
  emaPosition: number;
  /** How recently the trend started — higher = fresher momentum */
  freshness: number;
  /** Human-readable description */
  description: string;
}

/** Spike detection config for 5m timeframe */
export interface SpikeDetectionConfig {
  /** Volume ratio threshold for spike (e.g., 2.0 = 2x average) */
  volumeRatioThreshold: number;
  /** RSI below this = oversold spike (long opportunity) */
  oversoldRSI: number;
  /** RSI above this = overbought spike (short opportunity) */
  overboughtRSI: number;
}

// ============================================================================
// DCA EXHAUSTION THRESHOLDS
// ============================================================================

/**
 * Thresholds for the 5 momentum exhaustion signals used in DCA detection.
 * All values are configurable per strategy.
 */
export interface DCAExhaustionThresholds {
  /** RSI threshold for seller exhaustion (long DCA) */
  rsiOversold: number;
  /** RSI threshold for buyer exhaustion (short DCA) */
  rsiOverbought: number;

  /** Volume ratio below this = declining (5m) */
  volumeDecline5m: number;
  /** Volume ratio below this = fading (5m) */
  volumeFading5m: number;
  /** Volume ratio below this = confirming decline (15m) */
  volumeDecline15m: number;

  /** MACD histogram near-zero threshold for contraction */
  macdNearZero: number;
  /** MACD signal crossover proximity threshold */
  macdSignalProximity: number;

  /** BB position lower bound for "near middle" (volatility calming) */
  bbMiddleLow: number;
  /** BB position upper bound for "near middle" */
  bbMiddleHigh: number;

  /** Number of recent 5m candles to check for price stabilizing */
  priceStabilizingLookback: number;
  /** Minimum HL/LH matches needed for stabilizing signal */
  priceStabilizingMinMatches: number;

  /** Minimum hours between DCA entries, keyed by DCA level */
  minHoursBetweenByLevel: Record<number, number>;
}

// ============================================================================
// RISK CONFIG
// ============================================================================

/**
 * Risk management rules for the strategy.
 */
export interface RiskConfig {
  /** Whether to use stop losses (aggressive strategies don't) */
  useStopLoss: boolean;
  /** Whether to use fixed take-profit levels */
  useFixedTP: boolean;
  /** Whether to accept liquidation risk */
  acceptLiquidation: boolean;
}

// ============================================================================
// UNDERWATER POLICY (recovery mode for positions at loss)
// ============================================================================

/**
 * Strategy-driven policy for handling underwater (at-loss) positions.
 * When present and enabled, replaces panic exit signals with calm recovery UI.
 * When absent, current behavior (red EXIT NOW, timebox pressure) is preserved.
 */
export interface UnderwaterPolicy {
  enabled: boolean;
  /** Zero out timebox pressure entirely when position is at a loss */
  suppressTimeboxPressureWhenUnderwater: boolean;
  /** Multiplier for timebox weight when underwater (0.0 = no timebox influence) */
  underwaterTimeboxWeightMultiplier: number;
  /** Cap urgency at this level when position is underwater */
  maxUrgencyWhenUnderwater: 'monitor' | 'consider' | 'soon';
  /** Show the recovery panel UI instead of exit monitor */
  showRecoveryPanel: boolean;
  /** Show thesis review prompt in alerts */
  showThesisReviewPrompt: boolean;
  /** DCA adjustments when position is overdue + underwater */
  overdueDCA: {
    /** Confidence adjustment (e.g. -15 → 60% becomes 45%) */
    confidenceAdjustment: number;
    /** Min drawdown adjustment (e.g. -1.5 → 4% becomes 2.5%) */
    minDrawdownAdjustment: number;
    /** Time spacing multiplier (e.g. 0.5 → half the wait) */
    timeSpacingMultiplier: number;
  };
  /** Alert messages for recovery mode UI */
  alertMessages: {
    overdueUnderwater: string;
    dcaEncourage: string;
    costWarning: string;
  };
}

// ============================================================================
// AI INSTRUCTIONS
// ============================================================================

/**
 * AI instruction configuration embedded in the strategy.
 * Tells the AI assistant HOW to reason about this strategy.
 */
export interface AIInstructions {
  /** How the AI should communicate */
  personality: string;
  /** Non-negotiable rules the AI must follow */
  corePhilosophy: string[];
  /** How DCA works in this strategy */
  dcaGuidance: string;
  /** How exits work in this strategy */
  exitGuidance: string;
  /** Formatting and behavioral rules for AI responses */
  responseRules: string[];
}

// ============================================================================
// TRADING STRATEGY (master config object)
// ============================================================================

/**
 * Complete trading strategy definition.
 *
 * This is the single source of truth for ALL trading behavior.
 * Every function that makes a trading decision receives this object
 * (or a subset of it) as a parameter. No hardcoded thresholds anywhere.
 *
 * The current trader's philosophy is encoded as ONE instance:
 * AGGRESSIVE_SWING_10X
 */
export interface TradingStrategy {
  /** Strategy metadata */
  meta: {
    /** Unique strategy name */
    name: string;
    /** Strategy type — determines which evaluators the engine uses */
    type?: 'swing' | 'breakout';
    /** Human-readable description */
    description: string;
    /** Version for tracking changes */
    version: string;
    /** Asset pair this strategy is designed for */
    pair: string;
    /** Author or source */
    author: string;
  };

  /** Timeframe weights for recommendation engine */
  timeframeWeights: V2TimeframeWeights;
  /** Signal evaluation: how to score and threshold directions */
  signals: SignalEvaluationConfig;
  /** Spike detection on 5m */
  spike: SpikeDetectionConfig;

  /** Position sizing rules */
  positionSizing: PositionSizingConfig;
  /** DCA rules and exhaustion thresholds */
  dca: DCAConfig;
  /** Exit signal thresholds */
  exit: ExitConfig;
  /** Anti-greed protection */
  antiGreed: AntiGreedConfig;
  /** Timebox configuration */
  timebox: TimeboxConfig;
  /** Risk management rules */
  risk: RiskConfig;
  /** Liquidation zone-aware scoring config */
  liquidation?: LiquidationStrategyConfig;
  /** Market regime detection config */
  regime?: import('./market-regime').MarketRegimeConfig;
  /** Key level proximity and RR check config */
  keyLevels?: KeyLevelConfig;
  /** Fibonacci level config (feeds into confluent S/R, not a standalone signal) */
  fibonacci?: FibonacciConfig;
  /** Session-based confidence adjustments */
  session?: SessionFilterConfig;
  /** Spread guardrail config */
  spreadGuard?: SpreadGuardConfig;
  /** Derivatives (OI/funding) enhancement config */
  derivatives?: DerivativesConfig;
  /** Composite S/R rejection detection config */
  rejection?: RejectionConfig;
  /** BTC alignment evaluation config (timeframes, EMA, weights) */
  btcAlignment?: BTCAlignmentConfig;
  /** Optional AI instructions for strategy-aware assistant */
  aiInstructions?: AIInstructions;
  /** Optional underwater position management policy */
  underwaterPolicy?: UnderwaterPolicy;
}

// ============================================================================
// TRADING ENGINE CONFIG (backwards compat - subset of TradingStrategy)
// ============================================================================

/**
 * Master configuration for the v2 trading engine.
 * @deprecated Use TradingStrategy instead. This exists for backwards compat.
 */
export interface TradingEngineConfig {
  /** Position sizing rules */
  positionSizing: PositionSizingConfig;
  /** Anti-greed protection */
  antiGreed: AntiGreedConfig;
  /** Timebox configuration */
  timebox: TimeboxConfig;
  /** Timeframe weights for recommendation engine */
  timeframeWeights: V2TimeframeWeights;
  /** DCA-specific thresholds */
  dca: DCAConfig;
  /** Exit signal thresholds */
  exit: ExitConfig;
  /** Optional underwater position management policy */
  underwaterPolicy?: UnderwaterPolicy;
}

/** v2 timeframe weights - rebalanced for trader's preference */
export interface V2TimeframeWeights {
  '1d': number;
  '4h': number;
  '1h': number;   // Trader trusts 1H most for setup
  '15m': number;  // Trader trusts 15m most for entry
  '5m': number;
}

/** DCA-specific configuration (now includes exhaustion thresholds) */
export interface DCAConfig {
  /** Minimum drawdown % before considering DCA */
  minDrawdownForDCA: number;
  /** Minimum time (ms) between DCA entries */
  minTimeBetweenDCAs: number;
  /** Minimum exhaustion signal confidence for DCA */
  minExhaustionConfidence: number;
  /** Scale factor for DCA size per level (1.0 = same size, 1.5 = 50% larger) */
  dcaSizeScaleFactor: number;
  /** Whether to allow DCA after timebox midpoint */
  allowDCAAfterMidpoint: boolean;
  /** Per-signal exhaustion thresholds */
  exhaustionThresholds: DCAExhaustionThresholds;
}

/** Exit-specific configuration */
export interface ExitConfig {
  /** Exit pressure threshold to trigger exit recommendation */
  exitPressureThreshold: number;
  /** Minimum conditions that must flip for condition deterioration */
  minConditionFlips: number;
  /** Whether to allow partial exits */
  allowPartialExits: boolean;
  /** Minimum profit to consider taking (EUR) - prevents tiny exits */
  minProfitForExit: number;
}

// ============================================================================
// DEFAULT STRATEGY & CONSTANTS
// ============================================================================
//
// The single source of truth is the JSON file:
//   src/lib/trading/strategies/aggressive-swing-10x.json
//
// The strategy registry (strategies/index.ts) loads the JSON, hydrates it,
// and provides the getDefaultStrategy() API.
//
// These DEFAULT_* re-exports exist for backwards compatibility so that
// existing modules (position-sizing, dca-signals, exit-signals) can
// import defaults without changing their import paths.
// ============================================================================

import { getDefaultStrategy } from './strategies';

/** Get the current default strategy (loaded from JSON) */
function _defaults() {
  return getDefaultStrategy();
}

export const DEFAULT_V2_WEIGHTS: V2TimeframeWeights = _defaults().timeframeWeights;
export const DEFAULT_POSITION_SIZING: PositionSizingConfig = _defaults().positionSizing;
export const DEFAULT_DCA_CONFIG: DCAConfig = _defaults().dca;
export const DEFAULT_EXIT_CONFIG: ExitConfig = _defaults().exit;
export const DEFAULT_ANTI_GREED: AntiGreedConfig = _defaults().antiGreed;
export const DEFAULT_TIMEBOX: TimeboxConfig = _defaults().timebox;
export const DEFAULT_ENGINE_CONFIG: TradingEngineConfig = {
  positionSizing: _defaults().positionSizing,
  antiGreed: _defaults().antiGreed,
  timebox: _defaults().timebox,
  timeframeWeights: _defaults().timeframeWeights,
  dca: _defaults().dca,
  exit: _defaults().exit,
  underwaterPolicy: _defaults().underwaterPolicy,
};
export const DEFAULT_STRATEGY: TradingStrategy = _defaults();

/** @deprecated Use getDefaultStrategy() or getStrategy() from strategies/index.ts */
export const AGGRESSIVE_SWING_10X: TradingStrategy = _defaults();

// ============================================================================
// ENGINE INPUT / OUTPUT
// ============================================================================

/**
 * All data the engine needs per tick to make decisions.
 * Assembled by TradingDataProvider and passed to the engine.
 */
export interface EngineInput {
  /** Current price */
  currentPrice: number;
  /** Current recommendation from existing engine */
  recommendation: TradingRecommendation | null;
  /** Timeframe data for all timeframes */
  tfData: Record<number, TimeframeData>;
  /** BTC correlation */
  btcTrend: 'bull' | 'bear' | 'neut';
  btcChange: number;
  /** Available margin from trade balance (EUR) */
  availableMargin: number;
  /** Free margin from trade balance (EUR) */
  freeMargin: number;
  /** Total equity from trade balance (EUR) */
  equity: number;
  /** Current position state */
  position: PositionState;
  /** Timestamp */
  timestamp: number;
}

/**
 * Engine output per tick - what actions to take.
 * The UI reads this to show recommendations and the
 * execution layer uses it to place/manage orders.
 */
export interface EngineOutput {
  /** Updated position state */
  position: PositionState;
  /** Position sizing result (when no position or considering DCA) */
  sizing: PositionSizingResult | null;
  /** DCA signal (when position is open) */
  dcaSignal: DCASignal | null;
  /** Exit signal (when position is open) */
  exitSignal: ExitSignal | null;
  /** Summary for display */
  summary: EngineSummary;
}

/**
 * Human-readable summary for the UI dashboard
 */
export interface EngineSummary {
  /** Current status headline */
  headline: string;
  /** Status color for UI */
  statusColor: 'green' | 'yellow' | 'orange' | 'red' | 'gray' | 'blue';
  /** Key metrics for quick glance */
  metrics: {
    label: string;
    value: string;
    color?: string;
  }[];
  /** Active alerts/warnings */
  alerts: string[];
}

// ============================================================================
// CONDITION SNAPSHOT (for tracking deterioration)
// ============================================================================

/**
 * Snapshot of conditions at entry time.
 * Compared against current conditions to detect deterioration.
 */
export interface ConditionSnapshot {
  /** Timestamp of snapshot */
  timestamp: number;
  /** 4H trend at entry */
  trend4h: 'bullish' | 'bearish' | 'neutral';
  /** 1H trend at entry */
  trend1h: 'bullish' | 'bearish' | 'neutral';
  /** 15m RSI at entry */
  rsi15m: number;
  /** 1H MACD histogram at entry */
  macdHist1h: number;
  /** BTC trend at entry */
  btcTrend: 'bull' | 'bear' | 'neut';
  /** EMA alignment at entry */
  emaAlignment4h: 'bullish' | 'bearish' | 'mixed';
  /** Direction long/short scores at entry */
  longStrength: number;
  shortStrength: number;
  /** Number of checklist conditions passing at entry */
  conditionsPassing: number;
  /** Total conditions */
  conditionsTotal: number;
}

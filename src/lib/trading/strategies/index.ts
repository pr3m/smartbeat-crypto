/**
 * Strategy Loader & Registry
 *
 * Loads trading strategies from JSON files and provides a registry
 * for looking them up by name. This is the single source of truth
 * architecture: strategies are defined as JSON and hydrated into
 * TypeScript TradingStrategy objects.
 *
 * Usage:
 *   import { getStrategy, getDefaultStrategy, listStrategies } from './strategies';
 *   const strategy = getDefaultStrategy();
 *   const custom = getStrategy('AGGRESSIVE_SWING_10X');
 */

import type {
  TradingStrategy,
  DCAConfig,
  V2TimeframeWeights,
  SignalEvaluationConfig,
  SpikeDetectionConfig,
  PositionSizingConfig,
  ExitConfig,
  AntiGreedConfig,
  TimeboxConfig,
  RiskConfig,
  LiquidationStrategyConfig,
  KeyLevelConfig,
  FibonacciConfig,
  SessionFilterConfig,
  SpreadGuardConfig,
  DerivativesConfig,
  RejectionConfig,
} from '../v2-types';
import type { MarketRegimeConfig } from '../market-regime';

// Import strategy JSON files
import aggressiveSwing10xJson from './aggressive-swing-10x.json';
import breakoutPullback10xJson from './breakout-pullback-10x.json';

// ============================================================================
// JSON → TradingStrategy HYDRATION
// ============================================================================

/**
 * Hydrate a raw JSON object into a typed TradingStrategy.
 * Handles the minTimeBetweenDCAs conversion (JSON stores ms as number,
 * but the field name in JSON is `minTimeBetweenDCAsMs` for clarity).
 */
function hydrateStrategy(raw: Record<string, unknown>): TradingStrategy {
  const json = raw as Record<string, Record<string, unknown>>;

  // DCA config needs field name mapping: minTimeBetweenDCAsMs → minTimeBetweenDCAs
  const dcaRaw = json.dca as Record<string, unknown>;
  const dca: DCAConfig = {
    minDrawdownForDCA: dcaRaw.minDrawdownForDCA as number,
    minTimeBetweenDCAs: (dcaRaw.minTimeBetweenDCAsMs as number) ?? (dcaRaw.minTimeBetweenDCAs as number),
    minExhaustionConfidence: dcaRaw.minExhaustionConfidence as number,
    dcaSizeScaleFactor: dcaRaw.dcaSizeScaleFactor as number,
    allowDCAAfterMidpoint: dcaRaw.allowDCAAfterMidpoint as boolean,
    exhaustionThresholds: dcaRaw.exhaustionThresholds as DCAConfig['exhaustionThresholds'],
  };

  return {
    meta: json.meta as unknown as TradingStrategy['meta'],
    timeframeWeights: json.timeframeWeights as unknown as V2TimeframeWeights,
    signals: json.signals as unknown as SignalEvaluationConfig,
    spike: json.spike as unknown as SpikeDetectionConfig,
    positionSizing: json.positionSizing as unknown as PositionSizingConfig,
    dca,
    exit: json.exit as unknown as ExitConfig,
    antiGreed: json.antiGreed as unknown as AntiGreedConfig,
    timebox: json.timebox as unknown as TimeboxConfig,
    risk: json.risk as unknown as RiskConfig,
    liquidation: json.liquidation ? json.liquidation as unknown as LiquidationStrategyConfig : undefined,
    regime: json.regime ? json.regime as unknown as MarketRegimeConfig : undefined,
    keyLevels: json.keyLevels ? json.keyLevels as unknown as KeyLevelConfig : undefined,
    fibonacci: json.fibonacci ? json.fibonacci as unknown as FibonacciConfig : undefined,
    session: json.session ? json.session as unknown as SessionFilterConfig : undefined,
    spreadGuard: json.spreadGuard ? json.spreadGuard as unknown as SpreadGuardConfig : undefined,
    derivatives: json.derivatives ? json.derivatives as unknown as DerivativesConfig : undefined,
    rejection: json.rejection ? json.rejection as unknown as RejectionConfig : undefined,
    aiInstructions: json.aiInstructions as unknown as TradingStrategy['aiInstructions'],
  };
}

// ============================================================================
// STRATEGY VALIDATION
// ============================================================================

/** Validation error */
interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate a strategy object has all required fields and sensible values.
 * Returns an array of errors (empty = valid).
 */
export function validateStrategy(strategy: TradingStrategy): ValidationError[] {
  const errors: ValidationError[] = [];

  // Meta
  if (!strategy.meta?.name) errors.push({ field: 'meta.name', message: 'Strategy name is required' });
  if (!strategy.meta?.version) errors.push({ field: 'meta.version', message: 'Version is required' });

  // Timeframe weights must sum to 100
  const weights = strategy.timeframeWeights;
  if (weights) {
    const sum = weights['1d'] + weights['4h'] + weights['1h'] + weights['15m'] + weights['5m'];
    if (sum !== 100) {
      errors.push({ field: 'timeframeWeights', message: `Weights must sum to 100, got ${sum}` });
    }
  } else {
    errors.push({ field: 'timeframeWeights', message: 'Timeframe weights are required' });
  }

  // Signals
  if (strategy.signals) {
    if (strategy.signals.actionThreshold < 0 || strategy.signals.actionThreshold > 100) {
      errors.push({ field: 'signals.actionThreshold', message: 'Must be 0-100' });
    }
  } else {
    errors.push({ field: 'signals', message: 'Signal config is required' });
  }

  // Position sizing
  if (strategy.positionSizing) {
    const ps = strategy.positionSizing;
    if (ps.leverage < 1 || ps.leverage > 50) {
      errors.push({ field: 'positionSizing.leverage', message: 'Leverage must be 1-50' });
    }
    if (ps.maxTotalMarginPercent + ps.minFreeMarginPercent > 100) {
      errors.push({ field: 'positionSizing', message: 'maxTotalMarginPercent + minFreeMarginPercent cannot exceed 100' });
    }
    if (ps.fullEntryMarginPercent > ps.maxTotalMarginPercent) {
      errors.push({ field: 'positionSizing.fullEntryMarginPercent', message: 'Cannot exceed maxTotalMarginPercent' });
    }
  } else {
    errors.push({ field: 'positionSizing', message: 'Position sizing config is required' });
  }

  // DCA
  if (strategy.dca) {
    if (strategy.dca.minDrawdownForDCA < 0) {
      errors.push({ field: 'dca.minDrawdownForDCA', message: 'Must be >= 0' });
    }
  } else {
    errors.push({ field: 'dca', message: 'DCA config is required' });
  }

  // Exit
  if (strategy.exit) {
    if (strategy.exit.exitPressureThreshold < 0 || strategy.exit.exitPressureThreshold > 100) {
      errors.push({ field: 'exit.exitPressureThreshold', message: 'Must be 0-100' });
    }
  } else {
    errors.push({ field: 'exit', message: 'Exit config is required' });
  }

  // Timebox
  if (strategy.timebox) {
    if (strategy.timebox.maxHours <= 0) {
      errors.push({ field: 'timebox.maxHours', message: 'Must be > 0' });
    }
  } else {
    errors.push({ field: 'timebox', message: 'Timebox config is required' });
  }

  // Liquidation (optional)
  if (strategy.liquidation) {
    const liq = strategy.liquidation;
    if (liq.magnetProximityPct <= 0) {
      errors.push({ field: 'liquidation.magnetProximityPct', message: 'Must be > 0' });
    }
    if (liq.wallProximityPct <= 0) {
      errors.push({ field: 'liquidation.wallProximityPct', message: 'Must be > 0' });
    }
    if (liq.strongAsymmetryThreshold <= 0) {
      errors.push({ field: 'liquidation.strongAsymmetryThreshold', message: 'Must be > 0' });
    }
  }

  return errors;
}

// ============================================================================
// STRATEGY REGISTRY
// ============================================================================

/** Registry of all loaded strategies */
const strategyRegistry = new Map<string, TradingStrategy>();

/** Default strategy name */
const DEFAULT_STRATEGY_NAME = 'AGGRESSIVE_SWING_10X';

// Load built-in strategies on module init
function initRegistry() {
  const swing = hydrateStrategy(aggressiveSwing10xJson as unknown as Record<string, unknown>);
  strategyRegistry.set(swing.meta.name, swing);

  const breakout = hydrateStrategy(breakoutPullback10xJson as unknown as Record<string, unknown>);
  strategyRegistry.set(breakout.meta.name, breakout);
}

initRegistry();

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get a strategy by name. Throws if not found.
 */
export function getStrategy(name: string): TradingStrategy {
  const strategy = strategyRegistry.get(name);
  if (!strategy) {
    throw new Error(`Strategy "${name}" not found. Available: ${listStrategies().join(', ')}`);
  }
  return strategy;
}

/**
 * Get the default strategy (AGGRESSIVE_SWING_10X).
 */
export function getDefaultStrategy(): TradingStrategy {
  return getStrategy(DEFAULT_STRATEGY_NAME);
}

/**
 * List all registered strategy names.
 */
export function listStrategies(): string[] {
  return Array.from(strategyRegistry.keys());
}

/**
 * Register a custom strategy (e.g., loaded from user storage or API).
 * Validates before registering.
 */
export function registerStrategy(strategy: TradingStrategy): ValidationError[] {
  const errors = validateStrategy(strategy);
  if (errors.length > 0) {
    return errors;
  }
  strategyRegistry.set(strategy.meta.name, strategy);
  return [];
}

/**
 * Load a strategy from a raw JSON object (e.g., from file upload or API).
 * Hydrates and validates before registering.
 */
export function loadStrategyFromJSON(json: Record<string, unknown>): {
  strategy: TradingStrategy | null;
  errors: ValidationError[];
} {
  try {
    const strategy = hydrateStrategy(json);
    const errors = validateStrategy(strategy);
    if (errors.length > 0) {
      return { strategy: null, errors };
    }
    strategyRegistry.set(strategy.meta.name, strategy);
    return { strategy, errors: [] };
  } catch (err) {
    return {
      strategy: null,
      errors: [{ field: 'root', message: `Failed to parse strategy: ${err}` }],
    };
  }
}

/**
 * Export a strategy as a plain JSON-serializable object.
 * Useful for saving to file or sending via API.
 */
export function exportStrategyAsJSON(name: string): Record<string, unknown> {
  const strategy = getStrategy(name);
  return {
    ...strategy,
    dca: {
      ...strategy.dca,
      // Use the clearer JSON field name
      minTimeBetweenDCAsMs: strategy.dca.minTimeBetweenDCAs,
    },
  };
}

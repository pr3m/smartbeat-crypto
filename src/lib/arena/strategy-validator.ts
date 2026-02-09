/**
 * Strategy Validator - Validates & corrects LLM-generated strategies
 *
 * LLMs produce imperfect JSON. Rather than rejecting outright, this module
 * validates structural requirements, clamps numeric parameters to safe ranges,
 * and fills missing sections from DEFAULT_STRATEGY. The result is always a
 * usable TradingStrategy, along with any errors/warnings accumulated.
 */

import type { TradingStrategy } from '@/lib/trading/v2-types';
import { DEFAULT_STRATEGY } from '@/lib/trading/v2-types';
import { deepMerge } from './types';

// ============================================================================
// RESULT TYPE
// ============================================================================

export interface ValidatedStrategy {
  /** Whether the strategy passed validation (errors.length === 0) */
  valid: boolean;
  /** Hard errors (structural issues that required default fallback) */
  errors: string[];
  /** Soft warnings (values were clamped or normalized) */
  warnings: string[];
  /** The corrected, usable strategy */
  corrected: TradingStrategy;
}

// ============================================================================
// HELPERS
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Check whether a required top-level section exists and is an object */
function requireSection(
  raw: Record<string, unknown>,
  key: string,
  errors: string[]
): boolean {
  if (!(key in raw) || !isObj(raw[key])) {
    errors.push(`Missing or invalid section: "${key}" — using defaults`);
    return false;
  }
  return true;
}

// ============================================================================
// MAIN VALIDATOR
// ============================================================================

export function validateStrategy(
  raw: unknown,
  sessionDurationHours: number
): ValidatedStrategy {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Step 1: must be an object at all ---
  if (!isObj(raw)) {
    errors.push('Strategy is not an object — using full defaults');
    return { valid: false, errors, warnings, corrected: { ...DEFAULT_STRATEGY } };
  }

  const input = raw as Record<string, unknown>;

  // --- Step 2: structural checks — merge defaults for missing sections ---
  const requiredSections = [
    'timeframeWeights', 'positionSizing', 'timebox', 'spike',
    'signals', 'risk', 'dca', 'exit', 'antiGreed', 'meta',
  ] as const;

  for (const section of requiredSections) {
    requireSection(input, section, errors);
  }

  // Deep-merge raw onto defaults so every field has a value
  const merged = deepMerge(
    DEFAULT_STRATEGY as unknown as Record<string, unknown>,
    input as Record<string, unknown>
  ) as unknown as TradingStrategy;

  // --- Step 3: normalize timeframe weights to sum to 100 ---
  const tw = merged.timeframeWeights;
  const twKeys: (keyof typeof tw)[] = ['1d', '4h', '1h', '15m', '5m'];
  const twSum = twKeys.reduce((s, k) => s + (tw[k] || 0), 0);

  if (twSum !== 100 && twSum > 0) {
    const scale = 100 / twSum;
    for (const k of twKeys) {
      tw[k] = Math.round(tw[k] * scale * 100) / 100;
    }
    // Fix rounding residual
    const newSum = twKeys.reduce((s, k) => s + tw[k], 0);
    tw['1h'] += 100 - newSum;
    tw['1h'] = Math.round(tw['1h'] * 100) / 100;
    warnings.push(`timeframeWeights summed to ${twSum}, auto-normalized to 100`);
  } else if (twSum === 0) {
    errors.push('timeframeWeights all zero — using defaults');
    Object.assign(tw, DEFAULT_STRATEGY.timeframeWeights);
  }

  // --- Step 4: clamp parameter ranges (correct, don't reject) ---
  const ps = merged.positionSizing;

  function clampField<T extends Record<string, number>>(
    obj: T,
    field: keyof T & string,
    min: number,
    max: number,
    label: string
  ) {
    const original = obj[field];
    const clamped = clamp(original as number, min, max);
    if (clamped !== original) {
      warnings.push(`${label}: ${original} clamped to ${clamped} (range ${min}-${max})`);
      (obj as Record<string, number>)[field] = clamped;
    }
  }

  function forceField<T extends Record<string, unknown>>(
    obj: T,
    field: keyof T & string,
    value: unknown,
    label: string
  ) {
    if (obj[field] !== value) {
      warnings.push(`${label}: forced to ${value} (was ${String(obj[field])})`);
      (obj as Record<string, unknown>)[field] = value;
    }
  }

  // Leverage: force to 10
  forceField(ps as any, 'leverage', 10, 'positionSizing.leverage');

  // Position sizing clamps
  clampField(ps as any, 'fullEntryMarginPercent', 5, 20, 'positionSizing.fullEntryMarginPercent');
  clampField(ps as any, 'cautiousEntryMarginPercent', 3, 15, 'positionSizing.cautiousEntryMarginPercent');
  clampField(ps as any, 'minEntryConfidence', 40, 85, 'positionSizing.minEntryConfidence');
  clampField(ps as any, 'fullEntryConfidence', 60, 95, 'positionSizing.fullEntryConfidence');
  clampField(ps as any, 'maxDCACount', 0, 3, 'positionSizing.maxDCACount');

  // Timebox: maxHours clamped to [0.5, sessionDurationHours]
  clampField(merged.timebox as any, 'maxHours', 0.5, sessionDurationHours, 'timebox.maxHours');

  // Spike RSI clamps
  clampField(merged.spike as any, 'oversoldRSI', 15, 40, 'spike.oversoldRSI');
  clampField(merged.spike as any, 'overboughtRSI', 60, 85, 'spike.overboughtRSI');

  // Risk: force safety rails
  forceField(merged.risk as any, 'useStopLoss', false, 'risk.useStopLoss');
  forceField(merged.risk as any, 'acceptLiquidation', true, 'risk.acceptLiquidation');
  forceField(merged.risk as any, 'useFixedTP', false, 'risk.useFixedTP');

  // --- Step 5: validate meta strings ---
  const meta = merged.meta;
  if (!meta.name || typeof meta.name !== 'string') {
    meta.name = 'Unnamed Strategy';
    warnings.push('meta.name was missing — set to "Unnamed Strategy"');
  }
  if (!meta.description || typeof meta.description !== 'string') {
    meta.description = 'LLM-generated strategy';
    warnings.push('meta.description was missing — set to default');
  }
  if (!meta.version || typeof meta.version !== 'string') {
    meta.version = '1.0.0';
  }
  if (!meta.pair || typeof meta.pair !== 'string') {
    meta.pair = 'XRPEUR';
  }
  if (!meta.author || typeof meta.author !== 'string') {
    meta.author = 'arena-agent';
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    corrected: merged,
  };
}

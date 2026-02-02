/**
 * Knife State Persistence
 *
 * Manages stateful tracking of knife patterns per exchange:symbol:timeframe.
 * Uses dual TTL: candle-based (primary) + wall-clock (safety).
 */

export type KnifePhase = 'none' | 'impulse' | 'capitulation' | 'stabilizing' | 'confirming' | 'safe';
export type KnifeDirection = 'falling' | 'rising';

export interface KnifeState {
  key: string;                    // exchange:pair:tf
  direction: KnifeDirection;
  phase: KnifePhase;

  // Timeframe context (for TF-agnostic TTL)
  tfSec: number;                  // 900 for 15m, 3600 for 1h, etc.

  // Break context
  brokenLevel: number;
  breakTime: number;              // Unix SECONDS (matches OHLC)
  breakCandleIndex: number;       // Index in OHLC array at detection
  breakType: 'close' | 'wick_accept';  // How the break was detected

  // Impulse context (for retest comparisons)
  impulseStartIndex: number;
  impulseEndIndex: number;
  impulseVolBaseline: number;     // MEDIAN volume during impulse (not average)

  // Reclaim context
  reclaimTime?: number;           // Unix SECONDS
  reclaimCandleIndex?: number;

  // TTL tracking
  lastActivitySec: number;        // Unix SECONDS - for inactivity TTL
}

// In-memory store for knife states
const store = new Map<string, KnifeState>();

// TTL constants
const MAX_AGE_CANDLES = 48;        // 48 candles since break (e.g., 12h on 15m)
const MAX_INACTIVE_SEC = 6 * 3600; // 6 hours without update = stale

/**
 * Generate a unique key for exchange:pair:timeframe
 */
export function makeKnifeKey(exchange: string, pair: string, tf: string): string {
  return `${exchange}:${pair}:${tf}`;
}

/**
 * Get timeframe in seconds from timeframe string
 */
export function getTfSeconds(tf: string): number {
  const tfMap: Record<string, number> = {
    '5m': 5 * 60,
    '15m': 15 * 60,
    '1h': 60 * 60,
    '4h': 4 * 60 * 60,
    '1d': 24 * 60 * 60,
  };
  return tfMap[tf] || 15 * 60; // Default to 15m
}

/**
 * Retrieve knife state with TTL expiry check
 * @param key - The knife state key (exchange:pair:tf)
 * @param currentCandleTime - Must be latest OHLC candle time in Unix SECONDS
 */
export function getKnifeState(
  key: string,
  currentCandleTime: number
): KnifeState | null {
  const state = store.get(key);
  if (!state) return null;

  const nowSec = Math.floor(Date.now() / 1000);

  // Age-based expiry (candles since break)
  const candlesSinceBreak = Math.floor((currentCandleTime - state.breakTime) / state.tfSec);
  if (candlesSinceBreak > MAX_AGE_CANDLES) {
    store.delete(key);
    return null;
  }

  // Inactivity expiry (wall-clock since last update)
  if (nowSec - state.lastActivitySec > MAX_INACTIVE_SEC) {
    store.delete(key);
    return null;
  }

  return state;
}

/**
 * Set or update knife state
 * Automatically updates lastActivitySec
 */
export function setKnifeState(key: string, state: KnifeState | null): void {
  if (!state) {
    store.delete(key);
  } else {
    store.set(key, { ...state, lastActivitySec: Math.floor(Date.now() / 1000) });
  }
}

/**
 * Clear knife state for a key
 */
export function clearKnifeState(key: string): void {
  store.delete(key);
}

/**
 * Get all active knife states (for debugging/monitoring)
 */
export function getAllKnifeStates(): Map<string, KnifeState> {
  return new Map(store);
}

/**
 * Clear all knife states (for testing)
 */
export function clearAllKnifeStates(): void {
  store.clear();
}

/**
 * Log phase transition for monitoring
 */
export function logPhaseTransition(
  key: string,
  prevPhase: KnifePhase,
  newPhase: KnifePhase,
  brokenLevel: number,
  currentPrice: number,
  atr: number,
  signals: Record<string, boolean>
): void {
  if (prevPhase === newPhase) return;

  const distanceATR = atr !== 0 ? (currentPrice - brokenLevel) / atr : 0;
  const activeSignals = Object.entries(signals)
    .filter(([, v]) => v)
    .map(([k]) => k);

  console.log(`[Knife] ${key}: ${prevPhase} -> ${newPhase}`, {
    brokenLevel: brokenLevel.toFixed(5),
    distanceATR: distanceATR.toFixed(2),
    signals: activeSignals,
  });
}

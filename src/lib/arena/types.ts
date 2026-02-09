/**
 * Arena Trading Competition - Type Definitions
 *
 * Types for the gamified AI agent trading arena where 3-8 agents
 * compete in paper trading XRP/EUR with different strategies.
 */

import type { TradingStrategy } from '@/lib/trading/v2-types';
import type { Indicators, TimeframeData, TradingRecommendation } from '@/lib/kraken/types';

// ============================================================================
// SESSION CONFIG
// ============================================================================

export interface ArenaSessionConfig {
  pair: string;               // Always XRPEUR for now
  agentCount: number;         // 2-8
  startingCapital: number;    // EUR per agent
  decisionIntervalMs: number; // 60000 (1m), 300000 (5m), 900000 (15m)
  maxDurationHours: number;   // Session duration limit
  modelId: string;            // e.g. 'gpt-5-nano', 'gpt-4o-mini'
  leverage: number;           // Default leverage for all agents

  // Budget
  sessionBudgetUsd: number;   // Max API cost for entire session
  perAgentBudgetUsd?: number; // Optional per-agent cap

  // Agent selection
  archetypeIds?: string[];    // Which archetypes to use (if fewer than available)

  // Master Agent mode (AI-generated agents)
  useMasterAgent?: boolean;   // Default true - use AI to generate unique agents
}

export const DEFAULT_SESSION_CONFIG: ArenaSessionConfig = {
  pair: 'XRPEUR',
  agentCount: 5,
  startingCapital: 1000,
  decisionIntervalMs: 60000,   // 1 minute
  maxDurationHours: 4,
  modelId: 'gpt-5-nano',
  leverage: 10,
  sessionBudgetUsd: 1.0,
};

// ============================================================================
// AGENT ARCHETYPES
// ============================================================================

export type AvatarShape =
  | 'hexagon'
  | 'diamond'
  | 'circle'
  | 'triangle'
  | 'square'
  | 'pentagon'
  | 'octagon'
  | 'star';

export interface AgentArchetype {
  id: string;
  name: string;              // Display name like "The Knife"
  personality: string;       // ~100 word personality prompt for LLM
  avatarShape: AvatarShape;
  colorIndex: number;        // 0-7
  strategyMutations: DeepPartial<TradingStrategy>; // Merged onto base strategy
  marginPercentRange: [number, number]; // [min, max] margin % per trade
  maxTimeboxHours: number;   // Max hours to hold a position
  maxDCACount: number;       // Max DCAs allowed
  primaryIndicators: string[]; // Which indicators this agent focuses on
  regimePreferences: {
    trending: number;        // -1 to 1 preference weight
    ranging: number;
    volatile: number;
  };
}

// ============================================================================
// GENERATED AGENT CONFIG (produced by Master Agent or archetype converter)
// ============================================================================

export interface GeneratedAgentConfig {
  name: string;
  personality: string;
  avatarShape: AvatarShape;
  colorIndex: number;
  archetypeId: string;          // Dynamic slug (e.g. 'rsi_scalper_420')
  strategy: TradingStrategy;    // Complete strategy, not partial mutations
  commentaryTemplates: Partial<Record<CommentaryTrigger, string[]>>;
  tradingPhilosophy: string;    // One-liner like "Buy the dip, sell the rip"
  marketRegimePreference: {
    trending: number;           // -1 to 1
    ranging: number;
    volatile: number;
  };
  primaryIndicators: string[];
}

export interface MasterAgentRoster {
  agents: GeneratedAgentConfig[];
  sessionTheme: string;
  masterCommentary: string;
  tokensUsed: { input: number; output: number };
  costUsd: number;
}

// ============================================================================
// AGENT ACTIVITY (for UI real-time tracking)
// ============================================================================

export type AgentActivity = 'idle' | 'thinking' | 'trading' | 'holding' | 'waiting';

// ============================================================================
// AGENT STATE (in-memory, updated per tick)
// ============================================================================

export interface AgentState {
  agentId: string;
  name: string;
  archetypeId: string;
  avatarShape: AvatarShape;
  colorIndex: number;

  // Capital
  balance: number;           // Available EUR cash
  startingCapital: number;
  equity: number;            // balance + unrealized P&L

  // Position
  hasPosition: boolean;
  position: ArenaPositionState | null;

  // Performance
  totalPnl: number;
  totalFees: number;
  winCount: number;
  lossCount: number;
  maxDrawdown: number;
  peakEquity: number;

  // Health (0-100)
  health: number;
  healthZone: HealthZone;
  rank: number;

  // Status
  isDead: boolean;
  status: AgentStatus;
  deathTick?: number;
  deathReason?: string;

  // AI usage
  llmCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;

  // Trading history
  tradeCount: number;
  lastTradeAt?: number;

  // Badges
  badges: string[];

  // Activity tracking (new)
  activity?: AgentActivity;
  lastThought?: string;
  lastThoughtAt?: number;
  tradingPhilosophy?: string;
}

export type AgentStatus = 'alive' | 'liquidated' | 'bankrupt';

export type HealthZone = 'safe' | 'caution' | 'danger' | 'critical' | 'death_row' | 'dead';

export function getHealthZone(health: number): HealthZone {
  if (health <= 0) return 'dead';
  if (health <= 20) return 'death_row';
  if (health <= 40) return 'critical';
  if (health <= 60) return 'danger';
  if (health <= 80) return 'caution';
  return 'safe';
}

export function getHealthColor(zone: HealthZone): string {
  switch (zone) {
    case 'safe': return 'var(--green)';
    case 'caution': return 'var(--yellow)';
    case 'danger': return 'var(--orange)';
    case 'critical': return 'var(--red)';
    case 'death_row': return '#8b0000';
    case 'dead': return 'var(--foreground-tertiary)';
  }
}

// ============================================================================
// POSITION STATE (in-memory, per agent)
// ============================================================================

export interface ArenaPositionState {
  id: string;
  pair: string;
  side: 'long' | 'short';
  volume: number;
  avgEntryPrice: number;
  leverage: number;
  marginUsed: number;
  totalFees: number;
  dcaCount: number;
  dcaEntries: ArenaDCAEntry[];
  isOpen: boolean;
  openedAt: number;

  // Current P&L (updated each tick)
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  liquidationPrice: number;

  // Reasoning
  entryReasoning?: string;
}

export interface ArenaDCAEntry {
  price: number;
  volume: number;
  marginUsed: number;
  timestamp: number;
  reason: string;
}

// ============================================================================
// MARKET DATA (shared across all agents)
// ============================================================================

export interface SharedMarketData {
  price: number;
  timestamp: number;
  ticker: {
    bid: number;
    ask: number;
    last: number;
    volume24h: number;
    high24h: number;
    low24h: number;
  };
  tfData: Record<string, TimeframeData>;  // '5m', '15m', '1h', '4h', '1d'
  btcTrend: 'bull' | 'bear' | 'neut';
  btcChange: number;
  recommendation?: TradingRecommendation; // Base recommendation (no strategy mutations)
}

// ============================================================================
// AGENT DECISIONS
// ============================================================================

export type ArenaAction =
  | 'open_long'
  | 'open_short'
  | 'close'
  | 'dca'
  | 'hold'
  | 'wait';

export interface AgentDecision {
  action: ArenaAction;
  reasoning: string;
  confidence: number;        // 0-100
  usedLLM: boolean;
  marginPercent?: number;    // For open/dca: how much to risk (5-20%)
  inputTokens?: number;
  outputTokens?: number;
}

// ============================================================================
// ARENA EVENTS (for SSE stream & UI feed)
// ============================================================================

export type ArenaEventType =
  | 'tick'
  | 'agent_action'
  | 'trade_open'
  | 'trade_close'
  | 'trade_dca'
  | 'agent_death'
  | 'leaderboard_update'
  | 'face_off'
  | 'lead_change'
  | 'near_death'
  | 'hot_streak'
  | 'comeback'
  | 'market_shock'
  | 'badge_earned'
  | 'milestone'
  | 'session_started'
  | 'session_paused'
  | 'session_resumed'
  | 'session_ended'
  | 'budget_warning'
  | 'agent_hold'
  | 'agent_wait'
  | 'agent_analyzing'
  | 'agent_thinking'
  | 'roster_reveal'
  | 'session_countdown';

export type EventImportance = 'low' | 'medium' | 'high' | 'critical';

export interface ArenaEvent {
  id: string;
  type: ArenaEventType;
  agentId?: string;
  agentName?: string;
  importance: EventImportance;
  title: string;
  detail: string;
  priceAt: number;
  pnlChange?: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// SCORING & RANKINGS
// ============================================================================

export interface AgentRanking {
  agentId: string;
  name: string;
  rank: number;
  rarsScore: number;         // Risk-Adjusted Return Score
  pnlPercent: number;
  winRate: number;
  health: number;
  status: AgentStatus;
  tradeCount: number;
}

export interface SessionSummary {
  winner: {
    agentId: string;
    name: string;
    pnl: number;
    pnlPercent: number;
    trades: number;
  };
  rankings: AgentRanking[];
  titles: SessionTitle[];
  totalTrades: number;
  totalLLMCalls: number;
  totalCostUsd: number;
  marketChange: number;      // Price change % over session
  duration: number;          // Actual runtime in ms
  priceStart: number;
  priceEnd: number;
}

export interface SessionTitle {
  title: string;
  agentId: string;
  agentName: string;
  value: string;             // e.g. "+23.5%" or "8 trades"
}

// ============================================================================
// BADGES / ACHIEVEMENTS
// ============================================================================

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;              // emoji or icon name
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

// ============================================================================
// COMMENTARY
// ============================================================================

export type CommentaryTrigger =
  | 'on_entry'
  | 'on_exit_profit'
  | 'on_exit_loss'
  | 'on_dca'
  | 'on_death'
  | 'on_rival_death'
  | 'on_near_death'
  | 'on_comeback'
  | 'on_hot_streak'
  | 'on_face_off'
  | 'on_lead_change'
  | 'on_badge';

export interface CommentaryTemplate {
  trigger: CommentaryTrigger;
  templates: string[];       // Array of template strings with {variables}
}

// ============================================================================
// MODEL PRICING
// ============================================================================

export interface ModelPricing {
  modelId: string;
  inputPer1MTokens: number;  // USD per 1M input tokens
  outputPer1MTokens: number; // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5-nano': {
    modelId: 'gpt-5-nano',
    inputPer1MTokens: 0.10,
    outputPer1MTokens: 0.40,
  },
  'gpt-4o-mini': {
    modelId: 'gpt-4o-mini',
    inputPer1MTokens: 0.15,
    outputPer1MTokens: 0.60,
  },
  'gpt-4o': {
    modelId: 'gpt-4o',
    inputPer1MTokens: 2.50,
    outputPer1MTokens: 10.00,
  },
};

export function estimateTokenCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[modelId] || MODEL_PRICING['gpt-4o-mini'];
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1MTokens +
    (outputTokens / 1_000_000) * pricing.outputPer1MTokens
  );
}

// ============================================================================
// SSE STREAM TYPES
// ============================================================================

export type SSEEventType =
  | 'connected'
  | 'tick'
  | 'event'
  | 'leaderboard'
  | 'agent_update'
  | 'session_status'
  | 'error';

export interface SSEMessage {
  type: SSEEventType;
  data: unknown;
  timestamp: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Deep partial type for strategy mutations */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Deep merge two objects */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overrides: DeepPartial<T>
): T {
  const result = { ...base };
  for (const key in overrides) {
    const value = overrides[key];
    if (
      value !== undefined &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        value as DeepPartial<Record<string, unknown>>
      ) as T[typeof key];
    } else if (value !== undefined) {
      result[key] = value as T[typeof key];
    }
  }
  return result;
}

/** Generate a short unique ID */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

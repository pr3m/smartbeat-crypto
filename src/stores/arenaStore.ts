/**
 * Arena Store
 * Zustand store for managing Arena trading competition state
 */

import { create } from 'zustand';
import type {
  AgentState,
  ArenaEvent,
  ArenaSessionConfig,
  AgentRanking,
  SessionSummary,
  ArenaAction,
} from '@/lib/arena/types';

type ArenaSessionStatus = 'idle' | 'configuring' | 'running' | 'paused' | 'completed';
type BottomTab = 'history' | 'strategies';

const MAX_EVENTS = 500;

interface ArenaState {
  // Session
  sessionId: string | null;
  sessionStatus: ArenaSessionStatus;
  config: ArenaSessionConfig | null;
  elapsedMs: number;
  currentTick: number;
  currentPrice: number;

  // Agents
  agents: AgentState[];
  rankings: AgentRanking[];
  selectedAgentId: string | null;

  // Events (ring buffer, last 200)
  events: ArenaEvent[];
  eventFilter: ArenaAction | 'all';

  // Session results
  sessionSummary: SessionSummary | null;
  showEndModal: boolean;

  // API cost tracking
  totalCostUsd: number;
  totalLLMCalls: number;
  budgetPercent: number;

  // Historical data
  pastSessions: Array<{
    id: string;
    status: string;
    startedAt: string;
    endedAt?: string;
    agentCount: number;
    winnerName?: string;
    totalRunTimeMs?: number;
    config?: ArenaSessionConfig;
    winner?: { name: string; totalPnl: number; rank: number } | null;
  }>;
  strategies: Array<{
    id: string;
    name: string;
    sourceAgentName?: string;
    winRate: number;
    totalPnl: number;
    rating: number;
  }>;

  // Agent activity tracking
  agentActivities: Record<string, { activity: string; lastThought: string; lastThoughtAt: number }>;

  // Agent strategies and configs (set once at session start)
  agentStrategies: Record<string, unknown>; // TradingStrategy per agent
  agentConfigs: Record<string, unknown>; // GeneratedAgentConfig partial per agent

  // Deadline tracking
  deadlineRemainingMs: number;
  deadlineUrgency: 'normal' | 'warning' | 'critical' | 'final';

  // Roster reveal (AI-generated agents)
  rosterIntro: {
    theme: string;
    masterCommentary: string;
    agents: unknown[];
    isRevealing: boolean;
    generationCost: { inputTokens: number; outputTokens: number; costUsd: number };
  } | null;

  // Master agent cost tracking
  masterAgentCost: { inputTokens: number; outputTokens: number; costUsd: number } | null;

  // UI state
  bottomTab: BottomTab;
  sseConnected: boolean;

  // Actions
  setConfig: (config: ArenaSessionConfig) => void;
  setSessionStatus: (status: ArenaSessionStatus) => void;
  setSessionId: (id: string) => void;
  updateAgents: (agents: AgentState[]) => void;
  updateRankings: (rankings: AgentRanking[]) => void;
  selectAgent: (agentId: string | null) => void;
  addEvent: (event: ArenaEvent) => void;
  addEvents: (events: ArenaEvent[]) => void;
  setEventFilter: (filter: ArenaAction | 'all') => void;
  setCurrentPrice: (price: number) => void;
  setElapsedMs: (ms: number) => void;
  setCurrentTick: (tick: number) => void;
  setSessionSummary: (summary: SessionSummary) => void;
  setShowEndModal: (show: boolean) => void;
  updateCost: (cost: number, calls: number, budgetPct: number) => void;
  setBottomTab: (tab: BottomTab) => void;
  setSseConnected: (connected: boolean) => void;
  setPastSessions: (sessions: ArenaState['pastSessions']) => void;
  setStrategies: (strategies: ArenaState['strategies']) => void;
  updateAgentActivity: (agentId: string, activity: string, thought: string) => void;
  setAgentStrategies: (strategies: Record<string, unknown>) => void;
  setAgentConfigs: (configs: Record<string, unknown>) => void;
  updateDeadline: (remainingMs: number) => void;
  setRosterIntro: (intro: ArenaState['rosterIntro']) => void;
  setMasterAgentCost: (cost: ArenaState['masterAgentCost']) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  sessionStatus: 'idle' as ArenaSessionStatus,
  config: null,
  elapsedMs: 0,
  currentTick: 0,
  currentPrice: 0,
  agents: [],
  rankings: [],
  selectedAgentId: null,
  events: [],
  eventFilter: 'all' as ArenaAction | 'all',
  sessionSummary: null,
  showEndModal: false,
  totalCostUsd: 0,
  totalLLMCalls: 0,
  budgetPercent: 0,
  pastSessions: [],
  strategies: [],
  agentActivities: {},
  agentStrategies: {},
  agentConfigs: {},
  deadlineRemainingMs: 0,
  deadlineUrgency: 'normal' as const,
  rosterIntro: null,
  masterAgentCost: null,
  bottomTab: 'history' as BottomTab,
  sseConnected: false,
};

export const useArenaStore = create<ArenaState>((set) => ({
  ...initialState,

  // Actions
  setConfig: (config) => set({ config }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setSessionId: (id) => set({ sessionId: id }),

  updateAgents: (incoming) =>
    set((state) => {
      if (state.agents.length === 0) return { agents: incoming };
      // Merge incoming data with existing agents (preserve avatarShape, colorIndex, etc.)
      const merged = incoming.map((inc) => {
        const existing = state.agents.find((a) => a.agentId === inc.agentId);
        return existing ? { ...existing, ...inc } : inc;
      });
      return { agents: merged };
    }),
  updateRankings: (rankings) => set({ rankings }),
  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  addEvent: (event) =>
    set((state) => {
      const events = [...state.events, event];
      if (events.length > MAX_EVENTS) {
        return { events: events.slice(events.length - MAX_EVENTS) };
      }
      return { events };
    }),

  addEvents: (newEvents) =>
    set((state) => {
      // Deduplicate by event ID to handle SSE reconnect replays
      const existingIds = new Set(state.events.map((e) => e.id));
      const unique = newEvents.filter((e) => !existingIds.has(e.id));
      if (unique.length === 0) return state;
      const events = [...state.events, ...unique];
      if (events.length > MAX_EVENTS) {
        return { events: events.slice(events.length - MAX_EVENTS) };
      }
      return { events };
    }),

  setEventFilter: (filter) => set({ eventFilter: filter }),
  setCurrentPrice: (price) => set({ currentPrice: price }),
  setElapsedMs: (ms) => set({ elapsedMs: ms }),
  setCurrentTick: (tick) => set({ currentTick: tick }),
  setSessionSummary: (summary) => set({ sessionSummary: summary }),
  setShowEndModal: (show) => set({ showEndModal: show }),

  updateCost: (cost, calls, budgetPct) =>
    set({ totalCostUsd: cost, totalLLMCalls: calls, budgetPercent: budgetPct }),

  setBottomTab: (tab) => set({ bottomTab: tab }),
  setSseConnected: (connected) => set({ sseConnected: connected }),
  setPastSessions: (sessions) => set({ pastSessions: sessions }),
  setStrategies: (strategies) => set({ strategies }),

  updateAgentActivity: (agentId, activity, thought) =>
    set((state) => ({
      agentActivities: {
        ...state.agentActivities,
        [agentId]: { activity, lastThought: thought, lastThoughtAt: Date.now() },
      },
    })),

  setAgentStrategies: (strategies) => set({ agentStrategies: strategies }),
  setAgentConfigs: (configs) => set({ agentConfigs: configs }),

  updateDeadline: (remainingMs) => {
    let urgency: 'normal' | 'warning' | 'critical' | 'final' = 'normal';
    if (remainingMs <= 300000) urgency = 'final';       // 5 min
    else if (remainingMs <= 900000) urgency = 'critical'; // 15 min
    else if (remainingMs <= 3600000) urgency = 'warning'; // 1 hour
    return set({ deadlineRemainingMs: remainingMs, deadlineUrgency: urgency });
  },

  setRosterIntro: (intro) => set({ rosterIntro: intro }),
  setMasterAgentCost: (cost) => set({ masterAgentCost: cost }),

  reset: () => set(initialState),
}));

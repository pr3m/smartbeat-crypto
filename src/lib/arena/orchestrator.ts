/**
 * Arena Orchestrator
 *
 * Server-side singleton that runs the arena competition.
 * Uses setInterval for the tick loop, survives SSE disconnects.
 * Auto-pauses after 30s with no SSE subscribers.
 */

import { PrismaClient } from '@prisma/client';
import type {
  ArenaSessionConfig,
  AgentState,
  AgentDecision,
  ArenaEvent,
  ArenaEventType,
  AgentRanking,
  SessionSummary,
  SharedMarketData,
  AgentStatus,
  ArenaPositionState,
  GeneratedAgentConfig,
  AgentActivity,
  AvatarShape,
} from './types';
import { generateId, getHealthZone, DEFAULT_SESSION_CONFIG } from './types';
import { ArenaAgentEngine } from './agent-engine';
import { ArenaExecutionEngine } from './execution-engine';
import { MarketDataCache } from './market-cache';
import { ArenaEventDetector, createArenaEvent } from './events';
import { rankAgents, computeSessionTitles } from './scoring';
import { checkBadges, type TradeEvent } from './badges';
import { generateCommentary } from './commentary';

const prisma = new PrismaClient();

// ============================================================================
// TYPES
// ============================================================================

type OrchestratorStatus = 'idle' | 'running' | 'paused' | 'stopping';

interface DecisionBuffer {
  agentId: string;
  tick: number;
  action: string;
  reasoning: string | null;
  confidence: number;
  usedLLM: boolean;
  priceAt: number;
  balanceAt: number;
  pnlAt: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

// Persist singleton across Next.js HMR — without this, every file change
// creates a new orchestrator while the old one's setInterval keeps ticking to nobody.
const globalForArena = globalThis as unknown as { __arenaOrchestrator?: ArenaOrchestrator };

export class ArenaOrchestrator {
  private readonly instanceId = Math.random().toString(36).slice(2, 8);
  private status: OrchestratorStatus = 'idle';
  private sessionId: string | null = null;
  private config: ArenaSessionConfig = DEFAULT_SESSION_CONFIG;

  // Engines
  private agentEngines: Map<string, ArenaAgentEngine> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  private agentConfigs: Map<string, GeneratedAgentConfig> = new Map();
  private executionEngine: ArenaExecutionEngine = new ArenaExecutionEngine();
  private marketCache: MarketDataCache = MarketDataCache.getInstance();
  private eventDetector: ArenaEventDetector = new ArenaEventDetector();

  // Tick loop
  private intervalHandle: NodeJS.Timeout | null = null;
  private tickNumber: number = 0;
  private startTime: number = 0;
  private pauseTime: number = 0;
  private totalPausedMs: number = 0;

  // Decision buffering
  private decisionBuffer: DecisionBuffer[] = [];
  private lastFlushTick: number = 0;

  // SSE subscribers
  private listeners: Set<(event: ArenaEvent) => void> = new Set();
  private lastSubscriberTime: number = 0;
  private autoPauseHandle: NodeJS.Timeout | null = null;

  // Snapshot timing
  private lastSnapshotTime: number = 0;

  // Event buffer — stores non-tick events for replay on SSE reconnect
  private eventBuffer: ArenaEvent[] = [];
  private static readonly MAX_EVENT_BUFFER = 500;

  // Roster intro data (persisted for reconnect restoration)
  private rosterIntroData: {
    theme: string;
    masterCommentary: string;
    generationCost: { inputTokens: number; outputTokens: number; costUsd: number };
  } | null = null;

  constructor() {
    console.log(`[Arena] New ArenaOrchestrator instance created: ${this.instanceId}`);
  }

  static getInstance(): ArenaOrchestrator {
    if (!globalForArena.__arenaOrchestrator) {
      globalForArena.__arenaOrchestrator = new ArenaOrchestrator();
    }
    const inst = globalForArena.__arenaOrchestrator;
    console.log(`[Arena] getInstance() → ${inst.instanceId} (status=${inst.status}, session=${inst.sessionId}, agents=${inst.agentStates.size})`);
    return inst;
  }

  // ============================================================================
  // SESSION LIFECYCLE
  // ============================================================================

  async createSession(
    config: ArenaSessionConfig,
    agentConfigs: GeneratedAgentConfig[]
  ): Promise<{ sessionId: string; agents: AgentState[] }> {
    console.log(`[Arena:${this.instanceId}] createSession() called — current status=${this.status}, agents=${this.agentStates.size}`);
    if (this.status !== 'idle') {
      // Reset stale state if no session is actually running
      if (this.status !== 'running' && this.status !== 'paused') {
        this.status = 'idle';
        this.sessionId = null;
        this.agentEngines.clear();
        this.agentStates.clear();
        this.agentConfigs.clear();
      } else {
        throw new Error(`Cannot create session: orchestrator is ${this.status}`);
      }
    }

    this.config = config;
    this.eventBuffer = []; // Clear previous session's events
    const agentBudget = (config.perAgentBudgetUsd ?? config.sessionBudgetUsd / config.agentCount);

    // Create session in DB
    const session = await prisma.arenaSession.create({
      data: {
        status: 'pending',
        config: JSON.stringify(config),
      },
    });
    this.sessionId = session.id;

    // Create agents
    const selectedConfigs = agentConfigs.slice(0, config.agentCount);
    const agentStates: AgentState[] = [];

    for (let i = 0; i < selectedConfigs.length; i++) {
      const agentConfig = selectedConfigs[i];
      const engine = new ArenaAgentEngine(agentConfig, config.modelId, agentBudget);

      // Create agent in DB
      const dbAgent = await prisma.arenaAgent.create({
        data: {
          sessionId: session.id,
          name: agentConfig.name,
          personality: agentConfig.personality,
          avatarShape: agentConfig.avatarShape,
          colorIndex: agentConfig.colorIndex,
          strategyConfig: JSON.stringify(agentConfig.strategy),
          startingCapital: config.startingCapital,
          currentCapital: config.startingCapital,
          peakEquity: config.startingCapital,
          health: 100,
        },
      });

      const state: AgentState = {
        agentId: dbAgent.id,
        name: agentConfig.name,
        archetypeId: agentConfig.archetypeId,
        avatarShape: agentConfig.avatarShape,
        colorIndex: agentConfig.colorIndex,
        balance: config.startingCapital,
        startingCapital: config.startingCapital,
        equity: config.startingCapital,
        hasPosition: false,
        position: null,
        totalPnl: 0,
        totalFees: 0,
        winCount: 0,
        lossCount: 0,
        maxDrawdown: 0,
        peakEquity: config.startingCapital,
        health: 100,
        healthZone: 'safe',
        rank: i + 1,
        isDead: false,
        status: 'alive' as AgentStatus,
        llmCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedCostUsd: 0,
        tradeCount: 0,
        badges: [],
        activity: 'idle' as AgentActivity,
        lastThought: '',
        tradingPhilosophy: agentConfig.tradingPhilosophy,
      };

      this.agentEngines.set(dbAgent.id, engine);
      this.agentStates.set(dbAgent.id, state);
      this.agentConfigs.set(dbAgent.id, agentConfig);
      agentStates.push(state);
    }

    return { sessionId: session.id, agents: agentStates };
  }

  async start(): Promise<void> {
    console.log(`[Arena:${this.instanceId}] start() called — session=${this.sessionId}, agents=${this.agentStates.size}`);
    if (!this.sessionId) throw new Error('No session created');
    if (this.status === 'running') return;

    try {
      this.startTime = Date.now();
      this.tickNumber = 0;
      this.lastSubscriberTime = Date.now();

      // Fetch initial price BEFORE setting running (so failed fetch doesn't break state)
      const market = await this.marketCache.fetchMarketData(true);

      this.status = 'running';

      // Update DB
      await prisma.arenaSession.update({
        where: { id: this.sessionId },
        data: { status: 'running', startedAt: new Date(), startPrice: market.price },
      });

      // Emit session started event
      this.emitEvent(createArenaEvent(
        'session_started',
        'Arena Started',
        `${this.agentStates.size} agents competing at XRP/EUR ${market.price.toFixed(4)}`,
        'critical',
        market.price
      ));

      // Start tick loop
      this.intervalHandle = setInterval(() => {
        this.tick().catch(err => {
          console.error('[Arena] Tick error:', err);
        });
      }, this.config.decisionIntervalMs);
    } catch (err) {
      // Reset to idle so user can retry
      this.status = 'idle';
      console.error('[Arena] Start failed:', err);
      throw err;
    }
  }

  async pause(): Promise<void> {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.pauseTime = Date.now();

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    await prisma.arenaSession.update({
      where: { id: this.sessionId! },
      data: { status: 'paused' },
    });

    this.emitEvent(createArenaEvent(
      'session_paused', 'Arena Paused', 'Competition paused', 'medium',
      this.marketCache.getCachedData()?.price ?? 0
    ));
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') return;
    this.totalPausedMs += Date.now() - this.pauseTime;
    this.status = 'running';
    this.lastSubscriberTime = Date.now();

    await prisma.arenaSession.update({
      where: { id: this.sessionId! },
      data: { status: 'running' },
    });

    this.emitEvent(createArenaEvent(
      'session_resumed', 'Arena Resumed', 'Competition resumed', 'medium',
      this.marketCache.getCachedData()?.price ?? 0
    ));

    this.intervalHandle = setInterval(() => {
      this.tick().catch(err => {
        console.error('[Arena] Tick error:', err);
      });
    }, this.config.decisionIntervalMs);
  }

  async stop(): Promise<SessionSummary> {
    console.log(`[Arena:${this.instanceId}] stop() called — status=${this.status}, session=${this.sessionId}, agents=${this.agentStates.size}, startTime=${this.startTime}`);

    this.status = 'stopping';

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.autoPauseHandle) {
      clearTimeout(this.autoPauseHandle);
      this.autoPauseHandle = null;
    }

    // Fetch session record from DB — we need this for startPrice and as fallback
    let sessionRecord = this.sessionId
      ? await prisma.arenaSession.findUnique({
          where: { id: this.sessionId },
          include: { agents: true },
        })
      : null;

    // If no sessionId in memory, try to find the latest running/paused session from DB
    if (!sessionRecord) {
      sessionRecord = await prisma.arenaSession.findFirst({
        where: { status: { in: ['running', 'paused'] } },
        orderBy: { createdAt: 'desc' },
        include: { agents: true },
      });
      if (sessionRecord) {
        console.warn(`[Arena:${this.instanceId}] stop() — Found orphaned session ${sessionRecord.id} in DB`);
        this.sessionId = sessionRecord.id;
      }
    }

    // Force-close all open positions
    const market = await this.marketCache.fetchMarketData(true);
    for (const [agentId, state] of this.agentStates) {
      if (state.hasPosition && state.position) {
        const result = this.executionEngine.closePosition(state, market.price);
        this.agentStates.set(agentId, result.state);
      }
    }

    // Flush remaining decisions
    await this.flushDecisions();

    // Compute final rankings from in-memory state
    let agents = Array.from(this.agentStates.values());

    // FALLBACK: If in-memory agents are empty but DB has them, reconstruct from DB
    if (agents.length === 0 && sessionRecord?.agents && sessionRecord.agents.length > 0) {
      console.warn(`[Arena:${this.instanceId}] stop() — NO in-memory agents! Reconstructing from DB (${sessionRecord.agents.length} agents)`);
      agents = sessionRecord.agents.map((dbAgent, i) => ({
        agentId: dbAgent.id,
        name: dbAgent.name,
        archetypeId: 'db-fallback',
        avatarShape: dbAgent.avatarShape as AvatarShape,
        colorIndex: dbAgent.colorIndex,
        balance: dbAgent.currentCapital,
        startingCapital: dbAgent.startingCapital,
        equity: dbAgent.currentCapital,
        hasPosition: false,
        position: null,
        totalPnl: dbAgent.totalPnl,
        totalFees: dbAgent.totalFees,
        winCount: dbAgent.winCount,
        lossCount: dbAgent.lossCount,
        maxDrawdown: dbAgent.maxDrawdown,
        peakEquity: dbAgent.peakEquity,
        health: dbAgent.health,
        healthZone: getHealthZone(dbAgent.health),
        rank: dbAgent.rank || (i + 1),
        isDead: dbAgent.status !== 'alive',
        status: dbAgent.status as AgentStatus,
        llmCallCount: dbAgent.llmCallCount,
        totalInputTokens: dbAgent.totalInputTokens,
        totalOutputTokens: dbAgent.totalOutputTokens,
        estimatedCostUsd: dbAgent.estimatedCostUsd,
        tradeCount: dbAgent.winCount + dbAgent.lossCount,
        badges: [],
        activity: 'idle' as AgentActivity,
        lastThought: '',
        tradingPhilosophy: '',
      }));
    }

    const rankings = rankAgents(agents);
    const titles = computeSessionTitles(agents);

    const winner = rankings[0];
    const winnerState = agents.find(a => a.agentId === winner?.agentId);

    // Duration: use in-memory startTime if valid, otherwise fall back to DB startedAt
    let totalRunTimeMs: number;
    if (this.startTime > 0) {
      totalRunTimeMs = Date.now() - this.startTime - this.totalPausedMs;
    } else if (sessionRecord?.startedAt) {
      totalRunTimeMs = Date.now() - sessionRecord.startedAt.getTime();
      console.warn(`[Arena:${this.instanceId}] stop() — startTime was 0, using DB startedAt. Duration=${totalRunTimeMs}ms`);
    } else {
      totalRunTimeMs = 0;
      console.warn(`[Arena:${this.instanceId}] stop() — No valid start time available`);
    }

    const startPrice = sessionRecord?.startPrice ?? 0;

    console.log(`[Arena:${this.instanceId}] stop() computing summary — agents=${agents.length}, winner=${winner?.name}, duration=${totalRunTimeMs}ms`);

    const summary: SessionSummary = {
      winner: {
        agentId: winner?.agentId ?? '',
        name: winner?.name ?? 'Unknown',
        pnl: winnerState?.totalPnl ?? 0,
        pnlPercent: winner?.pnlPercent ?? 0,
        trades: winnerState?.tradeCount ?? 0,
      },
      rankings,
      titles,
      totalTrades: agents.reduce((sum, a) => sum + a.tradeCount, 0),
      totalLLMCalls: agents.reduce((sum, a) => sum + a.llmCallCount, 0),
      totalCostUsd: agents.reduce((sum, a) => sum + a.estimatedCostUsd, 0),
      marketChange: market.price && startPrice
        ? ((market.price - startPrice) / startPrice * 100)
        : 0,
      duration: totalRunTimeMs,
      priceStart: startPrice,
      priceEnd: market.price,
    };

    // Update DB session
    if (this.sessionId) await prisma.arenaSession.update({
      where: { id: this.sessionId },
      data: {
        status: 'completed',
        endedAt: new Date(),
        totalRunTimeMs,
        endPrice: market.price,
        summary: JSON.stringify(summary),
      },
    });

    // Update all agents in DB (skip if we loaded from DB fallback — data is already there)
    if (this.agentStates.size > 0) {
      for (const state of agents) {
        const ranking = rankings.find(r => r.agentId === state.agentId);
        await prisma.arenaAgent.update({
          where: { id: state.agentId },
          data: {
            currentCapital: state.balance,
            totalPnl: state.totalPnl,
            totalFees: state.totalFees,
            winCount: state.winCount,
            lossCount: state.lossCount,
            maxDrawdown: state.maxDrawdown,
            peakEquity: state.peakEquity,
            health: state.health,
            rank: ranking?.rank ?? 0,
            status: state.status,
            deathTick: state.deathTick ?? null,
            deathReason: state.deathReason ?? null,
            llmCallCount: state.llmCallCount,
            totalInputTokens: state.totalInputTokens,
            totalOutputTokens: state.totalOutputTokens,
            estimatedCostUsd: state.estimatedCostUsd,
          },
        });
      }
    }

    // Emit session ended
    this.emitEvent(createArenaEvent(
      'session_ended',
      'Arena Complete',
      `Winner: ${summary.winner.name} with ${summary.winner.pnlPercent.toFixed(1)}% returns`,
      'critical',
      market.price,
      undefined, undefined,
      { summary }
    ));

    // Reset state (keep eventBuffer so completed session events survive)
    this.status = 'idle';
    this.sessionId = null;
    this.agentEngines.clear();
    this.agentStates.clear();
    this.agentConfigs.clear();
    this.decisionBuffer = [];
    this.rosterIntroData = null;
    this.startTime = 0;
    this.tickNumber = 0;
    this.totalPausedMs = 0;
    this.pauseTime = 0;

    return summary;
  }

  // ============================================================================
  // TICK LOOP
  // ============================================================================

  private async tick(): Promise<void> {
    if (this.status !== 'running') return;

    this.tickNumber++;

    // Log every 5th tick to confirm the loop is running
    if (this.tickNumber % 5 === 1) {
      console.log(`[Arena:${this.instanceId}] tick #${this.tickNumber} — agents=${this.agentStates.size}, listeners=${this.listeners.size}`);
    }

    // Check max duration
    const elapsedMs = Date.now() - this.startTime - this.totalPausedMs;
    if (elapsedMs >= this.config.maxDurationHours * 60 * 60 * 1000) {
      await this.stop();
      return;
    }

    // Session deadline countdown events
    const totalDurationMs = this.config.maxDurationHours * 60 * 60 * 1000;
    const remainingMs = totalDurationMs - elapsedMs;
    const milestones = [3600000, 900000, 300000]; // 1h, 15m, 5m
    for (const ms of milestones) {
      const prevRemaining = totalDurationMs - (elapsedMs - this.config.decisionIntervalMs);
      if (remainingMs <= ms && prevRemaining > ms) {
        const label = ms >= 3600000 ? `${ms / 3600000}h` : `${ms / 60000}m`;
        this.emitEvent(createArenaEvent(
          'session_countdown',
          `${label} Remaining`,
          `Session ends in ${label}. The clock is ticking.`,
          ms <= 300000 ? 'critical' : ms <= 900000 ? 'high' : 'medium',
          this.marketCache.getCachedData()?.price ?? 0
        ));
      }
    }

    // Check auto-pause (no subscribers for 30s)
    if (this.listeners.size === 0 && Date.now() - this.lastSubscriberTime > 30000) {
      console.log(`[Arena:${this.instanceId}] Auto-pausing — no SSE subscribers for 30s`);
      await this.pause();
      return;
    }

    // 1. Fetch market data ONCE
    let market: SharedMarketData;
    try {
      market = await this.marketCache.fetchMarketData();
    } catch (err) {
      console.error('[Arena] Market data fetch failed:', err);
      return;
    }

    // 2. Check all alive agents - are any still alive?
    const aliveAgents = Array.from(this.agentStates.values()).filter(a => !a.isDead);
    if (aliveAgents.length <= 1) {
      // Only one or zero agents left - end session
      await this.stop();
      return;
    }

    // 3. Process each alive agent
    for (const [agentId, state] of this.agentStates) {
      if (state.isDead) continue;

      const engine = this.agentEngines.get(agentId);
      if (!engine) continue;

      // Check liquidation first
      if (state.hasPosition && state.position) {
        const liqCheck = this.executionEngine.checkLiquidation(state, market.price);
        if (liqCheck.isLiquidated) {
          // Agent is liquidated
          const closedState = this.executionEngine.closePosition(state, market.price);
          const updatedState: AgentState = {
            ...closedState.state,
            isDead: true,
            status: 'liquidated',
            deathTick: this.tickNumber,
            deathReason: liqCheck.reason || 'Position liquidated',
            health: 0,
            healthZone: 'dead',
          };
          this.agentStates.set(agentId, updatedState);

          const liqAgentConfig = this.agentConfigs.get(agentId);
          this.emitEvent(createArenaEvent(
            'agent_death',
            `${state.name} Liquidated`,
            generateCommentary('on_death', { name: state.name, price: market.price.toFixed(4) }, liqAgentConfig?.commentaryTemplates?.on_death),
            'critical',
            market.price,
            agentId, state.name
          ));

          // Save position to DB
          await this.saveClosedPosition(agentId, state.position, market.price, closedState.realizedPnl, closedState.fees);
          continue;
        }
      }

      // Update P&L
      let currentState = this.executionEngine.updatePositionPnL(state, market.price);

      // Get agent decision
      const decision = await engine.evaluate(currentState, market, this.tickNumber);

      // Execute decision
      currentState = await this.executeDecision(agentId, currentState, decision, market);

      // Update activity and thought
      if (engine) {
        currentState = {
          ...currentState,
          activity: engine.getActivity(decision),
          lastThought: decision.reasoning,
          lastThoughtAt: Date.now(),
        };
      }

      // Update health
      currentState = {
        ...currentState,
        health: this.executionEngine.calculateHealth(currentState),
        healthZone: getHealthZone(this.executionEngine.calculateHealth(currentState)),
      };

      // Check bankruptcy
      if (currentState.balance <= 0 && !currentState.hasPosition) {
        currentState = {
          ...currentState,
          isDead: true,
          status: 'bankrupt',
          deathTick: this.tickNumber,
          deathReason: 'Bankrupt - no funds remaining',
          health: 0,
          healthZone: 'dead',
        };
        const bankruptAgentConfig = this.agentConfigs.get(agentId);
        this.emitEvent(createArenaEvent(
          'agent_death',
          `${state.name} Bankrupt`,
          generateCommentary('on_death', { name: state.name, price: market.price.toFixed(4) }, bankruptAgentConfig?.commentaryTemplates?.on_death),
          'critical',
          market.price,
          agentId, state.name
        ));
      }

      // Track LLM usage
      if (decision.usedLLM) {
        currentState = {
          ...currentState,
          llmCallCount: currentState.llmCallCount + 1,
          totalInputTokens: currentState.totalInputTokens + (decision.inputTokens ?? 0),
          totalOutputTokens: currentState.totalOutputTokens + (decision.outputTokens ?? 0),
          estimatedCostUsd: currentState.estimatedCostUsd + (decision.inputTokens && decision.outputTokens
            ? (decision.inputTokens / 1_000_000) * 0.15 + (decision.outputTokens / 1_000_000) * 0.60
            : 0),
        };
      }

      this.agentStates.set(agentId, currentState);

      // Verbose: emit every decision as a feed event (hold/wait included)
      if (decision.action === 'hold' || decision.action === 'wait') {
        const posInfo = currentState.hasPosition && currentState.position
          ? ` | ${currentState.position.side.toUpperCase()} pos @ ${currentState.position.avgEntryPrice.toFixed(4)}, P&L: ${(currentState.position.unrealizedPnlPercent ?? 0).toFixed(1)}%`
          : ' | No position';
        this.emitEvent(createArenaEvent(
          decision.action === 'hold' ? 'agent_hold' : 'agent_wait',
          `${state.name}: ${decision.action.toUpperCase()}`,
          `${decision.reasoning || 'Monitoring market...'}${posInfo}`,
          'low',
          market.price,
          agentId, state.name,
          {
            action: decision.action,
            confidence: decision.confidence,
            balance: currentState.balance,
            health: currentState.health,
            usedLLM: decision.usedLLM,
          }
        ));
      }

      // Buffer decision
      this.bufferDecision(agentId, decision, market.price, currentState);
    }

    // 4. Detect dramatic events
    const allAgents = Array.from(this.agentStates.values());
    const events = this.eventDetector.detectEvents(allAgents, market, this.tickNumber);
    events.forEach(e => this.emitEvent(e));

    // 5. Update rankings
    const rankings = rankAgents(allAgents);
    this.eventDetector.updateRankings(allAgents);

    // Emit tick event with current state
    this.emitEvent(createArenaEvent(
      'tick',
      `Tick ${this.tickNumber}`,
      `Price: ${market.price.toFixed(4)}, Alive: ${aliveAgents.length}`,
      'low',
      market.price,
      undefined, undefined,
      {
        tick: this.tickNumber,
        elapsedMs,
        agents: allAgents.map(a => ({
          agentId: a.agentId,
          name: a.name,
          archetypeId: a.archetypeId,
          avatarShape: a.avatarShape,
          colorIndex: a.colorIndex,
          startingCapital: a.startingCapital,
          balance: a.balance,
          equity: a.equity,
          health: a.health,
          healthZone: a.healthZone,
          rank: a.rank,
          isDead: a.isDead,
          status: a.status,
          hasPosition: a.hasPosition,
          position: a.hasPosition && a.position ? {
            id: a.position.id,
            pair: a.position.pair,
            side: a.position.side,
            avgEntryPrice: a.position.avgEntryPrice,
            isOpen: a.position.isOpen,
            unrealizedPnl: a.position.unrealizedPnl,
            unrealizedPnlPercent: a.position.unrealizedPnlPercent,
            volume: a.position.volume,
            marginUsed: a.position.marginUsed,
            leverage: a.position.leverage,
            totalFees: a.position.totalFees,
            dcaCount: a.position.dcaCount,
            dcaEntries: a.position.dcaEntries,
            liquidationPrice: a.position.liquidationPrice,
            openedAt: a.position.openedAt,
          } : null,
          totalPnl: a.totalPnl,
          totalFees: a.totalFees,
          tradeCount: a.tradeCount,
          winCount: a.winCount,
          lossCount: a.lossCount,
          maxDrawdown: a.maxDrawdown,
          peakEquity: a.peakEquity,
          llmCallCount: a.llmCallCount,
          totalInputTokens: a.totalInputTokens,
          totalOutputTokens: a.totalOutputTokens,
          estimatedCostUsd: a.estimatedCostUsd,
          badges: a.badges,
          activity: a.activity,
          lastThought: a.lastThought,
          lastThoughtAt: a.lastThoughtAt,
          tradingPhilosophy: a.tradingPhilosophy,
        })),
        rankings,
      }
    ));

    // 6. Flush decisions every 10 ticks
    if (this.tickNumber - this.lastFlushTick >= 10) {
      await this.flushDecisions();
    }

    // 7. Save snapshot every 5 minutes
    if (Date.now() - this.lastSnapshotTime >= 5 * 60 * 1000) {
      await this.saveSnapshot(market.price);
    }
  }

  // ============================================================================
  // EXECUTION
  // ============================================================================

  private async executeDecision(
    agentId: string,
    state: AgentState,
    decision: AgentDecision,
    market: SharedMarketData
  ): Promise<AgentState> {
    switch (decision.action) {
      case 'open_long':
      case 'open_short': {
        if (state.hasPosition) return state;
        const side = decision.action === 'open_long' ? 'long' : 'short';
        const marginPct = decision.marginPercent ?? 10;
        const result = this.executionEngine.openPosition(
          state, side as 'long' | 'short', market.price, marginPct, this.config.leverage
        );

        const entryAgentConfig = this.agentConfigs.get(agentId);
        this.emitEvent(createArenaEvent(
          'trade_open',
          `${state.name} → ${side.toUpperCase()}`,
          generateCommentary('on_entry', {
            name: state.name,
            direction: side,
            price: market.price.toFixed(4),
          }, entryAgentConfig?.commentaryTemplates?.on_entry),
          'high',
          market.price,
          agentId, state.name,
          { side, marginPct }
        ));

        // Save position to DB
        await prisma.arenaPosition.create({
          data: {
            id: result.position.id,
            agentId,
            pair: this.config.pair,
            side,
            volume: result.position.volume,
            avgEntryPrice: result.position.avgEntryPrice,
            leverage: this.config.leverage,
            marginUsed: result.position.marginUsed,
            totalFees: result.position.totalFees,
            entryReasoning: JSON.stringify({ reasoning: decision.reasoning, confidence: decision.confidence }),
            entryConditions: JSON.stringify({ price: market.price, tick: this.tickNumber }),
          },
        });

        return result.state;
      }

      case 'close': {
        if (!state.hasPosition || !state.position) return state;
        const pos = state.position;
        const result = this.executionEngine.closePosition(state, market.price);
        const won = result.realizedPnl > 0;

        const newState = {
          ...result.state,
          tradeCount: result.state.tradeCount + 1,
          winCount: result.state.winCount + (won ? 1 : 0),
          lossCount: result.state.lossCount + (won ? 0 : 1),
        };

        // Track streaks for event detection
        const streakEvent = this.eventDetector.recordTradeResult(agentId, state.name, won, market.price);
        if (streakEvent) this.emitEvent(streakEvent);

        // Check badges
        const allAgents = Array.from(this.agentStates.values());
        const tradeEvent: TradeEvent = {
          type: 'trade_close',
          pnl: result.realizedPnl,
          duration: Date.now() - pos.openedAt,
          side: pos.side,
        };
        const earnedBadges = checkBadges(newState, allAgents, tradeEvent);
        if (earnedBadges.length > 0) {
          const updatedBadges = [...newState.badges, ...earnedBadges.map(b => b.id)];
          Object.assign(newState, { badges: updatedBadges });
          const badgeAgentConfig = this.agentConfigs.get(agentId);
          earnedBadges.forEach(badge => {
            this.emitEvent(createArenaEvent(
              'badge_earned',
              `${state.name}: ${badge.name}`,
              generateCommentary('on_badge', { name: state.name, badge_name: badge.name }, badgeAgentConfig?.commentaryTemplates?.on_badge),
              'medium',
              market.price,
              agentId, state.name,
              { badge }
            ));
          });
        }

        const trigger = won ? 'on_exit_profit' : 'on_exit_loss';
        const closeAgentConfig = this.agentConfigs.get(agentId);
        this.emitEvent(createArenaEvent(
          'trade_close',
          `${state.name} closes ${won ? 'WIN' : 'LOSS'}`,
          generateCommentary(trigger, {
            name: state.name,
            pnl_pct: Math.abs(result.realizedPnl / pos.marginUsed * 100).toFixed(1),
            pnl_eur: Math.abs(result.realizedPnl).toFixed(2),
          }, closeAgentConfig?.commentaryTemplates?.[trigger]),
          'high',
          market.price,
          agentId, state.name,
          { pnl: result.realizedPnl, fees: result.fees }
        ));

        // Save closed position to DB
        await this.saveClosedPosition(agentId, pos, market.price, result.realizedPnl, result.fees);

        return newState;
      }

      case 'dca': {
        if (!state.hasPosition || !state.position) return state;
        const marginPct = decision.marginPercent ?? 5;
        const result = this.executionEngine.dcaPosition(state, market.price, marginPct);

        const dcaAgentConfig = this.agentConfigs.get(agentId);
        this.emitEvent(createArenaEvent(
          'trade_dca',
          `${state.name} DCA #${result.position.dcaCount}`,
          generateCommentary('on_dca', {
            name: state.name,
            direction: result.position.side,
            price: market.price.toFixed(4),
          }, dcaAgentConfig?.commentaryTemplates?.on_dca),
          'medium',
          market.price,
          agentId, state.name
        ));

        // Update position in DB
        await prisma.arenaPosition.update({
          where: { id: result.position.id },
          data: {
            dcaCount: result.position.dcaCount,
            dcaHistory: JSON.stringify(result.position.dcaEntries),
            avgEntryPrice: result.position.avgEntryPrice,
            volume: result.position.volume,
            marginUsed: result.position.marginUsed,
            totalFees: result.position.totalFees,
          },
        });

        return result.state;
      }

      case 'hold':
      case 'wait':
      default:
        return state;
    }
  }

  // ============================================================================
  // DATA PERSISTENCE
  // ============================================================================

  private bufferDecision(
    agentId: string,
    decision: AgentDecision,
    price: number,
    state: AgentState
  ): void {
    // Only buffer interesting decisions or every 10th hold/wait
    const isInteresting = decision.action !== 'hold' && decision.action !== 'wait';
    if (!isInteresting && this.tickNumber % 10 !== 0) return;

    this.decisionBuffer.push({
      agentId,
      tick: this.tickNumber,
      action: decision.action,
      reasoning: isInteresting ? decision.reasoning : null,
      confidence: decision.confidence,
      usedLLM: decision.usedLLM,
      priceAt: price,
      balanceAt: state.balance,
      pnlAt: state.totalPnl,
      inputTokens: decision.inputTokens ?? null,
      outputTokens: decision.outputTokens ?? null,
    });
  }

  private async flushDecisions(): Promise<void> {
    if (this.decisionBuffer.length === 0) return;

    try {
      await prisma.arenaDecision.createMany({
        data: this.decisionBuffer.map(d => ({
          agentId: d.agentId,
          tick: d.tick,
          action: d.action,
          reasoning: d.reasoning,
          confidence: d.confidence,
          usedLLM: d.usedLLM,
          priceAt: d.priceAt,
          balanceAt: d.balanceAt,
          pnlAt: d.pnlAt,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
        })),
      });
      this.decisionBuffer = [];
      this.lastFlushTick = this.tickNumber;
    } catch (err) {
      console.error('[Arena] Failed to flush decisions:', err);
    }
  }

  private async saveSnapshot(price: number): Promise<void> {
    if (!this.sessionId) return;

    const agents = Array.from(this.agentStates.values());
    try {
      // Save snapshot for time-series data
      await prisma.arenaSnapshot.create({
        data: {
          sessionId: this.sessionId,
          data: JSON.stringify(agents.map(a => ({
            agentId: a.agentId,
            name: a.name,
            balance: a.balance,
            equity: a.equity,
            health: a.health,
            rank: a.rank,
            status: a.status,
            totalPnl: a.totalPnl,
            winCount: a.winCount,
            lossCount: a.lossCount,
            hasPosition: a.hasPosition,
          }))),
          marketPrice: price,
        },
      });

      // Also persist current agent state to ArenaAgent records
      // so DB is up-to-date if singleton is lost
      for (const a of agents) {
        await prisma.arenaAgent.update({
          where: { id: a.agentId },
          data: {
            currentCapital: a.balance,
            totalPnl: a.totalPnl,
            totalFees: a.totalFees,
            winCount: a.winCount,
            lossCount: a.lossCount,
            maxDrawdown: a.maxDrawdown,
            peakEquity: a.peakEquity,
            health: a.health,
            rank: a.rank,
            status: a.status,
            llmCallCount: a.llmCallCount,
            totalInputTokens: a.totalInputTokens,
            totalOutputTokens: a.totalOutputTokens,
            estimatedCostUsd: a.estimatedCostUsd,
          },
        });
      }

      this.lastSnapshotTime = Date.now();
    } catch (err) {
      console.error('[Arena] Failed to save snapshot:', err);
    }
  }

  private async saveClosedPosition(
    agentId: string,
    position: ArenaPositionState,
    exitPrice: number,
    realizedPnl: number,
    fees: number
  ): Promise<void> {
    try {
      await prisma.arenaPosition.update({
        where: { id: position.id },
        data: {
          isOpen: false,
          exitPrice,
          realizedPnl,
          totalFees: fees,
          holdDurationMs: Date.now() - position.openedAt,
          exitReasoning: JSON.stringify({ price: exitPrice, pnl: realizedPnl }),
          closedAt: new Date(),
        },
      });
    } catch (err) {
      console.error('[Arena] Failed to save closed position:', err);
    }
  }

  // ============================================================================
  // SSE SUBSCRIPTION
  // ============================================================================

  subscribe(listener: (event: ArenaEvent) => void): () => void {
    this.listeners.add(listener);
    this.lastSubscriberTime = Date.now();
    console.log(`[Arena:${this.instanceId}] subscribe() — now ${this.listeners.size} listeners, status=${this.status}, session=${this.sessionId}`);

    // Cancel auto-pause if we have subscribers
    if (this.autoPauseHandle) {
      clearTimeout(this.autoPauseHandle);
      this.autoPauseHandle = null;
    }

    // Auto-resume if paused
    if (this.status === 'paused' && this.sessionId) {
      this.resume().catch(err => console.error('[Arena] Auto-resume failed:', err));
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.lastSubscriberTime = Date.now();
      }
    };
  }

  private emitEvent(event: ArenaEvent): void {
    // Buffer non-tick events for replay on SSE reconnect
    if (event.type !== 'tick') {
      this.eventBuffer.push(event);
      if (this.eventBuffer.length > ArenaOrchestrator.MAX_EVENT_BUFFER) {
        this.eventBuffer = this.eventBuffer.slice(-ArenaOrchestrator.MAX_EVENT_BUFFER);
      }
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[Arena] Event listener error:', err);
      }
    }
  }

  // ============================================================================
  // GETTERS
  // ============================================================================

  getStatus(): OrchestratorStatus {
    return this.status;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getAgentStates(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  getAgentState(agentId: string): AgentState | undefined {
    return this.agentStates.get(agentId);
  }

  getCurrentTick(): number {
    return this.tickNumber;
  }

  getElapsedMs(): number {
    if (this.startTime === 0) return 0;
    return Date.now() - this.startTime - this.totalPausedMs;
  }

  getConfig(): ArenaSessionConfig {
    return this.config;
  }

  getEventBuffer(): ArenaEvent[] {
    return [...this.eventBuffer];
  }

  getAgentConfigsMap(): Map<string, GeneratedAgentConfig> {
    return this.agentConfigs;
  }

  getCurrentPrice(): number {
    return this.marketCache.getCachedData()?.price ?? 0;
  }

  getRankings(): AgentRanking[] {
    const agents = Array.from(this.agentStates.values());
    return agents.length > 0 ? rankAgents(agents) : [];
  }

  setRosterIntro(data: {
    theme: string;
    masterCommentary: string;
    generationCost: { inputTokens: number; outputTokens: number; costUsd: number };
  } | null): void {
    this.rosterIntroData = data;
  }

  getRosterIntro() {
    return this.rosterIntroData;
  }
}

'use client';

import { useEffect, useRef } from 'react';
import { useArenaStore } from '@/stores/arenaStore';
import type { ArenaEvent, AgentState, AgentRanking } from '@/lib/arena/types';

export function ArenaProvider({ children }: { children: React.ReactNode }) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSseConnected = useArenaStore((s) => s.setSseConnected);
  const addEvent = useArenaStore((s) => s.addEvent);
  const updateAgents = useArenaStore((s) => s.updateAgents);
  const updateRankings = useArenaStore((s) => s.updateRankings);
  const setCurrentPrice = useArenaStore((s) => s.setCurrentPrice);
  const setElapsedMs = useArenaStore((s) => s.setElapsedMs);
  const setCurrentTick = useArenaStore((s) => s.setCurrentTick);
  const setSessionId = useArenaStore((s) => s.setSessionId);
  const setSessionStatus = useArenaStore((s) => s.setSessionStatus);
  const setSessionSummary = useArenaStore((s) => s.setSessionSummary);
  const setShowEndModal = useArenaStore((s) => s.setShowEndModal);
  const updateCost = useArenaStore((s) => s.updateCost);
  const setConfig = useArenaStore((s) => s.setConfig);
  const updateAgentActivity = useArenaStore((s) => s.updateAgentActivity);
  const updateDeadline = useArenaStore((s) => s.updateDeadline);
  const setRosterIntro = useArenaStore((s) => s.setRosterIntro);
  const setAgentStrategies = useArenaStore((s) => s.setAgentStrategies);
  const setAgentConfigs = useArenaStore((s) => s.setAgentConfigs);
  const setMasterAgentCost = useArenaStore((s) => s.setMasterAgentCost);
  const addEvents = useArenaStore((s) => s.addEvents);

  useEffect(() => {
    function connect() {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource('/api/arena/stream');
      eventSourceRef.current = es;

      es.onopen = () => {
        setSseConnected(true);
      };

      es.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data);
          const type = parsed.type;
          // SSE messages use { type, data } wrapper; data may also be at top level
          const data = parsed.data ?? parsed;

          switch (type) {
            case 'connected':
              setSseConnected(true);
              if (data.sessionId) setSessionId(data.sessionId);
              if (data.status) setSessionStatus(data.status);
              if (data.config) setConfig(data.config);
              if (data.elapsedMs != null) setElapsedMs(data.elapsedMs);
              if (data.tick != null) setCurrentTick(data.tick);
              if (data.currentPrice != null) setCurrentPrice(data.currentPrice as number);
              // Restore agent strategies/configs from server on reconnect
              if (data.agentStrategies) setAgentStrategies(data.agentStrategies);
              if (data.agentConfigs) setAgentConfigs(data.agentConfigs);
              // Restore roster intro (not revealing since user already saw it)
              if (data.rosterIntro) {
                const ri = data.rosterIntro as { theme: string; masterCommentary: string; generationCost: { inputTokens: number; outputTokens: number; costUsd: number } };
                // Get agent configs to build the agents array for roster intro
                const agentConfigsState = useArenaStore.getState().agentConfigs;
                const agentsForIntro = Object.entries(agentConfigsState).map(([, cfg]) => cfg);
                setRosterIntro({
                  theme: ri.theme,
                  masterCommentary: ri.masterCommentary,
                  agents: agentsForIntro,
                  isRevealing: false, // Don't re-reveal on reconnect
                  generationCost: ri.generationCost,
                });
                setMasterAgentCost(ri.generationCost);
              }
              // Compute deadline from elapsed time
              if (data.config && data.elapsedMs != null) {
                const cfg = data.config as { maxDurationHours: number };
                const totalMs = cfg.maxDurationHours * 60 * 60 * 1000;
                const remaining = totalMs - (data.elapsedMs as number);
                updateDeadline(Math.max(0, remaining));
              }
              break;

            case 'tick': {
              // data contains: price, priceAt, elapsedMs, tick, agents, rankings
              if (data.price != null) setCurrentPrice(data.price);
              if (data.priceAt != null) setCurrentPrice(data.priceAt);
              if (data.elapsedMs != null) setElapsedMs(data.elapsedMs);
              if (data.tick != null) setCurrentTick(data.tick);
              if (Array.isArray(data.agents)) updateAgents(data.agents as AgentState[]);
              if (Array.isArray(data.rankings)) updateRankings(data.rankings as AgentRanking[]);
              // Compute cost from agent data
              if (Array.isArray(data.agents)) {
                const agents = data.agents as AgentState[];
                const totalCost = agents.reduce((s: number, a: AgentState) => s + (a.estimatedCostUsd ?? 0), 0);
                const totalCalls = agents.reduce((s: number, a: AgentState) => s + (a.llmCallCount ?? 0), 0);
                const config = useArenaStore.getState().config;
                const budgetPct = config ? (totalCost / config.sessionBudgetUsd) * 100 : 0;
                updateCost(totalCost, totalCalls, budgetPct);
              }
              // Extract activity data from tick agents
              if (Array.isArray(data.agents)) {
                for (const agent of data.agents as Array<Record<string, unknown>>) {
                  if (agent.agentId && agent.activity) {
                    updateAgentActivity(
                      agent.agentId as string,
                      agent.activity as string,
                      (agent.lastThought as string) ?? ''
                    );
                  }
                }

                // Update deadline from elapsed time
                const configState = useArenaStore.getState().config;
                if (configState && data.elapsedMs != null) {
                  const totalMs = configState.maxDurationHours * 60 * 60 * 1000;
                  const remaining = totalMs - (data.elapsedMs as number);
                  updateDeadline(Math.max(0, remaining));
                }
              }
              break;
            }

            case 'agent_update': {
              // data may be { agents: [...] } or an array directly
              const agents = Array.isArray(data) ? data : data.agents;
              if (Array.isArray(agents)) {
                updateAgents(agents as AgentState[]);
                // Extract cost, activity data (same as tick handler)
                const agentArr = agents as AgentState[];
                const totalCost = agentArr.reduce((s: number, a: AgentState) => s + (a.estimatedCostUsd ?? 0), 0);
                const totalCalls = agentArr.reduce((s: number, a: AgentState) => s + (a.llmCallCount ?? 0), 0);
                const config = useArenaStore.getState().config;
                const budgetPct = config ? (totalCost / config.sessionBudgetUsd) * 100 : 0;
                updateCost(totalCost, totalCalls, budgetPct);
                for (const agent of agentArr) {
                  if (agent.agentId && agent.activity) {
                    updateAgentActivity(agent.agentId, agent.activity, agent.lastThought ?? '');
                  }
                }
              }
              break;
            }

            case 'leaderboard':
              if (Array.isArray(data.rankings)) {
                updateRankings(data.rankings as AgentRanking[]);
              }
              break;

            case 'event': {
              // Wrapped event: { type: 'event', data: { event } }
              const evt = data.event as ArenaEvent | undefined;
              if (evt) addEvent(evt);
              break;
            }

            case 'event_replay': {
              // Bulk replay of buffered events on reconnect
              const replayEvents = data.events as ArenaEvent[] | undefined;
              if (Array.isArray(replayEvents) && replayEvents.length > 0) {
                addEvents(replayEvents);
              }
              break;
            }

            case 'session_status':
              if (data.status) setSessionStatus(data.status);
              if (data.sessionId) setSessionId(data.sessionId);
              if (data.config) setConfig(data.config);
              if (data.status === 'completed' && data.summary) {
                setSessionSummary(data.summary);
                setShowEndModal(true);
              }
              break;

            case 'error':
              console.error('[Arena SSE] Server error:', data);
              break;

            default: {
              // Fallback: treat as raw ArenaEvent (for direct orchestrator events)
              const arenaEvent = parsed as ArenaEvent;
              if (arenaEvent.type === 'session_ended' && arenaEvent.metadata?.summary) {
                setSessionSummary(arenaEvent.metadata.summary as never);
                setSessionStatus('completed');
                setShowEndModal(true);
              }
              // Handle roster reveal events
              if (arenaEvent.type === 'roster_reveal' as string) {
                // These are informational - just add to event feed
              }
              // Handle countdown events
              if (arenaEvent.type === 'session_countdown' as string) {
                // These are informational - just add to event feed
              }
              if (arenaEvent.id && arenaEvent.type) {
                addEvent(arenaEvent);
              }
              break;
            }
          }
        } catch (err) {
          console.error('[Arena SSE] Parse error:', err);
        }
      };

      es.onerror = () => {
        setSseConnected(false);
        es.close();
        eventSourceRef.current = null;
        // Reconnect after 3 seconds
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setSseConnected(false);
    };
  }, [
    setSseConnected, setSessionStatus, setSessionId, setCurrentPrice,
    setElapsedMs, setCurrentTick, updateAgents, updateRankings,
    addEvent, addEvents, updateCost, setSessionSummary, setShowEndModal, setConfig,
    updateAgentActivity, updateDeadline, setRosterIntro, setAgentStrategies,
    setAgentConfigs, setMasterAgentCost,
  ]);

  return <>{children}</>;
}

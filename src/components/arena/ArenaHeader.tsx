'use client';

import { useState, useEffect } from 'react';
import { useArenaStore } from '@/stores/arenaStore';
import { DEFAULT_SESSION_CONFIG, MODEL_PRICING, type ArenaSessionConfig } from '@/lib/arena/types';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const INTERVAL_OPTIONS = [
  { value: 60000, label: '1m' },
  { value: 300000, label: '5m' },
  { value: 900000, label: '15m' },
];

const DURATION_OPTIONS = [
  { value: 1, label: '1h' },
  { value: 2, label: '2h' },
  { value: 4, label: '4h' },
  { value: 8, label: '8h' },
  { value: 24, label: '24h' },
];

const MODEL_OPTIONS = Object.keys(MODEL_PRICING);

function intervalLabel(ms: number): string {
  if (ms >= 60000) return `${ms / 60000}m`;
  return `${ms / 1000}s`;
}

export function ArenaHeader() {
  const sessionStatus = useArenaStore((s) => s.sessionStatus);
  const elapsedMs = useArenaStore((s) => s.elapsedMs);
  const currentPrice = useArenaStore((s) => s.currentPrice);
  const currentTick = useArenaStore((s) => s.currentTick);
  const agents = useArenaStore((s) => s.agents);
  const totalCostUsd = useArenaStore((s) => s.totalCostUsd);
  const totalLLMCalls = useArenaStore((s) => s.totalLLMCalls);
  const budgetPercent = useArenaStore((s) => s.budgetPercent);
  const config = useArenaStore((s) => s.config);
  const sseConnected = useArenaStore((s) => s.sseConnected);
  const setConfig = useArenaStore((s) => s.setConfig);
  const setSessionId = useArenaStore((s) => s.setSessionId);
  const setSessionStatus = useArenaStore((s) => s.setSessionStatus);
  const updateAgents = useArenaStore((s) => s.updateAgents);
  const deadlineRemainingMs = useArenaStore((s) => s.deadlineRemainingMs);
  const deadlineUrgency = useArenaStore((s) => s.deadlineUrgency);
  const rosterIntro = useArenaStore((s) => s.rosterIntro);
  const masterAgentCost = useArenaStore((s) => s.masterAgentCost);
  const setRosterIntro = useArenaStore((s) => s.setRosterIntro);
  const setAgentStrategies = useArenaStore((s) => s.setAgentStrategies);
  const setAgentConfigs = useArenaStore((s) => s.setAgentConfigs);
  const setMasterAgentCost = useArenaStore((s) => s.setMasterAgentCost);

  const [showConfig, setShowConfig] = useState(false);
  // Note: useMasterAgent is part of configForm since ArenaSessionConfig now has it
  const [configForm, setConfigForm] = useState<ArenaSessionConfig>({
    ...(config || DEFAULT_SESSION_CONFIG),
    useMasterAgent: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [tickProgress, setTickProgress] = useState(0);

  const aliveCount = agents.filter(a => !a.isDead).length;
  const totalCount = agents.length;
  const intervalMs = config?.decisionIntervalMs ?? DEFAULT_SESSION_CONFIG.decisionIntervalMs;

  // Tick countdown: reset progress on each new tick, animate to 100% over intervalMs
  useEffect(() => {
    if (sessionStatus !== 'running') {
      setTickProgress(0);
      return;
    }
    setTickProgress(0);
    const startTime = Date.now();
    const frame = () => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, (elapsed / intervalMs) * 100);
      setTickProgress(pct);
      if (pct < 100) rafRef = requestAnimationFrame(frame);
    };
    let rafRef = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef);
  }, [currentTick, sessionStatus, intervalMs]);

  const handleCreateSession = async () => {
    setError(null);
    setStarting(true);
    setProgressMsg(configForm.useMasterAgent !== false ? 'Connecting...' : 'Starting...');
    try {
      const res = await fetch('/api/arena/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', config: configForm }),
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = `Server error: ${res.status}`;
        try { msg = JSON.parse(text).error || msg; } catch { /* noop */ }
        setError(msg);
        return;
      }

      // Read NDJSON stream for progress updates
      const reader = res.body?.getReader();
      if (!reader) {
        setError('No response stream');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete last line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            if (event.type === 'progress') {
              setProgressMsg(event.message);
            } else if (event.type === 'error') {
              setError(event.error);
              return;
            } else if (event.type === 'done') {
              // Final payload — same shape as the old JSON response
              const data = event;
              if (data.sessionId) {
                setSessionId(data.sessionId);
                setConfig(configForm);
                setSessionStatus('running');
                if (data.agents) {
                  updateAgents(data.agents.map((a: Record<string, unknown>) => ({
                    agentId: a.agentId,
                    name: a.name,
                    archetypeId: a.archetypeId,
                    avatarShape: a.avatarShape,
                    colorIndex: a.colorIndex,
                    startingCapital: a.startingCapital,
                    balance: a.startingCapital,
                    equity: a.startingCapital,
                    health: 100,
                    healthZone: 'safe',
                    rank: 0,
                    isDead: false,
                    status: 'alive',
                    hasPosition: false,
                    position: null,
                    totalPnl: 0,
                    totalFees: 0,
                    winCount: 0,
                    lossCount: 0,
                    maxDrawdown: 0,
                    peakEquity: a.startingCapital,
                    llmCallCount: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    estimatedCostUsd: 0,
                    tradeCount: 0,
                    tradingPhilosophy: (a.tradingPhilosophy as string) || '',
                    badges: [],
                  })));
                  if (data.agentStrategies) setAgentStrategies(data.agentStrategies);
                  if (data.agentConfigs) setAgentConfigs(data.agentConfigs);
                  if (data.rosterIntro) {
                    setMasterAgentCost(data.rosterIntro.generationCost);
                    setRosterIntro({
                      theme: data.rosterIntro.theme,
                      masterCommentary: data.rosterIntro.masterCommentary,
                      agents: data.agents || [],
                      isRevealing: true,
                      generationCost: data.rosterIntro.generationCost,
                    });
                  }
                }
                setShowConfig(false);
              } else {
                setError('No session ID returned');
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      console.error('Failed to create session:', err);
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setStarting(false);
      setProgressMsg(null);
    }
  };

  const handlePause = async () => {
    try {
      await fetch('/api/arena/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      });
    } catch {
      // silent
    }
  };

  const handleResume = async () => {
    try {
      await fetch('/api/arena/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      });
    } catch {
      // silent
    }
  };

  const handleStop = async () => {
    try {
      const res = await fetch('/api/arena/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      if (res.ok) {
        const data = await res.json();
        // Use response directly as fallback in case SSE didn't deliver it
        if (data.summary) {
          const store = useArenaStore.getState();
          if (!store.sessionSummary) {
            useArenaStore.getState().setSessionSummary(data.summary);
            useArenaStore.getState().setShowEndModal(true);
          }
          useArenaStore.getState().setSessionStatus('completed');
        }
      }
    } catch {
      // silent
    }
  };

  const budgetColor = budgetPercent >= 80 ? 'var(--red)' : budgetPercent >= 60 ? 'var(--yellow)' : 'var(--green)';

  const statusBadgeClass: Record<string, string> = {
    idle: 'bg-tertiary text-secondary',
    configuring: 'bg-blue-500/15 text-blue-400',
    running: 'bg-success text-green-400',
    paused: 'bg-yellow-500/15 text-yellow-400',
    completed: 'bg-tertiary text-secondary',
  };

  return (
    <>
      <div className="arena-card flex flex-wrap items-center gap-4 mb-4">
        {/* Status + SSE indicator */}
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded font-medium ${statusBadgeClass[sessionStatus] || statusBadgeClass.idle}`}>
            {sessionStatus.toUpperCase()}
          </span>
          {!sseConnected && (
            <span className="w-2 h-2 rounded-full bg-red-500" title="SSE disconnected" />
          )}
        </div>

        {/* Timer */}
        {sessionStatus !== 'idle' && (
          <div className="text-lg mono text-primary font-bold">
            {formatDuration(elapsedMs)}
          </div>
        )}

        {/* Deadline countdown */}
        {sessionStatus === 'running' && deadlineRemainingMs > 0 && (
          <div className={`text-sm mono font-medium ${
            deadlineUrgency === 'final' ? 'text-red-500 animate-pulse' :
            deadlineUrgency === 'critical' ? 'text-red-400' :
            deadlineUrgency === 'warning' ? 'text-yellow-400' :
            'text-tertiary'
          }`}>
            -{formatDuration(deadlineRemainingMs)}
          </div>
        )}

        {/* Interval badge + tick countdown */}
        {sessionStatus === 'running' && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium mono">
              {intervalLabel(intervalMs)}
            </span>
            <div className="w-16 h-1.5 rounded bg-tertiary overflow-hidden">
              <div
                className="h-full rounded bg-blue-500/60 transition-none"
                style={{ width: `${tickProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Price */}
        {currentPrice > 0 && (
          <div className="text-sm text-secondary">
            XRP/EUR{' '}
            <span className="mono text-blue-400 font-medium">{currentPrice.toFixed(4)}</span>
          </div>
        )}

        {/* Agent count */}
        {totalCount > 0 && (
          <div className="text-sm text-secondary">
            <span className="text-primary font-medium">{aliveCount}</span>
            <span className="text-tertiary">/{totalCount}</span>
            <span className="text-tertiary ml-1">agents</span>
          </div>
        )}

        {/* Session theme */}
        {rosterIntro && sessionStatus === 'running' && (
          <div className="text-xs text-blue-400 italic truncate max-w-48">
            {rosterIntro.theme}
          </div>
        )}

        {/* API Cost */}
        <div className="flex items-center gap-2 ml-auto">
          {totalLLMCalls > 0 && (
            <>
              <span className="mono text-xs" style={{ color: budgetColor }}>
                ${totalCostUsd.toFixed(2)}
              </span>
              <span className="text-xs text-tertiary">
                / ${(config?.sessionBudgetUsd ?? DEFAULT_SESSION_CONFIG.sessionBudgetUsd).toFixed(2)}
              </span>
              <div className="w-20 h-2 rounded bg-tertiary overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-300"
                  style={{
                    width: `${Math.min(100, budgetPercent)}%`,
                    backgroundColor: budgetColor,
                  }}
                />
              </div>
              <span className="text-[10px] text-tertiary">({totalLLMCalls} calls)</span>
              {masterAgentCost && (
                <span className="text-[10px] text-tertiary ml-1">
                  +${masterAgentCost.costUsd.toFixed(3)} gen
                </span>
              )}
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {(sessionStatus === 'idle' || sessionStatus === 'completed') && (
            <button className="btn btn-primary text-sm" onClick={() => {
              if (sessionStatus === 'completed') useArenaStore.getState().reset();
              setShowConfig(true);
            }}>
              New Session
            </button>
          )}
          {sessionStatus === 'running' && (
            <>
              <button className="btn btn-secondary text-sm" onClick={handlePause}>Pause</button>
              <button className="btn btn-danger text-sm" onClick={handleStop}>Stop</button>
            </>
          )}
          {sessionStatus === 'paused' && (
            <>
              <button className="btn btn-success text-sm" onClick={handleResume}>Resume</button>
              <button className="btn btn-danger text-sm" onClick={handleStop}>Stop</button>
            </>
          )}
        </div>
      </div>

      {/* Config Dialog */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in">
          <div className="arena-card max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-primary">Session Config</h3>
              <button
                onClick={() => setShowConfig(false)}
                className="text-tertiary hover:text-primary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* AI Agent Generation Mode */}
              <div>
                <label className="text-xs text-secondary block mb-1">Agent Generation</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfigForm({ ...configForm, useMasterAgent: true })}
                    className={`flex-1 py-1.5 text-sm rounded transition-colors ${
                      configForm.useMasterAgent !== false
                        ? 'bg-blue-500 text-white'
                        : 'bg-tertiary text-secondary hover:text-primary'
                    }`}
                  >
                    AI Generated
                  </button>
                  <button
                    onClick={() => setConfigForm({ ...configForm, useMasterAgent: false })}
                    className={`flex-1 py-1.5 text-sm rounded transition-colors ${
                      configForm.useMasterAgent === false
                        ? 'bg-blue-500 text-white'
                        : 'bg-tertiary text-secondary hover:text-primary'
                    }`}
                  >
                    Classic
                  </button>
                </div>
                <p className="text-[10px] text-tertiary mt-1">
                  {configForm.useMasterAgent !== false
                    ? 'AI creates unique agents with diverse strategies'
                    : 'Uses 6 predefined archetypes'}
                </p>
              </div>

              {/* Agent Count Slider */}
              <div>
                <label className="text-xs text-secondary block mb-1">
                  Agents: <span className="text-primary font-medium">{configForm.agentCount}</span>
                </label>
                <input
                  type="range"
                  min={3}
                  max={8}
                  value={configForm.agentCount}
                  onChange={(e) => setConfigForm({ ...configForm, agentCount: parseInt(e.target.value) })}
                  className="w-full slider-thumb bg-tertiary"
                />
                <div className="flex justify-between text-[10px] text-tertiary mt-0.5">
                  <span>3</span>
                  <span>8</span>
                </div>
              </div>

              {/* Starting Capital */}
              <div>
                <label className="text-xs text-secondary block mb-1">Starting Capital (EUR)</label>
                <input
                  type="number"
                  min={100}
                  max={10000}
                  step={100}
                  value={configForm.startingCapital}
                  onChange={(e) => setConfigForm({ ...configForm, startingCapital: parseFloat(e.target.value) || 1000 })}
                  className="input w-full"
                />
              </div>

              {/* Decision Interval */}
              <div>
                <label className="text-xs text-secondary block mb-1">Decision Interval</label>
                <div className="flex gap-2">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setConfigForm({ ...configForm, decisionIntervalMs: opt.value })}
                      className={`flex-1 py-1.5 text-sm rounded transition-colors ${
                        configForm.decisionIntervalMs === opt.value
                          ? 'bg-blue-500 text-white'
                          : 'bg-tertiary text-secondary hover:text-primary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Duration */}
              <div>
                <label className="text-xs text-secondary block mb-1">Max Duration</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setConfigForm({ ...configForm, maxDurationHours: opt.value })}
                      className={`px-3 py-1.5 text-sm rounded transition-colors ${
                        configForm.maxDurationHours === opt.value
                          ? 'bg-blue-500 text-white'
                          : 'bg-tertiary text-secondary hover:text-primary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model Selector */}
              <div>
                <label className="text-xs text-secondary block mb-1">LLM Model</label>
                <select
                  value={configForm.modelId}
                  onChange={(e) => setConfigForm({ ...configForm, modelId: e.target.value })}
                  className="input w-full"
                >
                  {MODEL_OPTIONS.map((m) => {
                    const p = MODEL_PRICING[m];
                    return (
                      <option key={m} value={m}>
                        {m} (${p.inputPer1MTokens}/1M in)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Budget */}
              <div>
                <label className="text-xs text-secondary block mb-1">
                  API Budget: <span className="text-primary font-medium">${configForm.sessionBudgetUsd.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={configForm.sessionBudgetUsd}
                  onChange={(e) => setConfigForm({ ...configForm, sessionBudgetUsd: parseFloat(e.target.value) })}
                  className="w-full slider-thumb bg-tertiary"
                />
                <div className="flex justify-between text-[10px] text-tertiary mt-0.5">
                  <span>$0.10</span>
                  <span>$10.00</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2 mt-2">
                {error}
              </div>
            )}

            {/* Progress indicator */}
            {starting && progressMsg && (
              <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded bg-blue-500/10 border border-blue-500/20">
                <svg className="w-4 h-4 text-blue-400 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm text-blue-400 animate-pulse">{progressMsg}</span>
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button className="btn btn-secondary flex-1" onClick={() => setShowConfig(false)} disabled={starting}>
                Cancel
              </button>
              <button className="btn btn-success flex-1" onClick={handleCreateSession} disabled={starting}>
                {starting ? 'Working...' : 'Start Competition'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

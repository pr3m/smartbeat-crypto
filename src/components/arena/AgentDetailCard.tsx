'use client';

import { useState } from 'react';
import { useArenaStore } from '@/stores/arenaStore';
import { AgentAvatar } from './AgentAvatar';
import { AgentHealthBar } from './AgentHealthBar';
import { ActivityIndicator } from './ActivityIndicator';
import { StrategyBars } from './StrategyBars';

export function AgentDetailCard() {
  const agents = useArenaStore((s) => s.agents);
  const selectedAgentId = useArenaStore((s) => s.selectedAgentId);
  const agentActivities = useArenaStore((s) => s.agentActivities);
  const agentStrategies = useArenaStore((s) => s.agentStrategies);
  const agentConfigs = useArenaStore((s) => s.agentConfigs);
  const config = useArenaStore((s) => s.config);
  const [extracting, setExtracting] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);
  const [showPersonality, setShowPersonality] = useState(false);
  const [showCommentary, setShowCommentary] = useState(false);

  const agent = agents.find((a) => a.agentId === selectedAgentId);

  if (!agent) {
    return (
      <div className="arena-card p-4 text-center text-sm text-tertiary">
        Select an agent to view details
      </div>
    );
  }

  const activity = agentActivities[agent.agentId];
  const strategy = agentStrategies[agent.agentId] as Record<string, unknown> | undefined;
  const agentConfig = agentConfigs[agent.agentId] as Record<string, unknown> | undefined;

  const pnlPercent = agent.startingCapital > 0
    ? ((agent.equity - agent.startingCapital) / agent.startingCapital) * 100
    : 0;
  const pnlPositive = pnlPercent >= 0;
  const winRate = agent.winCount + agent.lossCount > 0
    ? (agent.winCount / (agent.winCount + agent.lossCount)) * 100
    : 0;

  const handleExtractStrategy = async () => {
    setExtracting(true);
    try {
      await fetch('/api/arena/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.agentId }),
      });
    } catch {
      // silent
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="arena-card">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <AgentAvatar
          shape={agent.avatarShape}
          colorIndex={agent.colorIndex}
          isDead={agent.isDead}
          isTrading={agent.hasPosition}
          size={40}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-primary">{agent.name}</div>
          <div className="text-xs text-tertiary">{agent.archetypeId}</div>
          {(agent.tradingPhilosophy || (agentConfig?.tradingPhilosophy as string)) && (
            <div className="text-[10px] text-blue-400 italic truncate">
              &ldquo;{agent.tradingPhilosophy || (agentConfig?.tradingPhilosophy as string)}&rdquo;
            </div>
          )}
        </div>
        <span className={`text-lg mono font-bold ${pnlPositive ? 'text-success' : 'text-danger'}`}>
          {pnlPositive ? '+' : ''}{pnlPercent.toFixed(2)}%
        </span>
      </div>

      {/* Primary Indicators */}
      {Array.isArray(agentConfig?.primaryIndicators) && (agentConfig.primaryIndicators as string[]).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {(agentConfig.primaryIndicators as string[]).map((ind: string) => (
            <span key={ind} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
              {ind}
            </span>
          ))}
        </div>
      )}

      {/* Market Regime Preference */}
      {agentConfig?.marketRegimePreference != null && (
        <div className="flex gap-3 mb-2 text-[10px]">
          {Object.entries(agentConfig.marketRegimePreference as Record<string, number>).map(([k, v]) => {
            const num = v as number;
            return (
              <span key={k} className="text-tertiary">
                {k}: <span className={num > 0 ? 'text-success' : num < 0 ? 'text-danger' : 'text-secondary'}>{num > 0 ? '+' : ''}{num.toFixed(1)}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Health */}
      <div className="mb-3">
        <AgentHealthBar health={agent.health} />
      </div>

      {/* Performance Grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <div className="text-xs text-tertiary">Equity</div>
          <div className="text-sm mono text-primary">{agent.equity.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-tertiary">Win Rate</div>
          <div className="text-sm mono text-primary">{winRate.toFixed(0)}%</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-tertiary">Trades</div>
          <div className="text-sm mono text-primary">{agent.tradeCount}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-tertiary">Wins</div>
          <div className="text-sm mono text-success">{agent.winCount}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-tertiary">Losses</div>
          <div className="text-sm mono text-danger">{agent.lossCount}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-tertiary">Max DD</div>
          <div className="text-sm mono text-danger">{agent.maxDrawdown.toFixed(1)}%</div>
        </div>
      </div>

      {/* Strategy Profile */}
      {strategy !== undefined && (
        <div className="border-t border-primary pt-2 mb-3">
          <button
            onClick={() => setShowStrategy(!showStrategy)}
            className="text-xs text-secondary hover:text-primary w-full text-left flex items-center justify-between"
          >
            <span>Strategy Profile</span>
            <span className="text-tertiary">{showStrategy ? '−' : '+'}</span>
          </button>
          {showStrategy && (
            <div className="mt-2">
              <StrategyBars strategy={strategy} sessionDurationHours={config?.maxDurationHours} />
            </div>
          )}
        </div>
      )}

      {/* Current Position */}
      {agent.position && (
        <div className="border border-primary rounded-lg p-2 mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-tertiary">Position</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              agent.position.side === 'long' ? 'badge-bullish' : 'badge-bearish'
            }`}>
              {agent.position.side.toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div>
              <span className="text-tertiary">Entry: </span>
              <span className="mono text-primary">{agent.position.avgEntryPrice.toFixed(4)}</span>
            </div>
            <div>
              <span className="text-tertiary">Vol: </span>
              <span className="mono text-primary">{agent.position.volume.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-tertiary">uPnL: </span>
              <span className={`mono ${(agent.position.unrealizedPnl ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                {(agent.position.unrealizedPnl ?? 0) >= 0 ? '+' : ''}{(agent.position.unrealizedPnl ?? 0).toFixed(2)}
                <span className="text-tertiary ml-1">
                  ({(agent.position.unrealizedPnlPercent ?? 0) >= 0 ? '+' : ''}{(agent.position.unrealizedPnlPercent ?? 0).toFixed(1)}%)
                </span>
              </span>
            </div>
            <div>
              <span className="text-tertiary">Margin: </span>
              <span className="mono text-primary">{(agent.position.marginUsed ?? 0).toFixed(2)}</span>
            </div>
            <div>
              <span className="text-tertiary">DCAs: </span>
              <span className="mono text-primary">{agent.position.dcaCount ?? 0}</span>
            </div>
            <div>
              <span className="text-tertiary">Liq: </span>
              <span className="mono text-danger">{(agent.position.liquidationPrice ?? 0).toFixed(4)}</span>
            </div>
            {agent.position.openedAt && (
              <div>
                <span className="text-tertiary">Hold: </span>
                <span className="mono text-primary">
                  {Math.floor((Date.now() - agent.position.openedAt) / 60000)}m
                </span>
              </div>
            )}
            {(agent.position.totalFees ?? 0) > 0 && (
              <div>
                <span className="text-tertiary">Fees: </span>
                <span className="mono text-secondary">{(agent.position.totalFees ?? 0).toFixed(3)}</span>
              </div>
            )}
          </div>
          {agent.position?.entryReasoning && (
            <div className="text-[10px] text-secondary mt-1 bg-tertiary rounded px-2 py-1">
              {agent.position.entryReasoning}
            </div>
          )}
          {agent.position?.dcaEntries && agent.position.dcaEntries.length > 0 && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[10px] text-tertiary">DCA History:</div>
              {agent.position.dcaEntries.map((dca, i) => (
                <div key={i} className="text-[10px] text-secondary pl-2">
                  #{i + 1} @ {dca.price?.toFixed(4)} ({dca.volume?.toFixed(1)} XRP)
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Current Activity */}
      <div className="border-t border-primary pt-2 mb-3">
        <div className="text-xs text-tertiary mb-1">Last Decision</div>
        <div className="flex items-center gap-2 mb-1">
          <ActivityIndicator activity={activity?.activity || agent.activity || 'idle'} size={8} />
          <span className="text-xs text-primary capitalize">{activity?.activity || agent.activity || 'idle'}</span>
          {activity?.lastThoughtAt && (
            <span className="text-[10px] text-tertiary">
              {new Date(activity.lastThoughtAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        {(activity?.lastThought || agent.lastThought) && (
          <div className="text-[10px] text-secondary bg-tertiary rounded px-2 py-1">
            {activity?.lastThought || agent.lastThought}
          </div>
        )}
      </div>

      {/* AI Usage */}
      <div className="border-t border-primary pt-2 mb-3">
        <div className="text-xs text-tertiary mb-1">AI Usage</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-tertiary">Calls: </span>
            <span className="mono text-primary">{agent.llmCallCount}</span>
          </div>
          <div>
            <span className="text-tertiary">Cost: </span>
            <span className="mono text-primary">${agent.estimatedCostUsd.toFixed(3)}</span>
          </div>
          <div>
            <span className="text-tertiary">In: </span>
            <span className="mono text-primary">{(agent.totalInputTokens / 1000).toFixed(1)}k</span>
          </div>
          <div>
            <span className="text-tertiary">Out: </span>
            <span className="mono text-primary">{(agent.totalOutputTokens / 1000).toFixed(1)}k</span>
          </div>
        </div>
      </div>

      {/* Badges */}
      {agent.badges.length > 0 && (
        <div className="border-t border-primary pt-2 mb-3">
          <div className="text-xs text-tertiary mb-1">Badges</div>
          <div className="flex flex-wrap gap-1">
            {agent.badges.map((badge) => (
              <span
                key={badge}
                className="text-xs px-1.5 py-0.5 rounded bg-tertiary text-secondary animate-badge-earn"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Personality */}
      {agentConfig?.personality != null && (
        <div className="border-t border-primary pt-2 mb-3">
          <button
            onClick={() => setShowPersonality(!showPersonality)}
            className="text-xs text-secondary hover:text-primary w-full text-left flex items-center justify-between"
          >
            <span>Personality</span>
            <span className="text-tertiary">{showPersonality ? '−' : '+'}</span>
          </button>
          {showPersonality && (
            <div className="text-[10px] text-secondary mt-1 leading-relaxed">
              {String(agentConfig.personality)}
            </div>
          )}
        </div>
      )}

      {/* Commentary Templates */}
      {agentConfig?.commentaryTemplates != null && Object.keys(agentConfig.commentaryTemplates as Record<string, unknown>).length > 0 && (
        <div className="border-t border-primary pt-2 mb-3">
          <button
            onClick={() => setShowCommentary(!showCommentary)}
            className="text-xs text-secondary hover:text-primary w-full text-left flex items-center justify-between"
          >
            <span>Commentary Voice</span>
            <span className="text-tertiary">{showCommentary ? '−' : '+'}</span>
          </button>
          {showCommentary && (
            <div className="mt-1 space-y-1.5">
              {Object.entries(agentConfig.commentaryTemplates as Record<string, string[]>).map(([trigger, templates]) => (
                <div key={trigger}>
                  <div className="text-[9px] text-tertiary font-medium">{trigger}</div>
                  {(templates as string[]).slice(0, 2).map((t, i) => (
                    <div key={i} className="text-[10px] text-secondary pl-2 italic">
                      &ldquo;{t}&rdquo;
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Extract Strategy */}
      <button
        onClick={handleExtractStrategy}
        disabled={extracting}
        className="btn btn-secondary w-full text-xs"
      >
        {extracting ? 'Extracting...' : 'Extract Strategy'}
      </button>
    </div>
  );
}

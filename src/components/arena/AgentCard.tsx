'use client';

import type { AgentState } from '@/lib/arena/types';
import { AgentAvatar } from './AgentAvatar';
import { AgentHealthBar } from './AgentHealthBar';
import { ActivityIndicator } from './ActivityIndicator';
import { useArenaStore } from '@/stores/arenaStore';

interface AgentCardProps {
  agent: AgentState;
  isSelected: boolean;
  onSelect: (agentId: string) => void;
}

export function AgentCard({ agent, isSelected, onSelect }: AgentCardProps) {
  const agentActivities = useArenaStore((s) => s.agentActivities);
  const agentConfigs = useArenaStore((s) => s.agentConfigs);
  const activity = agentActivities[agent.agentId];
  const agentConfig = agentConfigs[agent.agentId] as Record<string, unknown> | undefined;

  const pnlPercent = agent.startingCapital > 0
    ? ((agent.equity - agent.startingCapital) / agent.startingCapital) * 100
    : 0;
  const pnlPositive = pnlPercent >= 0;

  return (
    <div
      className={`arena-agent-row cursor-pointer ${isSelected ? 'bg-tertiary' : ''} ${agent.isDead ? 'opacity-50' : ''}`}
      onClick={() => onSelect(agent.agentId)}
    >
      {/* Rank */}
      <span className="text-xs text-tertiary mono w-5 text-center shrink-0">
        {agent.rank > 0 ? `#${agent.rank}` : '-'}
      </span>

      {/* Avatar */}
      <AgentAvatar
        shape={agent.avatarShape}
        colorIndex={agent.colorIndex}
        isDead={agent.isDead}
        isTrading={agent.hasPosition}
        size={28}
      />

      {/* Name + archetype */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-primary truncate">{agent.name}</div>
        <div className="text-xs text-tertiary truncate">
          {agent.tradingPhilosophy || (agentConfig?.tradingPhilosophy as string) || agent.archetypeId}
        </div>
      </div>

      {/* P&L */}
      <span className={`text-sm mono shrink-0 ${pnlPositive ? 'text-success' : 'text-danger'}`}>
        {pnlPositive ? '+' : ''}{pnlPercent.toFixed(1)}%
      </span>

      {/* Last action */}
      {agent.hasPosition && agent.position ? (
        <span className="text-[10px] text-secondary truncate max-w-20 shrink-0">
          {agent.position.side.toUpperCase()} @ {agent.position.avgEntryPrice.toFixed(4)}
        </span>
      ) : activity?.lastThought ? (
        <span className="text-[10px] text-tertiary truncate max-w-20 shrink-0">
          {activity.lastThought.slice(0, 20)}
        </span>
      ) : null}

      {/* Health bar */}
      <div className="w-16 shrink-0">
        <AgentHealthBar health={agent.health} showLabel={false} />
      </div>

      {/* Trade count */}
      <span className="text-xs text-tertiary mono w-6 text-center shrink-0">
        {agent.tradeCount}
      </span>

      {/* Status */}
      <span className="shrink-0">
        {agent.isDead ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-danger text-white">Dead</span>
        ) : (
          <ActivityIndicator activity={activity?.activity || agent.activity || 'idle'} size={8} />
        )}
      </span>
    </div>
  );
}

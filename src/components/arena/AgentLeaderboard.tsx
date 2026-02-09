'use client';

import { useArenaStore } from '@/stores/arenaStore';
import { AgentCard } from './AgentCard';

export function AgentLeaderboard() {
  const agents = useArenaStore((s) => s.agents);
  const selectedAgentId = useArenaStore((s) => s.selectedAgentId);
  const selectAgent = useArenaStore((s) => s.selectAgent);

  const alive = agents
    .filter((a) => !a.isDead)
    .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));

  const dead = agents
    .filter((a) => a.isDead)
    .sort((a, b) => (a.deathTick ?? 0) - (b.deathTick ?? 0));

  const sorted = [...alive, ...dead];

  return (
    <div className="arena-card">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-primary">Leaderboard</h3>
        <span className="text-xs text-tertiary">
          {alive.length}/{agents.length} alive
        </span>
      </div>

      <div className="flex items-center gap-2 px-2.5 pb-1 text-[10px] text-tertiary uppercase tracking-wider">
        <span className="w-5 text-center">#</span>
        <span className="w-7" />
        <span className="flex-1">Agent</span>
        <span className="w-14 text-right">P&L</span>
        <span className="w-16 text-center">HP</span>
        <span className="w-6 text-center">Tx</span>
        <span className="w-10" />
      </div>

      <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
        {sorted.map((agent) => (
          <AgentCard
            key={agent.agentId}
            agent={agent}
            isSelected={selectedAgentId === agent.agentId}
            onSelect={selectAgent}
          />
        ))}

        {agents.length === 0 && (
          <div className="text-sm text-tertiary text-center py-6">
            No agents yet. Start a session to begin.
          </div>
        )}
      </div>
    </div>
  );
}

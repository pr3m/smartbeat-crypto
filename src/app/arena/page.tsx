'use client';

import { ArenaProvider } from '@/components/arena/ArenaProvider';
import { ArenaHeader } from '@/components/arena/ArenaHeader';
import { ArenaChart } from '@/components/arena/ArenaChart';
import { AgentLeaderboard } from '@/components/arena/AgentLeaderboard';
import { EventFeed } from '@/components/arena/EventFeed';
import { AgentDetailCard } from '@/components/arena/AgentDetailCard';
import { EndOfSessionModal } from '@/components/arena/EndOfSessionModal';
import { RosterReveal } from '@/components/arena/RosterReveal';
import { SessionHistory } from '@/components/arena/SessionHistory';
import { StrategyLibrary } from '@/components/arena/StrategyLibrary';
import { useArenaStore } from '@/stores/arenaStore';

function ArenaContent() {
  const selectedAgentId = useArenaStore((s) => s.selectedAgentId);
  const bottomTab = useArenaStore((s) => s.bottomTab);
  const setBottomTab = useArenaStore((s) => s.setBottomTab);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
      {/* Header with session controls, timer, price, API cost */}
      <ArenaHeader />

      {/* Main grid: left (chart + events), right (leaderboard + detail) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-4">
          <ArenaChart />
          <EventFeed />
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">
          <AgentLeaderboard />
          {selectedAgentId && <AgentDetailCard />}
        </div>
      </div>

      {/* Bottom tabs: Session History | Strategy Library */}
      <div className="arena-card">
        <div className="flex gap-1 border-b border-primary mb-3">
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              bottomTab === 'history'
                ? 'border-blue-500 text-primary'
                : 'border-transparent text-tertiary hover:text-secondary'
            }`}
            onClick={() => setBottomTab('history')}
          >
            Session History
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              bottomTab === 'strategies'
                ? 'border-blue-500 text-primary'
                : 'border-transparent text-tertiary hover:text-secondary'
            }`}
            onClick={() => setBottomTab('strategies')}
          >
            Strategy Library
          </button>
        </div>
        {bottomTab === 'history' ? <SessionHistory /> : <StrategyLibrary />}
      </div>

      {/* End of session modal overlay */}
      <EndOfSessionModal />

      {/* Roster reveal overlay (AI-generated agents) */}
      <RosterReveal />
    </div>
  );
}

export default function ArenaPage() {
  return (
    <ArenaProvider>
      <ArenaContent />
    </ArenaProvider>
  );
}

'use client';

import { useArenaStore } from '@/stores/arenaStore';
import { AgentAvatar } from './AgentAvatar';

export function EndOfSessionModal() {
  const showEndModal = useArenaStore((s) => s.showEndModal);
  const sessionSummary = useArenaStore((s) => s.sessionSummary);
  const agents = useArenaStore((s) => s.agents);
  const setShowEndModal = useArenaStore((s) => s.setShowEndModal);
  const reset = useArenaStore((s) => s.reset);

  if (!showEndModal || !sessionSummary) return null;

  const winner = sessionSummary.winner;
  const winnerAgent = agents.find((a) => a.agentId === winner.agentId);

  // Guard against invalid duration (e.g. if startTime was 0, duration would be epoch-sized)
  const rawDurationMin = sessionSummary.duration > 0 ? Math.round(sessionSummary.duration / 60000) : 0;
  const durationMin = rawDurationMin > 0 && rawDurationMin < 100000 ? rawDurationMin : 0;
  const durationDisplay = durationMin >= 60
    ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
    : `${durationMin}m`;
  const marketChangePositive = sessionSummary.marketChange >= 0;

  const handleNewSession = () => {
    setShowEndModal(false);
    reset();
  };

  const handleSaveStrategy = async (agentId: string) => {
    try {
      await fetch('/api/arena/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
    } catch {
      // silent
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in">
      <div className="arena-card max-w-lg w-full mx-4 p-6 animate-results-reveal">
        {/* Winner Announcement */}
        <div className="text-center mb-6">
          <div className="text-xs text-tertiary uppercase tracking-wider mb-2">Session Complete</div>
          <div className="text-2xl font-bold text-primary mb-2">
            {winner.name || 'Session'} {winner.name ? 'Wins!' : 'Complete'}
          </div>
          {winnerAgent && (
            <div className="flex justify-center mb-2">
              <AgentAvatar
                shape={winnerAgent.avatarShape}
                colorIndex={winnerAgent.colorIndex}
                size={56}
              />
            </div>
          )}
          <div className="text-success text-xl mono font-bold">
            +{winner.pnlPercent.toFixed(2)}%
          </div>
          <div className="text-xs text-tertiary mt-1">
            {winner.trades} trades | {winner.pnl >= 0 ? '+' : ''}{winner.pnl.toFixed(2)} EUR
          </div>
        </div>

        {/* Final Rankings */}
        <div className="mb-4">
          <div className="text-xs text-tertiary uppercase tracking-wider mb-2">Final Rankings</div>
          <table className="table text-xs">
            <thead>
              <tr>
                <th>#</th>
                <th>Agent</th>
                <th className="text-right">P&L</th>
                <th className="text-right">Win%</th>
                <th className="text-right">Trades</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessionSummary.rankings.map((r) => {
                const a = agents.find((ag) => ag.agentId === r.agentId);
                return (
                  <tr key={r.agentId}>
                    <td className="text-tertiary">{r.rank}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        {a && (
                          <AgentAvatar
                            shape={a.avatarShape}
                            colorIndex={a.colorIndex}
                            isDead={a.isDead}
                            size={18}
                          />
                        )}
                        <span className="text-primary">{r.name}</span>
                      </div>
                    </td>
                    <td className={`text-right ${r.pnlPercent >= 0 ? 'text-success' : 'text-danger'}`}>
                      {r.pnlPercent >= 0 ? '+' : ''}{r.pnlPercent.toFixed(1)}%
                    </td>
                    <td className="text-right">{(r.winRate * 100).toFixed(0)}%</td>
                    <td className="text-right">{r.tradeCount}</td>
                    <td>
                      <button
                        onClick={() => handleSaveStrategy(r.agentId)}
                        className="text-[10px] text-blue-400 hover:text-blue-300"
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Titles */}
        {sessionSummary.titles.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-tertiary uppercase tracking-wider mb-2">Titles</div>
            <div className="space-y-1">
              {sessionSummary.titles.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-yellow-400">{t.title}</span>
                  <span className="text-secondary">
                    {t.agentName} ({t.value})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Session Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4 text-center border-t border-primary pt-3">
          <div>
            <div className="text-xs text-tertiary">Duration</div>
            <div className="text-sm mono text-primary">{durationDisplay}</div>
          </div>
          <div>
            <div className="text-xs text-tertiary">Total Trades</div>
            <div className="text-sm mono text-primary">{sessionSummary.totalTrades}</div>
          </div>
          <div>
            <div className="text-xs text-tertiary">Market</div>
            <div className={`text-sm mono ${marketChangePositive ? 'text-success' : 'text-danger'}`}>
              {marketChangePositive ? '+' : ''}{sessionSummary.marketChange.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* API Cost Summary */}
        <div className="text-center text-xs text-tertiary mb-4">
          API Cost: ${sessionSummary.totalCostUsd.toFixed(3)} ({sessionSummary.totalLLMCalls} calls)
        </div>

        {/* New Session */}
        <button
          onClick={handleNewSession}
          className="btn btn-primary w-full"
        >
          New Session
        </button>
      </div>
    </div>
  );
}

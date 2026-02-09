'use client';

import { useEffect, useCallback } from 'react';
import { useArenaStore } from '@/stores/arenaStore';
import type { AgentState } from '@/lib/arena/types';

export function SessionHistory() {
  const pastSessions = useArenaStore((s) => s.pastSessions);
  const setPastSessions = useArenaStore((s) => s.setPastSessions);
  const sessionId = useArenaStore((s) => s.sessionId);
  const setSessionId = useArenaStore((s) => s.setSessionId);
  const setSessionStatus = useArenaStore((s) => s.setSessionStatus);
  const setConfig = useArenaStore((s) => s.setConfig);
  const updateAgents = useArenaStore((s) => s.updateAgents);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/arena/sessions');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.sessions)) {
        setPastSessions(data.sessions);
      }
    } catch {
      // silent
    }
  }, [setPastSessions]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleClick = async (session: (typeof pastSessions)[number]) => {
    // Already viewing this session
    if (session.id === sessionId) return;

    if (session.status === 'running' || session.status === 'paused') {
      // Restore client state so UI shows the session immediately
      setSessionId(session.id);
      if (session.config) setConfig(session.config);

      // Fetch full agent data from DB so leaderboard + chart populate immediately
      try {
        const detailRes = await fetch(`/api/arena/sessions/${session.id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          if (Array.isArray(detail.agents) && detail.agents.length > 0) {
            updateAgents(detail.agents as AgentState[]);
          }
          if (detail.config) setConfig(detail.config);
        }
      } catch {
        // Will be populated by SSE on next tick
      }

      if (session.status === 'paused') {
        // Tell the server to resume the orchestrator tick loop
        setSessionStatus('running');
        try {
          await fetch('/api/arena/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'resume' }),
          });
        } catch {
          // SSE auto-resume on subscribe will handle it as fallback
        }
      } else {
        setSessionStatus('running');
      }
    }
  };

  if (pastSessions.length === 0) {
    return (
      <div className="text-sm text-tertiary text-center py-8">
        No past sessions yet. Start your first competition!
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Agents</th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          {pastSessions.map((session) => {
            const isActive = session.status === 'running' || session.status === 'paused';
            const isCurrent = session.id === sessionId;
            return (
              <tr
                key={session.id}
                onClick={() => handleClick(session)}
                className={`${
                  isActive ? 'cursor-pointer hover:bg-white/[0.03]' : ''
                } ${isCurrent ? 'bg-blue-500/[0.07]' : ''}`}
              >
                <td className="text-secondary">
                  {new Date(session.startedAt).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    session.status === 'completed'
                      ? 'bg-success text-green-400'
                      : session.status === 'running'
                      ? 'bg-blue-500/15 text-blue-400'
                      : session.status === 'paused'
                      ? 'bg-yellow-500/15 text-yellow-400'
                      : 'bg-tertiary text-secondary'
                  }`}>
                    {session.status}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] text-blue-400 ml-1.5">current</span>
                  )}
                </td>
                <td className="text-secondary">{session.agentCount}</td>
                <td className="text-primary">
                  {session.winner?.name || session.winnerName || '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

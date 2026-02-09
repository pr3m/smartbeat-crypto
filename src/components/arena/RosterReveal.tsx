'use client';

import { useState, useEffect } from 'react';
import { useArenaStore } from '@/stores/arenaStore';
import { AgentAvatar } from './AgentAvatar';
import type { AvatarShape } from '@/lib/arena/types';

export function RosterReveal() {
  const rosterIntro = useArenaStore((s) => s.rosterIntro);
  const [revealedCount, setRevealedCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Auto-reveal agents one by one (no auto-dismiss — user must click the button)
  useEffect(() => {
    if (!rosterIntro?.isRevealing) return;

    const agents = rosterIntro.agents as Array<Record<string, unknown>>;
    if (revealedCount >= agents.length) return; // all revealed, wait for user

    const timer = setTimeout(() => {
      setRevealedCount((c) => c + 1);
    }, 1500);
    return () => clearTimeout(timer);
  }, [rosterIntro, revealedCount]);

  // Reset when a new roster intro comes in
  useEffect(() => {
    if (rosterIntro?.isRevealing) {
      setRevealedCount(0);
      setDismissed(false);
    }
  }, [rosterIntro?.isRevealing]);

  if (!rosterIntro?.isRevealing || dismissed) return null;

  const agents = rosterIntro.agents as Array<Record<string, unknown>>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-fade-in">
      <div className="max-w-2xl w-full mx-4 space-y-4">
        {/* Theme title */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-primary mb-2">
            {rosterIntro.theme}
          </h2>
          <p className="text-sm text-secondary italic">
            {rosterIntro.masterCommentary}
          </p>
        </div>

        {/* Agent reveals */}
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {agents.slice(0, revealedCount).map((agent, i) => (
            <div
              key={i}
              className="arena-card flex items-center gap-3 p-3 animate-slide-up"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <AgentAvatar
                shape={((agent.avatarShape as string) || 'circle') as AvatarShape}
                colorIndex={(agent.colorIndex as number) || i}
                isDead={false}
                isTrading={false}
                size={36}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-primary">
                  {String(agent.name)}
                </div>
                <div className="text-xs text-blue-400 italic truncate">
                  &ldquo;{String(agent.tradingPhilosophy)}&rdquo;
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(agent.primaryIndicators as string[] || []).slice(0, 4).map((ind) => (
                    <span key={ind} className="text-[9px] px-1 py-0.5 rounded bg-tertiary text-secondary">
                      {ind}
                    </span>
                  ))}
                  {(agent.strategy as Record<string, unknown>)?.positionSizing != null && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">
                      DCA: {((agent.strategy as Record<string, Record<string, number>>).positionSizing?.maxDCACount) ?? 0}
                    </span>
                  )}
                  {(agent.strategy as Record<string, unknown>)?.timebox != null && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">
                      {((agent.strategy as Record<string, Record<string, number>>).timebox?.maxHours) ?? '?'}h
                    </span>
                  )}
                </div>
              </div>
              {/* Regime preferences */}
              <div className="text-[9px] text-tertiary shrink-0 text-right space-y-0.5">
                {Object.entries((agent.marketRegimePreference as Record<string, number>) || {}).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-secondary">{k}: </span>
                    <span className={v > 0 ? 'text-success' : v < 0 ? 'text-danger' : ''}>
                      {v > 0 ? '+' : ''}{(v as number).toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-tertiary">
            {rosterIntro.generationCost && (
              <span>
                Generation: {rosterIntro.generationCost.inputTokens + rosterIntro.generationCost.outputTokens} tokens / ${rosterIntro.generationCost.costUsd.toFixed(4)}
              </span>
            )}
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="btn btn-primary text-sm"
          >
            {revealedCount >= agents.length ? 'Let the Games Begin!' : 'Skip Reveal'}
          </button>
        </div>
      </div>
    </div>
  );
}

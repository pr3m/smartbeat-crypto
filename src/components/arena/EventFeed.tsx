'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useArenaStore } from '@/stores/arenaStore';
import type { ArenaEvent, EventImportance } from '@/lib/arena/types';

type EventFilter = 'all' | 'trades' | 'decisions' | 'deaths' | 'milestones';

const TRADE_EVENTS = new Set([
  'trade_open', 'trade_close', 'trade_dca', 'agent_action',
]);
const DECISION_EVENTS = new Set([
  'agent_hold', 'agent_wait', 'agent_analyzing',
  'trade_open', 'trade_close', 'trade_dca', 'agent_action',
]);
const DEATH_EVENTS = new Set(['agent_death', 'near_death']);
const MILESTONE_EVENTS = new Set([
  'milestone', 'badge_earned', 'lead_change', 'hot_streak', 'comeback', 'face_off',
  'roster_reveal', 'session_countdown',
]);

// Skip tick events from feed (they update the header, not the feed)
// Session lifecycle events ARE shown so users see arena start/pause/resume in the feed
const HIDDEN_EVENTS = new Set(['tick']);

function matchesFilter(event: ArenaEvent, filter: EventFilter): boolean {
  if (HIDDEN_EVENTS.has(event.type)) return false;
  if (filter === 'all') return true;
  if (filter === 'trades') return TRADE_EVENTS.has(event.type);
  if (filter === 'decisions') return DECISION_EVENTS.has(event.type);
  if (filter === 'deaths') return DEATH_EVENTS.has(event.type);
  if (filter === 'milestones') return MILESTONE_EVENTS.has(event.type);
  return true;
}

function importanceColor(importance: EventImportance): string {
  switch (importance) {
    case 'critical': return 'var(--red)';
    case 'high': return 'var(--yellow)';
    case 'medium': return 'var(--blue)';
    case 'low': return 'var(--foreground-tertiary)';
  }
}

function EventItem({ event, isHighlighted }: { event: ArenaEvent; isHighlighted?: boolean }) {
  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const isCountdown = event.type === 'session_countdown';
  const isReveal = event.type === 'roster_reveal';

  return (
    <div
      className={`arena-event-item ${
        isCountdown ? 'bg-red-500/5 border-l-2 border-red-500/30' :
        isReveal ? 'bg-blue-500/5 border-l-2 border-blue-500/30' :
        isHighlighted ? 'bg-blue-500/5' :
        ''
      }`}
      data-importance={event.importance}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-tertiary mono shrink-0">{time}</span>
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: importanceColor(event.importance) }}
        />
        <span className={`text-sm ${isReveal ? 'text-blue-400' : 'text-primary'}`}>{event.title}</span>
        {/* Show metadata inline for trade events */}
        {event.metadata && (event.type === 'trade_open' || event.type === 'trade_close') && (
          <span className="text-[10px] text-tertiary ml-auto shrink-0">
            {event.metadata.usedLLM ? 'LLM' : 'Rule'}
            {event.metadata.confidence != null && ` ${event.metadata.confidence}%`}
          </span>
        )}
      </div>
      {event.detail && (
        <div className="text-xs text-secondary mt-0.5 ml-[72px]">
          {event.detail}
        </div>
      )}
    </div>
  );
}

export function EventFeed() {
  const events = useArenaStore((s) => s.events);
  const selectedAgentId = useArenaStore((s) => s.selectedAgentId);
  const [filter, setFilter] = useState<EventFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const filteredEvents = events.filter((e) => matchesFilter(e, filter));

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScroll.current = atBottom;
  }, []);

  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEvents.length]);

  const filters: { key: EventFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'decisions', label: 'Decisions' },
    { key: 'trades', label: 'Trades' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'milestones', label: 'Milestones' },
  ];

  return (
    <div className="arena-card flex flex-col" style={{ minHeight: 200 }}>
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-primary">Activity Feed</h3>
        <div className="flex gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                filter === f.key
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-tertiary hover:text-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-0.5"
        style={{ maxHeight: 400 }}
      >
        {filteredEvents.length === 0 ? (
          <div className="text-xs text-tertiary text-center py-4">
            Waiting for activity...
          </div>
        ) : (
          filteredEvents.slice(-100).map((event) => (
            <EventItem
              key={event.id}
              event={event}
              isHighlighted={!!selectedAgentId && event.agentId === selectedAgentId}
            />
          ))
        )}
      </div>
    </div>
  );
}

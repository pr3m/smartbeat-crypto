/**
 * Arena Trading Competition - Badge / Achievement System
 *
 * Badges are checked after each trade event and awarded once per agent per session.
 */

import type { Badge, AgentState } from './types';

// ============================================================================
// BADGE DEFINITIONS
// ============================================================================

export const BADGE_DEFINITIONS: Badge[] = [
  {
    id: 'first_blood',
    name: 'First Blood',
    description: 'First profitable trade in session',
    icon: '\u{1FA78}',
    rarity: 'common',
  },
  {
    id: 'speed_demon',
    name: 'Speed Demon',
    description: 'Profitable trade under 5 minutes',
    icon: '\u26A1',
    rarity: 'uncommon',
  },
  {
    id: 'comeback_kid',
    name: 'Comeback Kid',
    description: 'Position was -5%+, closed at +2%+',
    icon: '\u{1F504}',
    rarity: 'rare',
  },
  {
    id: 'steady_eddie',
    name: 'Steady Eddie',
    description: '5 consecutive wins',
    icon: '\u{1F4CA}',
    rarity: 'rare',
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    description: 'Recovered from <25% to >80% health',
    icon: '\u{1F525}',
    rarity: 'epic',
  },
  {
    id: 'lone_wolf',
    name: 'Lone Wolf',
    description: 'Only agent trading in that direction (and won)',
    icon: '\u{1F43A}',
    rarity: 'rare',
  },
  {
    id: 'cat_lives',
    name: 'Cat Lives',
    description: 'Survived below 30% health',
    icon: '\u{1F431}',
    rarity: 'uncommon',
  },
  {
    id: 'iron_hands',
    name: 'Iron Hands',
    description: 'Held through >3% drawdown and profited',
    icon: '\u{1F932}',
    rarity: 'rare',
  },
];

// Quick lookup map
const BADGE_MAP = new Map<string, Badge>(
  BADGE_DEFINITIONS.map((b) => [b.id, b])
);

export function getBadgeById(id: string): Badge | undefined {
  return BADGE_MAP.get(id);
}

// ============================================================================
// BADGE CHECK
// ============================================================================

export interface TradeEvent {
  type: 'trade_close' | 'trade_open' | 'tick';
  pnl?: number;              // Realized P&L for this trade (EUR)
  pnlPercent?: number;       // Realized P&L %
  duration?: number;          // Trade duration in ms
  minPnlDuringTrade?: number; // Worst unrealized P&L % during the trade
  side?: 'long' | 'short';   // Direction of the closed trade
  consecutiveWins?: number;   // Current consecutive win streak
  lowestHealthSeen?: number;  // Lowest health this agent has ever had
}

/**
 * Check all badge conditions and return newly earned badges.
 * Only returns badges the agent does NOT already have.
 */
export function checkBadges(
  agent: AgentState,
  allAgents: AgentState[],
  event: TradeEvent
): Badge[] {
  const earned: Badge[] = [];
  const has = new Set(agent.badges);

  function award(id: string) {
    if (!has.has(id)) {
      const badge = BADGE_MAP.get(id);
      if (badge) earned.push(badge);
    }
  }

  // Only check trade-related badges on trade_close
  if (event.type === 'trade_close') {
    const won = (event.pnl ?? 0) > 0;

    // First Blood: first profitable trade
    if (won && agent.winCount <= 1) {
      award('first_blood');
    }

    // Speed Demon: profitable trade under 5 minutes
    if (won && event.duration !== undefined && event.duration < 5 * 60 * 1000) {
      award('speed_demon');
    }

    // Comeback Kid: was -5%+ during trade, closed at +2%+
    if (
      event.minPnlDuringTrade !== undefined &&
      event.minPnlDuringTrade <= -5 &&
      (event.pnlPercent ?? 0) >= 2
    ) {
      award('comeback_kid');
    }

    // Steady Eddie: 5 consecutive wins
    if ((event.consecutiveWins ?? 0) >= 5) {
      award('steady_eddie');
    }

    // Lone Wolf: only agent trading in that direction and won
    if (won && event.side) {
      const othersInSameDirection = allAgents.filter(
        (a) =>
          a.agentId !== agent.agentId &&
          a.hasPosition &&
          a.position?.side === event.side
      );
      if (othersInSameDirection.length === 0) {
        award('lone_wolf');
      }
    }

    // Iron Hands: held through >3% drawdown and profited
    if (
      won &&
      event.minPnlDuringTrade !== undefined &&
      event.minPnlDuringTrade <= -3
    ) {
      award('iron_hands');
    }
  }

  // These can be checked on any event type (tick or trade)

  // Cat Lives: survived below 30% health (must still be alive)
  if (!agent.isDead && agent.health > 0) {
    const lowestHealth = event.lowestHealthSeen ?? agent.health;
    if (lowestHealth < 30) {
      award('cat_lives');
    }
  }

  // Phoenix: recovered from <25% to >80% health
  if (!agent.isDead && agent.health > 80) {
    const lowestHealth = event.lowestHealthSeen ?? 100;
    if (lowestHealth < 25) {
      award('phoenix');
    }
  }

  return earned;
}

/**
 * Arena Trading Competition - Event Detection & Emission
 *
 * Detects dramatic moments during the competition:
 * face-offs, lead changes, near-deaths, hot streaks, comebacks, market shocks.
 */

import type {
  ArenaEvent,
  ArenaEventType,
  EventImportance,
  AgentState,
  SharedMarketData,
} from './types';
import { generateId } from './types';

// ============================================================================
// EVENT FACTORY
// ============================================================================

export function createArenaEvent(
  type: ArenaEventType,
  title: string,
  detail: string,
  importance: EventImportance,
  price: number,
  agentId?: string,
  agentName?: string,
  metadata?: Record<string, unknown>
): ArenaEvent {
  return {
    id: generateId(),
    type,
    agentId,
    agentName,
    importance,
    title,
    detail,
    priceAt: price,
    timestamp: Date.now(),
    metadata,
  };
}

// ============================================================================
// EVENT DETECTOR
// ============================================================================

export class ArenaEventDetector {
  private previousRankings: Map<string, number> = new Map();
  private previousPrices: number[] = [];
  private streaks: Map<string, number> = new Map();
  private lowestHealth: Map<string, number> = new Map();
  private nearDeathAlerted: Set<string> = new Set();
  private comebackAlerted: Set<string> = new Set();
  private knownFaceOffs: Set<string> = new Set();

  /**
   * Called after each tick to detect dramatic events.
   */
  detectEvents(
    agents: AgentState[],
    market: SharedMarketData,
    _tickNumber: number
  ): ArenaEvent[] {
    const events: ArenaEvent[] = [];

    events.push(...this.checkFaceOffs(agents, market.price));
    events.push(...this.checkLeadChanges(agents, market.price));
    events.push(...this.checkNearDeaths(agents, market.price));
    events.push(...this.checkHotStreaks(agents, market.price));
    events.push(...this.checkComebacks(agents, market.price));
    events.push(...this.checkMarketShock(market));

    // Track health lows
    for (const agent of agents) {
      const prev = this.lowestHealth.get(agent.agentId) ?? 100;
      if (agent.health < prev) {
        this.lowestHealth.set(agent.agentId, agent.health);
      }
    }

    return events;
  }

  /**
   * Face-Off: two agents hold opposing positions simultaneously.
   */
  private checkFaceOffs(agents: AgentState[], price: number): ArenaEvent[] {
    const events: ArenaEvent[] = [];
    const withPositions = agents.filter((a) => a.hasPosition && a.position && !a.isDead);

    for (let i = 0; i < withPositions.length; i++) {
      for (let j = i + 1; j < withPositions.length; j++) {
        const a = withPositions[i];
        const b = withPositions[j];
        const sideA = a.position!.side;
        const sideB = b.position!.side;

        if (sideA !== sideB) {
          // Create a stable key so we only alert once per pair per opposing window
          const key = [a.agentId, b.agentId].sort().join(':');
          if (!this.knownFaceOffs.has(key)) {
            this.knownFaceOffs.add(key);
            events.push(
              createArenaEvent(
                'face_off',
                `${a.name} vs ${b.name}`,
                `${a.name} (${sideA}) vs ${b.name} (${sideB}) - opposing bets on XRP`,
                'high',
                price,
                undefined,
                undefined,
                {
                  agent1: a.agentId,
                  agent1Name: a.name,
                  dir1: sideA,
                  agent2: b.agentId,
                  agent2Name: b.name,
                  dir2: sideB,
                }
              )
            );
          }
        }
      }
    }

    // Clean up face-offs where one or both agents closed positions
    for (const key of this.knownFaceOffs) {
      const [id1, id2] = key.split(':');
      const a1 = agents.find((a) => a.agentId === id1);
      const a2 = agents.find((a) => a.agentId === id2);
      if (
        !a1?.hasPosition ||
        !a2?.hasPosition ||
        a1.position?.side === a2.position?.side
      ) {
        this.knownFaceOffs.delete(key);
      }
    }

    return events;
  }

  /**
   * Lead Change: #1 position swaps.
   */
  private checkLeadChanges(agents: AgentState[], price: number): ArenaEvent[] {
    const events: ArenaEvent[] = [];
    const alive = agents.filter((a) => !a.isDead);

    if (alive.length < 2) return events;

    // Sort by current equity to find the leader
    const sorted = [...alive].sort((a, b) => b.equity - a.equity);
    const currentLeaderId = sorted[0].agentId;
    const previousLeaderId = this.findPreviousLeader();

    if (
      previousLeaderId &&
      previousLeaderId !== currentLeaderId
    ) {
      const newLeader = sorted[0];
      const oldLeader = agents.find((a) => a.agentId === previousLeaderId);
      const pnlPct = ((newLeader.totalPnl / newLeader.startingCapital) * 100).toFixed(1);

      events.push(
        createArenaEvent(
          'lead_change',
          `${newLeader.name} takes the lead!`,
          `${newLeader.name} overtakes ${oldLeader?.name ?? 'previous leader'} with ${Number(pnlPct) >= 0 ? '+' : ''}${pnlPct}% returns`,
          'high',
          price,
          newLeader.agentId,
          newLeader.name,
          { oldLeader: oldLeader?.name, pnlPct }
        )
      );
    }

    // Update rankings for next check
    this.updateRankings(agents);

    return events;
  }

  private findPreviousLeader(): string | undefined {
    let leaderId: string | undefined;
    let bestRank = Infinity;
    for (const [id, rank] of this.previousRankings) {
      if (rank < bestRank) {
        bestRank = rank;
        leaderId = id;
      }
    }
    return leaderId;
  }

  /**
   * Near-Death: agent drops below 25% health.
   * Only alerts once per agent until they recover above 40%.
   */
  private checkNearDeaths(agents: AgentState[], price: number): ArenaEvent[] {
    const events: ArenaEvent[] = [];

    for (const agent of agents) {
      if (agent.isDead) continue;

      if (agent.health <= 25 && !this.nearDeathAlerted.has(agent.agentId)) {
        this.nearDeathAlerted.add(agent.agentId);
        events.push(
          createArenaEvent(
            'near_death',
            `${agent.name} on death's door`,
            `${agent.name} drops to ${agent.health.toFixed(0)}% health - elimination looms`,
            'critical',
            price,
            agent.agentId,
            agent.name,
            { health: agent.health }
          )
        );
      }

      // Reset alert if they recover above 40%
      if (agent.health > 40 && this.nearDeathAlerted.has(agent.agentId)) {
        this.nearDeathAlerted.delete(agent.agentId);
      }
    }

    return events;
  }

  /**
   * Hot Streak: 3+ consecutive wins.
   */
  private checkHotStreaks(agents: AgentState[], price: number): ArenaEvent[] {
    const events: ArenaEvent[] = [];

    for (const agent of agents) {
      const streak = this.streaks.get(agent.agentId) ?? 0;
      if (streak >= 3 && streak % 1 === 0) {
        // Only emit on exact multiples (3, 4, 5...) - we check in recordTradeResult
        // Here we just verify the streak is active
      }
    }

    // Hot streak events are primarily emitted via recordTradeResult
    // This method is a placeholder for tick-based streak checking if needed
    return events;
  }

  /**
   * Comeback: agent recovers from <40% health to >70% health.
   */
  private checkComebacks(agents: AgentState[], price: number): ArenaEvent[] {
    const events: ArenaEvent[] = [];

    for (const agent of agents) {
      if (agent.isDead) continue;

      const lowest = this.lowestHealth.get(agent.agentId) ?? 100;

      if (
        lowest < 40 &&
        agent.health > 70 &&
        !this.comebackAlerted.has(agent.agentId)
      ) {
        this.comebackAlerted.add(agent.agentId);
        events.push(
          createArenaEvent(
            'comeback',
            `${agent.name} stages a comeback!`,
            `${agent.name} recovers from ${lowest.toFixed(0)}% to ${agent.health.toFixed(0)}% health`,
            'high',
            price,
            agent.agentId,
            agent.name,
            { lowestHealth: lowest, currentHealth: agent.health }
          )
        );
      }
    }

    return events;
  }

  /**
   * Market Shock: >1% price move in a single interval.
   */
  private checkMarketShock(market: SharedMarketData): ArenaEvent[] {
    const events: ArenaEvent[] = [];
    const price = market.price;

    if (this.previousPrices.length > 0) {
      const lastPrice = this.previousPrices[this.previousPrices.length - 1];
      const changePct = ((price - lastPrice) / lastPrice) * 100;

      if (Math.abs(changePct) > 1) {
        const direction = changePct > 0 ? 'up' : 'down';
        events.push(
          createArenaEvent(
            'market_shock',
            `Market shock: XRP ${direction} ${Math.abs(changePct).toFixed(1)}%`,
            `XRP/EUR moved ${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}% in one interval (${lastPrice.toFixed(4)} -> ${price.toFixed(4)})`,
            'critical',
            price,
            undefined,
            undefined,
            { changePct, previousPrice: lastPrice }
          )
        );
      }
    }

    this.previousPrices.push(price);
    // Keep only last 100 prices
    if (this.previousPrices.length > 100) {
      this.previousPrices.shift();
    }

    return events;
  }

  /**
   * Record a trade result for streak tracking.
   * Returns a hot_streak event if the agent hits 3+ consecutive wins.
   */
  recordTradeResult(
    agentId: string,
    agentName: string,
    won: boolean,
    price: number
  ): ArenaEvent | null {
    if (won) {
      const current = (this.streaks.get(agentId) ?? 0) + 1;
      this.streaks.set(agentId, current);

      if (current >= 3) {
        return createArenaEvent(
          'hot_streak',
          `${agentName} on a hot streak!`,
          `${agentName} hits ${current} consecutive wins`,
          current >= 5 ? 'critical' : 'high',
          price,
          agentId,
          agentName,
          { streakCount: current }
        );
      }
    } else {
      this.streaks.set(agentId, 0);
    }

    return null;
  }

  /**
   * Update stored rankings for lead change detection.
   */
  updateRankings(agents: AgentState[]): void {
    const sorted = [...agents]
      .filter((a) => !a.isDead)
      .sort((a, b) => b.equity - a.equity);

    this.previousRankings.clear();
    sorted.forEach((agent, idx) => {
      this.previousRankings.set(agent.agentId, idx + 1);
    });
  }

  /**
   * Get the current streak count for an agent.
   */
  getStreak(agentId: string): number {
    return this.streaks.get(agentId) ?? 0;
  }

  /**
   * Get the lowest health ever recorded for an agent.
   */
  getLowestHealth(agentId: string): number {
    return this.lowestHealth.get(agentId) ?? 100;
  }
}

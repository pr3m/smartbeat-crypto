/**
 * Arena Trading Competition - Scoring & Rankings
 *
 * RARS (Risk-Adjusted Return Score) ranking system.
 * Rewards consistent, sustainable trading over lucky big swings.
 */

import type { AgentState, AgentRanking, SessionTitle } from './types';

/**
 * Calculate Risk-Adjusted Return Score for an agent.
 *
 * RARS = returnPct * consistencyMultiplier * survivalMultiplier
 *
 * - returnPct: total P&L as % of starting capital
 * - consistencyMultiplier: 1.0 + (winRate - 0.5) * 0.5  (range 0.75 - 1.25)
 * - survivalMultiplier: min(1.0, equity / startingCapital)
 *
 * Dead agents get a large penalty so they always rank last among themselves
 * but still preserve relative ordering.
 */
export function calculateRARS(state: AgentState): number {
  const totalTrades = state.winCount + state.lossCount;
  const winRate = totalTrades > 0 ? state.winCount / totalTrades : 0.5;

  // Return as percentage of starting capital
  const returnPct = (state.totalPnl / state.startingCapital) * 100;

  // Consistency: rewarded for win rate above 50%, penalized below
  const consistencyMultiplier = 1.0 + (winRate - 0.5) * 0.5;

  // Survival: penalized if equity has dropped below starting capital
  const survivalMultiplier = Math.min(1.0, state.equity / state.startingCapital);

  let score = returnPct * consistencyMultiplier * survivalMultiplier;

  // Dead agents get a massive penalty so they always rank below living agents
  if (state.isDead) {
    score = score - 10000;
  }

  return score;
}

/**
 * Rank all agents by RARS score.
 * Dead agents are always ranked after living agents.
 */
export function rankAgents(agents: AgentState[]): AgentRanking[] {
  const scored = agents.map((agent) => {
    const totalTrades = agent.winCount + agent.lossCount;
    const winRate = totalTrades > 0 ? agent.winCount / totalTrades : 0;
    const pnlPercent = (agent.totalPnl / agent.startingCapital) * 100;

    return {
      agentId: agent.agentId,
      name: agent.name,
      rank: 0, // assigned below
      rarsScore: calculateRARS(agent),
      pnlPercent,
      winRate,
      health: agent.health,
      status: agent.status,
      tradeCount: agent.tradeCount,
    };
  });

  // Sort by RARS descending
  scored.sort((a, b) => b.rarsScore - a.rarsScore);

  // Assign ranks (1-based)
  for (let i = 0; i < scored.length; i++) {
    scored[i].rank = i + 1;
  }

  return scored;
}

/**
 * Compute end-of-session (or live) titles/awards.
 */
export function computeSessionTitles(agents: AgentState[]): SessionTitle[] {
  const titles: SessionTitle[] = [];
  const alive = agents.filter((a) => !a.isDead);
  const withTrades = agents.filter((a) => a.tradeCount > 0);

  // Best Trader - highest RARS
  const rankings = rankAgents(agents);
  if (rankings.length > 0) {
    const best = rankings[0];
    titles.push({
      title: 'Best Trader',
      agentId: best.agentId,
      agentName: best.name,
      value: `${best.pnlPercent >= 0 ? '+' : ''}${best.pnlPercent.toFixed(1)}%`,
    });
  }

  // Most Consistent - highest win rate (min 3 trades)
  const consistent = withTrades
    .filter((a) => a.winCount + a.lossCount >= 3)
    .sort((a, b) => {
      const wrA = a.winCount / (a.winCount + a.lossCount);
      const wrB = b.winCount / (b.winCount + b.lossCount);
      return wrB - wrA;
    });
  if (consistent.length > 0) {
    const best = consistent[0];
    const wr = (best.winCount / (best.winCount + best.lossCount)) * 100;
    titles.push({
      title: 'Most Consistent',
      agentId: best.agentId,
      agentName: best.name,
      value: `${wr.toFixed(0)}% win rate`,
    });
  }

  // Biggest Risk Taker - highest average margin %
  // Approximated by total fees (more margin = more fees) relative to trade count
  const riskTakers = withTrades.sort((a, b) => {
    const avgA = a.totalFees / a.tradeCount;
    const avgB = b.totalFees / b.tradeCount;
    return avgB - avgA;
  });
  if (riskTakers.length > 0) {
    const best = riskTakers[0];
    const avgFee = best.totalFees / best.tradeCount;
    titles.push({
      title: 'Biggest Risk Taker',
      agentId: best.agentId,
      agentName: best.name,
      value: `${avgFee.toFixed(2)} EUR avg fee`,
    });
  }

  // Survivor - longest alive with most trades
  const survivors = alive
    .filter((a) => a.tradeCount > 0)
    .sort((a, b) => b.tradeCount - a.tradeCount);
  if (survivors.length > 0) {
    const best = survivors[0];
    titles.push({
      title: 'Survivor',
      agentId: best.agentId,
      agentName: best.name,
      value: `${best.tradeCount} trades`,
    });
  }

  // Speed Demon - fastest average trade duration
  // We use lastTradeAt as a proxy; agents with more trades in less time are faster
  const speedsters = withTrades
    .filter((a) => a.lastTradeAt !== undefined)
    .sort((a, b) => {
      // More trades per unit time = faster
      const rateA = a.tradeCount;
      const rateB = b.tradeCount;
      return rateB - rateA;
    });
  if (speedsters.length > 0) {
    const best = speedsters[0];
    titles.push({
      title: 'Speed Demon',
      agentId: best.agentId,
      agentName: best.name,
      value: `${best.tradeCount} trades`,
    });
  }

  return titles;
}

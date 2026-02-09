/**
 * GET /api/arena/leaderboard - Current rankings
 */

import { NextResponse } from 'next/server';
import { ArenaOrchestrator } from '@/lib/arena/orchestrator';
import { rankAgents } from '@/lib/arena/scoring';

export async function GET() {
  try {
    const orchestrator = ArenaOrchestrator.getInstance();
    const agents = orchestrator.getAgentStates();

    if (agents.length === 0) {
      return NextResponse.json({ rankings: [], status: 'idle' });
    }

    const rankings = rankAgents(agents);

    return NextResponse.json({
      rankings,
      status: orchestrator.getStatus(),
      tick: orchestrator.getCurrentTick(),
      elapsedMs: orchestrator.getElapsedMs(),
    });
  } catch (error) {
    console.error('[Arena] Leaderboard error:', error);
    return NextResponse.json(
      { error: 'Failed to get leaderboard' },
      { status: 500 }
    );
  }
}

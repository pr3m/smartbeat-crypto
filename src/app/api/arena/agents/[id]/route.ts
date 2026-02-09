/**
 * GET /api/arena/agents/[id] - Get agent details
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ArenaOrchestrator } from '@/lib/arena/orchestrator';

const prisma = new PrismaClient();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if agent is in active session (get live state)
    const orchestrator = ArenaOrchestrator.getInstance();
    const liveState = orchestrator.getAgentState(id);

    // Get from DB
    const agent = await prisma.arenaAgent.findUnique({
      where: { id },
      include: {
        positions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...agent,
      strategyConfig: JSON.parse(agent.strategyConfig),
      liveState: liveState ?? null,
      positions: agent.positions.map(p => ({
        ...p,
        dcaHistory: p.dcaHistory ? JSON.parse(p.dcaHistory) : [],
        entryReasoning: p.entryReasoning ? JSON.parse(p.entryReasoning) : null,
        exitReasoning: p.exitReasoning ? JSON.parse(p.exitReasoning) : null,
        entryConditions: p.entryConditions ? JSON.parse(p.entryConditions) : null,
      })),
    });
  } catch (error) {
    console.error('[Arena] Get agent error:', error);
    return NextResponse.json(
      { error: 'Failed to get agent' },
      { status: 500 }
    );
  }
}

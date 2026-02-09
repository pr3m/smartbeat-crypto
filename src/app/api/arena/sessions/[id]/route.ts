/**
 * GET /api/arena/sessions/[id] - Fetch a single session with full agent + position data
 *
 * Used to restore UI state when clicking a session history row or on page refresh
 * when the orchestrator's in-memory state has been lost (e.g. server restart).
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getHealthZone } from '@/lib/arena/types';
import type { AgentState, AgentStatus, ArenaPositionState } from '@/lib/arena/types';

const prisma = new PrismaClient();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = await prisma.arenaSession.findUnique({
      where: { id },
      include: {
        agents: {
          include: {
            positions: {
              where: { isOpen: true },
              take: 1,
            },
          },
          orderBy: { rank: 'asc' },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const config = JSON.parse(session.config);

    // Map DB agents to AgentState shape the client expects
    const agents: AgentState[] = session.agents.map((a) => {
      const openPos = a.positions[0] ?? null;
      const position: ArenaPositionState | null = openPos
        ? {
            id: openPos.id,
            pair: openPos.pair,
            side: openPos.side as 'long' | 'short',
            volume: openPos.volume,
            avgEntryPrice: openPos.avgEntryPrice,
            leverage: openPos.leverage,
            marginUsed: openPos.marginUsed,
            totalFees: openPos.totalFees,
            dcaCount: openPos.dcaCount,
            dcaEntries: openPos.dcaHistory ? JSON.parse(openPos.dcaHistory) : [],
            isOpen: true,
            openedAt: openPos.createdAt.getTime(),
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
            liquidationPrice: 0,
          }
        : null;

      return {
        agentId: a.id,
        name: a.name,
        archetypeId: '',
        avatarShape: a.avatarShape as AgentState['avatarShape'],
        colorIndex: a.colorIndex,
        balance: a.currentCapital,
        startingCapital: a.startingCapital,
        equity: a.currentCapital + (position ? 0 : 0), // P&L recalculated on next tick
        hasPosition: !!openPos,
        position,
        totalPnl: a.totalPnl,
        totalFees: a.totalFees,
        winCount: a.winCount,
        lossCount: a.lossCount,
        maxDrawdown: a.maxDrawdown,
        peakEquity: a.peakEquity,
        health: a.health,
        healthZone: getHealthZone(a.health),
        rank: a.rank,
        isDead: a.status !== 'alive',
        status: a.status as AgentStatus,
        deathTick: a.deathTick ?? undefined,
        deathReason: a.deathReason ?? undefined,
        llmCallCount: a.llmCallCount,
        totalInputTokens: a.totalInputTokens,
        totalOutputTokens: a.totalOutputTokens,
        estimatedCostUsd: a.estimatedCostUsd,
        tradeCount: a.winCount + a.lossCount,
        badges: [],
      };
    });

    return NextResponse.json({
      id: session.id,
      status: session.status,
      config,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      totalRunTimeMs: session.totalRunTimeMs,
      startPrice: session.startPrice,
      endPrice: session.endPrice,
      summary: session.summary ? JSON.parse(session.summary) : null,
      agents,
    });
  } catch (error) {
    console.error('[Arena] Session detail error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session' },
      { status: 500 }
    );
  }
}

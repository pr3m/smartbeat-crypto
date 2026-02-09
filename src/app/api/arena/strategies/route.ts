/**
 * POST /api/arena/strategies - Extract strategy from winning agent
 * GET  /api/arena/strategies - List extracted strategies
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const { agentId } = await request.json();

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const agent = await prisma.arenaAgent.findUnique({
      where: { id: agentId },
      include: {
        session: true,
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const totalTrades = agent.winCount + agent.lossCount;
    const winRate = totalTrades > 0 ? agent.winCount / totalTrades : 0;

    const strategy = await prisma.arenaStrategy.create({
      data: {
        name: `${agent.name}'s Strategy`,
        description: `Extracted from ${agent.name} in session ${agent.sessionId}. Win rate: ${(winRate * 100).toFixed(0)}%, P&L: ${agent.totalPnl.toFixed(2)} EUR`,
        config: agent.strategyConfig,
        sourceSessionId: agent.sessionId,
        sourceAgentName: agent.name,
        winRate,
        totalPnl: agent.totalPnl,
        maxDrawdown: agent.maxDrawdown,
        totalTrades,
        rating: winRate * 50 + (agent.totalPnl > 0 ? 25 : 0) + Math.min(25, totalTrades * 2.5),
      },
    });

    return NextResponse.json(strategy);
  } catch (error) {
    console.error('[Arena] Extract strategy error:', error);
    return NextResponse.json(
      { error: 'Failed to extract strategy' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const strategies = await prisma.arenaStrategy.findMany({
      where: { isActive: true },
      orderBy: { rating: 'desc' },
    });

    return NextResponse.json({
      strategies: strategies.map(s => ({
        ...s,
        config: JSON.parse(s.config),
      })),
    });
  } catch (error) {
    console.error('[Arena] List strategies error:', error);
    return NextResponse.json(
      { error: 'Failed to list strategies' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await prisma.arenaStrategy.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Arena] Delete strategy error:', error);
    return NextResponse.json(
      { error: 'Failed to delete strategy' },
      { status: 500 }
    );
  }
}

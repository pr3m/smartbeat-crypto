/**
 * GET /api/arena/session/[id] - Get session details
 * POST /api/arena/session/[id] - Control session (pause/resume/stop)
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
    const session = await prisma.arenaSession.findUnique({
      where: { id },
      include: {
        agents: {
          orderBy: { rank: 'asc' },
        },
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...session,
      config: JSON.parse(session.config),
      summary: session.summary ? JSON.parse(session.summary) : null,
    });
  } catch (error) {
    console.error('[Arena] Get session error:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { action } = await request.json();
    const orchestrator = ArenaOrchestrator.getInstance();

    if (orchestrator.getSessionId() !== id) {
      return NextResponse.json(
        { error: 'Session is not the active session' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'pause':
        await orchestrator.pause();
        return NextResponse.json({ status: 'paused' });
      case 'resume':
        await orchestrator.resume();
        return NextResponse.json({ status: 'running' });
      case 'stop': {
        const summary = await orchestrator.stop();
        return NextResponse.json({ status: 'completed', summary });
      }
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Arena] Session action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to perform action' },
      { status: 500 }
    );
  }
}

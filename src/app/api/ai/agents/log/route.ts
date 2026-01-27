/**
 * Agent Log API Route
 * POST /api/ai/agents/log - Create a log entry for an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, type, content, priceAt, metadata } = body;

    if (!agentId || !type || !content) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: agentId, type, content' },
        { status: 400 }
      );
    }

    // Verify agent exists
    const agent = await prisma.tradeAgent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    const log = await prisma.agentLog.create({
      data: {
        agentId,
        type,
        content,
        priceAt: priceAt || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    return NextResponse.json({
      success: true,
      log,
    });
  } catch (error) {
    console.error('[Agent Log API] Error creating log:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Creating agent log'),
      { status: 500 }
    );
  }
}

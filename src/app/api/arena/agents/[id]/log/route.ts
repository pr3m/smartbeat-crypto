/**
 * GET /api/arena/agents/[id]/log - Paginated decision log
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const where: Record<string, unknown> = { agentId: id };
    if (type && type !== 'all') {
      where.action = type;
    }

    const [decisions, total] = await Promise.all([
      prisma.arenaDecision.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: Math.min(limit, 100),
      }),
      prisma.arenaDecision.count({ where }),
    ]);

    return NextResponse.json({
      decisions,
      total,
      offset,
      limit,
    });
  } catch (error) {
    console.error('[Arena] Get agent log error:', error);
    return NextResponse.json(
      { error: 'Failed to get agent log' },
      { status: 500 }
    );
  }
}

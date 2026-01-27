/**
 * Trade Agents API Route
 * GET /api/ai/agents - List all trade agents
 * POST /api/ai/agents - Create a new trade agent for a position
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const positionId = searchParams.get('positionId');

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (positionId) where.positionId = positionId;

    const agents = await prisma.tradeAgent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    return NextResponse.json({
      success: true,
      agents,
    });
  } catch (error) {
    console.error('[Agents API] Error fetching agents:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching agents'),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      positionId,
      positionType = 'simulated',
      pair,
      side,
      entryPrice,
      priceAlertPct = 2.0,
      checkCooldown = 300,
    } = body;

    // Validate required fields
    if (!positionId || !pair || !side || !entryPrice) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: positionId, pair, side, entryPrice' },
        { status: 400 }
      );
    }

    // Check if agent already exists for this position
    const existing = await prisma.tradeAgent.findUnique({
      where: { positionId },
    });

    if (existing) {
      // Reactivate if exists
      const updated = await prisma.tradeAgent.update({
        where: { positionId },
        data: {
          status: 'active',
          entryPrice,
          priceAlertPct,
          checkCooldown,
          lastPrice: null,
          lastCheckAt: null,
          lastAlertAt: null,
        },
      });

      return NextResponse.json({
        success: true,
        agent: updated,
        reactivated: true,
      });
    }

    // Create new agent
    const agent = await prisma.tradeAgent.create({
      data: {
        positionId,
        positionType,
        pair,
        side,
        entryPrice,
        priceAlertPct,
        checkCooldown,
        status: 'active',
      },
    });

    // Log creation
    await prisma.agentLog.create({
      data: {
        agentId: agent.id,
        type: 'check',
        content: `Agent created for ${side} ${pair} position at ${entryPrice}`,
        priceAt: entryPrice,
      },
    });

    return NextResponse.json({
      success: true,
      agent,
    });
  } catch (error) {
    console.error('[Agents API] Error creating agent:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Creating agent'),
      { status: 500 }
    );
  }
}

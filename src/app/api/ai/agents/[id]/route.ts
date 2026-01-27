/**
 * Single Trade Agent API Route
 * GET /api/ai/agents/[id] - Get agent details
 * PATCH /api/ai/agents/[id] - Update agent settings
 * DELETE /api/ai/agents/[id] - Delete/deactivate agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const agent = await prisma.tradeAgent.findUnique({
      where: { id },
      include: {
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      agent,
    });
  } catch (error) {
    console.error('[Agents API] Error fetching agent:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching agent'),
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, priceAlertPct, checkCooldown } = body;

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (priceAlertPct !== undefined) updateData.priceAlertPct = priceAlertPct;
    if (checkCooldown !== undefined) updateData.checkCooldown = checkCooldown;

    const agent = await prisma.tradeAgent.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      agent,
    });
  } catch (error) {
    console.error('[Agents API] Error updating agent:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Updating agent'),
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const hard = searchParams.get('hard') === 'true';

    if (hard) {
      // Actually delete (logs cascade)
      await prisma.tradeAgent.delete({
        where: { id },
      });
    } else {
      // Soft delete - just mark as completed
      await prisma.tradeAgent.update({
        where: { id },
        data: { status: 'completed' },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Agents API] Error deleting agent:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Deleting agent'),
      { status: 500 }
    );
  }
}

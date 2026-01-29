/**
 * Draft Orders API Route
 * GET /api/draft-orders - List all draft orders
 * POST /api/draft-orders - Create a draft order
 * DELETE /api/draft-orders - Delete all drafts or specific draft
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // pending, submitted, cancelled
    const source = searchParams.get('source'); // manual, ai
    const testModeParam = searchParams.get('testMode'); // true or false
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }
    if (source) {
      where.source = source;
    }
    // Filter by testMode if provided
    if (testModeParam !== null) {
      where.testMode = testModeParam === 'true';
    }

    const drafts = await prisma.draftOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      drafts,
      count: drafts.length,
    });
  } catch (error) {
    console.error('[Draft Orders API] Error fetching draft orders:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching draft orders'),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      pair = 'XRPEUR',
      side,
      orderType,
      price,
      price2,
      volume,
      displayVolume,
      leverage = 10,
      trailingOffset,
      trailingOffsetType,
      source = 'manual',
      aiSetupType,
      aiAnalysisId,
      activationCriteria,
      invalidation,
      positionSizePct,
      testMode = true,
    } = body;

    // Validation
    if (!side || !['buy', 'sell'].includes(side)) {
      return NextResponse.json(
        { error: 'Invalid side - must be "buy" or "sell"' },
        { status: 400 }
      );
    }

    if (!orderType) {
      return NextResponse.json(
        { error: 'Order type is required' },
        { status: 400 }
      );
    }

    if (!volume || volume <= 0) {
      return NextResponse.json(
        { error: 'Valid volume is required' },
        { status: 400 }
      );
    }

    // Create draft order
    const draft = await prisma.draftOrder.create({
      data: {
        pair,
        side,
        orderType,
        price: price || null,
        price2: price2 || null,
        volume,
        displayVolume: displayVolume || null,
        leverage,
        trailingOffset: trailingOffset || null,
        trailingOffsetType: trailingOffsetType || null,
        source,
        aiSetupType: aiSetupType || null,
        aiAnalysisId: aiAnalysisId || null,
        activationCriteria: activationCriteria ? JSON.stringify(activationCriteria) : null,
        invalidation: invalidation ? JSON.stringify(invalidation) : null,
        positionSizePct: positionSizePct || null,
        testMode,
      },
    });

    return NextResponse.json({
      success: true,
      draft,
      message: `Draft ${orderType} order created`,
    });
  } catch (error) {
    console.error('[Draft Orders API] Error creating draft order:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Creating draft order'),
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { draftId, deleteAll, status } = body;

    if (deleteAll) {
      // Delete all drafts (optionally filter by status)
      const where: Record<string, unknown> = {};
      if (status) {
        where.status = status;
      }

      const result = await prisma.draftOrder.deleteMany({
        where,
      });

      return NextResponse.json({
        success: true,
        deleted: result.count,
        message: `${result.count} draft orders deleted`,
      });
    }

    if (!draftId) {
      return NextResponse.json(
        { error: 'draftId or deleteAll required' },
        { status: 400 }
      );
    }

    // Delete specific draft
    const draft = await prisma.draftOrder.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    await prisma.draftOrder.delete({
      where: { id: draftId },
    });

    return NextResponse.json({
      success: true,
      deleted: 1,
      message: 'Draft order deleted',
    });
  } catch (error) {
    console.error('[Draft Orders API] Error deleting draft orders:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Deleting draft orders'),
      { status: 500 }
    );
  }
}

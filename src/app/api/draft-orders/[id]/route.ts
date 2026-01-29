/**
 * Single Draft Order API Route
 * GET /api/draft-orders/[id] - Get single draft
 * PATCH /api/draft-orders/[id] - Update draft
 * DELETE /api/draft-orders/[id] - Delete specific draft
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const draft = await prisma.draftOrder.findUnique({
      where: { id },
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      draft,
    });
  } catch (error) {
    console.error('[Draft Order API] Error fetching draft:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching draft order'),
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    // Check if draft exists
    const existing = await prisma.draftOrder.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    // Cannot update submitted/cancelled drafts
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot update draft with status: ${existing.status}` },
        { status: 400 }
      );
    }

    // Build update data - only include provided fields
    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'pair',
      'side',
      'orderType',
      'price',
      'price2',
      'volume',
      'displayVolume',
      'leverage',
      'trailingOffset',
      'trailingOffsetType',
      'activationCriteria',
      'invalidation',
      'positionSizePct',
      'status',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // Handle JSON fields
        if (field === 'activationCriteria' || field === 'invalidation') {
          updateData[field] = body[field] ? JSON.stringify(body[field]) : null;
        } else {
          updateData[field] = body[field];
        }
      }
    }

    const draft = await prisma.draftOrder.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      draft,
      message: 'Draft order updated',
    });
  } catch (error) {
    console.error('[Draft Order API] Error updating draft:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Updating draft order'),
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const draft = await prisma.draftOrder.findUnique({
      where: { id },
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    await prisma.draftOrder.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Draft order deleted',
    });
  } catch (error) {
    console.error('[Draft Order API] Error deleting draft:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Deleting draft order'),
      { status: 500 }
    );
  }
}

/**
 * Single Conversation API Route
 * GET /api/ai/conversations/[id] - Get conversation details
 * DELETE /api/ai/conversations/[id] - Delete a conversation
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

    const conversation = await prisma.chatConversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error('[Conversations API] Error fetching conversation:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching conversation'),
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Messages are deleted via cascade
    await prisma.chatConversation.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Conversations API] Error deleting conversation:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Deleting conversation'),
      { status: 500 }
    );
  }
}

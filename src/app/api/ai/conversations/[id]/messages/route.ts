/**
 * Conversation Messages API Route
 * GET /api/ai/conversations/[id]/messages - Get messages for a conversation
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
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Verify conversation exists
    const conversation = await prisma.chatConversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const messages = await prisma.chatMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
    });

    return NextResponse.json({
      success: true,
      messages,
      conversationId: id,
    });
  } catch (error) {
    console.error('[Messages API] Error fetching messages:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching messages'),
      { status: 500 }
    );
  }
}

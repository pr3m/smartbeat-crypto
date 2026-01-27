/**
 * Conversations API Route
 * GET /api/ai/conversations - List all conversations
 * POST /api/ai/conversations - Create a new conversation
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const context = searchParams.get('context');

    const where = context ? { context } : {};

    const [conversations, total] = await Promise.all([
      prisma.chatConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          title: true,
          context: true,
          messageCount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.chatConversation.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      conversations,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Conversations API] Error fetching conversations:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching conversations'),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { context = 'general', title } = body;

    const conversation = await prisma.chatConversation.create({
      data: {
        context,
        title: title || null,
      },
    });

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error('[Conversations API] Error creating conversation:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Creating conversation'),
      { status: 500 }
    );
  }
}

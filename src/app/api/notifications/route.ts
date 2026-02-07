/**
 * Notifications API Route
 * GET /api/notifications - List notifications (with unread count)
 * POST /api/notifications - Record a notification (+ 90-day retention cleanup)
 * PATCH /api/notifications - Bulk actions (markAllRead, markRead)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unread') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: Record<string, unknown> = {};
    if (unreadOnly) {
      where.read = false;
    }

    // Always get unread count for the badge
    const unreadCount = await prisma.notification.count({
      where: { read: false },
    });

    // If limit=0, only return the count (lightweight polling)
    if (limit === 0) {
      return NextResponse.json({
        success: true,
        notifications: [],
        unreadCount,
      });
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('[Notifications API] Error fetching notifications:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching notifications'),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, body: notifBody, type, tag, priority = 'medium', replacePrefix } = body;

    if (!title || !notifBody || !type || !tag) {
      return NextResponse.json(
        { error: 'title, body, type, and tag are required' },
        { status: 400 }
      );
    }

    // If replacePrefix provided, remove older notifications in the same group
    // e.g. replacePrefix="pnl-abc123" replaces "pnl-abc123-3" with "pnl-abc123-5"
    if (replacePrefix) {
      await prisma.notification.deleteMany({
        where: {
          tag: { startsWith: replacePrefix },
        },
      });
    }

    // Create notification
    const notification = await prisma.notification.create({
      data: {
        title,
        body: notifBody,
        type,
        tag,
        priority,
      },
    });

    // Retention cleanup: delete notifications older than 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    await prisma.notification.deleteMany({
      where: {
        createdAt: { lt: ninetyDaysAgo },
      },
    });

    return NextResponse.json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error('[Notifications API] Error creating notification:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Creating notification'),
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ids } = body;

    if (action === 'markAllRead') {
      const result = await prisma.notification.updateMany({
        where: { read: false },
        data: { read: true },
      });

      return NextResponse.json({
        success: true,
        updated: result.count,
        message: `${result.count} notifications marked as read`,
      });
    }

    if (action === 'markRead' && Array.isArray(ids) && ids.length > 0) {
      const result = await prisma.notification.updateMany({
        where: { id: { in: ids } },
        data: { read: true },
      });

      return NextResponse.json({
        success: true,
        updated: result.count,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "markAllRead" or "markRead" with ids.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Notifications API] Error updating notifications:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Updating notifications'),
      { status: 500 }
    );
  }
}

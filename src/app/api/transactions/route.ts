import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/transactions - Get transactions from database
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const type = searchParams.get('type');
    const asset = searchParams.get('asset');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build where clause
    const where: Record<string, unknown> = {};

    if (year) {
      const yearNum = parseInt(year);
      where.timestamp = {
        gte: new Date(yearNum, 0, 1),
        lte: new Date(yearNum, 11, 31, 23, 59, 59),
      };
    }

    if (type && type !== 'all') {
      where.type = type;
    }

    if (asset) {
      where.asset = { contains: asset.toUpperCase() };
    }

    // Get transactions
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        include: {
          taxEvents: true,
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    // Get summary stats
    const stats = await prisma.transaction.aggregate({
      where,
      _sum: {
        gain: true,
        cost: true,
        fee: true,
      },
      _count: true,
    });

    // Get counts by type
    const countsByType = await prisma.transaction.groupBy({
      by: ['type'],
      where,
      _count: { id: true },
    });

    // Get counts by category
    const countsByCategory = await prisma.transaction.groupBy({
      by: ['category'],
      where,
      _count: { id: true },
    });

    return NextResponse.json({
      transactions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      stats: {
        totalGain: stats._sum.gain || 0,
        totalCost: stats._sum.cost || 0,
        totalFees: stats._sum.fee || 0,
        count: stats._count,
      },
      countsByType: countsByType.reduce((acc, item) => {
        acc[item.type] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      countsByCategory: countsByCategory.reduce((acc, item) => {
        acc[item.category] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get transactions' },
      { status: 500 }
    );
  }
}

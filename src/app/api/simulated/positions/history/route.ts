import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

/**
 * GET /api/simulated/positions/history
 * Get closed simulated positions for trade history
 */
export async function GET() {
  try {
    const closedPositions = await prisma.simulatedPosition.findMany({
      where: {
        isOpen: false,
      },
      orderBy: { closedAt: 'desc' },
      include: {
        orders: {
          include: { fills: true },
        },
      },
    });

    // Transform to history format
    const positions = closedPositions.map(pos => {
      // Calculate entry and exit prices from orders
      const entryOrders = pos.orders.filter(o =>
        (pos.side === 'long' && o.type === 'buy') ||
        (pos.side === 'short' && o.type === 'sell')
      );
      const exitOrders = pos.orders.filter(o =>
        (pos.side === 'long' && o.type === 'sell') ||
        (pos.side === 'short' && o.type === 'buy')
      );

      // Get exit price from exit orders or use average entry as fallback
      let exitPrice = pos.avgEntryPrice;
      if (exitOrders.length > 0) {
        const totalExitValue = exitOrders.reduce((sum, o) => {
          const fills = o.fills;
          if (fills.length > 0) {
            return sum + fills.reduce((fSum, f) => fSum + f.price * f.volume, 0);
          }
          return sum + (o.price || o.marketPriceAtOrder) * o.filledVolume;
        }, 0);
        const totalExitVolume = exitOrders.reduce((sum, o) => sum + o.filledVolume, 0);
        if (totalExitVolume > 0) {
          exitPrice = totalExitValue / totalExitVolume;
        }
      }

      // Calculate duration in hours
      const openedAt = new Date(pos.openedAt);
      const closedAt = pos.closedAt ? new Date(pos.closedAt) : new Date();
      const durationMs = closedAt.getTime() - openedAt.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);

      // Determine outcome
      const pnl = pos.realizedPnl ?? 0;
      let outcome: 'win' | 'loss' | 'breakeven';
      if (pnl > 0.01) {
        outcome = 'win';
      } else if (pnl < -0.01) {
        outcome = 'loss';
      } else {
        outcome = 'breakeven';
      }

      return {
        id: pos.id,
        pair: pos.pair,
        side: pos.side as 'long' | 'short',
        volume: pos.volume,
        entryPrice: pos.avgEntryPrice,
        exitPrice,
        leverage: pos.leverage,
        realizedPnl: pnl,
        totalFees: pos.totalFees,
        openedAt: pos.openedAt.toISOString(),
        closedAt: pos.closedAt?.toISOString() ?? new Date().toISOString(),
        duration: durationHours,
        outcome,
      };
    });

    return NextResponse.json({ positions });
  } catch (error) {
    console.error('[History API] Error fetching closed positions:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching trade history'),
      { status: 500 }
    );
  }
}

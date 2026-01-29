import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

/**
 * GET /api/trading/history
 * Get closed margin trades from Kraken transaction history
 *
 * Groups transactions by krakenOrderId to get accurate P&L
 * Only includes trades with posstatus='closed'
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pair = searchParams.get('pair'); // Optional filter

    // Get all closed margin trades (opening trades with close data)
    const closedTrades = await prisma.transaction.findMany({
      where: {
        type: 'MARGIN_TRADE',
        posstatus: 'closed',
        ...(pair && { pair }),
      },
      orderBy: { timestamp: 'desc' },
    });

    // Group by krakenOrderId to avoid double-counting fills
    const orderGroups = new Map<string, typeof closedTrades>();
    for (const trade of closedTrades) {
      const orderId = trade.krakenOrderId || trade.id;
      if (!orderGroups.has(orderId)) {
        orderGroups.set(orderId, []);
      }
      orderGroups.get(orderId)!.push(trade);
    }

    // Transform grouped trades into position history
    const positions = Array.from(orderGroups.entries()).map(([orderId, trades]) => {
      // Aggregate values across all fills for this order
      const firstTrade = trades[0];

      // Calculate totals
      const totalVolume = trades.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const totalCost = trades.reduce((sum, t) => sum + (t.cost || 0), 0);
      const totalFees = trades.reduce((sum, t) => sum + (t.fee || 0) + (t.closeFee || 0), 0);
      const totalCloseCost = trades.reduce((sum, t) => sum + (t.closeCost || 0), 0);

      // Use Kraken's calculated P&L (netPnl is authoritative)
      const realizedPnl = trades.reduce((sum, t) => sum + (t.netPnl || 0), 0);

      // Calculate entry and exit prices
      const entryPrice = totalVolume > 0 ? totalCost / totalVolume : (firstTrade.price || 0);
      const exitPrice = totalVolume > 0 && totalCloseCost > 0
        ? totalCloseCost / totalVolume
        : (firstTrade.closePrice || entryPrice);

      // Parse leverage from string like "3:1"
      const leverageStr = firstTrade.leverage || '1:1';
      const leverage = parseInt(leverageStr.split(':')[0]) || 1;

      // Determine side from transaction type
      const side = firstTrade.side === 'buy' ? 'long' : 'short';

      // Calculate duration
      const openedAt = firstTrade.timestamp;
      // Estimate close time from close data or use a recent time
      const closedAt = firstTrade.closeCost
        ? new Date(openedAt.getTime() + (24 * 60 * 60 * 1000)) // Approximate
        : openedAt;
      const durationHours = (closedAt.getTime() - openedAt.getTime()) / (1000 * 60 * 60);

      // Determine outcome
      let outcome: 'win' | 'loss' | 'breakeven';
      if (realizedPnl > 0.01) {
        outcome = 'win';
      } else if (realizedPnl < -0.01) {
        outcome = 'loss';
      } else {
        outcome = 'breakeven';
      }

      return {
        id: orderId,
        pair: firstTrade.pair || 'XRPEUR',
        side,
        volume: totalVolume,
        entryPrice,
        exitPrice,
        leverage,
        realizedPnl,
        totalFees,
        openedAt: openedAt.toISOString(),
        closedAt: closedAt.toISOString(),
        duration: Math.max(0, durationHours),
        outcome,
      };
    });

    // Sort by closed date descending
    positions.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());

    return NextResponse.json({ positions });
  } catch (error) {
    console.error('[Trading History API] Error:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching trading history'),
      { status: 500 }
    );
  }
}

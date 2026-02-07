import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';
import { calculateSimulatedPnL, calculateSimulatedFees, calculateRealizedPnL } from '@/lib/trading/simulated-pnl';

/**
 * GET /api/simulated/positions
 * List simulated positions with optional filters
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const isOpen = searchParams.get('open'); // 'true' or 'false'
    const pair = searchParams.get('pair');
    const currentPrice = parseFloat(searchParams.get('currentPrice') || '0');

    const where: Record<string, unknown> = {};
    if (isOpen !== null) {
      where.isOpen = isOpen === 'true';
    }
    if (pair) {
      where.pair = pair;
    }

    const positions = await prisma.simulatedPosition.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      include: {
        orders: {
          include: { fills: true },
        },
      },
    });

    // Get simulated balance for equity (used in liquidation calculation)
    const simulatedBalance = await prisma.simulatedBalance.findUnique({
      where: { id: 'default' },
    });
    const accountEquity = simulatedBalance?.equity ?? 2000;

    // Calculate P&L for open positions if current price provided
    const positionsWithPnl = positions.map(pos => {
      if (pos.isOpen && currentPrice > 0) {
        const pnl = calculateSimulatedPnL(
          pos.avgEntryPrice,
          currentPrice,
          pos.volume,
          pos.side as 'long' | 'short',
          pos.leverage,
          pos.totalFees,
          accountEquity, // Pass account equity for accurate Kraken-style liquidation calc
          pos.openedAt.getTime() // Pass open time for rollover fee estimation
        );
        return {
          ...pos,
          unrealizedPnl: pnl.unrealizedPnl,
          unrealizedPnlPercent: pnl.unrealizedPnlPercent,
          unrealizedPnlLevered: pnl.unrealizedPnlLevered,
          unrealizedPnlLeveredPercent: pnl.unrealizedPnlLeveredPercent,
          liquidationPrice: pnl.liquidationPrice,
          marginUsed: pnl.marginUsed,
          currentValue: pnl.currentValue,
        };
      }
      return pos;
    });

    return NextResponse.json({ positions: positionsWithPnl });
  } catch (error) {
    console.error('[Positions API] Error fetching simulated positions:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching simulated positions'),
      { status: 500 }
    );
  }
}

/**
 * POST /api/simulated/positions
 * Close a position
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { positionId, closePrice, closeVolume } = body;

    if (!positionId) {
      return NextResponse.json({ error: 'Position ID required' }, { status: 400 });
    }
    if (!closePrice || closePrice <= 0) {
      return NextResponse.json({ error: 'Close price required' }, { status: 400 });
    }

    // Get the position
    const position = await prisma.simulatedPosition.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }
    if (!position.isOpen) {
      return NextResponse.json({ error: 'Position already closed' }, { status: 400 });
    }

    // Determine volume to close (default: full position)
    const volumeToClose = closeVolume && closeVolume > 0
      ? Math.min(closeVolume, position.volume)
      : position.volume;

    const isFullClose = volumeToClose >= position.volume;

    // Calculate closing fee
    const closingFee = calculateSimulatedFees(
      volumeToClose,
      closePrice,
      'market',
      position.leverage > 0
    );

    // Calculate proportional entry cost and fees for closed portion
    const portionRatio = volumeToClose / position.volume;
    const closedCost = position.totalCost * portionRatio;
    const closedFees = (position.totalFees * portionRatio) + closingFee;

    // Calculate realized P&L
    const realizedPnl = calculateRealizedPnL(
      position.avgEntryPrice,
      closePrice,
      volumeToClose,
      position.side as 'long' | 'short',
      closedFees
    );

    // Create closing order
    const closeOrder = await prisma.simulatedOrder.create({
      data: {
        pair: position.pair,
        type: position.side === 'long' ? 'sell' : 'buy',
        orderType: 'market',
        volume: volumeToClose,
        leverage: position.leverage,
        status: 'filled',
        filledVolume: volumeToClose,
        marketPriceAtOrder: closePrice,
        positionId: position.id,
      },
    });

    // Create fill for closing order
    await prisma.simulatedFill.create({
      data: {
        orderId: closeOrder.id,
        price: closePrice,
        volume: volumeToClose,
        fee: closingFee,
      },
    });

    // Update or close position
    let updatedPosition;
    if (isFullClose) {
      updatedPosition = await prisma.simulatedPosition.update({
        where: { id: positionId },
        data: {
          isOpen: false,
          realizedPnl,
          totalFees: position.totalFees + closingFee,
          closedAt: new Date(),
        },
      });
    } else {
      // Partial close - update remaining position
      const remainingVolume = position.volume - volumeToClose;
      const remainingCost = position.totalCost - closedCost;
      const remainingFees = position.totalFees - (position.totalFees * portionRatio);
      const remainingAvgPrice = remainingVolume > 0 ? (remainingCost / remainingVolume) : position.avgEntryPrice;

      updatedPosition = await prisma.simulatedPosition.update({
        where: { id: positionId },
        data: {
          volume: remainingVolume,
          totalCost: remainingCost,
          totalFees: remainingFees,
          avgEntryPrice: remainingAvgPrice,
          realizedPnl: (position.realizedPnl || 0) + realizedPnl,
        },
      });
    }

    // Update balance with realized P&L
    await prisma.simulatedBalance.update({
      where: { id: 'default' },
      data: {
        eurBalance: { increment: realizedPnl },
        totalRealizedPnl: { increment: realizedPnl },
        totalFeesPaid: { increment: closingFee },
      },
    });

    // Create trade analysis record for AI backtesting
    await prisma.tradeAnalysis.create({
      data: {
        positionId: position.id,
        tradeType: position.side,
        entryPrice: position.avgEntryPrice,
        exitPrice: closePrice,
        realizedPnl,
        pnlPercent: (realizedPnl / (closedCost / position.leverage)) * 100,
        outcome: realizedPnl > 0 ? 'win' : realizedPnl < 0 ? 'loss' : 'breakeven',
        entrySnapshot: position.entryConditions || '{}',
      },
    });

    return NextResponse.json({
      success: true,
      position: updatedPosition,
      realizedPnl,
      closingFee,
      message: `Position ${isFullClose ? 'closed' : 'partially closed'} at €${closePrice.toFixed(4)}. P&L: ${realizedPnl >= 0 ? '+' : ''}€${realizedPnl.toFixed(2)}`,
    });
  } catch (error) {
    console.error('[Positions API] Error closing simulated position:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Closing simulated position'),
      { status: 500 }
    );
  }
}

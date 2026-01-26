import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateSimulatedFees } from '@/lib/trading/simulated-pnl';

/**
 * POST /api/simulated/orders/fill
 * Check all open limit orders and fill any that should be triggered
 * based on the current market price
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { currentPrice } = body;

    if (!currentPrice || currentPrice <= 0) {
      return NextResponse.json(
        { error: 'Current price required' },
        { status: 400 }
      );
    }

    // Find all open limit orders
    const openOrders = await prisma.simulatedOrder.findMany({
      where: {
        status: 'open',
        orderType: { in: ['limit', 'stop-loss', 'take-profit'] },
      },
      orderBy: { createdAt: 'asc' }, // Fill oldest first
    });

    const filledOrders: Array<{
      orderId: string;
      type: string;
      orderType: string;
      price: number;
      fillPrice: number;
      volume: number;
    }> = [];

    for (const order of openOrders) {
      if (!order.price) continue;

      let shouldFill = false;

      // Determine if order should fill based on order type and side
      if (order.orderType === 'limit') {
        // BUY limit: fills when price drops to or below limit price
        // SELL limit: fills when price rises to or above limit price
        if (order.type === 'buy' && currentPrice <= order.price) {
          shouldFill = true;
        } else if (order.type === 'sell' && currentPrice >= order.price) {
          shouldFill = true;
        }
      } else if (order.orderType === 'stop-loss') {
        // BUY stop-loss: fills when price rises to trigger (covering short)
        // SELL stop-loss: fills when price drops to trigger (exiting long)
        if (order.type === 'buy' && currentPrice >= order.price) {
          shouldFill = true;
        } else if (order.type === 'sell' && currentPrice <= order.price) {
          shouldFill = true;
        }
      } else if (order.orderType === 'take-profit') {
        // BUY take-profit: fills when price drops to trigger (covering short at profit)
        // SELL take-profit: fills when price rises to trigger (exiting long at profit)
        if (order.type === 'buy' && currentPrice <= order.price) {
          shouldFill = true;
        } else if (order.type === 'sell' && currentPrice >= order.price) {
          shouldFill = true;
        }
      }

      if (shouldFill) {
        // Use the limit price for fill (better execution than market for limit orders)
        const fillPrice = order.orderType === 'limit' ? order.price : currentPrice;

        try {
          await executeOrder(order.id, fillPrice);
          filledOrders.push({
            orderId: order.id,
            type: order.type,
            orderType: order.orderType,
            price: order.price,
            fillPrice,
            volume: order.volume,
          });
        } catch (err) {
          console.error(`Failed to fill order ${order.id}:`, err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      checked: openOrders.length,
      filled: filledOrders.length,
      filledOrders,
    });
  } catch (error) {
    console.error('Error checking limit orders:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check orders' },
      { status: 500 }
    );
  }
}

/**
 * Execute an order (fill it and create/update position)
 */
async function executeOrder(orderId: string, fillPrice: number) {
  const order = await prisma.simulatedOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  // Calculate fee
  const fee = calculateSimulatedFees(
    order.volume,
    fillPrice,
    order.orderType as 'market' | 'limit',
    order.leverage > 0
  );

  // Create fill record
  const fill = await prisma.simulatedFill.create({
    data: {
      orderId,
      price: fillPrice,
      volume: order.volume,
      fee,
    },
  });

  // Determine position side
  const side = order.type === 'buy' ? 'long' : 'short';

  // Check for existing open position on the same pair and side
  let position = await prisma.simulatedPosition.findFirst({
    where: {
      pair: order.pair,
      side,
      isOpen: true,
    },
  });

  const totalCost = order.volume * fillPrice;

  if (position) {
    // Add to existing position (average down/up)
    const newVolume = position.volume + order.volume;
    const newTotalCost = position.totalCost + totalCost;
    const newAvgPrice = newTotalCost / newVolume;

    position = await prisma.simulatedPosition.update({
      where: { id: position.id },
      data: {
        volume: newVolume,
        avgEntryPrice: newAvgPrice,
        totalCost: newTotalCost,
        totalFees: position.totalFees + fee,
      },
    });
  } else {
    // Create new position
    position = await prisma.simulatedPosition.create({
      data: {
        pair: order.pair,
        side,
        volume: order.volume,
        avgEntryPrice: fillPrice,
        leverage: order.leverage,
        totalCost,
        totalFees: fee,
        entryConditions: order.entryConditions,
      },
    });
  }

  // Link order to position
  const updatedOrder = await prisma.simulatedOrder.update({
    where: { id: orderId },
    data: {
      status: 'filled',
      filledVolume: order.volume,
      positionId: position.id,
    },
    include: {
      fills: true,
      position: true,
    },
  });

  // Update balance (deduct fee)
  await prisma.simulatedBalance.update({
    where: { id: 'default' },
    data: {
      totalFeesPaid: { increment: fee },
    },
  });

  return {
    order: updatedOrder,
    position,
    fill,
  };
}

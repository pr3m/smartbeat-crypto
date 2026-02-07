import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';
import { calculateSimulatedFees, calculateMarginRequired, calculateSimulatedPnL } from '@/lib/trading/simulated-pnl';

/**
 * DELETE /api/simulated/orders
 * Cancel a simulated order or all open orders
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { orderId, cancelAll } = body;

    if (cancelAll) {
      // Cancel all open orders
      const result = await prisma.simulatedOrder.updateMany({
        where: { status: 'open' },
        data: { status: 'cancelled' },
      });

      return NextResponse.json({
        success: true,
        cancelled: result.count,
        message: `${result.count} orders cancelled`,
      });
    }

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId or cancelAll required' },
        { status: 400 }
      );
    }

    // Cancel specific order
    const order = await prisma.simulatedOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    if (order.status !== 'open') {
      return NextResponse.json(
        { error: `Cannot cancel order with status: ${order.status}` },
        { status: 400 }
      );
    }

    await prisma.simulatedOrder.update({
      where: { id: orderId },
      data: { status: 'cancelled' },
    });

    return NextResponse.json({
      success: true,
      cancelled: 1,
      message: 'Order cancelled',
    });
  } catch (error) {
    console.error('[Orders API] Error cancelling simulated order:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Cancelling simulated order'),
      { status: 500 }
    );
  }
}

/**
 * GET /api/simulated/orders
 * List simulated orders with optional filters
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // open, filled, cancelled
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }

    const orders = await prisma.simulatedOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        fills: true,
        position: true,
      },
    });

    return NextResponse.json({ orders });
  } catch (error) {
    console.error('[Orders API] Error fetching simulated orders:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching simulated orders'),
      { status: 500 }
    );
  }
}

/**
 * POST /api/simulated/orders
 * Create a new simulated order (market orders fill immediately)
 * Supports all 9 Kraken order types
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      pair = 'XRPEUR',
      type, // 'buy' | 'sell'
      orderType = 'market', // market, limit, stop-loss, stop-loss-limit, take-profit, take-profit-limit, trailing-stop, trailing-stop-limit, iceberg
      price, // Primary price (limit/trigger)
      price2, // Secondary price for *-limit types
      volume, // Position size in XRP
      leverage = 10,
      marketPrice, // Current market price
      trailingOffset, // For trailing stop orders
      trailingOffsetType, // 'percent' | 'absolute'
      displayVolume, // For iceberg orders
      entryConditions, // JSON snapshot of indicators
    } = body;

    // Validation
    if (!type || !['buy', 'sell'].includes(type)) {
      return NextResponse.json({ error: 'Invalid order type' }, { status: 400 });
    }
    if (!volume || volume <= 0) {
      return NextResponse.json({ error: 'Invalid volume' }, { status: 400 });
    }
    if (!marketPrice || marketPrice <= 0) {
      return NextResponse.json({ error: 'Market price required' }, { status: 400 });
    }
    // Validate price based on order type
    const needsPrice = ['limit', 'stop-loss', 'stop-loss-limit', 'take-profit', 'take-profit-limit', 'iceberg'].includes(orderType);
    const needsTrailingOffset = ['trailing-stop', 'trailing-stop-limit'].includes(orderType);

    if (needsPrice && (!price || price <= 0)) {
      return NextResponse.json({ error: `Price required for ${orderType} orders` }, { status: 400 });
    }
    if (needsTrailingOffset && (!trailingOffset || trailingOffset <= 0)) {
      return NextResponse.json({ error: 'Trailing offset required for trailing stop orders' }, { status: 400 });
    }

    // *-limit types need secondary price
    const needsPrice2 = ['stop-loss-limit', 'take-profit-limit', 'trailing-stop-limit'].includes(orderType);
    if (needsPrice2 && (!price2 || price2 <= 0)) {
      return NextResponse.json({ error: `Secondary price required for ${orderType} orders` }, { status: 400 });
    }

    // Get current balance
    const balance = await prisma.simulatedBalance.findUnique({
      where: { id: 'default' },
    });

    if (!balance) {
      return NextResponse.json({ error: 'Balance not initialized' }, { status: 400 });
    }

    const openPositions = await prisma.simulatedPosition.findMany({
      where: { isOpen: true },
    });
    let currentMarginUsed = 0;
    for (const pos of openPositions) {
      currentMarginUsed += pos.totalCost / pos.leverage;
    }

    const exitPosition = openPositions.find(pos => (
      pos.pair === pair
      && ((pos.side === 'long' && type === 'sell') || (pos.side === 'short' && type === 'buy'))
    ));

    const isExitOrderType = [
      'stop-loss',
      'stop-loss-limit',
      'take-profit',
      'take-profit-limit',
      'trailing-stop',
      'trailing-stop-limit',
    ].includes(orderType);

    const isReduceOnlyExit = Boolean(exitPosition && isExitOrderType && volume <= exitPosition.volume);

    // Calculate required margin
    // For trailing stops, use market price for margin calculation
    const executionPrice = orderType === 'market' || needsTrailingOffset ? marketPrice : price;
    const marginRequired = calculateMarginRequired(volume, executionPrice, leverage);

    // Check available margin (considering open positions + unrealized P&L)
    let totalUnrealizedPnl = 0;
    if (marketPrice > 0) {
      for (const pos of openPositions) {
        const pnl = calculateSimulatedPnL(
          pos.avgEntryPrice,
          marketPrice,
          pos.volume,
          pos.side as 'long' | 'short',
          pos.leverage,
          pos.totalFees,
          undefined,
          pos.openedAt.getTime()
        );
        totalUnrealizedPnl += pnl.unrealizedPnl;
      }
    }

    const equity = balance.eurBalance + balance.cryptoValue + totalUnrealizedPnl;
    const freeMargin = equity - currentMarginUsed; // Real free margin (NOT multiplied by leverage)

    if (!isReduceOnlyExit && marginRequired > freeMargin) {
      return NextResponse.json(
        { error: `Insufficient margin. Required: €${marginRequired.toFixed(2)}, Available: €${freeMargin.toFixed(2)}` },
        { status: 400 }
      );
    }

    // Calculate initial trailing high/low water mark
    const initialHighWater = type === 'sell' ? marketPrice : null; // For trailing sell (exit long)
    const initialLowWater = type === 'buy' ? marketPrice : null; // For trailing buy (exit short)

    // Create the order with all fields
    const order = await prisma.simulatedOrder.create({
      data: {
        pair,
        type,
        orderType,
        price: needsPrice ? price : null,
        price2: needsPrice2 ? price2 : null,
        volume,
        leverage,
        status: orderType === 'market' ? 'filled' : 'open',
        filledVolume: orderType === 'market' ? volume : 0,
        marketPriceAtOrder: marketPrice,
        trailingOffset: needsTrailingOffset ? trailingOffset : null,
        trailingOffsetType: needsTrailingOffset ? (trailingOffsetType || 'percent') : null,
        trailingHighWater: initialHighWater,
        trailingLowWater: initialLowWater,
        displayVolume: orderType === 'iceberg' ? (displayVolume || volume * 0.1) : null,
        entryConditions: entryConditions ? JSON.stringify(entryConditions) : null,
      },
    });

    // For market orders, execute immediately
    if (orderType === 'market') {
      const result = await executeOrder(order.id, marketPrice);
      return NextResponse.json({
        success: true,
        order: result.order,
        position: result.position,
        fill: result.fill,
        message: `Market ${type} order filled at €${marketPrice.toFixed(4)}`,
      });
    }

    // For non-market orders, return the pending order
    return NextResponse.json({
      success: true,
      order,
      message: `Limit ${type} order placed at €${price.toFixed(4)}`,
    });
  } catch (error) {
    console.error('[Orders API] Error creating simulated order:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Creating simulated order'),
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

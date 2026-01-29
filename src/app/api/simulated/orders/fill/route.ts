import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateSimulatedFees } from '@/lib/trading/simulated-pnl';

/**
 * POST /api/simulated/orders/fill
 * Check all open orders and fill any that should be triggered
 * based on the current market price.
 *
 * Supports all 9 Kraken order types:
 * - market: Immediate fill at current price
 * - limit: Fill when price crosses limit
 * - stop-loss: Trigger when price crosses threshold, fill at market
 * - stop-loss-limit: Trigger at threshold, then wait for limit fill
 * - take-profit: Trigger when price reaches target, fill at market
 * - take-profit-limit: Trigger at target, then wait for limit fill
 * - trailing-stop: Track high/low water mark, trigger on reversal by offset
 * - trailing-stop-limit: Same as above, place limit instead of market
 * - iceberg: Fill in chunks of displayVolume
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

    // Find all open and triggered orders
    const openOrders = await prisma.simulatedOrder.findMany({
      where: {
        status: { in: ['open', 'triggered'] },
      },
      orderBy: { createdAt: 'asc' }, // Fill oldest first
    });

    const filledOrders: Array<{
      orderId: string;
      type: string;
      orderType: string;
      price: number | null;
      fillPrice: number;
      volume: number;
    }> = [];

    const triggeredOrders: Array<{
      orderId: string;
      orderType: string;
      triggerPrice: number;
    }> = [];

    for (const order of openOrders) {
      // Handle triggered orders (waiting for limit fill after trigger)
      if (order.status === 'triggered') {
        if (order.price2) {
          const shouldFillLimit = checkLimitFill(order.type, currentPrice, order.price2);
          if (shouldFillLimit) {
            try {
              await executeOrder(order.id, order.price2);
              filledOrders.push({
                orderId: order.id,
                type: order.type,
                orderType: order.orderType,
                price: order.price,
                fillPrice: order.price2,
                volume: order.volume,
              });
            } catch (err) {
              console.error(`Failed to fill triggered order ${order.id}:`, err);
            }
          }
        }
        continue;
      }

      // Handle different order types
      let shouldFill = false;
      let shouldTrigger = false;
      let fillPrice = currentPrice;

      switch (order.orderType) {
        case 'limit':
          shouldFill = checkLimitFill(order.type, currentPrice, order.price!);
          fillPrice = order.price!; // Fill at limit price (better execution)
          break;

        case 'stop-loss':
          // BUY stop-loss: triggers when price rises above trigger (covering short)
          // SELL stop-loss: triggers when price drops below trigger (exiting long)
          if (order.type === 'buy' && currentPrice >= order.price!) {
            shouldFill = true;
          } else if (order.type === 'sell' && currentPrice <= order.price!) {
            shouldFill = true;
          }
          break;

        case 'stop-loss-limit':
          // First stage: trigger, then place limit
          if (order.type === 'buy' && currentPrice >= order.price!) {
            shouldTrigger = true;
          } else if (order.type === 'sell' && currentPrice <= order.price!) {
            shouldTrigger = true;
          }
          break;

        case 'take-profit':
          // BUY take-profit: triggers when price drops to target (covering short at profit)
          // SELL take-profit: triggers when price rises to target (exiting long at profit)
          if (order.type === 'buy' && currentPrice <= order.price!) {
            shouldFill = true;
          } else if (order.type === 'sell' && currentPrice >= order.price!) {
            shouldFill = true;
          }
          break;

        case 'take-profit-limit':
          // First stage: trigger, then place limit
          if (order.type === 'buy' && currentPrice <= order.price!) {
            shouldTrigger = true;
          } else if (order.type === 'sell' && currentPrice >= order.price!) {
            shouldTrigger = true;
          }
          break;

        case 'trailing-stop':
        case 'trailing-stop-limit': {
          // Update high/low water marks
          const result = await updateTrailingStop(order, currentPrice);
          if (result.shouldTrigger) {
            if (order.orderType === 'trailing-stop') {
              shouldFill = true;
            } else {
              shouldTrigger = true;
            }
          }
          break;
        }

        case 'iceberg': {
          // Check if limit price reached
          if (checkLimitFill(order.type, currentPrice, order.price!)) {
            const result = await fillIcebergChunk(order, currentPrice);
            if (result.filled) {
              filledOrders.push({
                orderId: order.id,
                type: order.type,
                orderType: order.orderType,
                price: order.price,
                fillPrice: order.price!,
                volume: result.filledVolume,
              });
            }
          }
          continue; // Iceberg handles its own fill logic
        }

        default:
          // Unknown order type, skip
          continue;
      }

      // Execute fill or trigger
      if (shouldFill) {
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
      } else if (shouldTrigger) {
        try {
          await triggerOrder(order.id, currentPrice);
          triggeredOrders.push({
            orderId: order.id,
            orderType: order.orderType,
            triggerPrice: currentPrice,
          });
        } catch (err) {
          console.error(`Failed to trigger order ${order.id}:`, err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      checked: openOrders.length,
      filled: filledOrders.length,
      triggered: triggeredOrders.length,
      filledOrders,
      triggeredOrders,
    });
  } catch (error) {
    console.error('Error checking orders:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check orders' },
      { status: 500 }
    );
  }
}

/**
 * Check if a limit order should fill
 */
function checkLimitFill(type: string, currentPrice: number, limitPrice: number): boolean {
  // BUY limit: fills when price drops to or below limit price
  // SELL limit: fills when price rises to or above limit price
  if (type === 'buy' && currentPrice <= limitPrice) {
    return true;
  }
  if (type === 'sell' && currentPrice >= limitPrice) {
    return true;
  }
  return false;
}

/**
 * Update trailing stop high/low water marks and check for trigger
 */
async function updateTrailingStop(
  order: {
    id: string;
    type: string;
    trailingOffset: number | null;
    trailingOffsetType: string | null;
    trailingHighWater: number | null;
    trailingLowWater: number | null;
  },
  currentPrice: number
): Promise<{ shouldTrigger: boolean }> {
  if (!order.trailingOffset) {
    return { shouldTrigger: false };
  }

  let shouldTrigger = false;
  const updateData: { trailingHighWater?: number; trailingLowWater?: number } = {};

  // Calculate trigger distance
  const offset = order.trailingOffsetType === 'percent'
    ? currentPrice * (order.trailingOffset / 100)
    : order.trailingOffset;

  if (order.type === 'sell') {
    // Trailing sell (exit long): track highest price, trigger when price drops by offset
    const highWater = Math.max(order.trailingHighWater || currentPrice, currentPrice);
    if (highWater > (order.trailingHighWater || 0)) {
      updateData.trailingHighWater = highWater;
    }

    // Check if price dropped from high by offset amount
    const triggerPrice = highWater - offset;
    if (currentPrice <= triggerPrice) {
      shouldTrigger = true;
    }
  } else {
    // Trailing buy (exit short): track lowest price, trigger when price rises by offset
    const lowWater = Math.min(order.trailingLowWater || currentPrice, currentPrice);
    if (lowWater < (order.trailingLowWater || Infinity)) {
      updateData.trailingLowWater = lowWater;
    }

    // Check if price rose from low by offset amount
    const triggerPrice = lowWater + offset;
    if (currentPrice >= triggerPrice) {
      shouldTrigger = true;
    }
  }

  // Update water marks in DB
  if (Object.keys(updateData).length > 0) {
    await prisma.simulatedOrder.update({
      where: { id: order.id },
      data: updateData,
    });
  }

  return { shouldTrigger };
}

/**
 * Fill a chunk of an iceberg order
 */
async function fillIcebergChunk(
  order: {
    id: string;
    type: string;
    orderType: string;
    pair: string;
    price: number | null;
    volume: number;
    displayVolume: number | null;
    filledVolume: number;
    filledDisplayVol: number;
    leverage: number;
    entryConditions: string | null;
  },
  fillPrice: number
): Promise<{ filled: boolean; filledVolume: number }> {
  const displayVol = order.displayVolume || order.volume * 0.1;
  const remainingTotal = order.volume - order.filledVolume;

  if (remainingTotal <= 0) {
    // Order fully filled
    await prisma.simulatedOrder.update({
      where: { id: order.id },
      data: { status: 'filled' },
    });
    return { filled: false, filledVolume: 0 };
  }

  // Fill up to displayVolume
  const fillVolume = Math.min(displayVol, remainingTotal);

  // Calculate fee
  const fee = calculateSimulatedFees(fillVolume, fillPrice, 'limit', order.leverage > 0);

  // Create fill record
  await prisma.simulatedFill.create({
    data: {
      orderId: order.id,
      price: fillPrice,
      volume: fillVolume,
      fee,
    },
  });

  // Update order
  const newFilledVolume = order.filledVolume + fillVolume;
  const isFullyFilled = newFilledVolume >= order.volume;

  await prisma.simulatedOrder.update({
    where: { id: order.id },
    data: {
      filledVolume: newFilledVolume,
      filledDisplayVol: 0, // Reset for next chunk
      status: isFullyFilled ? 'filled' : 'open',
    },
  });

  // Update position (partial fill)
  await updatePosition(order, fillVolume, fillPrice, fee);

  // Update balance (deduct fee)
  await prisma.simulatedBalance.update({
    where: { id: 'default' },
    data: {
      totalFeesPaid: { increment: fee },
    },
  });

  return { filled: true, filledVolume: fillVolume };
}

/**
 * Trigger a two-stage order (changes status from open to triggered)
 */
async function triggerOrder(orderId: string, triggerPrice: number) {
  await prisma.simulatedOrder.update({
    where: { id: orderId },
    data: {
      status: 'triggered',
      isTriggered: true,
      triggeredAt: new Date(),
    },
  });
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

  // Update position
  const position = await updatePosition(order, order.volume, fillPrice, fee);

  // Link order to position and mark filled
  const updatedOrder = await prisma.simulatedOrder.update({
    where: { id: orderId },
    data: {
      status: 'filled',
      filledVolume: order.volume,
      positionId: position?.id || null,
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

/**
 * Update or create position based on order fill
 */
async function updatePosition(
  order: {
    type: string;
    pair: string;
    leverage: number;
    entryConditions: string | null;
  },
  volume: number,
  fillPrice: number,
  fee: number
) {
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

  const totalCost = volume * fillPrice;

  if (position) {
    // Add to existing position (average down/up)
    const newVolume = position.volume + volume;
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
        volume,
        avgEntryPrice: fillPrice,
        leverage: order.leverage,
        totalCost,
        totalFees: fee,
        entryConditions: order.entryConditions,
      },
    });
  }

  return position;
}

/**
 * Submit Draft Order API Route
 * POST /api/draft-orders/[id]/submit - Submit draft as real order
 *
 * Routes to /api/simulated/orders (test mode) or /api/kraken/private/orders (live mode)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { testMode = true, currentPrice } = body;

    // Get draft
    const draft = await prisma.draftOrder.findUnique({
      where: { id },
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    if (draft.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot submit draft with status: ${draft.status}` },
        { status: 400 }
      );
    }

    // Get current price if not provided
    let marketPrice = currentPrice;
    if (!marketPrice) {
      try {
        const tickerRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:4000'}/api/kraken/public/ticker?pair=XRPEUR`
        );
        const tickerData = await tickerRes.json();
        if (tickerData.data?.price) {
          marketPrice = parseFloat(tickerData.data.price);
        }
      } catch {
        // Fall back to draft price if we can't get current price
        marketPrice = draft.price || 0;
      }
    }

    let result;
    let orderId: string | null = null;

    if (testMode) {
      // Submit to simulated orders API
      const orderParams = {
        pair: draft.pair,
        type: draft.side,
        orderType: draft.orderType === 'iceberg' ? 'limit' : draft.orderType,
        price: draft.price,
        price2: draft.price2,
        volume: draft.volume,
        leverage: draft.leverage,
        marketPrice,
        trailingOffset: draft.trailingOffset,
        trailingOffsetType: draft.trailingOffsetType,
        displayVolume: draft.displayVolume,
        entryConditions: {
          source: draft.source,
          aiSetupType: draft.aiSetupType,
          draftId: draft.id,
          activationCriteria: draft.activationCriteria ? JSON.parse(draft.activationCriteria) : null,
        },
      };

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:4000'}/api/simulated/orders`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderParams),
        }
      );

      result = await response.json();

      if (!response.ok || result.error) {
        return NextResponse.json(
          { error: result.error || 'Failed to submit order' },
          { status: 400 }
        );
      }

      orderId = result.order?.id || null;
    } else {
      // Submit to Kraken private API
      const krakenParams: Record<string, string | number | boolean | undefined> = {
        pair: draft.pair,
        type: draft.side,
        ordertype: draft.orderType === 'iceberg' ? 'limit' : draft.orderType,
        volume: draft.volume.toString(),
      };

      // Add price based on order type
      if (draft.price) {
        if (draft.orderType.includes('trailing')) {
          // Trailing stop offset
          krakenParams.price = draft.trailingOffsetType === 'percent'
            ? `${draft.trailingOffset}%`
            : draft.trailingOffset?.toString();
        } else {
          krakenParams.price = draft.price.toFixed(5);
        }
      }

      if (draft.price2) {
        if (draft.orderType.includes('trailing')) {
          krakenParams.price2 = draft.trailingOffsetType === 'percent'
            ? `${draft.price2}%`
            : draft.price2.toString();
        } else {
          krakenParams.price2 = draft.price2.toFixed(5);
        }
      }

      // Add leverage
      if (draft.leverage > 1) {
        krakenParams.leverage = draft.leverage.toString();
      }

      // Add display volume for iceberg
      if (draft.orderType === 'iceberg' && draft.displayVolume) {
        krakenParams.displayvol = draft.displayVolume.toString();
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:4000'}/api/kraken/private/orders`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(krakenParams),
        }
      );

      result = await response.json();

      if (!response.ok || result.error) {
        return NextResponse.json(
          { error: result.error || 'Failed to submit order to Kraken' },
          { status: 400 }
        );
      }

      orderId = result.txid?.[0] || null;
    }

    // Update draft status
    await prisma.draftOrder.update({
      where: { id },
      data: {
        status: 'submitted',
        submittedOrderId: orderId,
      },
    });

    return NextResponse.json({
      success: true,
      orderId,
      testMode,
      message: `Draft order submitted${testMode ? ' (test mode)' : ''}`,
      result,
    });
  } catch (error) {
    console.error('[Draft Submit API] Error submitting draft:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Submitting draft order'),
      { status: 500 }
    );
  }
}

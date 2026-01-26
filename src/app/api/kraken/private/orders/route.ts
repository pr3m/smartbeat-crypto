import { NextRequest, NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';
import type { AddOrderParams } from '@/lib/kraken/types';

export async function GET(request: NextRequest) {
  if (!krakenClient.hasCredentials()) {
    return NextResponse.json(
      { error: 'API credentials not configured' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'open';

  try {
    if (type === 'open') {
      const result = await krakenClient.getOpenOrders(true);
      // Transform Kraken response to match frontend expected format
      // Kraken returns { open: { [txid]: OrderInfo } }
      const ordersMap = result.open || {};
      const orders = Object.entries(ordersMap).map(([id, order]: [string, any]) => ({
        id,
        pair: order.descr?.pair || '',
        type: order.descr?.type || 'buy',
        orderType: order.descr?.ordertype || 'limit',
        price: parseFloat(order.descr?.price || order.price || '0'),
        volume: parseFloat(order.vol || '0'),
        volumeExecuted: parseFloat(order.vol_exec || '0'),
        leverage: order.descr?.leverage ? parseInt(order.descr.leverage.split(':')[0]) : 1,
        status: order.status || 'open',
        createdAt: order.opentm ? new Date(order.opentm * 1000).toISOString() : new Date().toISOString(),
        description: order.descr?.order || '',
      }));
      return NextResponse.json({ orders });
    } else {
      const result = await krakenClient.getClosedOrders(true);
      // Transform closed orders similarly
      const ordersMap = result.closed || {};
      const orders = Object.entries(ordersMap).map(([id, order]: [string, any]) => ({
        id,
        pair: order.descr?.pair || '',
        type: order.descr?.type || 'buy',
        orderType: order.descr?.ordertype || 'limit',
        price: parseFloat(order.descr?.price || order.price || '0'),
        volume: parseFloat(order.vol || '0'),
        volumeExecuted: parseFloat(order.vol_exec || '0'),
        leverage: order.descr?.leverage ? parseInt(order.descr.leverage.split(':')[0]) : 1,
        status: order.status || 'closed',
        createdAt: order.opentm ? new Date(order.opentm * 1000).toISOString() : new Date().toISOString(),
        closedAt: order.closetm ? new Date(order.closetm * 1000).toISOString() : undefined,
        description: order.descr?.order || '',
      }));
      return NextResponse.json({ orders, count: result.count });
    }
  } catch (error) {
    console.error('Orders error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!krakenClient.hasCredentials()) {
    return NextResponse.json(
      { error: 'API credentials not configured' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json() as AddOrderParams;

    // Validate required fields
    if (!body.pair || !body.type || !body.ordertype || !body.volume) {
      return NextResponse.json(
        { error: 'Missing required fields: pair, type, ordertype, volume' },
        { status: 400 }
      );
    }

    const result = await krakenClient.addOrder(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Add order error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!krakenClient.hasCredentials()) {
    return NextResponse.json(
      { error: 'API credentials not configured' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const txid = searchParams.get('txid');
  const cancelAll = searchParams.get('all');

  try {
    if (cancelAll === 'true') {
      const result = await krakenClient.cancelAllOrders();
      return NextResponse.json(result);
    }

    if (!txid) {
      return NextResponse.json(
        { error: 'Missing txid parameter' },
        { status: 400 }
      );
    }

    const result = await krakenClient.cancelOrder(txid);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Cancel order error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

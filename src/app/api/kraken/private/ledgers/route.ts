import { NextRequest, NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';

export async function GET(request: NextRequest) {
  if (!krakenClient.hasCredentials()) {
    return NextResponse.json(
      { error: 'API credentials not configured' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const offset = searchParams.get('offset');
  const all = searchParams.get('all');
  const asset = searchParams.get('asset') || undefined;
  const type = searchParams.get('type') || undefined;

  try {
    if (all === 'true') {
      // Get all ledgers with pagination
      const ledgers = await krakenClient.getAllLedgers(
        start ? parseInt(start) : undefined,
        end ? parseInt(end) : undefined
      );
      return NextResponse.json({ ledgers, count: Object.keys(ledgers).length });
    }

    // Get single page
    const result = await krakenClient.getLedgers(
      asset,
      'currency',
      type,
      start ? parseInt(start) : undefined,
      end ? parseInt(end) : undefined,
      offset ? parseInt(offset) : 0
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Ledgers error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

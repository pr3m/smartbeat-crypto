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
  const asset = searchParams.get('asset') || 'ZEUR';

  try {
    const result = await krakenClient.getTradeBalance(asset);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Trade balance error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

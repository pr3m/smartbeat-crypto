import { NextRequest, NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pairs = searchParams.get('pairs');

  if (!pairs) {
    return NextResponse.json(
      { error: 'Missing pairs parameter' },
      { status: 400 }
    );
  }

  try {
    const result = await krakenClient.getTicker(pairs.split(','));
    return NextResponse.json(result);
  } catch (error) {
    console.error('Ticker error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

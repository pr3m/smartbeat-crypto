import { NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';

export async function GET() {
  if (!krakenClient.hasCredentials()) {
    return NextResponse.json(
      { error: 'API credentials not configured' },
      { status: 401 }
    );
  }

  try {
    const result = await krakenClient.getBalance();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Balance error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

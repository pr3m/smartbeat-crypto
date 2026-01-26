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
    const result = await krakenClient.getOpenPositions();
    // Kraken returns an object keyed by position ID, or empty object if no positions
    // Return as-is since the frontend expects this format
    return NextResponse.json(result);
  } catch (error) {
    console.error('Positions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // If there's a permission error or no margin account, return empty positions
    // instead of error to allow the app to continue functioning
    if (errorMessage.includes('EGeneral:Permission denied') ||
        errorMessage.includes('EAccount:Invalid permissions')) {
      console.log('Positions endpoint: Permission issue, returning empty positions');
      return NextResponse.json({});
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

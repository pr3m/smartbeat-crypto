import { NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';
import type { StatusResponse } from '@/lib/types/status';

export async function GET() {
  try {
    const hasCredentials = krakenClient.hasCredentials();

    if (!hasCredentials) {
      return NextResponse.json<StatusResponse>({
        status: 'no-credentials',
        hasCredentials: false,
        krakenConnected: false,
        message: 'API keys not configured',
      });
    }

    try {
      // Try to get server time (public endpoint, lightweight check)
      const serverTime = await krakenClient.getServerTime();

      return NextResponse.json<StatusResponse>({
        status: 'connected',
        hasCredentials: true,
        krakenConnected: true,
        message: 'Connected to Kraken',
        serverTime: serverTime.rfc1123,
      });
    } catch (error) {
      console.error('Kraken connection check failed:', error);
      return NextResponse.json<StatusResponse>({
        status: 'error',
        hasCredentials: true,
        krakenConnected: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      });
    }
  } catch (error) {
    // Catch any unexpected errors to prevent 500
    console.error('Status API error:', error);
    return NextResponse.json<StatusResponse>({
      status: 'error',
      hasCredentials: false,
      krakenConnected: false,
      message: 'Internal error checking status',
    });
  }
}

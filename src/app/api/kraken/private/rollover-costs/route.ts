import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { krakenClient } from '@/lib/kraken/client';

/**
 * Get actual rollover costs for open margin positions.
 *
 * Strategy:
 * 1. Query local SQLite DB for ROLLOVER transactions (fast, works if synced)
 * 2. If DB returns nothing, query Kraken Ledger API live for type=rollover entries
 *
 * Query params:
 * - openTime: Unix timestamp in milliseconds when position opened
 * - asset: The asset to filter by (e.g., "XRP")
 * - positionId: (optional) Kraken position ID
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const positionId = searchParams.get('positionId');
    const openTimeMs = searchParams.get('openTime');
    const asset = searchParams.get('asset');

    if (!openTimeMs || !asset) {
      return NextResponse.json(
        { error: 'openTime and asset are required' },
        { status: 400 }
      );
    }

    const openTimeDate = new Date(parseInt(openTimeMs, 10));
    const openTimeSec = Math.floor(parseInt(openTimeMs, 10) / 1000);

    // --- Strategy 1: Query local DB ---
    let totalRolloverCost = 0;
    let rolloverCount = 0;
    let source = 'none';

    try {
      const rollovers = await prisma.transaction.findMany({
        where: {
          type: 'ROLLOVER',
          timestamp: { gte: openTimeDate },
          OR: [
            { asset: asset },
            { asset: asset.replace(/^X/, '') },
            { asset: 'EUR' },
            { asset: 'ZEUR' },
          ],
        },
        orderBy: { timestamp: 'asc' },
        select: {
          id: true,
          timestamp: true,
          asset: true,
          amount: true,
          fee: true,
        },
      });

      const relevantRollovers = rollovers.filter(r => r.amount < 0 || (r.fee && r.fee > 0));

      if (relevantRollovers.length > 0) {
        totalRolloverCost = relevantRollovers.reduce((sum, r) => {
          return sum + Math.abs(r.amount || 0) + Math.abs(r.fee || 0);
        }, 0);
        rolloverCount = relevantRollovers.length;
        source = 'database';
      }
    } catch (dbErr) {
      // DB might not be set up, continue to API fallback
      console.warn('Rollover DB query failed, trying API:', dbErr);
    }

    // --- Strategy 2: If DB had nothing, query Kraken Ledger API live ---
    if (rolloverCount === 0 && krakenClient.hasCredentials()) {
      try {
        // Query ledger for rollover entries since position opened
        // Kraken Ledger API uses unix seconds for start/end
        const result = await krakenClient.getLedgers(
          undefined, // all assets (rollover can be in EUR/ZEUR)
          'currency',
          'rollover',
          openTimeSec,
          undefined, // no end (until now)
          0
        );

        if (result.ledger) {
          const entries = Object.values(result.ledger);

          // Filter to entries related to this asset or EUR (rollover fees)
          const assetVariants = [
            asset.toUpperCase(),
            asset.replace(/^X/, '').toUpperCase(),
            `X${asset.toUpperCase()}`,
            'EUR', 'ZEUR',
          ];

          const relevant = entries.filter(e =>
            assetVariants.includes(e.asset.toUpperCase())
          );

          if (relevant.length > 0) {
            totalRolloverCost = relevant.reduce((sum, e) => {
              const amount = parseFloat(e.amount || '0');
              const fee = parseFloat(e.fee || '0');
              // Rollover entries: amount is typically negative (fee charged), fee field may also have a value
              return sum + Math.abs(amount) + Math.abs(fee);
            }, 0);
            rolloverCount = relevant.length;
            source = 'kraken_api';
          }
        }
      } catch (apiErr) {
        console.warn('Kraken Ledger API query for rollovers failed:', apiErr);
      }
    }

    return NextResponse.json({
      positionId,
      asset,
      openTime: openTimeDate.toISOString(),
      rolloverCount,
      totalRolloverCost,
      source,
    });
  } catch (error) {
    console.error('Rollover costs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

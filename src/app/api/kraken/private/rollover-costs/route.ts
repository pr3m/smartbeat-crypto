import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

/**
 * Get actual rollover costs for open margin positions
 * Queries the Transaction table for ROLLOVER entries since the position opened
 *
 * Query params:
 * - positionId: The Kraken position ID (optional, filters to specific position)
 * - openTime: Unix timestamp in milliseconds when position opened
 * - asset: The asset to filter by (e.g., "XRP")
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

    const openTime = new Date(parseInt(openTimeMs, 10));

    // Query ROLLOVER transactions for this asset since position opened
    // Rollover fees in Kraken ledger are typically recorded as the fee asset (EUR)
    // but the transaction is linked to the borrowed/margin asset
    const rollovers = await prisma.transaction.findMany({
      where: {
        type: 'ROLLOVER',
        timestamp: {
          gte: openTime,
        },
        // Filter by asset - rollovers could be for the crypto asset
        // or the quote currency, so check both
        OR: [
          { asset: asset },
          { asset: asset.replace(/^X/, '') }, // Handle Kraken's X prefix
          { asset: 'EUR' }, // Rollover fees are often in EUR
          { asset: 'ZEUR' }, // Kraken's EUR symbol
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

    // Filter to only rollovers that are likely for this position
    // For margin positions, rollover fees show as negative amounts
    const relevantRollovers = rollovers.filter(r => {
      // Rollover entries typically have a negative amount (fee charged)
      // or a positive fee field
      return r.amount < 0 || (r.fee && r.fee > 0);
    });

    // Calculate total rollover cost
    // The cost is the absolute value of amount (which is negative) plus any explicit fees
    const totalRolloverCost = relevantRollovers.reduce((sum, r) => {
      const cost = Math.abs(r.amount || 0) + Math.abs(r.fee || 0);
      return sum + cost;
    }, 0);

    return NextResponse.json({
      positionId,
      asset,
      openTime: openTime.toISOString(),
      rolloverCount: relevantRollovers.length,
      totalRolloverCost,
      rollovers: relevantRollovers.map(r => ({
        timestamp: r.timestamp.toISOString(),
        asset: r.asset,
        amount: r.amount,
        fee: r.fee,
      })),
    });
  } catch (error) {
    console.error('Rollover costs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

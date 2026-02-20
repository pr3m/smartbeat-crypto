import { NextRequest, NextResponse } from 'next/server';
import { krakenClient } from '@/lib/kraken/client';

/**
 * Get actual rollover costs for open margin positions.
 *
 * Strategy:
 * 1. Query Kraken Ledger API live for type=rollover entries (source of truth)
 *    - Paginate through all results
 *    - Filter to EUR/ZEUR entries only (avoid double-counting paired asset entries)
 * 2. If API fails, fall back to rate × periods calculation
 *
 * Query params:
 * - openTime: Unix timestamp in milliseconds when position opened
 * - asset: The asset to filter by (e.g., "XRP")
 * - positionId: (optional) Kraken position ID
 * - costBasis: (optional) Position cost in EUR for rate-based fallback
 * - rolloverRate: (optional) Per-4h rollover rate as decimal (e.g., 0.0001 for 0.01%)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const positionId = searchParams.get('positionId');
    const openTimeMs = searchParams.get('openTime');
    const asset = searchParams.get('asset');
    const costBasis = parseFloat(searchParams.get('costBasis') || '0');
    const rolloverRate = parseFloat(searchParams.get('rolloverRate') || '0');

    if (!openTimeMs || !asset) {
      return NextResponse.json(
        { error: 'openTime and asset are required' },
        { status: 400 }
      );
    }

    const openTimeMsNum = parseInt(openTimeMs, 10);
    const openTimeDate = new Date(openTimeMsNum);
    const openTimeSec = Math.floor(openTimeMsNum / 1000);

    let totalRolloverCost = 0;
    let rolloverCount = 0;
    let source = 'none';

    // --- Strategy 1: Query Kraken Ledger API live with pagination ---
    if (krakenClient.hasCredentials()) {
      try {
        // Query only EUR/ZEUR rollover entries to avoid double-counting
        // Kraken creates paired ledger entries per rollover period;
        // the EUR entry is the actual fee charged
        let allEntries: Array<{ amount: string; fee: string; time: number }> = [];
        let offset = 0;
        let totalApiCount = 0;
        const MAX_PAGES = 10; // Safety limit
        let page = 0;

        do {
          const result = await krakenClient.getLedgers(
            'ZEUR,EUR',  // Only EUR entries (the actual fee charges)
            'currency',
            'rollover',
            openTimeSec,
            undefined,   // no end (until now)
            offset
          );

          if (result.ledger) {
            const entries = Object.values(result.ledger);
            allEntries = allEntries.concat(entries);
            totalApiCount = result.count;
            offset = allEntries.length;
          } else {
            break;
          }

          page++;
        } while (offset < totalApiCount && page < MAX_PAGES);

        if (allEntries.length > 0) {
          // Sum absolute amounts — rollover entries have negative amount (fee charged)
          totalRolloverCost = allEntries.reduce((sum, e) => {
            const amount = parseFloat(e.amount || '0');
            const fee = parseFloat(e.fee || '0');
            return sum + Math.abs(amount) + Math.abs(fee);
          }, 0);
          rolloverCount = allEntries.length;
          source = 'kraken_api';
        }
      } catch (apiErr) {
        console.warn('Kraken Ledger API query for rollovers failed:', apiErr);
      }
    }

    // --- Strategy 2: Rate-based calculation as fallback ---
    // If API returned nothing or failed, calculate from rate × periods
    if (rolloverCount === 0 && costBasis > 0 && rolloverRate > 0) {
      const hoursOpen = (Date.now() - openTimeMsNum) / (1000 * 60 * 60);
      const rolloverPeriods = Math.floor(hoursOpen / 4);
      const perPeriodCost = costBasis * rolloverRate;
      totalRolloverCost = perPeriodCost * rolloverPeriods;
      rolloverCount = rolloverPeriods;
      source = 'calculated';
    }

    // Compute expected rollover for sanity check / debugging
    const hoursOpen = (Date.now() - openTimeMsNum) / (1000 * 60 * 60);
    const expectedPeriods = Math.floor(hoursOpen / 4);
    const expectedCost = costBasis > 0 && rolloverRate > 0
      ? costBasis * rolloverRate * expectedPeriods
      : null;

    return NextResponse.json({
      positionId,
      asset,
      openTime: openTimeDate.toISOString(),
      rolloverCount,
      totalRolloverCost,
      source,
      debug: {
        hoursOpen: hoursOpen.toFixed(1),
        expectedPeriods,
        expectedCost: expectedCost !== null ? expectedCost.toFixed(2) : null,
        costBasis: costBasis || null,
        rolloverRate: rolloverRate || null,
      },
    });
  } catch (error) {
    console.error('Rollover costs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

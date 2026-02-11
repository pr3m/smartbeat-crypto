import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';
import { krakenClient } from '@/lib/kraken/client';

/**
 * GET /api/trading/history
 * Get closed margin trades from Kraken transaction history
 *
 * Combines:
 * 1. Database records (from sync) for historical trades
 * 2. Live Kraken TradesHistory API for recent trades not yet synced
 *
 * Groups transactions by krakenOrderId to get accurate P&L
 * Only includes trades with posstatus='closed'
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pair = searchParams.get('pair'); // Optional filter

    // Run DB query and Kraken API fetch in parallel
    const [dbPositions, livePositions] = await Promise.all([
      getDbPositions(pair),
      getLiveRecentPositions(pair),
    ]);

    console.log(`[Trading History] DB positions: ${dbPositions.length}, Live positions: ${livePositions.length}`);

    // Merge: use DB positions as base, add any live positions not in DB
    const dbIds = new Set(dbPositions.map(p => p.id));
    const merged = [...dbPositions];
    for (const livePos of livePositions) {
      if (!dbIds.has(livePos.id)) {
        merged.push(livePos);
      }
    }

    // Sort by closed date descending
    merged.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());

    return NextResponse.json({ positions: merged });
  } catch (error) {
    console.error('[Trading History API] Error:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching trading history'),
      { status: 500 }
    );
  }
}

interface PositionRecord {
  id: string;
  pair: string;
  side: 'long' | 'short';
  volume: number;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  realizedPnl: number;
  totalFees: number;
  openedAt: string;
  closedAt: string;
  duration: number;
  outcome: 'win' | 'loss' | 'breakeven';
}

/**
 * Get closed positions from the local database (synced data).
 *
 * Two-pass approach:
 * Pass 1: Original method — opening trades with posstatus='closed' or close data,
 *         grouped by krakenOrderId. Works for most historical trades.
 * Pass 2: positionTxId grouping — for trades that lack close data fields
 *         (synced before position was closed). Groups by Kraken's position ID
 *         and detects closure via matching entry+exit trades.
 */
async function getDbPositions(pair: string | null): Promise<PositionRecord[]> {
  try {
    const allMarginTrades = await prisma.transaction.findMany({
      where: {
        type: 'MARGIN_TRADE',
        ...(pair && { pair }),
      },
      orderBy: { timestamp: 'asc' },
    });

    const positions: PositionRecord[] = [];
    const processedTradeIds = new Set<string>();

    // ── Pass 1: Opening trades with Kraken close data ──
    // These are trades where posstatus='closed', closeCost, or netPnl is set.
    // Excludes closing trades (openingTradeId set).
    const closedOpeningTrades = allMarginTrades.filter(t =>
      !t.openingTradeId &&
      (t.posstatus === 'closed' || t.closeCost !== null || t.netPnl !== null)
    );

    // Group by krakenOrderId
    const orderGroups = new Map<string, typeof allMarginTrades>();
    for (const trade of closedOpeningTrades) {
      const orderId = trade.krakenOrderId || trade.id;
      if (!orderGroups.has(orderId)) {
        orderGroups.set(orderId, []);
      }
      orderGroups.get(orderId)!.push(trade);
      processedTradeIds.add(trade.id);
    }

    for (const [orderId, trades] of orderGroups) {
      const firstTrade = trades[0];
      const totalVolume = trades.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const totalCost = trades.reduce((sum, t) => sum + (t.cost || 0), 0);
      const totalFees = trades.reduce((sum, t) => sum + (t.fee || 0) + (t.closeFee || 0), 0);
      const totalCloseCost = trades.reduce((sum, t) => sum + (t.closeCost || 0), 0);
      const realizedPnl = trades.reduce((sum, t) => sum + (t.netPnl || 0), 0);
      const entryPrice = totalVolume > 0 ? totalCost / totalVolume : (firstTrade.price || 0);
      const exitPrice = totalVolume > 0 && totalCloseCost > 0
        ? totalCloseCost / totalVolume
        : (firstTrade.closePrice || entryPrice);
      const leverageStr = firstTrade.leverage || '1:1';
      const leverage = parseInt(leverageStr.split(':')[0]) || 1;
      const side = firstTrade.side === 'buy' ? 'long' as const : 'short' as const;
      const openedAt = firstTrade.timestamp;
      const closedAt = firstTrade.closeCost
        ? new Date(openedAt.getTime() + (24 * 60 * 60 * 1000))
        : openedAt;
      const durationHours = (closedAt.getTime() - openedAt.getTime()) / (1000 * 60 * 60);

      let outcome: 'win' | 'loss' | 'breakeven';
      if (realizedPnl > 0.01) outcome = 'win';
      else if (realizedPnl < -0.01) outcome = 'loss';
      else outcome = 'breakeven';

      positions.push({
        id: orderId,
        pair: firstTrade.pair || 'XRPEUR',
        side,
        volume: totalVolume,
        entryPrice,
        exitPrice,
        leverage,
        realizedPnl,
        totalFees,
        openedAt: openedAt.toISOString(),
        closedAt: closedAt.toISOString(),
        duration: Math.max(0, durationHours),
        outcome,
      });

      // Mark closing trades for this position as processed too
      if (firstTrade.positionTxId) {
        for (const t of allMarginTrades) {
          if (t.positionTxId === firstTrade.positionTxId) {
            processedTradeIds.add(t.id);
          }
        }
      }
    }

    // ── Pass 2: positionTxId grouping for remaining trades ──
    // Catches positions where trades were synced before closure (no close data fields).
    const remainingTrades = allMarginTrades.filter(t => !processedTradeIds.has(t.id));

    const positionGroups = new Map<string, typeof allMarginTrades>();
    for (const trade of remainingTrades) {
      const posId = trade.positionTxId;
      if (!posId) continue;
      if (!positionGroups.has(posId)) {
        positionGroups.set(posId, []);
      }
      positionGroups.get(posId)!.push(trade);
    }

    for (const [posId, trades] of positionGroups) {
      const firstTrade = trades[0];
      const isLong = firstTrade.side === 'buy';
      const entrySide = isLong ? 'buy' : 'sell';
      const exitSide = isLong ? 'sell' : 'buy';

      const entryTrades = trades.filter(t => t.side === entrySide);
      const exitTrades = trades.filter(t => t.side === exitSide);

      // Only show if position is actually closed (has exit trades)
      if (exitTrades.length === 0) continue;

      const entryVolume = entryTrades.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const entryCost = entryTrades.reduce((sum, t) => sum + (t.cost || 0), 0);
      const entryFees = entryTrades.reduce((sum, t) => sum + (t.fee || 0), 0);
      const avgEntryPrice = entryVolume > 0 ? entryCost / entryVolume : (firstTrade.price || 0);

      const exitVolume = exitTrades.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const exitProceeds = exitTrades.reduce((sum, t) => sum + (t.cost || 0), 0);
      const exitFees = exitTrades.reduce((sum, t) => sum + (t.fee || 0), 0);
      const avgExitPrice = exitVolume > 0 ? exitProceeds / exitVolume : avgEntryPrice;

      const totalFees = entryFees + exitFees;
      const realizedPnl = isLong
        ? exitProceeds - entryCost - totalFees
        : entryCost - exitProceeds - totalFees;

      const margin = firstTrade.margin || 0;
      const leverage = margin > 0 ? Math.round(entryCost / margin) || 1 : 1;

      const openedAt = firstTrade.timestamp;
      const closedAt = exitTrades[exitTrades.length - 1].timestamp;
      const durationHours = (closedAt.getTime() - openedAt.getTime()) / (1000 * 60 * 60);

      let outcome: 'win' | 'loss' | 'breakeven';
      if (realizedPnl > 0.01) outcome = 'win';
      else if (realizedPnl < -0.01) outcome = 'loss';
      else outcome = 'breakeven';

      positions.push({
        id: posId,
        pair: firstTrade.pair || 'XRPEUR',
        side: isLong ? 'long' : 'short',
        volume: entryVolume,
        entryPrice: avgEntryPrice,
        exitPrice: avgExitPrice,
        leverage,
        realizedPnl,
        totalFees,
        openedAt: openedAt.toISOString(),
        closedAt: closedAt.toISOString(),
        duration: Math.max(0, durationHours),
        outcome,
      });
    }

    return positions;
  } catch (error) {
    console.error('[Trading History] DB query error:', error);
    return [];
  }
}

/**
 * Fetch recent closed trades directly from Kraken API
 * Gets last 50 trades with close data for real-time history
 */
async function getLiveRecentPositions(pair: string | null): Promise<PositionRecord[]> {
  if (!krakenClient.hasCredentials()) return [];

  try {
    const result = await krakenClient.getTradesHistory('all', true);
    const trades = result.trades || {};

    const tradeEntries = Object.entries(trades);
    console.log(`[Trading History] Kraken API returned ${tradeEntries.length} trades`);

    // Filter to closed OPENING margin trades (exclude closing trades)
    // Opening trades have posstatus='closed' and carry the P&L data
    // Closing trades have misc='closing' and are the exit side
    const closedTrades = tradeEntries
      .filter(([, trade]) => {
        const isMargin = parseFloat(trade.margin || '0') > 0;
        const isClosed = trade.posstatus === 'closed';
        const isClosingTrade = trade.misc?.includes('closing');
        const matchesPair = !pair || trade.pair === pair;
        return isMargin && isClosed && !isClosingTrade && matchesPair;
      });

    console.log(`[Trading History] Found ${closedTrades.length} closed margin trades from Kraken API`);

    // Group by ordertxid
    const orderGroups = new Map<string, Array<[string, typeof trades[string]]>>();
    for (const entry of closedTrades) {
      const orderId = entry[1].ordertxid;
      if (!orderGroups.has(orderId)) {
        orderGroups.set(orderId, []);
      }
      orderGroups.get(orderId)!.push(entry);
    }

    return Array.from(orderGroups.entries()).map(([orderId, entries]) => {
      const firstTrade = entries[0][1];
      const totalVolume = entries.reduce((sum, [, t]) => sum + parseFloat(t.vol || '0'), 0);
      const totalCost = entries.reduce((sum, [, t]) => sum + parseFloat(t.cost || '0'), 0);
      const totalFees = entries.reduce((sum, [, t]) => {
        return sum + parseFloat(t.fee || '0') + parseFloat(t.cfee || '0');
      }, 0);
      const totalCloseCost = entries.reduce((sum, [, t]) => sum + parseFloat(t.ccost || '0'), 0);
      const realizedPnl = entries.reduce((sum, [, t]) => sum + parseFloat(t.net || '0'), 0);

      const entryPrice = totalVolume > 0 ? totalCost / totalVolume : parseFloat(firstTrade.price || '0');
      const exitPrice = totalVolume > 0 && totalCloseCost > 0
        ? totalCloseCost / totalVolume
        : parseFloat(firstTrade.cprice || '0') || entryPrice;

      const side = firstTrade.type === 'buy' ? 'long' as const : 'short' as const;
      const openedAt = new Date(firstTrade.time * 1000);

      // Estimate close time: if cprice exists, use a rough estimate
      // Kraken doesn't give exact close timestamp on opening trades,
      // but we can use the trade time + some reasonable offset
      const closedAt = totalCloseCost > 0
        ? new Date(openedAt.getTime() + (24 * 60 * 60 * 1000)) // Approximate
        : openedAt;
      const durationHours = (closedAt.getTime() - openedAt.getTime()) / (1000 * 60 * 60);

      let outcome: 'win' | 'loss' | 'breakeven';
      if (realizedPnl > 0.01) outcome = 'win';
      else if (realizedPnl < -0.01) outcome = 'loss';
      else outcome = 'breakeven';

      return {
        id: orderId,
        pair: firstTrade.pair || 'XRPEUR',
        side,
        volume: totalVolume,
        entryPrice,
        exitPrice,
        leverage: parseInt((firstTrade.margin && totalCost > 0
          ? (totalCost / parseFloat(firstTrade.margin)).toFixed(0)
          : '1')) || 1,
        realizedPnl,
        totalFees,
        openedAt: openedAt.toISOString(),
        closedAt: closedAt.toISOString(),
        duration: Math.max(0, durationHours),
        outcome,
      };
    });
  } catch (error) {
    console.error('[Trading History] Kraken API error:', error);
    return [];
  }
}

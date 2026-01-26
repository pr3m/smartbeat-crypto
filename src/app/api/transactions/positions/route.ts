import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

interface GroupedPosition {
  id: string;
  pair: string;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED' | 'PARTIAL';

  // Entry details
  entryTime: Date;
  entryTrades: number;
  avgEntryPrice: number;
  totalEntryVolume: number;
  totalEntryCost: number;

  // Exit details (if closed)
  exitTime: Date | null;
  exitTrades: number;
  avgExitPrice: number | null;
  totalExitVolume: number;
  totalExitProceeds: number;

  // Fees and costs
  entryFees: number;
  exitFees: number;
  marginFees: number; // rollover fees
  totalFees: number;

  // P&L (from Kraken's net field - authoritative!)
  realizedPnL: number | null;
  pnlSource: 'kraken' | 'calculated'; // Track where P&L came from

  // Raw transaction IDs for drill-down
  transactionIds: string[];
  positionTxId: string | null; // Kraken's position identifier
  openingTradeId: string | null;
  closingTradeId: string | null;
}

/**
 * GET /api/transactions/positions - Get grouped margin positions
 * Groups individual margin trades into logical positions (open to close)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const pair = searchParams.get('pair');

    // Build date filter for filtering positions (not the query)
    const yearStart = year ? new Date(parseInt(year), 0, 1) : undefined;
    const yearEnd = year ? new Date(parseInt(year), 11, 31, 23, 59, 59) : undefined;

    // Fetch ALL margin-related transactions (closing trades might be in different year)
    const marginTransactions = await prisma.transaction.findMany({
      where: {
        type: { in: ['MARGIN_TRADE', 'MARGIN_SETTLEMENT', 'ROLLOVER'] },
        ...(pair ? { pair } : {}),
      },
      orderBy: { timestamp: 'asc' },
      include: {
        taxEvents: true,
      },
    });

    // Group transactions by position (this links opening and closing trades across years)
    let positions = groupIntoPositions(marginTransactions);

    // Filter positions by entry year if year is specified
    if (yearStart && yearEnd) {
      positions = positions.filter(p => {
        const entryTime = new Date(p.entryTime);
        return entryTime >= yearStart && entryTime <= yearEnd;
      });
    }

    // Get unique pairs for filtering
    const uniquePairs = [...new Set(marginTransactions
      .filter(t => t.pair)
      .map(t => t.pair as string)
    )].sort();

    // Calculate summary stats
    const summary = {
      totalPositions: positions.length,
      openPositions: positions.filter(p => p.status === 'OPEN').length,
      closedPositions: positions.filter(p => p.status === 'CLOSED').length,
      totalRealizedPnL: positions
        .filter(p => p.realizedPnL !== null)
        .reduce((sum, p) => sum + (p.realizedPnL || 0), 0),
      totalFees: positions.reduce((sum, p) => sum + p.totalFees, 0),
      profitablePositions: positions.filter(p => (p.realizedPnL || 0) > 0).length,
      losingPositions: positions.filter(p => (p.realizedPnL || 0) < 0).length,
    };

    return NextResponse.json({
      positions,
      pairs: uniquePairs,
      summary,
    });
  } catch (error) {
    console.error('Get positions error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get positions' },
      { status: 500 }
    );
  }
}

interface Transaction {
  id: string;
  krakenRefId: string | null;
  krakenOrderId: string | null;
  type: string;
  category: string;
  asset: string;
  amount: number;
  pair: string | null;
  side: string | null;
  price: number | null;
  cost: number | null;
  fee: number | null;
  feeAsset: string | null;
  leverage: string | null;
  margin: number | null;
  costBasis: number | null;
  proceeds: number | null;
  gain: number | null;
  timestamp: Date;
  // New margin position fields
  posstatus: string | null;
  positionTxId: string | null;
  openingTradeId: string | null;
  closingTradeId: string | null;
  closePrice: number | null;
  closeCost: number | null;
  closeFee: number | null;
  closeVolume: number | null;
  closeMargin: number | null;
  netPnl: number | null; // Kraken's authoritative P&L
  taxEvents: Array<{
    id: string;
    gain: number;
    taxableAmount: number;
  }>;
}

function groupIntoPositions(transactions: Transaction[]): GroupedPosition[] {
  const positions: GroupedPosition[] = [];

  // Separate by type
  const marginTrades = transactions.filter(t => t.type === 'MARGIN_TRADE');
  const settlements = transactions.filter(t => t.type === 'MARGIN_SETTLEMENT');
  const rollovers = transactions.filter(t => t.type === 'ROLLOVER');

  // Build lookup maps
  const tradesByRefId = new Map<string, Transaction>();
  const closingTradesByOpeningRef = new Map<string, Transaction[]>();

  for (const trade of marginTrades) {
    if (trade.krakenRefId) {
      tradesByRefId.set(trade.krakenRefId, trade);
    }
    // Index closing trades by their positionTxId (points to opening trade's krakenRefId)
    if (trade.positionTxId && trade.posstatus !== 'closed') {
      const existing = closingTradesByOpeningRef.get(trade.positionTxId) || [];
      existing.push(trade);
      closingTradesByOpeningRef.set(trade.positionTxId, existing);
    }
  }

  // Group opening trades by krakenOrderId (same order = same position)
  const openingTradesByOrderId = new Map<string, Transaction[]>();
  const processedTradeIds = new Set<string>();

  for (const trade of marginTrades) {
    // Opening trades have posstatus = 'closed'
    if (trade.posstatus === 'closed' && trade.krakenOrderId) {
      const existing = openingTradesByOrderId.get(trade.krakenOrderId) || [];
      existing.push(trade);
      openingTradesByOrderId.set(trade.krakenOrderId, existing);
    }
  }

  // Create grouped positions from order groups
  for (const [orderId, entryTrades] of openingTradesByOrderId) {
    // Sort entry trades by time
    entryTrades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Collect all exit trades for this position
    const exitTrades: Transaction[] = [];
    for (const entryTrade of entryTrades) {
      processedTradeIds.add(entryTrade.id);

      // Find closing trades that reference this entry trade
      if (entryTrade.krakenRefId) {
        const closingTrades = closingTradesByOpeningRef.get(entryTrade.krakenRefId) || [];
        for (const closingTrade of closingTrades) {
          if (!processedTradeIds.has(closingTrade.id)) {
            exitTrades.push(closingTrade);
            processedTradeIds.add(closingTrade.id);
          }
        }
      }

      // Also check closingTradeId reference
      if (entryTrade.closingTradeId) {
        const closingTrade = tradesByRefId.get(entryTrade.closingTradeId);
        if (closingTrade && !processedTradeIds.has(closingTrade.id)) {
          exitTrades.push(closingTrade);
          processedTradeIds.add(closingTrade.id);
        }
      }
    }

    // Sort exit trades by time
    exitTrades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Determine direction from first entry trade
    const isBuy = entryTrades[0].side === 'buy';
    const direction: 'LONG' | 'SHORT' = isBuy ? 'LONG' : 'SHORT';
    const pair = entryTrades[0].pair || 'UNKNOWN';
    const positionTxId = entryTrades[0].positionTxId;

    positions.push(createGroupedPosition(
      pair,
      direction,
      entryTrades,
      exitTrades,
      rollovers,
      settlements,
      'CLOSED',
      positionTxId
    ));
  }

  // Second pass: Handle remaining trades (open positions or unlinked trades)
  const remainingTrades = marginTrades.filter(t => !processedTradeIds.has(t.id));
  const tradesByPair = new Map<string, Transaction[]>();

  for (const trade of remainingTrades) {
    const pair = trade.pair || 'UNKNOWN';
    if (!tradesByPair.has(pair)) {
      tradesByPair.set(pair, []);
    }
    tradesByPair.get(pair)!.push(trade);
  }

  // Process remaining trades by pair
  for (const [pair, trades] of tradesByPair) {
    // Sort by timestamp
    trades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Track open position
    let currentPosition: {
      direction: 'LONG' | 'SHORT';
      entryTrades: Transaction[];
      exitTrades: Transaction[];
      openVolume: number;
    } | null = null;

    for (const trade of trades) {
      const isBuy = trade.side === 'buy';
      const volume = Math.abs(trade.amount);

      if (!currentPosition) {
        // Start new position
        currentPosition = {
          direction: isBuy ? 'LONG' : 'SHORT',
          entryTrades: [trade],
          exitTrades: [],
          openVolume: volume,
        };
      } else {
        // Check if this trade is same direction (adding to position) or opposite (closing)
        const isAddingToPosition =
          (currentPosition.direction === 'LONG' && isBuy) ||
          (currentPosition.direction === 'SHORT' && !isBuy);

        if (isAddingToPosition) {
          // Adding to existing position
          currentPosition.entryTrades.push(trade);
          currentPosition.openVolume += volume;
        } else {
          // Closing position (partially or fully)
          currentPosition.exitTrades.push(trade);
          currentPosition.openVolume -= volume;

          // Check if position is fully closed (within small tolerance)
          if (currentPosition.openVolume <= 0.00000001) {
            // Create grouped position
            positions.push(createGroupedPosition(
              pair,
              currentPosition.direction,
              currentPosition.entryTrades,
              currentPosition.exitTrades,
              rollovers,
              settlements,
              'CLOSED',
              null // No positionTxId for fallback grouping
            ));
            currentPosition = null;
          }
        }
      }
    }

    // Handle any remaining open position
    if (currentPosition && currentPosition.openVolume > 0.00000001) {
      positions.push(createGroupedPosition(
        pair,
        currentPosition.direction,
        currentPosition.entryTrades,
        currentPosition.exitTrades,
        rollovers,
        settlements,
        currentPosition.exitTrades.length > 0 ? 'PARTIAL' : 'OPEN',
        null // No positionTxId for fallback grouping
      ));
    }
  }

  // Sort positions by entry time (most recent first)
  positions.sort((a, b) => b.entryTime.getTime() - a.entryTime.getTime());

  return positions;
}

function createGroupedPosition(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entryTrades: Transaction[],
  exitTrades: Transaction[],
  allRollovers: Transaction[],
  allSettlements: Transaction[],
  status: 'OPEN' | 'CLOSED' | 'PARTIAL',
  positionTxIdParam: string | null
): GroupedPosition {
  // Calculate entry metrics (aggregate all entry trades)
  const entryTime = entryTrades[0].timestamp;
  const totalEntryVolume = entryTrades.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const totalEntryCost = entryTrades.reduce((sum, t) => sum + (t.cost || 0), 0);
  const avgEntryPrice = totalEntryVolume > 0 ? totalEntryCost / totalEntryVolume : 0;
  const entryFees = entryTrades.reduce((sum, t) => sum + (t.fee || 0), 0);

  // Calculate exit metrics - aggregate from exit trades OR from all entry trades' close data
  let exitTime: Date | null = null;
  let totalExitVolume = 0;
  let totalExitProceeds = 0;
  let exitFees = 0;

  if (exitTrades.length > 0) {
    // Use exit trades data
    exitTime = exitTrades[exitTrades.length - 1].timestamp;
    totalExitVolume = exitTrades.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    totalExitProceeds = exitTrades.reduce((sum, t) => sum + (t.cost || 0), 0);
    exitFees = exitTrades.reduce((sum, t) => sum + (t.fee || 0), 0);
  } else if (status === 'CLOSED') {
    // Aggregate close data from ALL entry trades (when closing trades are in different year)
    for (const trade of entryTrades) {
      if (trade.closeCost) {
        totalExitVolume += trade.closeVolume || Math.abs(trade.amount);
        totalExitProceeds += trade.closeCost;
        exitFees += trade.closeFee || 0;
      }
    }
  }

  const avgExitPrice = totalExitVolume > 0 ? totalExitProceeds / totalExitVolume : null;

  // Find related rollover fees (between entry and exit time, same asset)
  const asset = pair.replace(/EUR$|USD$|GBP$/, '');
  const lastEntryTime = entryTrades[entryTrades.length - 1].timestamp;
  const positionEndTime = exitTime || new Date();
  const relatedRollovers = allRollovers.filter(r =>
    r.asset === asset &&
    r.timestamp >= entryTime &&
    r.timestamp <= positionEndTime
  );
  const marginFees = relatedRollovers.reduce((sum, r) => sum + Math.abs(r.fee || 0), 0);

  // Calculate total fees
  const totalFees = entryFees + exitFees + marginFees;

  // Calculate realized P&L - SUM all netPnl from entry trades (Kraken's authoritative data)
  let realizedPnL: number | null = null;
  let pnlSource: 'kraken' | 'calculated' = 'calculated';

  if (status === 'CLOSED' && entryTrades.length > 0) {
    // Sum netPnl from ALL entry trades
    const tradesWithNetPnl = entryTrades.filter(t => t.netPnl !== null);
    if (tradesWithNetPnl.length > 0) {
      realizedPnL = tradesWithNetPnl.reduce((sum, t) => sum + (t.netPnl || 0), 0);
      pnlSource = 'kraken';
    } else {
      // Fallback: Calculate from cost/proceeds
      if (direction === 'LONG') {
        realizedPnL = totalExitProceeds - totalEntryCost - totalFees;
      } else {
        realizedPnL = totalEntryCost - totalExitProceeds - totalFees;
      }
      pnlSource = 'calculated';
    }
  }

  // Collect all transaction IDs
  const transactionIds = [
    ...entryTrades.map(t => t.id),
    ...exitTrades.map(t => t.id),
    ...relatedRollovers.map(r => r.id),
  ];

  // Use passed positionTxId or fallback to first entry trade's
  const positionTxId = positionTxIdParam || entryTrades[0]?.positionTxId || null;

  // For openingTradeId, show count if multiple entry trades
  const openingTradeId = entryTrades.length === 1
    ? entryTrades[0]?.krakenRefId
    : `${entryTrades.length} fills`;

  // For closingTradeId, show count if multiple exit trades
  const closingTradeId = exitTrades.length === 1
    ? exitTrades[0]?.krakenRefId
    : exitTrades.length > 1
      ? `${exitTrades.length} fills`
      : entryTrades[0]?.closingTradeId || null;

  return {
    id: `pos_${entryTrades[0].id}`,
    pair,
    direction,
    status,
    entryTime,
    entryTrades: entryTrades.length,
    avgEntryPrice,
    totalEntryVolume,
    totalEntryCost,
    exitTime,
    exitTrades: exitTrades.length,
    avgExitPrice,
    totalExitVolume,
    totalExitProceeds,
    entryFees,
    exitFees,
    marginFees,
    totalFees,
    realizedPnL,
    pnlSource,
    transactionIds,
    positionTxId,
    openingTradeId,
    closingTradeId,
  };
}

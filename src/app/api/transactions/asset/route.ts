import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/transactions/asset - Get detailed breakdown for a specific asset
 * Query params: asset (required), year (optional), type (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const asset = searchParams.get('asset');
    const year = searchParams.get('year');
    const type = searchParams.get('type');

    if (!asset) {
      return NextResponse.json({ error: 'Asset parameter is required' }, { status: 400 });
    }

    // Build date filter
    const yearStart = year ? new Date(parseInt(year), 0, 1) : undefined;
    const yearEnd = year ? new Date(parseInt(year), 11, 31, 23, 59, 59) : undefined;

    // Fetch transactions for this asset
    const transactions = await prisma.transaction.findMany({
      where: {
        asset,
        ...(yearStart && yearEnd ? {
          timestamp: {
            gte: yearStart,
            lte: yearEnd,
          },
        } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: 100, // Limit for performance
    });

    // Calculate summary statistics
    let totalIn = 0;      // Amount received (positive)
    let totalOut = 0;     // Amount sent (negative)
    let totalFees = 0;
    let totalGain = 0;
    let totalLoss = 0;

    const byType: Record<string, {
      count: number;
      totalAmount: number;
      totalFees: number;
    }> = {};

    // For margin trades, track processed order IDs to avoid P&L double-counting
    const processedMarginOrderIds = new Set<string>();

    for (const tx of transactions) {
      // Track by type
      if (!byType[tx.type]) {
        byType[tx.type] = { count: 0, totalAmount: 0, totalFees: 0 };
      }
      byType[tx.type].count++;
      byType[tx.type].totalAmount += tx.amount;
      byType[tx.type].totalFees += tx.fee || 0;

      // Track totals
      if (tx.amount > 0) {
        totalIn += tx.amount;
      } else {
        totalOut += Math.abs(tx.amount);
      }
      totalFees += tx.fee || 0;

      // Track gains/losses - special handling for margin trades
      if (tx.type === 'MARGIN_TRADE') {
        // For margin trades, only count P&L once per position (grouped by order ID)
        // P&L is stored on opening trades (posstatus = 'closed')
        if (tx.posstatus === 'closed' && tx.netPnl !== null) {
          const orderId = tx.krakenOrderId || tx.id;
          if (!processedMarginOrderIds.has(orderId)) {
            processedMarginOrderIds.add(orderId);
            if (tx.netPnl > 0) {
              totalGain += tx.netPnl;
            } else {
              totalLoss += Math.abs(tx.netPnl);
            }
          }
        }
      } else if (tx.gain !== null) {
        // For non-margin trades, use gain directly
        if (tx.gain > 0) {
          totalGain += tx.gain;
        } else {
          totalLoss += Math.abs(tx.gain);
        }
      }
    }

    // Get type labels
    const typeLabels: Record<string, string> = {
      'TRADE': 'Spot Trades',
      'MARGIN_TRADE': 'Margin Trades',
      'MARGIN_SETTLEMENT': 'Margin Settlements',
      'DEPOSIT': 'Deposits',
      'WITHDRAWAL': 'Withdrawals',
      'TRANSFER': 'Transfers',
      'ROLLOVER': 'Margin Rollovers',
      'STAKING_REWARD': 'Staking Rewards',
      'STAKING_DEPOSIT': 'Staking Deposits',
      'STAKING_WITHDRAWAL': 'Staking Withdrawals',
      'EARN_REWARD': 'Earn Rewards',
      'EARN_ALLOCATION': 'Earn Allocations',
      'CREDIT': 'Credits/Bonuses',
      'AIRDROP': 'Airdrops',
      'FORK': 'Fork Coins',
      'NFT_TRADE': 'NFT Trades',
      'SPEND': 'Spending',
      'RECEIVE': 'Receiving',
      'FEE': 'Fees',
      'ADJUSTMENT': 'Adjustments',
    };

    // Get current balance (approximate from synced data)
    const netBalance = totalIn - totalOut;

    return NextResponse.json({
      asset,
      year: year ? parseInt(year) : null,
      type: type || null,
      summary: {
        transactionCount: transactions.length,
        totalIn,
        totalOut,
        netBalance,
        totalFees,
        totalGain,
        totalLoss,
        netPnL: totalGain - totalLoss,
      },
      byType: Object.entries(byType).map(([typeName, data]) => ({
        type: typeName,
        label: typeLabels[typeName] || typeName,
        ...data,
      })),
      recentTransactions: transactions.slice(0, 20).map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        fee: tx.fee,
        gain: tx.gain,
        timestamp: tx.timestamp,
        pair: tx.pair,
        side: tx.side,
        price: tx.price,
      })),
      typeLabels,
    });
  } catch (error) {
    console.error('Get asset detail error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get asset detail' },
      { status: 500 }
    );
  }
}

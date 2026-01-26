import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

interface LedgerBreakdown {
  type: string;
  count: number;
  totalAmount: number;
  totalFees: number;
  byAsset: Record<string, {
    count: number;
    amount: number;
    fees: number;
  }>;
}

/**
 * GET /api/transactions/ledger - Get ledger breakdown by type
 * Shows all transaction types with aggregates for each
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const type = searchParams.get('type');

    // Build date filter
    const yearStart = year ? new Date(parseInt(year), 0, 1) : undefined;
    const yearEnd = year ? new Date(parseInt(year), 11, 31, 23, 59, 59) : undefined;

    // Fetch transactions
    const transactions = await prisma.transaction.findMany({
      where: {
        ...(yearStart && yearEnd ? {
          timestamp: {
            gte: yearStart,
            lte: yearEnd,
          },
        } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { timestamp: 'desc' },
    });

    // Group by type
    const byType = new Map<string, LedgerBreakdown>();

    for (const tx of transactions) {
      const existing = byType.get(tx.type) || {
        type: tx.type,
        count: 0,
        totalAmount: 0,
        totalFees: 0,
        byAsset: {},
      };

      existing.count++;
      existing.totalAmount += tx.amount;
      existing.totalFees += tx.fee || 0;

      // Track by asset
      const assetData = existing.byAsset[tx.asset] || {
        count: 0,
        amount: 0,
        fees: 0,
      };
      assetData.count++;
      assetData.amount += tx.amount;
      assetData.fees += tx.fee || 0;
      existing.byAsset[tx.asset] = assetData;

      byType.set(tx.type, existing);
    }

    // Convert to array and sort by type
    const breakdown = Array.from(byType.values()).sort((a, b) =>
      a.type.localeCompare(b.type)
    );

    // Get type labels for UI
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

    // Income summary (taxable income types)
    const incomeTypes = [
      'STAKING_REWARD', 'EARN_REWARD', 'CREDIT', 'AIRDROP', 'FORK'
    ];
    const incomeSummary = breakdown
      .filter(b => incomeTypes.includes(b.type))
      .reduce((acc, b) => {
        acc.count += b.count;
        acc.totalAmount += b.totalAmount;
        return acc;
      }, { count: 0, totalAmount: 0 });

    // Get unique years with data
    const yearsResult = await prisma.transaction.findMany({
      select: { timestamp: true },
      distinct: ['timestamp'],
    });
    const years = [...new Set(
      yearsResult.map(t => t.timestamp.getFullYear())
    )].sort((a, b) => b - a);

    // Get unique types
    const types = [...new Set(transactions.map(t => t.type))].sort();

    return NextResponse.json({
      breakdown,
      typeLabels,
      incomeSummary,
      years,
      types,
      totalTransactions: transactions.length,
      selectedYear: year ? parseInt(year) : null,
      selectedType: type,
    });
  } catch (error) {
    console.error('Get ledger breakdown error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get ledger breakdown' },
      { status: 500 }
    );
  }
}

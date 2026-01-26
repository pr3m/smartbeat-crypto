import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const DEFAULT_BALANCE = {
  eurBalance: 2000,
  cryptoHoldings: '{}',
  cryptoValue: 0,
  equity: 2000,
  marginUsed: 0,
  freeMargin: 20000, // equity * 10 (leverage)
  marginLevel: null,
  totalRealizedPnl: 0,
  totalFeesPaid: 0,
};

/**
 * GET /api/simulated/balance
 * Get the current simulated balance
 */
export async function GET() {
  try {
    console.log('[Balance API] Fetching simulated balance...');

    // Get or create default balance
    let balance = await prisma.simulatedBalance.findUnique({
      where: { id: 'default' },
    });

    console.log('[Balance API] Found balance:', balance ? 'yes' : 'no');

    if (!balance) {
      console.log('[Balance API] Creating default balance...');
      balance = await prisma.simulatedBalance.create({
        data: {
          id: 'default',
          ...DEFAULT_BALANCE,
        },
      });
      console.log('[Balance API] Default balance created');
    }

    // Calculate current margin from open positions
    const openPositions = await prisma.simulatedPosition.findMany({
      where: { isOpen: true },
    });

    let marginUsed = 0;
    for (const pos of openPositions) {
      marginUsed += pos.totalCost / pos.leverage;
    }

    // Update calculated fields
    const equity = balance.eurBalance + balance.cryptoValue;
    const freeMargin = Math.max(0, equity * 10 - marginUsed); // 10x leverage
    const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : null;

    // Return the balance with calculated fields
    return NextResponse.json({
      ...balance,
      equity,
      marginUsed,
      freeMargin,
      marginLevel,
      openPositionsCount: openPositions.length,
    });
  } catch (error) {
    console.error('[Balance API] Error fetching simulated balance:', error);
    console.error('[Balance API] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch balance' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/simulated/balance
 * Actions: reset, deposit, withdraw
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, amount } = body;

    let balance = await prisma.simulatedBalance.findUnique({
      where: { id: 'default' },
    });

    if (!balance) {
      balance = await prisma.simulatedBalance.create({
        data: {
          id: 'default',
          ...DEFAULT_BALANCE,
        },
      });
    }

    switch (action) {
      case 'reset':
        // Close all open positions first
        await prisma.simulatedPosition.updateMany({
          where: { isOpen: true },
          data: { isOpen: false, closedAt: new Date() },
        });

        // Cancel all open orders
        await prisma.simulatedOrder.updateMany({
          where: { status: 'open' },
          data: { status: 'cancelled' },
        });

        // Reset balance
        balance = await prisma.simulatedBalance.update({
          where: { id: 'default' },
          data: {
            eurBalance: amount || DEFAULT_BALANCE.eurBalance,
            cryptoHoldings: '{}',
            cryptoValue: 0,
            equity: amount || DEFAULT_BALANCE.equity,
            marginUsed: 0,
            freeMargin: (amount || DEFAULT_BALANCE.equity) * 10,
            marginLevel: null,
            totalRealizedPnl: 0,
            totalFeesPaid: 0,
          },
        });
        break;

      case 'deposit':
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Invalid deposit amount' },
            { status: 400 }
          );
        }
        balance = await prisma.simulatedBalance.update({
          where: { id: 'default' },
          data: {
            eurBalance: balance.eurBalance + amount,
            equity: balance.equity + amount,
            freeMargin: balance.freeMargin + amount * 10,
          },
        });
        break;

      case 'withdraw':
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Invalid withdrawal amount' },
            { status: 400 }
          );
        }
        if (amount > balance.eurBalance) {
          return NextResponse.json(
            { error: 'Insufficient balance' },
            { status: 400 }
          );
        }
        balance = await prisma.simulatedBalance.update({
          where: { id: 'default' },
          data: {
            eurBalance: balance.eurBalance - amount,
            equity: balance.equity - amount,
            freeMargin: Math.max(0, balance.freeMargin - amount * 10),
          },
        });
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: reset, deposit, or withdraw' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      balance,
    });
  } catch (error) {
    console.error('Error updating simulated balance:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update balance' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDbErrorResponse } from '@/lib/db-error';
import { FEE_RATES } from '@/lib/trading/trade-calculations';

const DEFAULT_BALANCE = {
  eurBalance: 2000,
  cryptoHoldings: '{}',
  cryptoValue: 0,
  equity: 2000,
  marginUsed: 0,
  freeMargin: 2000, // equity - marginUsed (real free margin, NOT notional)
  marginLevel: null,
  totalRealizedPnl: 0,
  totalFeesPaid: 0,
};

/**
 * Calculate unrealized P&L for a position at a given price.
 * Includes entry fees and estimated rollover fees (matches Kraken's net P&L).
 */
function calculatePositionPnL(
  pos: { avgEntryPrice: number; volume: number; side: string; totalFees: number; totalCost: number; leverage: number; openedAt: Date },
  currentPrice: number
): number {
  const rawPnl = pos.side === 'long'
    ? (currentPrice - pos.avgEntryPrice) * pos.volume
    : (pos.avgEntryPrice - currentPrice) * pos.volume;

  // Include entry fees in P&L (Kraken shows net P&L)
  // Estimate rollover: 0.02% of notional per 4 hours
  const hoursOpen = (Date.now() - pos.openedAt.getTime()) / (1000 * 60 * 60);
  const rolloverPeriods = Math.floor(hoursOpen / 4);
  const notional = pos.avgEntryPrice * pos.volume;
  const rolloverFee = notional * FEE_RATES.marginRollover * rolloverPeriods;

  return rawPnl - pos.totalFees - rolloverFee;
}

function calculateLiquidationPnL(
  pos: { avgEntryPrice: number; volume: number; side: string; totalFees: number; openedAt: Date },
  currentPrice: number
): { rawPnl: number; rolloverFee: number; netPnl: number } {
  const rawPnl = pos.side === 'long'
    ? (currentPrice - pos.avgEntryPrice) * pos.volume
    : (pos.avgEntryPrice - currentPrice) * pos.volume;

  const hoursOpen = (Date.now() - pos.openedAt.getTime()) / (1000 * 60 * 60);
  const rolloverPeriods = Math.floor(hoursOpen / 4);
  const notional = pos.avgEntryPrice * pos.volume;
  const rolloverFee = notional * FEE_RATES.marginRollover * rolloverPeriods;

  const netPnl = rawPnl - pos.totalFees - rolloverFee;

  return { rawPnl, rolloverFee, netPnl };
}

/**
 * GET /api/simulated/balance
 * Get the current simulated balance with accurate margin calculations.
 *
 * Query params:
 *   currentPrice - optional, used to compute unrealized P&L and dynamic equity
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const currentPrice = parseFloat(searchParams.get('currentPrice') || '0');

    // Get or create default balance
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

    // Fetch open positions for margin and P&L calculations
    const openPositions = await prisma.simulatedPosition.findMany({
      where: { isOpen: true },
    });

    // Calculate margin used from open positions
    let marginUsed = 0;
    for (const pos of openPositions) {
      marginUsed += pos.totalCost / pos.leverage;
    }

    // Calculate unrealized P&L across all positions (if price available)
    let totalUnrealizedPnl = 0;
    if (currentPrice > 0 && openPositions.length > 0) {
      for (const pos of openPositions) {
        totalUnrealizedPnl += calculatePositionPnL(pos, currentPrice);
      }
    }

    // Equity = cash balance + crypto value + unrealized P&L on open positions
    // This matches Kraken's equity calculation
    const equity = balance.eurBalance + balance.cryptoValue + totalUnrealizedPnl;

    // Free margin = equity - margin used (NOT multiplied by leverage!)
    // This is the actual EUR you can commit as new margin collateral
    const freeMargin = Math.max(0, equity - marginUsed);

    // Margin level = (equity / margin used) * 100
    // Kraken liquidates at ~80% margin level for retail
    const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : null;

    // Auto-liquidation check: if margin level drops below 80%, force-close all positions
    let liquidated = false;
    if (marginLevel !== null && marginLevel < 80 && currentPrice > 0) {
      liquidated = true;

      // Force-close all positions at current price
      for (const pos of openPositions) {
        const pnl = calculateLiquidationPnL(pos, currentPrice);

        // Calculate closing fee
        const closingNotional = pos.volume * currentPrice;
        const closingFee = closingNotional * FEE_RATES.taker + closingNotional * FEE_RATES.marginOpen;

        const realizedPnl = pnl.netPnl - closingFee;

        await prisma.simulatedPosition.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            realizedPnl,
            totalFees: pos.totalFees + closingFee,
            closedAt: new Date(),
          },
        });

        // Update balance
        await prisma.simulatedBalance.update({
          where: { id: 'default' },
          data: {
            eurBalance: { increment: realizedPnl },
            totalRealizedPnl: { increment: realizedPnl },
            totalFeesPaid: { increment: closingFee },
          },
        });
      }

      // Cancel all open orders
      await prisma.simulatedOrder.updateMany({
        where: { status: 'open' },
        data: { status: 'cancelled' },
      });

      // Re-fetch balance after liquidation
      balance = await prisma.simulatedBalance.findUnique({
        where: { id: 'default' },
      });

      if (!balance) {
        throw new Error('Balance missing after liquidation');
      }

      // Recalculate post-liquidation values
      const postLiqEquity = balance.eurBalance + balance.cryptoValue;
      return NextResponse.json({
        ...balance,
        equity: postLiqEquity,
        marginUsed: 0,
        freeMargin: postLiqEquity,
        marginLevel: null,
        unrealizedPnl: 0,
        openPositionsCount: 0,
        liquidated: true,
        liquidationMessage: `Account liquidated at margin level ${marginLevel.toFixed(0)}%. All positions closed.`,
      });
    }

    return NextResponse.json({
      ...balance,
      equity,
      marginUsed,
      freeMargin,
      marginLevel,
      unrealizedPnl: totalUnrealizedPnl,
      openPositionsCount: openPositions.length,
    });
  } catch (error) {
    console.error('[Balance API] Error fetching simulated balance:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching simulated balance'),
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
        const resetEurBalance = amount || DEFAULT_BALANCE.eurBalance;
        balance = await prisma.simulatedBalance.update({
          where: { id: 'default' },
          data: {
            eurBalance: resetEurBalance,
            cryptoHoldings: '{}',
            cryptoValue: 0,
            equity: resetEurBalance,
            marginUsed: 0,
            freeMargin: resetEurBalance,
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
        const depositBalance = balance.eurBalance + amount;
        const depositOpenPositions = await prisma.simulatedPosition.findMany({
          where: { isOpen: true },
        });
        const depositMarginUsed = depositOpenPositions.reduce((total, pos) => total + (pos.totalCost / pos.leverage), 0);
        const depositEquity = depositBalance + balance.cryptoValue;
        const depositFreeMargin = Math.max(0, depositEquity - depositMarginUsed);

        balance = await prisma.simulatedBalance.update({
          where: { id: 'default' },
          data: {
            eurBalance: depositBalance,
            equity: depositEquity,
            marginUsed: depositMarginUsed,
            freeMargin: depositFreeMargin,
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
        const withdrawBalance = balance.eurBalance - amount;
        const withdrawOpenPositions = await prisma.simulatedPosition.findMany({
          where: { isOpen: true },
        });
        const withdrawMarginUsed = withdrawOpenPositions.reduce((total, pos) => total + (pos.totalCost / pos.leverage), 0);
        const withdrawEquity = withdrawBalance + balance.cryptoValue;
        const withdrawFreeMargin = Math.max(0, withdrawEquity - withdrawMarginUsed);

        balance = await prisma.simulatedBalance.update({
          where: { id: 'default' },
          data: {
            eurBalance: withdrawBalance,
            equity: withdrawEquity,
            marginUsed: withdrawMarginUsed,
            freeMargin: withdrawFreeMargin,
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
    console.error('[Balance API] Error updating simulated balance:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Updating simulated balance'),
      { status: 500 }
    );
  }
}

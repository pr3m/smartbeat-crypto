import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getTaxRate, getEffectiveDistributionRate, type AccountType } from '@/lib/tax/estonia-rules';

/**
 * Centralized error logger for tax calculations
 */
function logTaxError(context: string, error: unknown, details?: Record<string, unknown>): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  console.error(`[TAX_ERROR] ${context}:`, {
    message: errorMessage,
    stack: errorStack,
    ...details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/tax/summary - Get tax summary for a year
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get('year');
  const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();

  try {
    // Validate year
    if (isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json(
        { error: `Invalid year: ${yearParam}. Must be between 2000 and 2100.` },
        { status: 400 }
      );
    }

    // Get account type from settings
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    const accountType = (settings?.accountType as AccountType) || 'individual';

    const taxRate = getTaxRate(year, accountType);
    const distributionTaxRate = getEffectiveDistributionRate(year);

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    // Get all transactions for the year
    const transactions = await prisma.transaction.findMany({
      where: {
        timestamp: { gte: yearStart, lte: yearEnd },
      },
      include: {
        taxEvents: true,
      },
    });

    // Get tax events for the year
    const taxEvents = await prisma.taxEvent.findMany({
      where: { taxYear: year },
    });

    // Get prior year loss carryforward for business accounts
    let priorLossCarryforward = 0;
    if (accountType === 'business' && year > 2020) {
      // Calculate cumulative losses from prior years
      const priorYearEvents = await prisma.taxEvent.findMany({
        where: { taxYear: { lt: year } },
        select: { gain: true },
      });
      const priorNetPnL = priorYearEvents.reduce((sum, e) => sum + (e.gain || 0), 0);
      if (priorNetPnL < 0) {
        priorLossCarryforward = Math.abs(priorNetPnL);
      }
    }

    // Calculate totals
    let totalGains = 0;
    let totalLosses = 0;
    let tradingGains = 0;
    let tradingLosses = 0;
    let marginGains = 0;
    let marginLosses = 0;
    let stakingIncome = 0;
    let earnIncome = 0;
    let airdropIncome = 0;
    let creditIncome = 0;
    let totalTradingFees = 0;
    let totalMarginFees = 0;
    let totalTransactions = transactions.length;
    let taxableTransactions = 0;
    const warnings: string[] = [];

    // Process tax events (for spot trades FIFO calculation)
    for (const event of taxEvents) {
      // Only add spot trade gains (margin is handled separately)
      const tx = transactions.find(t => t.id === event.transactionId);
      if (tx && tx.type === 'TRADE') {
        if (event.gain > 0) {
          totalGains += event.gain;
          tradingGains += event.gain;
        } else {
          totalLosses += Math.abs(event.gain);
          tradingLosses += Math.abs(event.gain);
        }
      }
    }

    // Track processed margin order IDs to avoid double-counting
    const processedMarginOrderIds = new Set<string>();
    let stakingRewardsWithoutFMV = 0;
    let airdropsWithoutFMV = 0;

    // Process transactions for breakdown
    for (const tx of transactions) {
      // Track fees
      if (tx.fee && tx.fee > 0) {
        if (tx.type === 'MARGIN_TRADE' || tx.type === 'ROLLOVER') {
          totalMarginFees += tx.fee;
        } else {
          totalTradingFees += tx.fee;
        }
      }

      if (tx.type === 'TRADE' && tx.side === 'sell') {
        // Spot trades are handled via tax events above
        taxableTransactions++;
      } else if (tx.type === 'MARGIN_TRADE') {
        // For margin trades, use netPnl from opening trades (posstatus = 'closed')
        // These are the authoritative P&L values from Kraken
        // Group by krakenOrderId to avoid double-counting fills from the same order
        if (tx.posstatus === 'closed' && tx.netPnl !== null) {
          const orderId = tx.krakenOrderId || tx.id;
          if (!processedMarginOrderIds.has(orderId)) {
            processedMarginOrderIds.add(orderId);

            const pnl = tx.netPnl;
            if (pnl > 0) {
              marginGains += pnl;
              totalGains += pnl;
            } else {
              marginLosses += Math.abs(pnl);
              totalLosses += Math.abs(pnl);
            }
            taxableTransactions++;
          }
        }
      } else if (tx.type === 'STAKING_REWARD') {
        // For staking, the income is the value at time of receipt
        const income = Math.abs(tx.amount) * (tx.price || 0);
        if (income === 0 && tx.amount > 0) {
          stakingRewardsWithoutFMV++;
        }
        stakingIncome += income;
        totalGains += income;
        taxableTransactions++;
      } else if (tx.type === 'EARN_REWARD') {
        // Kraken Earn rewards - taxable income
        const income = Math.abs(tx.amount) * (tx.price || 0);
        earnIncome += income;
        totalGains += income;
        taxableTransactions++;
      } else if (tx.type === 'CREDIT') {
        // Credits/bonuses from Kraken
        const income = Math.abs(tx.amount) * (tx.price || 0);
        creditIncome += income;
        totalGains += income;
        taxableTransactions++;
      } else if (tx.type === 'AIRDROP' || tx.type === 'FORK') {
        const income = Math.abs(tx.amount) * (tx.price || 0);
        if (income === 0 && tx.amount > 0) {
          airdropsWithoutFMV++;
        }
        airdropIncome += income;
        totalGains += income;
        taxableTransactions++;
      }
    }

    // Generate warnings
    if (stakingRewardsWithoutFMV > 0) {
      warnings.push(`${stakingRewardsWithoutFMV} staking reward(s) have zero FMV - manual calculation needed`);
    }
    if (airdropsWithoutFMV > 0) {
      warnings.push(`${airdropsWithoutFMV} airdrop(s) have zero FMV - manual calculation needed`);
    }
    if (accountType === 'individual' && totalLosses > 0) {
      warnings.push(`${totalLosses.toFixed(2)} EUR in losses cannot be deducted (Estonian individual tax rules)`);
    }
    if (priorLossCarryforward > 0) {
      warnings.push(`Applied ${priorLossCarryforward.toFixed(2)} EUR loss carryforward from prior years`);
    }

    // Calculate net P&L
    const netPnL = totalGains - totalLosses;

    // Calculate tax based on account type
    let taxableAmount: number;
    let estimatedTax: number;
    let retainedProfit: number;
    let potentialDistributionTax: number;
    let lossCarryforward = 0;
    let hasLossCarryforward = false;

    if (accountType === 'business') {
      // Business: 0% tax on retained profits, losses offset gains
      taxableAmount = 0;
      estimatedTax = 0;

      // Apply prior year loss carryforward
      const adjustedNetPnL = netPnL - priorLossCarryforward;
      retainedProfit = adjustedNetPnL;

      // Calculate new loss carryforward
      if (adjustedNetPnL < 0) {
        lossCarryforward = Math.abs(adjustedNetPnL);
        hasLossCarryforward = true;
      }

      potentialDistributionTax = adjustedNetPnL > 0 ? adjustedNetPnL * distributionTaxRate : 0;
    } else {
      // Individual: Only gains taxable, losses NOT deductible
      taxableAmount = totalGains;
      estimatedTax = taxableAmount * taxRate;
      retainedProfit = 0;
      potentialDistributionTax = 0;
    }

    const summary = {
      taxYear: year,
      taxRate,
      accountType,
      totalGains,
      totalLosses,
      netPnL,
      taxableAmount,
      estimatedTax,
      retainedProfit,
      distributionTaxRate,
      potentialDistributionTax,
      lossCarryforward,
      hasLossCarryforward,
      tradingGains,
      tradingLosses,
      marginGains,
      marginLosses,
      stakingIncome,
      earnIncome,
      creditIncome,
      airdropIncome,
      otherIncome: 0,
      totalTradingFees,
      totalMarginFees,
      totalTransactions,
      taxableTransactions,
      warnings,
    };

    return NextResponse.json(summary);
  } catch (error) {
    logTaxError('Get tax summary', error, { year });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get tax summary' },
      { status: 500 }
    );
  }
}

/**
 * GET tax breakdown by asset
 */
export async function POST(request: NextRequest) {
  try {
    const { year } = await request.json();
    const taxYear = year || new Date().getFullYear();

    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);

    // Get breakdown by asset
    const byAsset = await prisma.transaction.groupBy({
      by: ['asset'],
      where: {
        timestamp: { gte: yearStart, lte: yearEnd },
        side: 'sell',
      },
      _sum: {
        gain: true,
        cost: true,
      },
      _count: true,
    });

    // Get breakdown by month
    const transactions = await prisma.transaction.findMany({
      where: {
        timestamp: { gte: yearStart, lte: yearEnd },
        side: 'sell',
      },
      select: {
        timestamp: true,
        gain: true,
      },
    });

    const byMonth = new Array(12).fill(null).map((_, i) => ({
      month: i + 1,
      gains: 0,
      losses: 0,
    }));

    for (const tx of transactions) {
      const month = tx.timestamp.getMonth();
      const gain = tx.gain || 0;
      if (gain > 0) {
        byMonth[month].gains += gain;
      } else {
        byMonth[month].losses += Math.abs(gain);
      }
    }

    return NextResponse.json({
      byAsset: byAsset.map(item => ({
        asset: item.asset,
        totalGain: item._sum.gain || 0,
        totalCost: item._sum.cost || 0,
        count: item._count,
      })),
      byMonth,
    });
  } catch (error) {
    logTaxError('Get tax breakdown', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get tax breakdown' },
      { status: 500 }
    );
  }
}

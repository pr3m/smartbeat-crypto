/**
 * Simulated Trade Analysis API Route
 * POST /api/simulated/analyze
 *
 * Analyzes trades with AI for backtesting insights
 * Uses LangChain for structured AI interactions
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  analyzeSingleTrade,
  analyzeTrades,
  isOpenAIConfigured,
  type TradeForAnalysis,
} from '@/lib/ai';

/**
 * POST /api/simulated/analyze
 * Analyze trades with AI for backtesting insights
 *
 * Body:
 * - positionId: string (optional) - Analyze a specific position
 * - batch: boolean (optional) - Analyze all recent trades
 */
export async function POST(request: Request) {
  try {
    if (!isOpenAIConfigured()) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { positionId, batch } = body;

    let trades: TradeForAnalysis[];

    if (positionId) {
      // Analyze a specific trade
      const analysis = await prisma.tradeAnalysis.findFirst({
        where: { positionId },
        orderBy: { createdAt: 'desc' },
      });

      if (!analysis) {
        return NextResponse.json(
          { error: 'Trade analysis not found for this position' },
          { status: 404 }
        );
      }

      trades = [{
        id: analysis.id,
        positionId: analysis.positionId,
        tradeType: analysis.tradeType,
        entryPrice: analysis.entryPrice,
        exitPrice: analysis.exitPrice,
        realizedPnl: analysis.realizedPnl,
        pnlPercent: analysis.pnlPercent,
        outcome: analysis.outcome,
        entrySnapshot: analysis.entrySnapshot,
        createdAt: analysis.createdAt,
      }];

      const result = await analyzeSingleTrade(trades[0]);

      // Update the trade analysis record with AI insights
      if (result.parsed) {
        await prisma.tradeAnalysis.update({
          where: { id: trades[0].id },
          data: {
            aiAnalysis: result.analysis,
            successFactors: 'whatWorked' in result.parsed
              ? JSON.stringify(result.parsed.whatWorked)
              : null,
            failureFactors: 'whatDidntWork' in result.parsed
              ? JSON.stringify(result.parsed.whatDidntWork)
              : null,
          },
        });
      }

      return NextResponse.json(result);
    } else if (batch) {
      // Batch analysis of recent trades
      const analyses = await prisma.tradeAnalysis.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      if (analyses.length === 0) {
        return NextResponse.json(
          { error: 'No completed trades to analyze' },
          { status: 400 }
        );
      }

      trades = analyses.map(a => ({
        id: a.id,
        positionId: a.positionId,
        tradeType: a.tradeType,
        entryPrice: a.entryPrice,
        exitPrice: a.exitPrice,
        realizedPnl: a.realizedPnl,
        pnlPercent: a.pnlPercent,
        outcome: a.outcome,
        entrySnapshot: a.entrySnapshot,
        createdAt: a.createdAt,
      }));

      const result = await analyzeTrades(trades);
      return NextResponse.json(result);
    } else {
      return NextResponse.json(
        { error: 'Provide either positionId or batch=true' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Trade analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/simulated/analyze
 * Get existing trade analyses
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const positionId = searchParams.get('positionId');
    const limit = parseInt(searchParams.get('limit') || '20');

    const where: Record<string, unknown> = {};
    if (positionId) {
      where.positionId = positionId;
    }

    const analyses = await prisma.tradeAnalysis.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Calculate summary stats
    const wins = analyses.filter(a => a.outcome === 'win').length;
    const losses = analyses.filter(a => a.outcome === 'loss').length;
    const totalPnl = analyses.reduce((sum, a) => sum + (a.realizedPnl || 0), 0);

    return NextResponse.json({
      analyses,
      stats: {
        total: analyses.length,
        wins,
        losses,
        winRate: analyses.length > 0 ? (wins / analyses.length) * 100 : 0,
        totalPnl,
        avgPnl: analyses.length > 0 ? totalPnl / analyses.length : 0,
      },
    });
  } catch (error) {
    console.error('Error fetching trade analyses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch analyses' },
      { status: 500 }
    );
  }
}

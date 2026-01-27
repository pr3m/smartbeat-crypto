/**
 * AI Trade Analysis API Route
 * POST /api/ai/analyze
 *
 * Sends market data to OpenAI GPT for intelligent trade analysis
 * Uses LangChain for structured AI interactions
 * Auto-saves analysis to database for Reports tab
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeMarket, isOpenAIConfigured, type MarketSnapshot } from '@/lib/ai';
import { prisma } from '@/lib/db';
import { trackAIUsage } from '@/lib/ai/usage-tracker';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    if (!isOpenAIConfigured()) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in .env' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const marketData: MarketSnapshot = body.marketData;

    if (!marketData) {
      return NextResponse.json(
        { error: 'Missing marketData in request body' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!marketData.currentPrice || !marketData.timeframes) {
      return NextResponse.json(
        { error: 'Invalid marketData: missing required fields (currentPrice, timeframes)' },
        { status: 400 }
      );
    }

    const result = await analyzeMarket(marketData);

    // Track AI usage
    const durationMs = Date.now() - startTime;
    const tokens = result.tokens || { input: 0, output: 0 };
    await trackAIUsage({
      feature: 'market_analysis',
      model: result.model,
      inputTokens: tokens.input || 0,
      outputTokens: tokens.output || 0,
      success: true,
      durationMs,
      endpoint: '/api/ai/analyze',
      userContext: 'trading',
    });

    // Debug: log what we're returning
    console.log('AI analyze route result:', {
      hasAnalysis: !!result.analysis,
      analysisLength: result.analysis?.length || 0,
      hasTradeData: !!result.tradeData,
      model: result.model,
    });

    // Auto-save analysis to database for Reports tab
    try {
      // Ensure analysis is a string before saving to database
      const analysisText = typeof result.analysis === 'string'
        ? result.analysis
        : JSON.stringify(result.analysis);

      await prisma.aIMarketAnalysis.create({
        data: {
          pair: marketData.pair || 'XRPEUR',
          model: result.model,
          action: result.tradeData?.action || 'WAIT',
          conviction: result.tradeData?.conviction || null,
          confidence: result.tradeData?.confidence || null,
          entryLow: result.tradeData?.entry?.low || null,
          entryHigh: result.tradeData?.entry?.high || null,
          stopLoss: result.tradeData?.stopLoss || null,
          targets: result.tradeData?.targets ? JSON.stringify(result.tradeData.targets) : null,
          riskReward: result.tradeData?.riskReward || null,
          analysis: analysisText,
          inputData: result.inputData,
          tokens: result.tokens ? JSON.stringify(result.tokens) : null,
          priceAtAnalysis: marketData.currentPrice,
        },
      });
      console.log('AI analysis saved to database');
    } catch (dbError) {
      // Log but don't fail the request if DB save fails
      console.error('Failed to save AI analysis to database:', dbError);
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('AI analysis error:', error);

    // Track failed request
    const durationMs = Date.now() - startTime;
    await trackAIUsage({
      feature: 'market_analysis',
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      inputTokens: 0,
      outputTokens: 0,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      durationMs,
      endpoint: '/api/ai/analyze',
      userContext: 'trading',
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to analyze market data',
        success: false,
      },
      { status: 500 }
    );
  }
}

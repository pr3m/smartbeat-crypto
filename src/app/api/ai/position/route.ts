/**
 * Position AI Evaluation API Route
 * POST /api/ai/position
 *
 * Evaluates an open position using AI for actionable recommendations
 */

import { NextRequest, NextResponse } from 'next/server';
import { evaluatePosition, type PositionData } from '@/lib/ai';
import type { PositionHealthMetrics, MarketSnapshot } from '@/lib/ai/types';
import { trackAIUsage } from '@/lib/ai/usage-tracker';

interface RequestBody {
  positionId: string;
  positionData: PositionData;
  health: PositionHealthMetrics;
  marketSnapshot?: MarketSnapshot; // Optional market context
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in .env' },
        { status: 500 }
      );
    }

    const body: RequestBody = await request.json();
    const { positionData, health, marketSnapshot } = body;

    if (!positionData) {
      return NextResponse.json(
        { error: 'Missing positionData in request body' },
        { status: 400 }
      );
    }

    if (!health) {
      return NextResponse.json(
        { error: 'Missing health metrics in request body' },
        { status: 400 }
      );
    }

    // Validate required position fields
    const requiredFields = [
      'pair',
      'side',
      'leverage',
      'entryPrice',
      'currentPrice',
      'liquidationPrice',
      'volume',
      'unrealizedPnl',
      'pnlPercent',
      'marginUsed',
      'hoursOpen',
    ];

    for (const field of requiredFields) {
      if (positionData[field as keyof PositionData] === undefined) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Run evaluation
    const result = await evaluatePosition(
      positionData,
      health,
      marketSnapshot || null,
      { apiKey, model }
    );

    // Track AI usage
    const durationMs = Date.now() - startTime;
    const tokens = result.tokens || { input: 0, output: 0 };
    await trackAIUsage({
      feature: 'position_evaluation',
      model,
      inputTokens: tokens.input || 0,
      outputTokens: tokens.output || 0,
      success: true,
      durationMs,
      endpoint: '/api/ai/position',
      userContext: 'trading',
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Position AI evaluation error:', error);

    // Track failed request
    const durationMs = Date.now() - startTime;
    await trackAIUsage({
      feature: 'position_evaluation',
      model,
      inputTokens: 0,
      outputTokens: 0,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      durationMs,
      endpoint: '/api/ai/position',
      userContext: 'trading',
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to evaluate position',
        success: false,
      },
      { status: 500 }
    );
  }
}

/**
 * Position AI Evaluation API Route
 * POST /api/ai/position
 *
 * Evaluates an open position using AI for actionable recommendations
 */

import { NextRequest, NextResponse } from 'next/server';
import { evaluatePosition, type PositionData } from '@/lib/ai';
import type { PositionHealthMetrics, MarketSnapshot } from '@/lib/ai/types';

interface RequestBody {
  positionId: string;
  positionData: PositionData;
  health: PositionHealthMetrics;
  marketSnapshot?: MarketSnapshot; // Optional market context
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4.1';

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

    return NextResponse.json(result);
  } catch (error) {
    console.error('Position AI evaluation error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to evaluate position',
        success: false,
      },
      { status: 500 }
    );
  }
}

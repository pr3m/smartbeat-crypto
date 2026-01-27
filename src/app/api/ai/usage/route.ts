/**
 * AI Usage API Route
 * GET /api/ai/usage - Get AI usage statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUsageSummary, getRecentUsage, getDailyUsage } from '@/lib/ai/usage-tracker';
import { createDbErrorResponse } from '@/lib/db-error';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'summary';
    const days = parseInt(searchParams.get('days') || '30', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    switch (view) {
      case 'summary': {
        const summary = await getUsageSummary(startDate, endDate);
        return NextResponse.json({
          success: true,
          period: { days, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          ...summary,
        });
      }

      case 'recent': {
        const recent = await getRecentUsage(limit);
        return NextResponse.json({
          success: true,
          records: recent,
          count: recent.length,
        });
      }

      case 'daily': {
        const daily = await getDailyUsage(days);
        return NextResponse.json({
          success: true,
          period: { days },
          daily,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid view parameter. Use: summary, recent, or daily' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[AI Usage API] Error:', error);
    return NextResponse.json(
      createDbErrorResponse(error, 'Fetching AI usage'),
      { status: 500 }
    );
  }
}

/**
 * AI Reports API Route
 * GET /api/ai/reports - List AI market analyses
 * DELETE /api/ai/reports?id=xxx - Delete a specific analysis
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const action = searchParams.get('action'); // Optional filter: LONG, SHORT, WAIT

    const where = action ? { action } : {};

    const [reports, total] = await Promise.all([
      prisma.aIMarketAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          pair: true,
          model: true,
          action: true,
          conviction: true,
          confidence: true,
          entryLow: true,
          entryHigh: true,
          stopLoss: true,
          targets: true,
          riskReward: true,
          analysis: true,
          inputData: true,
          tokens: true,
          priceAtAnalysis: true,
          createdAt: true,
        },
      }),
      prisma.aIMarketAnalysis.count({ where }),
    ]);

    // Parse JSON fields for each report
    const parsedReports = reports.map(report => ({
      ...report,
      targets: report.targets ? JSON.parse(report.targets) : null,
      tokens: report.tokens ? JSON.parse(report.tokens) : null,
    }));

    return NextResponse.json({
      success: true,
      reports: parsedReports,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching AI reports:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing id parameter' },
        { status: 400 }
      );
    }

    await prisma.aIMarketAnalysis.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting AI report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete report' },
      { status: 500 }
    );
  }
}

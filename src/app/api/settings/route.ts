import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/settings - Get current settings
 */
export async function GET() {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 'default' } });

    if (!settings) {
      // Create default settings if they don't exist
      settings = await prisma.settings.create({
        data: { id: 'default' },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get settings' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings - Update settings
 */
export async function PUT(request: NextRequest) {
  try {
    const updates = await request.json();

    // Only allow updating specific fields
    const allowedFields = ['accountType', 'costBasisMethod', 'defaultTaxYear', 'defaultPair'];
    const filteredUpdates: Record<string, unknown> = {};

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      update: filteredUpdates,
      create: { id: 'default', ...filteredUpdates },
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Update settings error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}

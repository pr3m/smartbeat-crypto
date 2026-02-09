/**
 * POST /api/arena/session/start - Start the arena competition
 */

import { NextResponse } from 'next/server';
import { ArenaOrchestrator } from '@/lib/arena/orchestrator';

export async function POST() {
  try {
    const orchestrator = ArenaOrchestrator.getInstance();
    await orchestrator.start();
    return NextResponse.json({ status: 'running' });
  } catch (error) {
    console.error('[Arena] Start error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start' },
      { status: 500 }
    );
  }
}

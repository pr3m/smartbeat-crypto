import { NextResponse } from 'next/server';
import { syncManager } from '@/lib/sync/sync-manager';

/**
 * GET /api/sync/status - Get current sync status
 *
 * Used for polling during sync operations.
 * Returns running state, progress, last sync time, and any errors.
 */
export async function GET() {
  try {
    const status = await syncManager.getStatus();

    return NextResponse.json({
      isRunning: status.isRunning,
      progress: status.progress,
      lastSync: status.lastSync
        ? {
            at: status.lastSync.at.toISOString(),
            recordsImported: status.lastSync.recordsImported,
          }
        : null,
      error: status.error,
      hasCredentials: syncManager.hasCredentials(),
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get sync status' },
      { status: 500 }
    );
  }
}

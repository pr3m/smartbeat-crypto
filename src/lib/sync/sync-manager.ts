/**
 * Sync Manager
 *
 * Singleton that manages automatic sync operations.
 * Handles startup sync, background sync, and cancellation.
 */

import { prisma } from '@/lib/db';
import { krakenClient } from '@/lib/kraken/client';
import {
  performGlobalSync,
  recoverFromInterruptedSync,
  cancelSync as cancelGlobalSync,
  getLastSyncedTimestamps,
  type SyncProgress,
  type SyncResult,
} from './global-sync';

export interface SyncStatus {
  isRunning: boolean;
  progress: SyncProgress | null;
  lastSync: {
    at: Date;
    recordsImported: number;
  } | null;
  error: string | null;
}

// How stale data can be before triggering auto-sync (1 hour)
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

class SyncManager {
  private static instance: SyncManager | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private currentProgress: SyncProgress | null = null;
  private lastError: string | null = null;
  private initialized = false;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  /**
   * Initialize the sync manager (called on app startup)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[SyncManager] Initializing...');

    try {
      // Recover from any interrupted syncs
      await recoverFromInterruptedSync();

      // Check if we should auto-sync
      const shouldSync = await this.shouldSyncOnStartup();

      if (shouldSync) {
        console.log('[SyncManager] Triggering startup sync...');
        // Don't await - run in background
        this.triggerSync('incremental').catch(err => {
          console.error('[SyncManager] Startup sync failed:', err);
        });
      } else {
        console.log('[SyncManager] No startup sync needed');
      }

      this.initialized = true;
    } catch (error) {
      console.error('[SyncManager] Initialization error:', error);
      this.initialized = true; // Mark as initialized to prevent retry loops
    }
  }

  /**
   * Check if we should sync on startup
   */
  async shouldSyncOnStartup(): Promise<boolean> {
    try {
      // Check if API credentials are configured
      if (!krakenClient.hasCredentials()) {
        console.log('[SyncManager] No API credentials configured, skipping auto-sync');
        return false;
      }

      // Get settings
      const settings = await prisma.settings.findUnique({
        where: { id: 'default' },
        select: {
          autoSyncOnStartup: true,
          lastSyncAt: true,
          lastTradeTimestamp: true,
          lastLedgerTimestamp: true,
        },
      });

      // If auto-sync is disabled, skip
      if (settings?.autoSyncOnStartup === false) {
        return false;
      }

      // If never synced, trigger full sync
      if (!settings?.lastSyncAt) {
        console.log('[SyncManager] No previous sync found, will do full sync');
        return true;
      }

      // If data is stale, trigger incremental sync
      const now = Date.now();
      const lastSync = settings.lastSyncAt.getTime();
      const isStale = (now - lastSync) > STALE_THRESHOLD_MS;

      if (isStale) {
        console.log('[SyncManager] Data is stale, will do incremental sync');
        return true;
      }

      return false;
    } catch (error) {
      console.error('[SyncManager] Error checking startup sync:', error);
      return false;
    }
  }

  /**
   * Trigger a sync operation
   */
  async triggerSync(mode: 'full' | 'incremental'): Promise<SyncResult> {
    if (this.isRunning) {
      throw new Error('A sync is already in progress');
    }

    // Check for API credentials
    if (!krakenClient.hasCredentials()) {
      throw new Error('Kraken API credentials not configured');
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.currentProgress = null;
    this.lastError = null;

    try {
      const result = await performGlobalSync({
        mode,
        signal: this.abortController.signal,
        onProgress: (progress) => {
          this.currentProgress = progress;
        },
      });

      if (!result.success) {
        this.lastError = result.errors[0] || 'Unknown error';
      }

      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Cancel the current sync operation
   */
  cancelSync(): void {
    if (this.abortController) {
      this.abortController.abort();
    }

    // Also cancel in the database
    cancelGlobalSync().catch(err => {
      console.error('[SyncManager] Error cancelling sync:', err);
    });
  }

  /**
   * Get current sync status
   */
  async getStatus(): Promise<SyncStatus> {
    // Get last sync info from database
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
      select: {
        lastSyncAt: true,
        syncInProgress: true,
        currentSyncId: true,
      },
    });

    // Get records imported from last sync log
    let recordsImported = 0;
    if (settings?.lastSyncAt) {
      const lastSyncLog = await prisma.syncLog.findFirst({
        where: {
          status: { in: ['completed', 'completed_with_errors'] },
        },
        orderBy: { completedAt: 'desc' },
        select: { recordsImported: true },
      });
      recordsImported = lastSyncLog?.recordsImported || 0;
    }

    // Get current progress if sync is running
    let progress = this.currentProgress;
    if (!progress && settings?.currentSyncId) {
      const currentLog = await prisma.syncLog.findUnique({
        where: { id: settings.currentSyncId },
        select: { progress: true },
      });
      if (currentLog?.progress) {
        try {
          progress = JSON.parse(currentLog.progress);
        } catch {
          // ignore parse errors
        }
      }
    }

    return {
      isRunning: this.isRunning || settings?.syncInProgress || false,
      progress,
      lastSync: settings?.lastSyncAt
        ? { at: settings.lastSyncAt, recordsImported }
        : null,
      error: this.lastError,
    };
  }

  /**
   * Check if credentials are configured
   */
  hasCredentials(): boolean {
    return krakenClient.hasCredentials();
  }
}

// Export singleton instance
export const syncManager = SyncManager.getInstance();

// Export for testing/custom instances
export { SyncManager };

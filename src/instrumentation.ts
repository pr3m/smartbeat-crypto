/**
 * Next.js Instrumentation Hook
 *
 * This file is called once when the Next.js server starts.
 * Used to initialize the sync manager for automatic data sync.
 */

export async function register() {
  // Only run on the server (Node.js runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Initializing server-side services...');

    try {
      // Dynamically import to avoid client-side bundling issues
      const { syncManager } = await import('./lib/sync/sync-manager');

      // Initialize the sync manager (handles startup sync)
      await syncManager.initialize();

      console.log('[Instrumentation] Server-side services initialized');
    } catch (error) {
      console.error('[Instrumentation] Failed to initialize services:', error);
      // Don't throw - we don't want to prevent the server from starting
    }
  }
}

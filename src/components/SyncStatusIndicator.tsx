'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

interface SyncStatus {
  isRunning: boolean;
  progress: SyncProgress | null;
  lastSync: { at: string; recordsImported: number } | null;
  error: string | null;
  hasCredentials: boolean;
}

interface SyncStatusIndicatorProps {
  className?: string;
  showLastSync?: boolean;
  compact?: boolean;
}

export function SyncStatusIndicator({
  className = '',
  showLastSync = true,
  compact = false,
}: SyncStatusIndicatorProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch sync status:', error);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Poll more frequently when sync is running
    const interval = setInterval(
      fetchStatus,
      status?.isRunning ? 2000 : 30000
    );

    return () => clearInterval(interval);
  }, [fetchStatus, status?.isRunning]);

  if (!status) {
    return null;
  }

  // Don't show anything if no credentials configured
  if (!status.hasCredentials) {
    return null;
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString('et-EE', { month: 'short', day: 'numeric' });
  };

  // Syncing state - show progress with link to import page
  if (status.isRunning && status.progress) {
    const { phase, current, total } = status.progress;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    return (
      <Link
        href="/tax/import"
        className={`flex items-center gap-2 text-sm hover:opacity-80 transition-opacity ${className}`}
        title={status.progress.message}
      >
        <span className="inline-block animate-spin text-info">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </span>
        <div className="flex flex-col">
          <span className="text-info text-xs font-medium">
            Syncing {phase}
          </span>
          {!compact && total > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-info rounded-full transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-tertiary text-xs">{percent}%</span>
            </div>
          )}
        </div>
      </Link>
    );
  }

  // Error state
  if (status.error) {
    return (
      <Link
        href="/tax/import"
        className={`flex items-center gap-2 text-sm cursor-pointer hover:opacity-80 ${className}`}
        title={status.error}
      >
        <span className="text-warning">⚠</span>
        <span className="text-warning text-xs">Sync failed</span>
      </Link>
    );
  }

  // Idle state with last sync info
  if (showLastSync && status.lastSync) {
    return (
      <Link
        href="/tax/import"
        className={`flex items-center gap-2 text-sm text-tertiary hover:text-secondary transition-colors ${className}`}
        title={`Last sync: ${new Date(status.lastSync.at).toLocaleString('et-EE')} - ${status.lastSync.recordsImported} records imported`}
      >
        <span className="text-success text-xs">●</span>
        <span className="hidden sm:inline text-xs">
          Synced {formatDate(status.lastSync.at)}
        </span>
      </Link>
    );
  }

  // Never synced
  if (!status.lastSync) {
    return (
      <Link
        href="/tax/import"
        className={`flex items-center gap-2 text-sm text-tertiary hover:text-secondary transition-colors ${className}`}
        title="Click to sync data from Kraken"
      >
        <span className="text-secondary text-xs">○</span>
        <span className="hidden sm:inline text-xs">Not synced</span>
      </Link>
    );
  }

  return null;
}

export default SyncStatusIndicator;

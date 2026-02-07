'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  tag: string;
  priority: string;
  read: boolean;
  createdAt: string;
}

const TYPE_COLORS: Record<string, string> = {
  signal: 'bg-purple-500',
  grade: 'bg-blue-500',
  setup: 'bg-blue-400',
  volume: 'bg-yellow-500',
  rsi: 'bg-orange-500',
  pnl: 'bg-emerald-500',
  dca: 'bg-cyan-500',
};

const TYPE_LABELS: Record<string, string> = {
  signal: 'Signal Change',
  grade: 'Grade Alert',
  setup: 'Setup Alert',
  volume: 'Volume Alert',
  rsi: 'RSI Alert',
  pnl: 'P&L Milestone',
  dca: 'DCA Level',
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  signal: 'The multi-timeframe analysis detected a new trading signal. 4H determines trend, 1H confirms setup, 15m times entry, 5m detects volume. Requires 5/6 conditions for entry.',
  grade: 'Signal confidence crossed a key threshold. Grade A (80%+) means high-probability setup. Below 50% means the setup is degrading and caution is warranted.',
  setup: 'Conditions are aligning but not yet confirmed. Confidence is rising toward a potential entry signal. Monitor for confirmation across timeframes.',
  volume: '15-minute volume exceeded 2x the average, suggesting institutional or significant market activity. Can precede large price moves.',
  rsi: 'The 15-minute RSI reached an extreme level. Below 25 is deeply oversold (potential bounce), above 75 is deeply overbought (potential pullback).',
  pnl: 'An open position crossed a P&L percentage milestone. Consider taking partial profits at positive milestones or reviewing stop losses at negative ones.',
  dca: 'Price dropped to a level where adding to a long position (Dollar Cost Averaging / Martingale) may improve the average entry price.',
};

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  high: { label: 'High', color: 'text-red-400' },
  medium: { label: 'Medium', color: 'text-yellow-400' },
  low: { label: 'Low', color: 'text-tertiary' },
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || 'bg-gray-500';
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatFullTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// --- Detail Dialog ---
function NotificationDetail({
  notification,
  onClose,
}: {
  notification: Notification;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleClickOutside(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const typeLabel = TYPE_LABELS[notification.type] || notification.type;
  const typeDesc = TYPE_DESCRIPTIONS[notification.type] || '';
  const priorityInfo = PRIORITY_LABELS[notification.priority] || PRIORITY_LABELS.medium;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 animate-fade-in">
      <div
        ref={dialogRef}
        className="bg-secondary border border-primary rounded-xl shadow-2xl w-full max-w-md mx-4 animate-fade-in overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${getTypeColor(notification.type)}`} />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-primary">{notification.title}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-tertiary">{typeLabel}</span>
              <span className="text-tertiary">·</span>
              <span className={`text-xs ${priorityInfo.color}`}>{priorityInfo.label} priority</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-tertiary hover:text-primary rounded transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-4">
          <p className="text-sm text-primary leading-relaxed">{notification.body}</p>
        </div>

        {/* Context explanation */}
        {typeDesc && (
          <div className="px-5 pb-4">
            <div className="bg-tertiary/30 rounded-lg px-4 py-3">
              <p className="text-xs text-secondary leading-relaxed">
                <span className="font-medium text-tertiary">What this means: </span>
                {typeDesc}
              </p>
            </div>
          </div>
        )}

        {/* Footer meta */}
        <div className="px-5 py-3 border-t border-primary flex items-center justify-between">
          <span className="text-xs text-tertiary">{formatFullTime(notification.createdAt)}</span>
          <span className="text-[10px] text-tertiary font-mono">{notification.tag}</span>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---
export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fetch unread count (lightweight poll)
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?unread=true&limit=0');
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Silent fail
    }
  }, []);

  // Fetch full notification list
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=30');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll unread count every 30s
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch full list when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Click outside to close dropdown (but not when detail dialog is open)
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (selectedNotification) return; // Dialog handles its own click-outside
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, selectedNotification]);

  // Mark single notification as read
  const markAsRead = async (id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markRead', ids: [id] }),
      });
    } catch {
      // Silent fail — optimistic update already applied
    }
  };

  // Mark all as read
  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAllRead' }),
      });
    } catch {
      // Silent fail
    }
  };

  // Open detail dialog
  const openDetail = (notif: Notification) => {
    if (!notif.read) markAsRead(notif.id);
    setSelectedNotification(notif);
  };

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-secondary hover:text-primary hover:bg-tertiary rounded-lg transition-colors relative"
        title="Notifications"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-2 w-80 bg-secondary border border-primary rounded-lg shadow-xl z-50 animate-fade-in overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary">
            <h3 className="text-sm font-semibold text-primary">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-96 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-secondary text-sm">
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-secondary text-sm">
                No notifications yet
              </div>
            ) : (
              notifications.map(notif => (
                <button
                  key={notif.id}
                  onClick={() => openDetail(notif)}
                  className={`w-full text-left px-4 py-3 border-b border-primary/50 hover:bg-tertiary transition-colors ${
                    !notif.read ? 'bg-blue-500/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Type indicator dot */}
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${getTypeColor(notif.type)}`} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium truncate ${!notif.read ? 'text-primary' : 'text-secondary'}`}>
                          {notif.title}
                        </span>
                        <span className="text-[10px] text-tertiary flex-shrink-0">
                          {formatRelativeTime(notif.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-secondary mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!notif.read && (
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Detail dialog */}
      {selectedNotification && (
        <NotificationDetail
          notification={selectedNotification}
          onClose={() => setSelectedNotification(null)}
        />
      )}
    </div>
  );
}

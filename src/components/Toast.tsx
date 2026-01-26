'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';

export interface Toast {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'signal';
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast = { ...toast, id };

    setToasts((prev) => {
      // Limit to 5 toasts
      const updated = [...prev, newToast];
      if (updated.length > 5) {
        return updated.slice(-5);
      }
      return updated;
    });

    // Auto-remove after duration
    const duration = toast.duration || (toast.type === 'signal' ? 15000 : 8000);
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  return (
    <div className="fixed top-20 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleRemove = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 200);
  };

  const bgColor = {
    info: 'bg-blue-900/90 border-blue-500',
    success: 'bg-green-900/90 border-green-500',
    warning: 'bg-yellow-900/90 border-yellow-500',
    error: 'bg-red-900/90 border-red-500',
    signal: 'bg-purple-900/90 border-purple-500',
  }[toast.type];

  const icon = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    signal: '🎯',
  }[toast.type];

  return (
    <div
      className={`
        ${bgColor} border rounded-lg p-4 shadow-xl backdrop-blur-sm
        transform transition-all duration-200
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
        animate-slide-in
      `}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white">{toast.title}</div>
          <div className="text-sm text-gray-300 mt-1 break-words">{toast.message}</div>
        </div>
        <button
          onClick={handleRemove}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// Browser notification helper
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.log('Browser does not support notifications');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
}

export function sendBrowserNotification(title: string, body: string, options?: NotificationOptions & { renotify?: boolean }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const notification = new Notification(title, {
    body,
    icon: '/favicon.ico',
    tag: 'trading-signal',
    ...options,
  } as NotificationOptions);

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  // Auto-close after 10 seconds
  setTimeout(() => notification.close(), 10000);
}

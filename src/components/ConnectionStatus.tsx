'use client';

import { useState, useEffect, useRef } from 'react';
import type { StatusResponse, ConnectionStatus as Status } from '@/lib/types/status';

const STATUS_CHECK_INTERVAL = 30000; // Check every 30 seconds

export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>('checking');
  const [message, setMessage] = useState('Checking...');
  const mountedRef = useRef(true);
  const checkingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const checkStatus = async () => {
      // Prevent concurrent checks
      if (checkingRef.current) return;
      checkingRef.current = true;

      try {
        const res = await fetch('/api/status');
        if (!mountedRef.current) return;

        if (!res.ok) {
          setStatus('error');
          setMessage('API Error');
          return;
        }

        const data: StatusResponse = await res.json();
        if (!mountedRef.current) return;

        setStatus(data.status);
        setMessage(data.message);
      } catch {
        if (!mountedRef.current) return;
        setStatus('error');
        setMessage('Network Error');
      } finally {
        checkingRef.current = false;
      }
    };

    // Initial check
    checkStatus();

    // Set up interval for periodic checks
    const interval = setInterval(checkStatus, STATUS_CHECK_INTERVAL);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'bg-green-500';
      case 'no-credentials':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      case 'checking':
      default:
        return 'bg-yellow-500 animate-pulse';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'no-credentials':
        return 'No API Keys';
      case 'error':
        return 'Disconnected';
      case 'checking':
      default:
        return 'Checking...';
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm text-secondary" title={message}>
      <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
      <span>{getStatusText()}</span>
    </div>
  );
}

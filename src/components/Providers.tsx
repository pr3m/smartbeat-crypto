'use client';

import { ReactNode } from 'react';
import { ToastProvider } from './Toast';

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

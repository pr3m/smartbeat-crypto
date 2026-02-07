/**
 * ChatContextSync
 * Automatically syncs the chat context based on the current URL path.
 * Rendered in the root layout so it runs on every page.
 */

'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useChatStore } from '@/stores/chatStore';

export function ChatContextSync() {
  const pathname = usePathname();
  const setContext = useChatStore((s) => s.setContext);

  useEffect(() => {
    if (pathname.startsWith('/trading')) {
      setContext('trading');
    } else if (pathname.startsWith('/tax/transactions')) {
      setContext('transactions');
    } else if (pathname.startsWith('/tax')) {
      setContext('tax');
    } else {
      setContext('general');
    }
  }, [pathname, setContext]);

  return null;
}

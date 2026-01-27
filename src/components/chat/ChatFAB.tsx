/**
 * Chat Floating Action Button
 * Opens the AI assistant chat panel
 */

'use client';

import { useChatStore } from '@/stores/chatStore';

export function ChatFAB() {
  const { toggleChat, isOpen, agentAlerts } = useChatStore();

  // Count undismissed alerts
  const alertCount = agentAlerts.filter((a) => !a.dismissed).length;

  return (
    <button
      onClick={toggleChat}
      className={`fixed bottom-6 left-6 z-40 flex items-center justify-center w-14 h-14 rounded-full fab transition-all ${
        isOpen
          ? 'bg-tertiary border border-primary'
          : 'bg-gradient-to-br from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500'
      }`}
      aria-label={isOpen ? 'Close chat' : 'Open AI assistant'}
    >
      {isOpen ? (
        // X icon when open
        <svg
          className="w-6 h-6 text-secondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      ) : (
        // Chat/AI icon when closed
        <svg
          className="w-7 h-7 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
          />
        </svg>
      )}

      {/* Alert badge */}
      {alertCount > 0 && !isOpen && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-5 h-5 px-1.5 text-xs font-bold text-white bg-red-500 rounded-full">
          {alertCount > 9 ? '9+' : alertCount}
        </span>
      )}
    </button>
  );
}

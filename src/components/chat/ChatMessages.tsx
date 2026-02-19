/**
 * Chat Messages List
 * Displays all messages with auto-scroll
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { TOOL_DISPLAY_NAMES } from '@/lib/ai/tool-display-names';

interface ChatMessagesProps {
  isStreaming: boolean;
}

export function ChatMessages({ isStreaming }: ChatMessagesProps) {
  const messages = useChatStore((state) => state.messages);
  const messagesLoading = useChatStore((state) => state.messagesLoading);
  const activeToolCalls = useChatStore((state) => state.activeToolCalls);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledAwayRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const prevMessageCountRef = useRef(messages.length);

  // Detect if user has scrolled away from the bottom
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // Consider "at bottom" if within 80px of the bottom
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    userScrolledAwayRef.current = !atBottom;
  }, []);

  // Scroll to bottom using rAF to avoid overlapping scroll commands
  const scrollToBottom = useCallback((instant: boolean) => {
    if (userScrolledAwayRef.current) return;

    // Cancel any pending scroll to avoid fighting animations
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      // Use scrollTop instead of scrollIntoView to avoid layout thrash
      container.scrollTop = container.scrollHeight;
    });
  }, []);

  // Reset user-scrolled-away when a new user message is sent
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'user') {
        userScrolledAwayRef.current = false;
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  // During streaming: use instant scroll on each content update
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom(true);
    }
  }, [messages, isStreaming, scrollToBottom]);

  // When streaming ends or new messages arrive (non-streaming), smooth scroll
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      scrollToBottom(false);
    }
  }, [isStreaming, messages.length, scrollToBottom]);

  // Also scroll when tool calls change (keeps indicator visible)
  useEffect(() => {
    scrollToBottom(true);
  }, [activeToolCalls, scrollToBottom]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  if (messagesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-secondary">Loading messages...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-gradient-to-br from-purple-600/20 to-blue-600/20 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-info"
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
        </div>
        <h3 className="text-lg font-medium mb-2">SmartBeat Assistant</h3>
        <p className="text-secondary text-sm max-w-xs">
          Ask me about your positions, trading history, tax calculations, or market analysis.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-2 w-full max-w-xs">
          <SuggestionButton text="What are my open positions?" />
          <SuggestionButton text="Show my tax summary for 2024" />
          <SuggestionButton text="Analyze my recent trades" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-4 space-y-1"
    >
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}

      {/* Tool execution indicator - stacked list */}
      {activeToolCalls.length > 0 && (
        <div className="flex justify-start mb-4">
          <div className="flex flex-col gap-1.5 px-4 py-2.5 bg-secondary border border-primary rounded-2xl rounded-bl-sm">
            {activeToolCalls.map((tool, i) => {
              const isLatest = i === activeToolCalls.length - 1;
              return (
                <div key={tool} className="flex items-center gap-2 text-xs">
                  {isLatest ? (
                    <svg
                      className="w-3.5 h-3.5 text-info animate-spin flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                  ) : (
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span className={isLatest ? 'text-secondary' : 'text-tertiary'}>
                    {TOOL_DISPLAY_NAMES[tool] || tool}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

function SuggestionButton({ text }: { text: string }) {
  const handleClick = () => {
    // Dispatch event - ChatPanel.sendMessage will handle adding message and API call
    window.dispatchEvent(
      new CustomEvent('chat:send', { detail: { message: text } })
    );
  };

  return (
    <button
      onClick={handleClick}
      className="px-4 py-2 text-sm text-left bg-tertiary hover:bg-secondary border border-primary rounded-lg transition-colors"
    >
      {text}
    </button>
  );
}

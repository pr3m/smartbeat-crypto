/**
 * Chat Messages List
 * Displays all messages with auto-scroll
 */

'use client';

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';

interface ChatMessagesProps {
  isStreaming: boolean;
}

export function ChatMessages({ isStreaming }: ChatMessagesProps) {
  const messages = useChatStore((state) => state.messages);
  const messagesLoading = useChatStore((state) => state.messagesLoading);
  const currentToolCall = useChatStore((state) => state.currentToolCall);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

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
      className="flex-1 overflow-y-auto p-4 space-y-1"
    >
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}

      {/* Tool execution indicator */}
      {currentToolCall && (
        <div className="flex justify-start mb-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-secondary border border-primary rounded-2xl rounded-bl-sm">
            <svg
              className="w-4 h-4 text-info animate-spin"
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
            <span className="text-sm text-secondary">{currentToolCall}</span>
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

/**
 * Chat Input Component
 * Text input with send button and streaming support
 */

'use client';

import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react';
import { useChatStore } from '@/stores/chatStore';

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isStreaming } = useChatStore();

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Listen for suggestion button clicks
  useEffect(() => {
    const handleSuggestion = (e: CustomEvent<{ message: string }>) => {
      onSend(e.detail.message);
    };
    window.addEventListener('chat:send', handleSuggestion as EventListener);
    return () => {
      window.removeEventListener('chat:send', handleSuggestion as EventListener);
    };
  }, [onSend]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || disabled || isStreaming) return;

      setInput('');
      await onSend(trimmed);
    },
    [input, disabled, isStreaming, onSend]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  const isDisabled = disabled || isStreaming;

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-primary bg-secondary">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? 'Waiting for response...' : 'Ask about positions, tax, trades...'}
            disabled={isDisabled}
            rows={1}
            className="w-full px-4 py-3 bg-primary border border-primary rounded-xl resize-none focus:outline-none focus:border-info transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: '46px', maxHeight: '120px' }}
          />
        </div>

        <button
          type="submit"
          disabled={isDisabled || !input.trim()}
          className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isStreaming ? (
            <svg
              className="w-5 h-5 text-white animate-spin"
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
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          )}
        </button>
      </div>

      <p className="text-xs text-tertiary mt-2 text-center">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}

/**
 * Chat Panel Component
 * Main chat drawer with messages and input
 */

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { ChatHistory } from './ChatHistory';

export function ChatPanel() {
  const {
    isOpen,
    closeChat,
    isHistoryOpen,
    toggleHistory,
    currentConversationId,
    setCurrentConversation,
    currentContext,
    isStreaming,
    setStreaming,
    addMessage,
    appendToLastMessage,
    setCurrentToolCall,
    setConversations,
    finishLastMessage,
    deleteMessagesAfter,
    messages,
  } = useChatStore();

  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      // Add user message to UI
      addMessage({ role: 'user', content });
      setStreaming(true);

      // Cancel any previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: currentConversationId,
            message: content,
            context: currentContext,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to send message');
        }

        // Add empty assistant message for streaming
        addMessage({ role: 'assistant', content: '', isStreaming: true });

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let newConversationId: string | null = null;

        const processLine = async (line: string) => {
          if (!line.startsWith('data: ')) return;

          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') return;

          try {
            const data = JSON.parse(jsonStr);

            switch (data.type) {
              case 'conversation':
                newConversationId = data.id;
                setCurrentConversation(data.id);
                break;

              case 'text':
                if (data.content) {
                  appendToLastMessage(data.content);
                }
                break;

              case 'tool_start':
                setCurrentToolCall(data.name);
                break;

              case 'tool_end':
                setCurrentToolCall(null);
                break;

              case 'error':
                appendToLastMessage(`\n\nError: ${data.message}`);
                break;

              case 'done':
                if (newConversationId) {
                  const convRes = await fetch('/api/ai/conversations');
                  if (convRes.ok) {
                    const convData = await convRes.json();
                    setConversations(convData.conversations || []);
                  }
                }
                break;
            }
          } catch {
            // Ignore parse errors for incomplete JSON
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            await processLine(line);
          }
        }

        // Process any remaining buffer content
        if (buffer.trim()) {
          await processLine(buffer);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return; // Request was cancelled
        }

        console.error('Chat error:', err);
        addMessage({
          role: 'assistant',
          content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`,
        });
      } finally {
        setStreaming(false);
        setCurrentToolCall(null);
        finishLastMessage();
        abortControllerRef.current = null;
      }
    },
    [
      currentConversationId,
      currentContext,
      addMessage,
      appendToLastMessage,
      setStreaming,
      setCurrentToolCall,
      setCurrentConversation,
      setConversations,
      finishLastMessage,
    ]
  );

  // Handle resend with message deletion
  const handleResend = useCallback(
    (messageId: string, content: string) => {
      // Find the message index
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      // Delete all messages after this one (including this one, we'll re-add it)
      const messagesToKeep = messages.slice(0, idx);
      useChatStore.setState({ messages: messagesToKeep });

      // Send the message again
      sendMessage(content);
    },
    [messages, sendMessage]
  );

  // Listen for resend events
  useEffect(() => {
    const handleResendEvent = (e: CustomEvent<{ messageId: string; content: string }>) => {
      handleResend(e.detail.messageId, e.detail.content);
    };
    window.addEventListener('chat:resend', handleResendEvent as EventListener);
    return () => {
      window.removeEventListener('chat:resend', handleResendEvent as EventListener);
    };
  }, [handleResend]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeChat();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeChat]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={closeChat}
      />

      {/* Panel - full screen on mobile */}
      <div className="fixed inset-0 sm:inset-y-0 sm:left-0 sm:right-auto z-50 flex animate-slide-in-left">
        {/* History sidebar (collapsible) - hidden on mobile */}
        {isHistoryOpen && (
          <div className="hidden sm:block w-64 border-r border-primary animate-fade-in">
            <ChatHistory />
          </div>
        )}

        {/* Main chat panel - full screen on mobile */}
        <div className="w-full sm:w-[450px] md:w-[500px] lg:w-[600px] xl:w-[700px] bg-primary flex flex-col border-r border-primary">
          {/* Header */}
          <header className="flex items-center justify-between p-4 border-b border-primary bg-secondary">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleHistory}
                className={`p-2 rounded-lg transition-colors ${
                  isHistoryOpen ? 'bg-tertiary' : 'hover:bg-tertiary'
                }`}
                title="Toggle history"
              >
                <svg
                  className="w-5 h-5 text-secondary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h7"
                  />
                </svg>
              </button>
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-info"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                  SmartBeat Assistant
                </h2>
                <p className="text-xs text-tertiary">
                  {currentConversationId ? 'Continuing conversation' : 'New conversation'}
                </p>
              </div>
            </div>

            <button
              onClick={closeChat}
              className="p-2 hover:bg-tertiary rounded-lg transition-colors"
              title="Close (Esc)"
            >
              <svg
                className="w-5 h-5 text-secondary"
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
            </button>
          </header>

          {/* Messages */}
          <ChatMessages isStreaming={isStreaming} />

          {/* Input */}
          <ChatInput onSend={sendMessage} disabled={isStreaming} />
        </div>
      </div>
    </>
  );
}

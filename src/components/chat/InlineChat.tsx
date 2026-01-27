/**
 * Inline Chat Component
 * Embeddable chat for follow-up questions in modals and panels
 */

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

interface InlineChatProps {
  /** Initial context message sent to AI (not shown to user) */
  contextMessage: string;
  /** Context type for the chat API */
  context: 'general' | 'trading' | 'tax' | 'transactions';
  /** Placeholder text for input */
  placeholder?: string;
  /** Optional title shown above chat */
  title?: string;
  /** Max height for messages area */
  maxHeight?: string;
}

export function InlineChat({
  contextMessage,
  context,
  placeholder = 'Ask a follow-up question...',
  title = 'Ask AI',
  maxHeight = '300px',
}: InlineChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentToolCall, setCurrentToolCall] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    // Add user message
    const userMsg: Message = { id: generateId(), role: 'user', content };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      // First message includes context, subsequent messages don't need it
      const messageToSend = messages.length === 0
        ? `Context for this conversation:\n${contextMessage}\n\nUser question: ${content}`
        : content;

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: messageToSend,
          context,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to send message');
      }

      // Add empty assistant message for streaming
      const assistantId = generateId();
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }]);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;

        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') return;

        try {
          const data = JSON.parse(jsonStr);

          switch (data.type) {
            case 'conversation':
              setConversationId(data.id);
              break;

            case 'text':
              if (data.content) {
                setMessages((prev) => {
                  const msgs = [...prev];
                  const lastIdx = msgs.length - 1;
                  if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
                    msgs[lastIdx] = { ...msgs[lastIdx], content: msgs[lastIdx].content + data.content };
                  }
                  return msgs;
                });
              }
              break;

            case 'tool_start':
              setCurrentToolCall(data.name);
              break;

            case 'tool_end':
              setCurrentToolCall(null);
              break;

            case 'error':
              setMessages((prev) => {
                const msgs = [...prev];
                const lastIdx = msgs.length - 1;
                if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
                  msgs[lastIdx] = { ...msgs[lastIdx], content: msgs[lastIdx].content + `\n\nError: ${data.message}` };
                }
                return msgs;
              });
              break;
          }
        } catch {
          // Ignore parse errors
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          processLine(line);
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        processLine(buffer);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      console.error('Inline chat error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
      setCurrentToolCall(null);
      // Clear streaming flag on last message
      setMessages((prev) => {
        const msgs = [...prev];
        const lastIdx = msgs.length - 1;
        if (lastIdx >= 0 && msgs[lastIdx].isStreaming) {
          msgs[lastIdx] = { ...msgs[lastIdx], isStreaming: false };
        }
        return msgs;
      });
      abortControllerRef.current = null;
    }
  }, [messages.length, contextMessage, conversationId, context, isStreaming]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const toolNames: Record<string, string> = {
    query_transactions: 'Searching transactions',
    get_positions: 'Checking positions',
    get_market_data: 'Fetching market data',
    get_trading_recommendation: 'Analyzing trading setup',
    get_ohlc_data: 'Fetching chart data',
    kraken_api: 'Querying Kraken API',
    calculate_tax: 'Calculating tax',
    analyze_trades: 'Analyzing trades',
    get_ledger: 'Reading ledger',
    get_balance: 'Checking balance',
    generate_ai_report: 'Generating AI analysis',
    get_reports: 'Fetching reports',
    get_current_setup: 'Analyzing entry checklist',
    analyze_position: 'Analyzing position',
  };

  // Collapsed view - just the input button to expand
  if (!isExpanded && messages.length === 0) {
    return (
      <div className="border-t border-primary mt-4 pt-4">
        <button
          onClick={() => {
            setIsExpanded(true);
            setTimeout(() => inputRef.current?.focus(), 100);
          }}
          className="w-full py-3 px-4 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          {title}
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-primary mt-4 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-purple-400 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          {title}
        </h4>
        {messages.length > 0 && (
          <button
            onClick={() => {
              setMessages([]);
              setConversationId(null);
            }}
            className="text-xs text-tertiary hover:text-secondary transition-colors"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      {messages.length > 0 && (
        <div
          className="space-y-3 overflow-y-auto mb-3 pr-1"
          style={{ maxHeight }}
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`text-sm ${
                msg.role === 'user' ? 'text-right' : 'text-left'
              }`}
            >
              <div
                className={`inline-block max-w-[85%] px-3 py-2 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-purple-600/30 text-white rounded-br-sm'
                    : 'bg-tertiary/50 rounded-bl-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  <span>{msg.content}</span>
                ) : (
                  <div className="chat-markdown-inline">
                    <MarkdownRenderer content={msg.content} className="text-sm" />
                    {msg.isStreaming && (
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current animate-pulse" />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Tool call indicator */}
          {currentToolCall && (
            <div className="flex items-center gap-2 text-xs text-tertiary">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>{toolNames[currentToolCall] || currentToolCall}...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isStreaming}
          className="flex-1 px-3 py-2 bg-tertiary border border-primary rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {isStreaming ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}

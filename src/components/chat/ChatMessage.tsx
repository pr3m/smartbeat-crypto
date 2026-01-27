/**
 * Single Chat Message Component
 * Renders user, assistant, and tool messages with markdown support
 */

'use client';

import { useMemo, useState } from 'react';
import type { ChatMessageData, ToolCall } from '@/stores/chatStore';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatMessageProps {
  message: ChatMessageData;
  onResend?: (content: string) => void;
}

function ToolCallIndicator({ toolCall }: { toolCall: ToolCall }) {
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
    generate_ai_report: 'Generating AI analysis report',
    get_reports: 'Fetching saved reports',
    get_current_setup: 'Analyzing entry checklist',
    analyze_position: 'Analyzing position',
  };

  const displayName = toolNames[toolCall.name] || `Running ${toolCall.name}`;

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs bg-tertiary rounded-lg border border-primary">
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
      <span className="text-secondary">{displayName}...</span>
    </div>
  );
}

function ToolResultDisplay({ toolCall }: { toolCall: ToolCall }) {
  if (!toolCall.result) return null;

  // Try to parse as JSON for better display
  let display: string;
  try {
    const parsed = JSON.parse(toolCall.result);
    if (Array.isArray(parsed)) {
      display = `Found ${parsed.length} results`;
    } else if (typeof parsed === 'object' && parsed !== null) {
      display = 'Data retrieved';
    } else {
      display = String(parsed).slice(0, 100);
    }
  } catch {
    display = toolCall.result.slice(0, 100);
  }

  return (
    <div className="text-xs text-tertiary mt-1 flex items-center gap-1">
      <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      <span>{display}</span>
    </div>
  );
}

export function ChatMessage({ message, onResend }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isTool = message.role === 'tool';
  const [copied, setCopied] = useState(false);

  const formattedTime = useMemo(() => {
    const date = new Date(message.createdAt);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [message.createdAt]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleResend = () => {
    if (onResend) {
      onResend(message.content);
    } else {
      // Dispatch resend event with messageId - ChatPanel will delete subsequent messages
      window.dispatchEvent(
        new CustomEvent('chat:resend', {
          detail: { messageId: message.id, content: message.content }
        })
      );
    }
  };

  // Tool messages are shown inline within assistant messages
  if (isTool) return null;

  // System messages (like agent alerts)
  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="px-4 py-2 bg-tertiary border border-primary rounded-lg text-xs text-secondary max-w-[90%]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
    >
      {/* Action buttons - show on hover (left side for AI, right side for user) */}
      {!isUser && (
        <div className="flex flex-col justify-center mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="p-1.5 text-tertiary hover:text-secondary hover:bg-tertiary rounded transition-colors"
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? (
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
        </div>
      )}

      <div
        className={`max-w-[85%] ${
          isUser
            ? 'bg-gradient-to-br from-purple-600/80 to-blue-600/80 text-white rounded-2xl rounded-br-sm'
            : 'bg-secondary border border-primary rounded-2xl rounded-bl-sm'
        } px-4 py-3`}
      >
        {/* Tool calls in progress */}
        {message.toolCalls && message.toolCalls.length > 0 && !message.toolCalls[0].result && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallIndicator key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Message content */}
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap text-white">
            {message.content}
          </div>
        ) : (
          <div className="text-sm">
            <MarkdownRenderer content={message.content} className="chat-markdown" />
            {message.isStreaming && (
              <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
            )}
          </div>
        )}

        {/* Completed tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && message.toolCalls[0].result && (
          <div className="mt-2 pt-2 border-t border-primary space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolResultDisplay key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`text-xs mt-1 ${
            isUser ? 'text-white/60' : 'text-tertiary'
          }`}
        >
          {formattedTime}
        </div>
      </div>

      {/* Action buttons for user messages (right side) */}
      {isUser && (
        <div className="flex flex-col justify-center ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="p-1.5 text-tertiary hover:text-secondary hover:bg-tertiary rounded transition-colors"
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? (
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
          <button
            onClick={handleResend}
            className="p-1.5 text-tertiary hover:text-secondary hover:bg-tertiary rounded transition-colors"
            title="Resend message"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

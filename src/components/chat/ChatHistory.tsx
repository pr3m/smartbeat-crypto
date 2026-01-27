/**
 * Chat History Sidebar
 * Shows list of past conversations
 */

'use client';

import { useEffect, useCallback } from 'react';
import { useChatStore, type ConversationSummary } from '@/stores/chatStore';

export function ChatHistory() {
  const {
    conversations,
    conversationsLoading,
    currentConversationId,
    setCurrentConversation,
    setConversations,
    setConversationsLoading,
    setMessages,
    setMessagesLoading,
    clearMessages,
  } = useChatStore();

  // Fetch conversations on mount
  useEffect(() => {
    const fetchConversations = async () => {
      setConversationsLoading(true);
      try {
        const res = await fetch('/api/ai/conversations');
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch (err) {
        console.error('Failed to fetch conversations:', err);
      } finally {
        setConversationsLoading(false);
      }
    };

    fetchConversations();
  }, [setConversations, setConversationsLoading]);

  const handleSelectConversation = useCallback(
    async (conversation: ConversationSummary) => {
      if (conversation.id === currentConversationId) return;

      setCurrentConversation(conversation.id);
      setMessagesLoading(true);

      try {
        const res = await fetch(`/api/ai/conversations/${conversation.id}/messages`);
        if (res.ok) {
          const data = await res.json();
          setMessages(
            data.messages.map((m: Record<string, unknown>) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls ? JSON.parse(m.toolCalls as string) : undefined,
              toolCallId: m.toolCallId,
              name: m.name,
              createdAt: new Date(m.createdAt as string),
            }))
          );
        }
      } catch (err) {
        console.error('Failed to fetch messages:', err);
      } finally {
        setMessagesLoading(false);
      }
    },
    [currentConversationId, setCurrentConversation, setMessages, setMessagesLoading]
  );

  const handleNewConversation = useCallback(() => {
    setCurrentConversation(null);
    clearMessages();
  }, [setCurrentConversation, clearMessages]);

  const handleDeleteConversation = useCallback(
    async (e: React.MouseEvent, conversationId: string) => {
      e.stopPropagation();

      try {
        const res = await fetch(`/api/ai/conversations/${conversationId}`, {
          method: 'DELETE',
        });

        if (res.ok) {
          setConversations(conversations.filter((c) => c.id !== conversationId));
          if (currentConversationId === conversationId) {
            setCurrentConversation(null);
            clearMessages();
          }
        }
      } catch (err) {
        console.error('Failed to delete conversation:', err);
      }
    },
    [conversations, currentConversationId, setConversations, setCurrentConversation, clearMessages]
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="h-full flex flex-col bg-secondary">
      {/* Header */}
      <div className="p-4 border-b border-primary">
        <button
          onClick={handleNewConversation}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-tertiary hover:bg-primary border border-primary rounded-lg transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto">
        {conversationsLoading ? (
          <div className="p-4 text-center text-secondary text-sm">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-center text-tertiary text-sm">No conversations yet</div>
        ) : (
          <div className="p-2 space-y-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv)}
                className={`w-full group flex items-start justify-between p-3 rounded-lg text-left transition-colors ${
                  currentConversationId === conv.id
                    ? 'bg-tertiary border border-info/30'
                    : 'hover:bg-tertiary border border-transparent'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {conv.title || 'New conversation'}
                  </p>
                  <p className="text-xs text-tertiary mt-0.5">
                    {formatDate(conv.updatedAt)} · {conv.messageCount} messages
                  </p>
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => handleDeleteConversation(e, conv.id)}
                  className="flex-shrink-0 ml-2 p-1 text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete conversation"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Context indicator */}
      <div className="p-4 border-t border-primary">
        <ContextBadge />
      </div>
    </div>
  );
}

function ContextBadge() {
  const { currentContext } = useChatStore();

  const contextInfo = {
    general: { label: 'General', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    trading: { label: 'Trading', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
    tax: { label: 'Tax', icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
    transactions: { label: 'Transactions', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  };

  const info = contextInfo[currentContext];

  return (
    <div className="flex items-center gap-2 text-xs text-secondary">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={info.icon} />
      </svg>
      <span>Context: {info.label}</span>
    </div>
  );
}

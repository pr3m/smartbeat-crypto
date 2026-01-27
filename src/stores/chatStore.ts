/**
 * Chat Store
 * Zustand store for managing chat state
 */

import { create } from 'zustand';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  createdAt: Date;
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  context: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  // UI state
  isOpen: boolean;
  isHistoryOpen: boolean;

  // Conversation state
  currentConversationId: string | null;
  conversations: ConversationSummary[];
  conversationsLoading: boolean;

  // Messages
  messages: ChatMessageData[];
  messagesLoading: boolean;

  // Streaming state
  isStreaming: boolean;
  currentToolCall: string | null; // Shows what tool is being executed

  // Context (current view)
  currentContext: 'general' | 'trading' | 'tax' | 'transactions';

  // Actions
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  toggleHistory: () => void;

  setCurrentConversation: (id: string | null) => void;
  setConversations: (conversations: ConversationSummary[]) => void;
  setConversationsLoading: (loading: boolean) => void;

  setMessages: (messages: ChatMessageData[]) => void;
  setMessagesLoading: (loading: boolean) => void;
  addMessage: (message: Omit<ChatMessageData, 'id' | 'createdAt'>) => void;
  appendToLastMessage: (content: string) => void;
  updateLastMessageToolCalls: (toolCalls: ToolCall[]) => void;
  finishLastMessage: () => void;
  deleteMessagesAfter: (messageId: string) => void;
  clearMessages: () => void;

  setStreaming: (streaming: boolean) => void;
  setCurrentToolCall: (toolName: string | null) => void;

  setContext: (context: 'general' | 'trading' | 'tax' | 'transactions') => void;

  // Agent alerts
  agentAlerts: AgentAlert[];
  addAgentAlert: (alert: Omit<AgentAlert, 'id' | 'createdAt' | 'dismissed'>) => void;
  dismissAlert: (id: string) => void;
  clearAlerts: () => void;
}

export interface AgentAlert {
  id: string;
  positionId: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  dismissed: boolean;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const useChatStore = create<ChatState>((set) => ({
  // Initial state
  isOpen: false,
  isHistoryOpen: false,
  currentConversationId: null,
  conversations: [],
  conversationsLoading: false,
  messages: [],
  messagesLoading: false,
  isStreaming: false,
  currentToolCall: null,
  currentContext: 'general',
  agentAlerts: [],

  // Actions
  openChat: () => set({ isOpen: true }),
  closeChat: () => set({ isOpen: false }),
  toggleChat: () => set((state) => ({ isOpen: !state.isOpen })),
  toggleHistory: () => set((state) => ({ isHistoryOpen: !state.isHistoryOpen })),

  setCurrentConversation: (id) => set({ currentConversationId: id }),
  setConversations: (conversations) => set({ conversations }),
  setConversationsLoading: (loading) => set({ conversationsLoading: loading }),

  setMessages: (messages) => set({ messages }),
  setMessagesLoading: (loading) => set({ messagesLoading: loading }),

  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: generateId(),
          createdAt: new Date(),
        },
      ],
    })),

  appendToLastMessage: (content) =>
    set((state) => {
      const messages = [...state.messages];
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        messages[lastIdx] = {
          ...messages[lastIdx],
          content: messages[lastIdx].content + content,
        };
      }
      return { messages };
    }),

  updateLastMessageToolCalls: (toolCalls) =>
    set((state) => {
      const messages = [...state.messages];
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        messages[lastIdx] = {
          ...messages[lastIdx],
          toolCalls,
        };
      }
      return { messages };
    }),

  finishLastMessage: () =>
    set((state) => {
      const messages = [...state.messages];
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx].isStreaming) {
        messages[lastIdx] = {
          ...messages[lastIdx],
          isStreaming: false,
        };
      }
      return { messages };
    }),

  deleteMessagesAfter: (messageId) =>
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;
      return { messages: state.messages.slice(0, idx + 1) };
    }),

  clearMessages: () => set({ messages: [] }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setCurrentToolCall: (toolName) => set({ currentToolCall: toolName }),

  setContext: (context) => set({ currentContext: context }),

  // Agent alerts
  addAgentAlert: (alert) =>
    set((state) => ({
      agentAlerts: [
        ...state.agentAlerts,
        {
          ...alert,
          id: generateId(),
          createdAt: new Date(),
          dismissed: false,
        },
      ],
    })),

  dismissAlert: (id) =>
    set((state) => ({
      agentAlerts: state.agentAlerts.map((a) =>
        a.id === id ? { ...a, dismissed: true } : a
      ),
    })),

  clearAlerts: () => set({ agentAlerts: [] }),
}));

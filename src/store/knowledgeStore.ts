import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ title: string; articleId: number }>;
  timestamp: number;
}

interface KnowledgeStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  appendToLastAssistant: (content: string) => void;
  setSourcesForLastAssistant: (sources: Array<{ title: string; articleId: number }>) => void;
  setStreaming: (v: boolean) => void;
  clearMessages: () => void;
  selectedMode: 'personal_assistant' | 'content_creation' | 'information_filtering';
  setSelectedMode: (mode: 'personal_assistant' | 'content_creation' | 'information_filtering') => void;
}

export const useKnowledgeStore = create<KnowledgeStore>()(
  persist(
    (set, get) => ({
      messages: [],
      isStreaming: false,
      selectedMode: 'personal_assistant',

      addMessage: (msg) => set((state) => ({
        messages: [...state.messages, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }],
      })),

      appendToLastAssistant: (content) => set((state) => {
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: last.content + content };
        }
        return { messages: msgs };
      }),

      setSourcesForLastAssistant: (sources) => set((state) => {
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, sources };
        }
        return { messages: msgs };
      }),

      setStreaming: (v) => set({ isStreaming: v }),
      clearMessages: () => set({ messages: [] }),
      setSelectedMode: (mode) => set({ selectedMode: mode }),
    }),
    {
      name: 'feedfuse.knowledge.v1',
      partialize: (state) => ({ messages: state.messages, selectedMode: state.selectedMode }),
    },
  ),
);
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface UseArticleAiChatReturn {
  messages: Message[];
  input: string;
  setInput: (val: string) => void;
  loading: boolean;
  sendMessage: () => Promise<void>;
  clearHistory: () => void;
}

function getStorageKey(articleId: number): string {
  return `ai-chat-${articleId}`;
}

function loadMessages(articleId: number): Message[] {
  try {
    const raw = localStorage.getItem(getStorageKey(articleId));
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(articleId: number, messages: Message[]): void {
  try {
    localStorage.setItem(getStorageKey(articleId), JSON.stringify(messages));
  } catch {
    /* storage full or unavailable */
  }
}

export function useArticleAiChat(articleId: number): UseArticleAiChatReturn {
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(articleId));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const articleIdRef = useRef(articleId);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(articleId, messages);
  }, [articleId, messages]);

  // Reset when articleId changes
  useEffect(() => {
    if (articleIdRef.current !== articleId) {
      articleIdRef.current = articleId;
      setMessages(loadMessages(articleId));
      setInput('');
      setLoading(false);
    }
  }, [articleId]);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || loading) return;

    // 1. Append user message
    const userMessage: Message = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    // 2. Create abort controller
    const controller = new AbortController();
    abortRef.current = controller;

    // 3. Add empty assistant message
    let assistantContent = '';
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/knowledge/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          mode: 'personal_assistant',
          articleId,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('请求失败');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              assistantContent += parsed.content;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: assistantContent };
                }
                return next;
              });
            }
            if (parsed.error) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = {
                    ...last,
                    content: last.content || `错误：${parsed.error}`,
                  };
                }
                return next;
              });
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && !last.content) {
          next[next.length - 1] = { ...last, content: '回答生成失败，请稍后重试' };
        }
        return next;
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, loading, articleId]);

  const clearHistory = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setLoading(false);
    try {
      localStorage.removeItem(getStorageKey(articleId));
    } catch {
      /* ignore */
    }
  }, [articleId]);

  return { messages, input, setInput, loading, sendMessage, clearHistory };
}
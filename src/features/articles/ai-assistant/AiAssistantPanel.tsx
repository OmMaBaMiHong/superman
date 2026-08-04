'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Send, X } from 'lucide-react';
import { useTranslation } from '@/i18n/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { useArticleAiChat } from './hooks/useArticleAiChat';

interface AiAssistantPanelProps {
  articleId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AiAssistantPanel({ articleId, open, onOpenChange }: AiAssistantPanelProps) {
  const { t } = useTranslation();
  const { messages, input, setInput, loading, sendMessage, clearHistory } =
    useArticleAiChat(articleId);
  const [localInput, setLocalInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync local input with hook input
  const effectiveInput = open ? localInput : input;

  // Clear history when articleId changes
  useEffect(() => {
    clearHistory();
  }, [articleId, clearHistory]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const question = localInput.trim();
    if (!question || loading) return;
    setInput(question);
    setLocalInput('');
    void sendMessage();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (question: string) => {
    if (loading) return;
    setInput(question);
    setLocalInput('');
    void sendMessage();
  };

  const lastMessage = messages[messages.length - 1];
  const showStreamingDots =
    loading && lastMessage?.role === 'assistant' && !lastMessage.content;

  const quickActions = [
    t('article.aiAssistant.summarize'),
    t('article.aiAssistant.keyPoints'),
    t('article.aiAssistant.explainTerms'),
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 z-50 flex h-full w-[400px] max-w-[90vw] flex-col border-l border-zinc-200 bg-white shadow-xl duration-300 ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right dark:border-zinc-800 dark:bg-zinc-900',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-amber-600" />
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t('article.aiAssistant.title')}
              </h2>
            </div>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !loading && (
              <div className="flex h-full items-center justify-center text-center text-sm text-zinc-400 dark:text-zinc-500">
                {t('article.aiAssistant.placeholder')}
              </div>
            )}

            {messages.map((message, idx) => (
              <MessageBubble key={idx} message={message} />
            ))}

            {showStreamingDots && (
              <div className="flex items-start gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[10px] font-bold text-white">
                  AI
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
                  <Dot className="animate-bounce [animation-delay:-0.3s]" />
                  <Dot className="animate-bounce [animation-delay:-0.15s]" />
                  <Dot className="animate-bounce" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 overflow-x-auto border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
            {quickActions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={loading}
                onClick={() => handleQuickAction(action)}
                className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
              >
                {action}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-end gap-2">
              <textarea
                value={localInput}
                onChange={(e) => setLocalInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('article.aiAssistant.placeholder')}
                rows={3}
                className="max-h-32 min-h-[80px] flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!localInput.trim() || loading}
                aria-label={t('article.aiAssistant.title')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MessageBubble({ message }: { message: import('./hooks/useArticleAiChat').Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-amber-100 px-3 py-2 text-sm text-zinc-900 dark:bg-amber-900/40 dark:text-amber-50">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[10px] font-bold text-white">
        AI
      </div>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
        {message.content}
      </div>
    </div>
  );
}

function Dot({ className }: { className?: string }) {
  return <span className={cn('h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500', className)} />;
}
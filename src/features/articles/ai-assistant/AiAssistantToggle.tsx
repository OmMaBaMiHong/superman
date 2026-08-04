'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/hooks/useTranslation';
import { useArticleAiChat } from './hooks/useArticleAiChat';
import { AiAssistantPanel } from './AiAssistantPanel';

interface AiAssistantToggleProps {
  articleId: number;
}

export function AiAssistantToggle({ articleId }: AiAssistantToggleProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const { messages } = useArticleAiChat(articleId);
  const lastSeenCountRef = useRef(0);

  // Reset unread count when panel opens
  useEffect(() => {
    if (open) {
      lastSeenCountRef.current = messages.length;
    }
  }, [open, messages.length]);

  const unreadCount = open ? 0 : Math.max(0, messages.length - lastSeenCountRef.current);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('article.aiAssistant.title')}
        className="fixed right-0 top-1/2 z-30 flex h-14 w-10 -translate-y-1/2 items-center justify-center rounded-l-lg bg-amber-600 text-white shadow-lg transition-colors hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
        style={{ borderRadius: '8px 0 0 8px' }}
      >
        <Bot className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AiAssistantPanel
        articleId={articleId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
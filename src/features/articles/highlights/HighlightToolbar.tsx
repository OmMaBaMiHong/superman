'use client';

import { useCallback, useRef } from 'react';
import { Highlighter } from 'lucide-react';
import type { HighlightColor } from '@/types';
import { useTranslation } from '@/i18n/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { useHighlightStore } from './hooks/useHighlightStore';
import { serializeRange } from './utils/rangeSerializer';
import type { ToolbarPosition } from './hooks/useHighlightSelection';

const COLOR_OPTIONS: Array<{
  color: HighlightColor;
  className: string;
}> = [
  { color: 'yellow', className: 'text-yellow-500 hover:bg-yellow-500/20 data-[active=true]:bg-yellow-500/25' },
  { color: 'green', className: 'text-green-500 hover:bg-green-500/20 data-[active=true]:bg-green-500/25' },
  { color: 'blue', className: 'text-blue-500 hover:bg-blue-500/20 data-[active=true]:bg-blue-500/25' },
  { color: 'pink', className: 'text-pink-500 hover:bg-pink-500/20 data-[active=true]:bg-pink-500/25' },
  { color: 'purple', className: 'text-purple-500 hover:bg-purple-500/20 data-[active=true]:bg-purple-500/25' },
];

interface HighlightToolbarProps {
  articleId: number;
  position: ToolbarPosition;
  selectedText: string;
  containerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export default function HighlightToolbar({
  articleId,
  position,
  selectedText,
  containerRef,
  onClose,
}: HighlightToolbarProps) {
  const { t } = useTranslation();
  const addHighlight = useHighlightStore((state) => state.addHighlight);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const handleColorClick = useCallback(
    async (color: HighlightColor) => {
      const container = containerRef.current;
      if (!container) return;

      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      const serialized = serializeRange(range, container);
      if (!serialized) return;

      await addHighlight(articleId, {
        text: serialized.text,
        rangeStartSelector: serialized.rangeStartSelector,
        rangeStartOffset: serialized.rangeStartOffset,
        rangeEndSelector: serialized.rangeEndSelector,
        rangeEndOffset: serialized.rangeEndOffset,
        color,
      });

      onClose();
    },
    [articleId, containerRef, addHighlight, onClose],
  );

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t('article.actions.highlight')}
      className="absolute z-50 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border/70 bg-popover p-1.5 shadow-lg"
      style={{
        top: position.top - 44,
        left: position.left,
      }}
    >
      {COLOR_OPTIONS.map(({ color, className }) => (
        <button
          key={color}
          type="button"
          aria-label={t(`article.highlight.colors.${color}`)}
          title={t(`article.highlight.colors.${color}`)}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150',
            className,
          )}
          onClick={() => void handleColorClick(color)}
        >
          <Highlighter className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
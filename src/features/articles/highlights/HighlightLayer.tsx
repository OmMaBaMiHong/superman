'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Highlight, HighlightColor } from '@/types';
import { useTranslation } from '@/i18n/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { useHighlightStore } from './hooks/useHighlightStore';
import { restoreRange } from './utils/rangeRestorer';

const HIGHLIGHT_COLOR_CLASS: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300/40 text-inherit',
  green: 'bg-green-300/40 text-inherit',
  blue: 'bg-blue-300/40 text-inherit',
  pink: 'bg-pink-300/40 text-inherit',
  purple: 'bg-purple-300/40 text-inherit',
};

const HIGHLIGHT_DATA_ATTR = 'data-highlight-id';

interface HighlightLayerProps {
  articleId: number;
  rootRef: React.RefObject<HTMLElement | null>;
}

export default function HighlightLayer({ articleId, rootRef }: HighlightLayerProps) {
  const { t } = useTranslation();
  const highlights = useHighlightStore((state) => state.highlights);
  const loadHighlights = useHighlightStore((state) => state.loadHighlights);
  const removeHighlight = useHighlightStore((state) => state.removeHighlight);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);

  // Load highlights on mount
  useEffect(() => {
    void loadHighlights(articleId);
  }, [articleId, loadHighlights]);

  // Apply highlights to the DOM
  const applyHighlights = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    // Remove all existing highlight marks
    const existingMarks = root.querySelectorAll<HTMLElement>(`mark[${HIGHLIGHT_DATA_ATTR}]`);
    for (const mark of existingMarks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      const textNode = document.createTextNode(mark.textContent ?? '');
      parent.replaceChild(textNode, mark);
      parent.normalize();
    }

    // Apply each highlight
    for (const highlight of highlights) {
      const range = restoreRange(highlight, root);
      if (!range) continue;

      try {
        const mark = document.createElement('mark');
        mark.setAttribute(HIGHLIGHT_DATA_ATTR, highlight.id);
        mark.className = cn(
          'cursor-pointer rounded-sm transition-colors duration-150',
          HIGHLIGHT_COLOR_CLASS[highlight.color],
        );

        range.surroundContents(mark);
      } catch {
        // surroundContents may fail if the range spans across element boundaries
        // In that case, skip this highlight
        continue;
      }
    }
  }, [highlights, rootRef]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  // Handle click on highlight marks
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const mark = target?.closest?.<HTMLElement>(`mark[${HIGHLIGHT_DATA_ATTR}]`);
      if (!mark) {
        setSelectedHighlightId(null);
        return;
      }

      const highlightId = mark.getAttribute(HIGHLIGHT_DATA_ATTR);
      if (highlightId) {
        event.stopPropagation();
        setSelectedHighlightId((current) =>
          current === highlightId ? null : highlightId,
        );
      }
    };

    root.addEventListener('click', handleClick);
    return () => {
      root.removeEventListener('click', handleClick);
    };
  }, [rootRef]);

  const handleDelete = useCallback(
    (highlightId: string) => {
      void removeHighlight(highlightId);
      setSelectedHighlightId(null);
    },
    [removeHighlight],
  );

  const selectedHighlight = highlights.find((h) => h.id === selectedHighlightId);

  // Render popover for the selected highlight
  return (
    <>
      {selectedHighlight && selectedHighlightId ? (
        <HighlightPopover
          highlight={selectedHighlight}
          rootRef={rootRef}
          onDelete={handleDelete}
          onClose={() => setSelectedHighlightId(null)}
          t={t}
        />
      ) : null}
    </>
  );
}

interface HighlightPopoverProps {
  highlight: Highlight;
  rootRef: React.RefObject<HTMLElement | null>;
  onDelete: (id: string) => void;
  onClose: () => void;
  t: (key: string) => string;
}

const HighlightPopover = ({
  highlight,
  rootRef,
  onDelete,
  onClose,
  t,
}: HighlightPopoverProps) => {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Position the popover near the highlight mark
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mark = root.querySelector<HTMLElement>(
      `mark[${HIGHLIGHT_DATA_ATTR}="${highlight.id}"]`,
    );
    if (!mark || !popoverRef.current) return;

    const markRect = mark.getBoundingClientRect();
    const popover = popoverRef.current;

    popover.style.top = `${markRect.top - 8}px`;
    popover.style.left = `${markRect.left + markRect.width / 2}px`;
  }, [highlight.id, rootRef]);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(`mark[${HIGHLIGHT_DATA_ATTR}]`)) return;
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 -translate-x-1/2 -translate-y-full"
    >
      <div className="rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('article.highlight.deleteHighlight')}
          </span>
          <button
            type="button"
            aria-label={t('article.highlight.deleteHighlight')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            onClick={() => onDelete(highlight.id)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
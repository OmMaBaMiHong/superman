import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToolbarPosition {
  top: number;
  left: number;
}

interface UseHighlightSelectionResult {
  showToolbar: boolean;
  toolbarPosition: ToolbarPosition;
  selectedText: string;
  clearSelection: () => void;
}

export function useHighlightSelection(
  containerRef: React.RefObject<HTMLElement | null>,
): UseHighlightSelectionResult {
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState('');
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setShowToolbar(false);
    setSelectedText('');
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setShowToolbar(false);
        setSelectedText('');
        return;
      }

      const range = selection.getRangeAt(0);
      const text = selection.toString().trim();
      if (!text) {
        setShowToolbar(false);
        setSelectedText('');
        return;
      }

      // Only handle selections within the container
      if (!container.contains(range.commonAncestorContainer)) {
        setShowToolbar(false);
        setSelectedText('');
        return;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      setToolbarPosition({
        top: rect.top - containerRect.top - 8,
        left: rect.left - containerRect.left + rect.width / 2,
      });
      setSelectedText(text);
      setShowToolbar(true);
    };

    const handleMouseDown = () => {
      // Delay hiding so the toolbar's own click events can fire first
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setShowToolbar(false);
        setSelectedText('');
      }, 200);
    };

    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mousedown', handleMouseDown);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mousedown', handleMouseDown);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [containerRef]);

  return { showToolbar, toolbarPosition, selectedText, clearSelection };
}
import { create } from 'zustand';
import type { Highlight, HighlightColor } from '@/types';
import {
  createHighlight,
  deleteHighlight,
  getArticleHighlights,
  updateHighlight,
} from '@/lib/api/apiClient';

export interface CreateHighlightParams {
  text: string;
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  color: HighlightColor;
  note?: string | null;
}

export interface UpdateHighlightParams {
  color?: HighlightColor;
  note?: string | null;
}

interface HighlightStore {
  highlights: Highlight[];
  loading: boolean;
  loadHighlights: (articleId: number) => Promise<void>;
  addHighlight: (articleId: number, params: CreateHighlightParams) => Promise<Highlight | null>;
  editHighlight: (highlightId: string, updates: UpdateHighlightParams) => Promise<void>;
  removeHighlight: (highlightId: string) => Promise<void>;
}

export const useHighlightStore = create<HighlightStore>()((set) => ({
  highlights: [],
  loading: false,

  loadHighlights: async (articleId: number) => {
    set({ loading: true });
    try {
      const highlights = await getArticleHighlights(articleId);
      set({ highlights, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addHighlight: async (articleId: number, params: CreateHighlightParams) => {
    try {
      const highlight = await createHighlight(articleId, params);
      set((state) => ({ highlights: [highlight, ...state.highlights] }));
      return highlight;
    } catch {
      return null;
    }
  },

  editHighlight: async (highlightId: string, updates: UpdateHighlightParams) => {
    try {
      const updated = await updateHighlight(highlightId, updates);
      set((state) => ({
        highlights: state.highlights.map((item) =>
          item.id === highlightId ? updated : item,
        ),
      }));
    } catch {
      // Swallow; callers can rely on the optimistic state unchanged.
    }
  },

  removeHighlight: async (highlightId: string) => {
    try {
      await deleteHighlight(highlightId);
      set((state) => ({
        highlights: state.highlights.filter((item) => item.id !== highlightId),
      }));
    } catch {
      // Swallow; the highlight remains in the list for retry.
    }
  },
}));

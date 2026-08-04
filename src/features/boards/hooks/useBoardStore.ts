import { create } from 'zustand';
import type { Board, BoardItem } from '@/types';
import * as api from '@/lib/api/apiClient';

interface BoardStore {
  boards: Board[];
  loading: boolean;
  activeBoardId: string | null;
  boardItems: BoardItem[];
  loadBoards: () => Promise<void>;
  createBoard: (title: string, description?: string, icon?: string) => Promise<Board | null>;
  deleteBoard: (boardId: string) => Promise<void>;
  setActiveBoard: (boardId: string | null) => void;
  loadBoardItems: (boardId: string) => Promise<void>;
  addArticle: (boardId: string, articleId: number) => Promise<void>;
  removeArticle: (boardId: string, articleId: number) => Promise<void>;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  boards: [],
  loading: false,
  activeBoardId: null,
  boardItems: [],

  loadBoards: async () => {
    set({ loading: true });
    try {
      const boards = await api.getBoards();
      set({ boards, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createBoard: async (title, description, icon) => {
    try {
      const board = await api.createBoard(title, { description, icon });
      set((state) => ({ boards: [...state.boards, board] }));
      return board;
    } catch {
      return null;
    }
  },

  deleteBoard: async (boardId) => {
    try {
      await api.deleteBoard(boardId);
      set((state) => ({
        boards: state.boards.filter((b) => b.id !== boardId),
        activeBoardId: state.activeBoardId === boardId ? null : state.activeBoardId,
        boardItems: state.activeBoardId === boardId ? [] : state.boardItems,
      }));
    } catch {
      // error handled by api client
    }
  },

  setActiveBoard: (boardId) => {
    set({ activeBoardId: boardId });
    if (boardId) {
      get().loadBoardItems(boardId);
    } else {
      set({ boardItems: [] });
    }
  },

  loadBoardItems: async (boardId) => {
    try {
      const boardItems = await api.getBoardItems(boardId);
      set({ boardItems });
    } catch {
      // error handled by api client
    }
  },

  addArticle: async (boardId, articleId) => {
    try {
      await api.addArticleToBoard(boardId, articleId);
      if (get().activeBoardId === boardId) {
        get().loadBoardItems(boardId);
      }
    } catch {
      // error handled by api client
    }
  },

  removeArticle: async (boardId, articleId) => {
    try {
      await api.removeArticleFromBoard(boardId, articleId);
      if (get().activeBoardId === boardId) {
        get().loadBoardItems(boardId);
      }
    } catch {
      // error handled by api client
    }
  },
}));
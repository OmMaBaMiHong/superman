import { create } from 'zustand';
import type { Tag } from '@/types';
import {
  addTagsToArticle,
  createTag,
  deleteTag,
  getArticleTags,
  getTags,
  removeTagFromArticle,
} from '@/lib/api/apiClient';

interface TagStore {
  tags: Tag[];
  articleTags: Tag[];
  loading: boolean;
  loadTags: () => Promise<void>;
  loadArticleTags: (articleId: number) => Promise<void>;
  addTag: (name: string, color?: string) => Promise<Tag | null>;
  removeTag: (tagId: string) => Promise<void>;
  attachTags: (articleId: number, tagIds: string[]) => Promise<void>;
  detachTag: (articleId: number, tagId: string) => Promise<void>;
}

export const useTagStore = create<TagStore>((set) => ({
  tags: [],
  articleTags: [],
  loading: false,

  loadTags: async () => {
    set({ loading: true });
    try {
      const tags = await getTags();
      set({ tags });
    } catch {
      // 错误已由 apiClient 统一提示，此处仅恢复 loading 状态。
    } finally {
      set({ loading: false });
    }
  },

  loadArticleTags: async (articleId) => {
    try {
      const articleTags = await getArticleTags(articleId);
      set({ articleTags });
    } catch {
      // 错误已由 apiClient 统一提示。
    }
  },

  addTag: async (name, color) => {
    try {
      const tag = await createTag(name, color);
      set((state) => ({ tags: [...state.tags, tag] }));
      return tag;
    } catch {
      return null;
    }
  },

  removeTag: async (tagId) => {
    try {
      await deleteTag(tagId);
      set((state) => ({ tags: state.tags.filter((tag) => tag.id !== tagId) }));
    } catch {
      // 错误已由 apiClient 统一提示。
    }
  },

  attachTags: async (articleId, tagIds) => {
    try {
      await addTagsToArticle(articleId, tagIds);
      const articleTags = await getArticleTags(articleId);
      set({ articleTags });
    } catch {
      // 错误已由 apiClient 统一提示。
    }
  },

  detachTag: async (articleId, tagId) => {
    try {
      await removeTagFromArticle(articleId, tagId);
      set((state) => ({
        articleTags: state.articleTags.filter((tag) => tag.id !== tagId),
      }));
    } catch {
      // 错误已由 apiClient 统一提示。
    }
  },
}));

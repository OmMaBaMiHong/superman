import type { Pool, PoolClient } from 'pg';
import type { FeedContentView } from '@/types';
import {
  createCategory,
  deleteCategory,
  findCategoryByNormalizedName,
  getCategoryById,
  getNextCategoryPosition,
} from '@/server/domains/feeds/repositories/categoriesRepo';
import {
  countFeedsByCategoryId,
  createFeed,
  deleteFeed,
  getFeedCategoryAssignment,
  type FeedRow,
  updateFeed,
} from '@/server/domains/feeds/repositories/feedsRepo';
import { deleteFeedFaviconCache } from '@/server/domains/feeds/repositories/feedFaviconsRepo';
import { buildFeedFaviconPath } from '@/server/integrations/rss/feedFaviconUrl';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { ValidationError } from '@/server/infra/http/errors';

interface CategoryResolutionInput {
  categoryId?: string | null;
  categoryName?: string | null;
  userId?: string;
}

export interface CreateFeedWithCategoryInput extends CategoryResolutionInput {
  title: string;
  url: string;
  siteUrl?: string | null;
  iconUrl?: string | null;
  enabled?: boolean;
  fullTextOnOpenEnabled?: boolean;
  fullTextOnFetchEnabled?: boolean;
  aiSummaryOnOpenEnabled?: boolean;
  aiSummaryOnFetchEnabled?: boolean;
  bodyTranslateOnFetchEnabled?: boolean;
  bodyTranslateOnOpenEnabled?: boolean;
  titleTranslateEnabled?: boolean;
  bodyTranslateEnabled?: boolean;
  articleListDisplayMode?: 'card' | 'list';
  view?: FeedContentView;
  fetchIntervalMinutes?: number;
}

export interface UpdateFeedWithCategoryInput extends CategoryResolutionInput {
  title?: string;
  url?: string;
  siteUrl?: string | null;
  iconUrl?: string | null;
  enabled?: boolean;
  fullTextOnOpenEnabled?: boolean;
  fullTextOnFetchEnabled?: boolean;
  aiSummaryOnOpenEnabled?: boolean;
  aiSummaryOnFetchEnabled?: boolean;
  bodyTranslateOnFetchEnabled?: boolean;
  bodyTranslateOnOpenEnabled?: boolean;
  titleTranslateEnabled?: boolean;
  bodyTranslateEnabled?: boolean;
  articleListDisplayMode?: 'card' | 'list';
  view?: FeedContentView;
  fetchIntervalMinutes?: number;
}

function hasCategoryInput(input: CategoryResolutionInput): boolean {
  return typeof input.categoryId !== 'undefined' || typeof input.categoryName !== 'undefined';
}

function normalizeCategoryName(name: string | null | undefined): string | null {
  const normalized = name?.trim() ?? '';
  if (!normalized || normalized === '未分类') return null;
  return normalized;
}

async function resolveCategoryId(
  client: PoolClient,
  input: CategoryResolutionInput,
): Promise<string | null> {
  const userId = normalizeUserId(input.userId);
  if (typeof input.categoryId !== 'undefined') {
    if (input.categoryId === null) {
      return null;
    }

    // 显式 categoryId 必须属于当前用户，避免跨账号绑定其他用户的分类。
    const category = await getCategoryById(client, input.categoryId, userId);
    if (!category) {
      throw new ValidationError('Invalid request body', { categoryId: 'not_found' });
    }
    return category.id;
  }

  const normalizedName = normalizeCategoryName(input.categoryName);
  if (!normalizedName) return null;

  const existing = await findCategoryByNormalizedName(client, normalizedName, userId);
  if (existing) return existing.id;

  const position = await getNextCategoryPosition(client, userId);
  const created = await createCategory(client, { name: normalizedName, position, userId });
  return created.id;
}

async function cleanupCategoryIfEmpty(
  client: PoolClient,
  categoryId: string | null | undefined,
  userId?: string,
): Promise<void> {
  if (!categoryId) return;

  const remainingCount = await countFeedsByCategoryId(client, categoryId, userId);
  if (remainingCount === 0) {
    await deleteCategory(client, categoryId, userId);
  }
}

export async function createFeedWithCategoryResolution(
  pool: Pool,
  input: CreateFeedWithCategoryInput,
): Promise<FeedRow> {
  const userId = normalizeUserId(input.userId);
  const client = await pool.connect();
  try {
    await client.query('begin');

    const resolvedCategoryId = await resolveCategoryId(client, { ...input, userId });
    const created = await createFeed(client, {
      ...input,
      userId,
      categoryId: resolvedCategoryId,
    });

    const nextCreated =
      created.siteUrl && created.kind === 'rss'
        ? await updateFeed(client, created.id, { iconUrl: buildFeedFaviconPath(created.id), userId })
        : created;

    await client.query('commit');
    return nextCreated ?? created;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateFeedWithCategoryResolution(
  pool: Pool,
  id: string,
  input: UpdateFeedWithCategoryInput,
): Promise<FeedRow | null> {
  const userId = normalizeUserId(input.userId);
  const client = await pool.connect();
  try {
    await client.query('begin');

    const existing = await getFeedCategoryAssignment(client, id, userId);
    if (!existing) {
      await client.query('commit');
      return null;
    }

    const nextInput = { ...input } as UpdateFeedWithCategoryInput & {
      categoryId?: string | null;
    };

    if (hasCategoryInput(input)) {
      nextInput.categoryId = await resolveCategoryId(client, { ...input, userId });
    }

    if (typeof input.siteUrl !== 'undefined') {
      nextInput.iconUrl = input.siteUrl ? buildFeedFaviconPath(id) : null;
    }

    const updated = await updateFeed(client, id, { ...nextInput, userId });
    if (!updated) {
      await client.query('commit');
      return null;
    }

    if (existing.categoryId !== updated.categoryId) {
      await cleanupCategoryIfEmpty(client, existing.categoryId, userId);
    }

    if (typeof input.siteUrl !== 'undefined' && existing.siteUrl !== updated.siteUrl) {
      await deleteFeedFaviconCache(client, id, userId);
    }

    await client.query('commit');
    return updated;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteFeedAndCleanupCategory(
  pool: Pool,
  id: string,
  userId?: string,
): Promise<boolean> {
  const scopedUserId = normalizeUserId(userId);
  const client = await pool.connect();
  try {
    await client.query('begin');

    const existing = await getFeedCategoryAssignment(client, id, scopedUserId);
    if (!existing) {
      await client.query('commit');
      return false;
    }

    const deleted = await deleteFeed(client, id, scopedUserId);
    if (!deleted) {
      await client.query('commit');
      return false;
    }

    await cleanupCategoryIfEmpty(client, existing.categoryId, scopedUserId);
    await client.query('commit');
    return true;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

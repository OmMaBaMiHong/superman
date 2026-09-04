import type { Pool } from 'pg';
import { GITHUB_ICON_URL } from '@/lib/feeds/feedIcons';
import { resolveEffectiveIntervalMinutes } from '@/server/integrations/github/githubRateLimit';
import { getRepository } from '@/server/integrations/github/githubClient';
import { parseRepoInput } from '@/server/integrations/github/githubResourceMapper';
import {
  createCategory,
  deleteCategory,
  findCategoryByNormalizedName,
  getCategoryById,
  getNextCategoryPosition,
} from '@/server/domains/feeds/repositories/categoriesRepo';
import {
  createGithubFeed,
  getFeedCategoryAssignment,
  updateFeed,
} from '@/server/domains/feeds/repositories/feedsRepo';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { ValidationError } from '@/server/infra/http/errors';
import type {
  GithubContentType,
  GithubRepoSubscription,
} from '@/server/domains/github/types';
import {
  createGithubSubscription,
  deleteGithubSubscription,
  getGithubSubscription,
  updateGithubSubscription,
} from '@/server/domains/github/repositories/githubSubscriptionsRepo';

type DbClient = Pool;

async function resolveCategoryId(
  client: DbClient,
  input: { categoryId?: string | null; categoryName?: string | null; userId?: string },
): Promise<string | null> {
  const userId = normalizeUserId(input.userId);

  if (typeof input.categoryId !== 'undefined') {
    if (input.categoryId === null) return null;
    const category = await getCategoryById(client as never, input.categoryId, userId);
    if (!category) {
      throw new ValidationError('Invalid request body', { categoryId: 'not_found' });
    }
    return category.id;
  }

  const normalized = input.categoryName?.trim();
  if (!normalized || normalized === '未分类') return null;

  const existing = await findCategoryByNormalizedName(client as never, normalized, userId);
  if (existing) return existing.id;

  const position = await getNextCategoryPosition(client as never, userId);
  const created = await createCategory(client as never, {
    name: normalized,
    position,
    userId,
  });
  return created.id;
}

async function cleanupCategoryIfEmpty(
  client: DbClient,
  categoryId: string | null | undefined,
  userId?: string,
): Promise<void> {
  if (!categoryId) return;
  const { countFeedsByCategoryId } = await import(
    '@/server/domains/feeds/repositories/categoriesRepo'
  );
  const remaining = await countFeedsByCategoryId(client as never, categoryId, userId);
  if (remaining === 0) {
    await deleteCategory(client as never, categoryId, userId);
  }
}

export interface CreateGithubSubscriptionServiceInput {
  repoInput: string;
  title?: string;
  contentTypes?: GithubContentType[];
  includePrerelease?: boolean;
  categoryId?: string | null;
  categoryName?: string | null;
  fetchIntervalMinutes: number;
  token?: string | null;
  userId?: string;
}

/**
 * 创建 GitHub 仓库订阅（事务编排：校验存在性 → 建 feed → 建订阅 → 解析分类）。
 *
 * 对标 `createAiDigestWithCategoryResolution`，但 GitHub 需要多一步「调用 GitHub API
 * 校验仓库存在性」，因此把 `getRepository` 放在事务外（只读校验），事务内只做写。
 */
export async function createGithubSubscriptionService(
  pool: Pool,
  input: CreateGithubSubscriptionServiceInput,
): Promise<GithubRepoSubscription> {
  const userId = normalizeUserId(input.userId);
  const ref = parseRepoInput(input.repoInput);

  // 1) 只读校验仓库存在性（私有仓库需 Token）
  const repoResult = await getRepository({
    owner: ref.owner,
    repo: ref.repo,
    token: input.token ?? null,
    userId,
  });
  const repository = repoResult.repository;
  if (!repository) {
    throw new ValidationError('Invalid GitHub repository', { repo: '仓库不存在或无权访问' });
  }

  const hasToken = Boolean(input.token && input.token.trim());
  const effectiveInterval = resolveEffectiveIntervalMinutes({
    intervalMinutes: input.fetchIntervalMinutes,
    hasToken,
  });

  const client = await pool.connect();
  try {
    await client.query('begin');

    const categoryId = await resolveCategoryId(client, input);

    const createdFeed = await createGithubFeed(client as never, {
      title: input.title?.trim() || repository.fullName,
      url: repository.htmlUrl,
      siteUrl: repository.htmlUrl,
      iconUrl: repository.avatarUrl ?? GITHUB_ICON_URL,
      categoryId,
      fetchIntervalMinutes: effectiveInterval,
      userId,
    });

    await createGithubSubscription(client as never, {
      feedId: createdFeed.id,
      userId,
      owner: ref.owner,
      repo: ref.repo,
      fullName: ref.fullName,
      htmlUrl: repository.htmlUrl,
      title: input.title?.trim() || repository.fullName,
      iconUrl: repository.avatarUrl ?? GITHUB_ICON_URL,
      avatarUrl: repository.avatarUrl,
      description: repository.description,
      language: repository.language,
      stargazers: repository.stargazers,
      contentTypes: input.contentTypes ?? ['release'],
      includePrerelease: input.includePrerelease ?? false,
      categoryId,
      fetchIntervalMinutes: effectiveInterval,
    });

    await client.query('commit');
    const subscription = await getGithubSubscription(pool, createdFeed.id, userId);
    if (!subscription) {
      throw new Error('Failed to read created GitHub subscription');
    }
    return subscription;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export interface UpdateGithubSubscriptionServiceInput {
  feedId: string;
  title?: string;
  contentTypes?: GithubContentType[];
  includePrerelease?: boolean;
  enabled?: boolean;
  fetchIntervalMinutes?: number;
  categoryId?: string | null;
  categoryName?: string | null;
  userId?: string;
}

export async function updateGithubSubscriptionService(
  pool: Pool,
  input: UpdateGithubSubscriptionServiceInput,
): Promise<GithubRepoSubscription | null> {
  const userId = normalizeUserId(input.userId);
  const client = await pool.connect();
  try {
    await client.query('begin');

    const existingAssignment = await getFeedCategoryAssignment(client as never, input.feedId, userId);
    if (!existingAssignment) {
      await client.query('commit');
      return null;
    }

    const nextCategoryId = await resolveCategoryId(client, input);

    const updatedFeed = await updateFeed(client as never, input.feedId, {
      title: input.title,
      enabled: input.enabled,
      categoryId: nextCategoryId,
      fetchIntervalMinutes: input.fetchIntervalMinutes,
      view: 'github',
      userId,
    });
    if (!updatedFeed) {
      await client.query('commit');
      return null;
    }

    const updatedSubscription = await updateGithubSubscription(client as never, input.feedId, {
      contentTypes: input.contentTypes,
      includePrerelease: input.includePrerelease,
      userId,
    });
    if (!updatedSubscription) {
      await client.query('rollback');
      return null;
    }

    if (existingAssignment.categoryId !== nextCategoryId) {
      await cleanupCategoryIfEmpty(client, existingAssignment.categoryId, userId);
    }

    await client.query('commit');
    return getGithubSubscription(pool, input.feedId, userId);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteGithubSubscriptionService(
  pool: Pool,
  feedId: string,
  userId?: string,
): Promise<boolean> {
  return deleteGithubSubscription(pool, feedId, userId);
}

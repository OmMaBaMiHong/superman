import type { GithubContentType, GithubRepoSubscription, GithubSyncStatus } from '@/types';

export type { GithubContentType, GithubRepoSubscription, GithubSyncStatus };

/** github_repo_subscriptions 原始行（驼峰投影前）。 */
export interface GithubSubscriptionRow {
  feedId: string;
  userId: string;
  owner: string;
  repo: string;
  repoHtmlUrl: string;
  contentTypes: string[];
  includePrerelease: boolean;
  repoDescription: string | null;
  repoLanguage: string | null;
  repoStargazers: number | null;
  repoAvatarUrl: string | null;
  releasesEtag: string | null;
  lastReleasePublishedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  nextSyncAt: string | null;
  consecutiveFailures: number;
  rateLimitedUntil: string | null;
  rateLimitRemaining: number | null;
  lastErrorCode: string | null;
  lastError: string | null;
}

/** github_article_items 原始行。 */
export interface GithubArticleItemRow {
  articleId: string;
  userId: string;
  feedId: string;
  ghType: GithubContentType;
  ghId: string;
  ghNodeId: string | null;
  ghNumber: number | null;
  tagName: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  bodyMarkdown: string | null;
  htmlUrl: string;
}

const VALID_CONTENT_TYPES: readonly GithubContentType[] = [
  'release',
  'issue',
  'pr',
  'commit',
];

/**
 * 把 DB 的 text[] 归一化为合法的 GithubContentType 数组。
 *
 * 剔除未知类型并按 `VALID_CONTENT_TYPES` 的声明顺序去重，
 * 保证 `content_types` 列的取值稳定（避免同一组类型因顺序/重复产生多种写法）。
 * 全部非法时兜底为 `['release']`。
 */
export function normalizeContentTypes(values: string[] | null | undefined): GithubContentType[] {
  if (!Array.isArray(values) || values.length === 0) {
    return ['release'];
  }

  const seen = new Set(values);
  const valid = VALID_CONTENT_TYPES.filter((type) => seen.has(type));

  return valid.length > 0 ? [...valid] : ['release'];
}

export interface CreateGithubSubscriptionInput {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  title: string;
  iconUrl?: string | null;
  avatarUrl?: string | null;
  description?: string | null;
  language?: string | null;
  stargazers?: number | null;
  contentTypes?: GithubContentType[];
  includePrerelease?: boolean;
  categoryId?: string | null;
  fetchIntervalMinutes?: number;
  userId?: string;
}

export interface UpdateGithubSubscriptionInput {
  title?: string;
  contentTypes?: GithubContentType[];
  includePrerelease?: boolean;
  enabled?: boolean;
  fetchIntervalMinutes?: number;
  categoryId?: string | null;
  userId?: string;
}

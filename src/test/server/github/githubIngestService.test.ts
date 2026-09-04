import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

vi.mock('@/server/integrations/github/githubClient', () => ({
  listReleases: vi.fn(),
  getRepository: vi.fn(),
}));

vi.mock('@/server/domains/feeds/repositories/feedsRepo', () => ({
  getFeedById: vi.fn(),
}));

vi.mock('@/server/domains/articles/repositories/articlesRepo', () => ({
  insertArticleIgnoreDuplicate: vi.fn(),
}));

vi.mock('@/server/domains/github/repositories/githubSubscriptionsRepo', () => ({
  getGithubSubscriptionRow: vi.fn(),
  recordGithubSyncResult: vi.fn(),
  recordGithubRateLimit: vi.fn(),
}));

vi.mock('@/server/domains/github/repositories/githubArticleItemsRepo', () => ({
  insertGithubArticleItem: vi.fn(),
}));

vi.mock('@/server/domains/github/services/githubTokenService', () => ({
  getGithubToken: vi.fn(),
}));

import { syncSingleRepo } from '@/server/domains/github/services/githubIngestService';
import { listReleases } from '@/server/integrations/github/githubClient';
import { getFeedById } from '@/server/domains/feeds/repositories/feedsRepo';
import { insertArticleIgnoreDuplicate } from '@/server/domains/articles/repositories/articlesRepo';
import {
  getGithubSubscriptionRow,
  recordGithubRateLimit,
  recordGithubSyncResult,
} from '@/server/domains/github/repositories/githubSubscriptionsRepo';
import { insertGithubArticleItem } from '@/server/domains/github/repositories/githubArticleItemsRepo';
import { getGithubToken } from '@/server/domains/github/services/githubTokenService';
import { GithubApiError } from '@/server/integrations/github/githubErrors';
import { EMPTY_RATE_LIMIT_SNAPSHOT } from '@/server/integrations/github/githubRateLimit';
import { NotFoundError } from '@/server/infra/http/errors';

const listReleasesMock = vi.mocked(listReleases);
const getFeedByIdMock = vi.mocked(getFeedById);
const insertArticleMock = vi.mocked(insertArticleIgnoreDuplicate);
const getSubscriptionRowMock = vi.mocked(getGithubSubscriptionRow);
const recordSyncResultMock = vi.mocked(recordGithubSyncResult);
const recordRateLimitMock = vi.mocked(recordGithubRateLimit);
const insertGithubItemMock = vi.mocked(insertGithubArticleItem);
const getGithubTokenMock = vi.mocked(getGithubToken);

const POOL = {} as Pool;
const FEED_ID = 'feed-1';
const USER_ID = 'user-1';
const NOW = new Date('2025-06-01T00:00:00.000Z');

function buildSubscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    feedId: FEED_ID,
    userId: USER_ID,
    owner: 'facebook',
    repo: 'react',
    repoHtmlUrl: 'https://github.com/facebook/react',
    contentTypes: ['release'],
    includePrerelease: false,
    repoDescription: 'A JS library',
    repoLanguage: 'JavaScript',
    repoStargazers: 1000,
    repoAvatarUrl: 'https://avatars.githubusercontent.com/u/69631',
    releasesEtag: 'W/"old-etag"',
    lastReleasePublishedAt: null,
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    nextSyncAt: null,
    consecutiveFailures: 0,
    rateLimitedUntil: null,
    rateLimitRemaining: null,
    lastErrorCode: null,
    lastError: null,
    ...overrides,
  } as never;
}

function buildFeed(overrides: Record<string, unknown> = {}) {
  return {
    id: FEED_ID,
    userId: USER_ID,
    title: 'facebook/react',
    url: 'https://github.com/facebook/react',
    enabled: true,
    fetchIntervalMinutes: 60,
    ...overrides,
  } as never;
}

function buildRelease(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    tagName: 'v19.0.0',
    name: 'React 19',
    body: '## Highlights\n\nServer components are stable.',
    bodyHtml: '<h2>Highlights</h2><p>Server components are stable.</p>',
    htmlUrl: 'https://github.com/facebook/react/releases/tag/v19.0.0',
    isPrerelease: false,
    isDraft: false,
    publishedAt: '2025-05-01T10:00:00.000Z',
    authorLogin: 'gaearon',
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getGithubTokenMock.mockResolvedValue('ghp_token');
  getFeedByIdMock.mockResolvedValue(buildFeed());
  getSubscriptionRowMock.mockResolvedValue(buildSubscriptionRow());
  insertGithubItemMock.mockResolvedValue(undefined as never);
  recordSyncResultMock.mockResolvedValue(undefined as never);
  recordRateLimitMock.mockResolvedValue(undefined as never);
});

describe('syncSingleRepo', () => {
  it('订阅不存在时抛 NotFoundError', async () => {
    getSubscriptionRowMock.mockResolvedValue(null);

    await expect(
      syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(listReleasesMock).not.toHaveBeenCalled();
  });

  it('订阅源被禁用时静默跳过且不发请求', async () => {
    getFeedByIdMock.mockResolvedValue(buildFeed({ enabled: false }));

    const outcome = await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, now: NOW });

    expect(outcome).toEqual({ inserted: 0, status: null, etag: 'W/"old-etag"' });
    expect(listReleasesMock).not.toHaveBeenCalled();
    expect(recordSyncResultMock).not.toHaveBeenCalled();
  });

  it('成功拉取时落库 articles + github_article_items 并记录同步结果', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [buildRelease()],
      etag: 'W/"new-etag"',
      rateLimit: { ...EMPTY_RATE_LIMIT_SNAPSHOT, remaining: 4999 },
    });
    insertArticleMock.mockResolvedValue({ id: 'article-1' } as never);

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      now: NOW,
    });

    expect(outcome.inserted).toBe(1);
    expect(outcome.status).toBe(200);
    expect(outcome.etag).toBe('W/"new-etag"');

    // ETag 条件请求：非 force 时必须带上旧 etag
    expect(listReleasesMock).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'facebook', repo: 'react', etag: 'W/"old-etag"' }),
    );

    const articleArgs = insertArticleMock.mock.calls[0][1];
    expect(articleArgs.dedupeKey).toBe('github:release:101');
    expect(articleArgs.title).toBe('React 19');
    expect(articleArgs.link).toBe('https://github.com/facebook/react/releases/tag/v19.0.0');
    expect(articleArgs.author).toBe('gaearon');
    expect(articleArgs.contentHtml).toContain('Server components are stable.');

    const itemArgs = insertGithubItemMock.mock.calls[0][1];
    expect(itemArgs).toMatchObject({
      articleId: 'article-1',
      feedId: FEED_ID,
      ghType: 'release',
      ghId: '101',
      tagName: 'v19.0.0',
      isPrerelease: false,
    });

    expect(recordSyncResultMock).toHaveBeenCalledWith(
      POOL,
      expect.objectContaining({
        feedId: FEED_ID,
        succeeded: true,
        status: 200,
        etag: 'W/"new-etag"',
        lastReleasePublishedAt: '2025-05-01T10:00:00.000Z',
        rateLimitRemaining: 4999,
      }),
    );
  });

  it('命中 304 时不落库，只刷新下次同步时间', async () => {
    listReleasesMock.mockResolvedValue({
      status: 304,
      releases: [],
      etag: 'W/"old-etag"',
      rateLimit: { ...EMPTY_RATE_LIMIT_SNAPSHOT, remaining: 4998 },
    });

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      now: NOW,
    });

    expect(outcome).toMatchObject({ inserted: 0, status: 304 });
    expect(insertArticleMock).not.toHaveBeenCalled();
    expect(insertGithubItemMock).not.toHaveBeenCalled();
    expect(recordSyncResultMock).toHaveBeenCalledWith(
      POOL,
      expect.objectContaining({ succeeded: true, status: 304 }),
    );
  });

  it('force=true 时跳过 ETag 条件请求', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [],
      etag: 'W/"new-etag"',
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });

    await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      force: true,
      now: NOW,
    });

    expect(listReleasesMock).toHaveBeenCalledWith(expect.objectContaining({ etag: null }));
  });

  it('跳过 draft，并在未开启预发布时跳过 prerelease', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [
        buildRelease({ id: 1, isDraft: true }),
        buildRelease({ id: 2, isPrerelease: true }),
        buildRelease({ id: 3 }),
      ],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });
    insertArticleMock.mockResolvedValue({ id: 'article-3' } as never);

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      now: NOW,
    });

    expect(outcome.inserted).toBe(1);
    expect(insertArticleMock).toHaveBeenCalledTimes(1);
    expect(insertArticleMock.mock.calls[0][1].dedupeKey).toBe('github:release:3');
  });

  it('开启 includePrerelease 后收录预发布版本', async () => {
    getSubscriptionRowMock.mockResolvedValue(buildSubscriptionRow({ includePrerelease: true }));
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [buildRelease({ id: 2, isPrerelease: true })],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });
    insertArticleMock.mockResolvedValue({ id: 'article-2' } as never);

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      now: NOW,
    });

    expect(outcome.inserted).toBe(1);
    expect(insertGithubItemMock.mock.calls[0][1]).toMatchObject({ isPrerelease: true });
  });

  it('重复 release 命中去重时不写 github_article_items', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [buildRelease()],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });
    insertArticleMock.mockResolvedValue(null);

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      now: NOW,
    });

    expect(outcome.inserted).toBe(0);
    expect(insertGithubItemMock).not.toHaveBeenCalled();
    expect(recordSyncResultMock).toHaveBeenCalledWith(
      POOL,
      expect.objectContaining({ succeeded: true }),
    );
  });

  it('命中限流时写熔断时间并返回归一化错误（不抛出）', async () => {
    const resetAt = new Date(NOW.getTime() + 30 * 60_000);
    listReleasesMock.mockRejectedValue(
      new GithubApiError('rate_limited', {
        status: 403,
        rateLimit: { limit: 60, remaining: 0, resetAt, retryAfterSeconds: null },
      }),
    );

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: '',
      now: NOW,
    });

    expect(outcome.inserted).toBe(0);
    expect(outcome.error?.errorCode).toBe('rate_limited');
    expect(recordRateLimitMock).toHaveBeenCalledWith(
      POOL,
      expect.objectContaining({
        feedId: FEED_ID,
        rateLimitedUntil: resetAt.toISOString(),
        rateLimitRemaining: 0,
      }),
    );
    expect(recordSyncResultMock).toHaveBeenCalledWith(
      POOL,
      expect.objectContaining({ succeeded: false, nextSyncAt: resetAt.toISOString() }),
    );
  });

  it('404 等语义错误落库失败结果并按指数退避推进', async () => {
    getSubscriptionRowMock.mockResolvedValue(buildSubscriptionRow({ consecutiveFailures: 1 }));
    listReleasesMock.mockRejectedValue(new GithubApiError('not_found', { status: 404 }));

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      now: NOW,
    });

    expect(outcome.error?.errorCode).toBe('not_found');
    expect(outcome.error?.errorMessage).toContain('仓库不存在');
    expect(recordRateLimitMock).not.toHaveBeenCalled();

    const args = recordSyncResultMock.mock.calls[0][1];
    expect(args.succeeded).toBe(false);
    expect(args.status).toBe(404);
    // consecutiveFailures 1 → +1 = 2 → 60min * 2^2 = 240min
    expect(new Date(args.nextSyncAt).getTime() - NOW.getTime()).toBe(240 * 60_000);
  });

  it('非 GitHub 语义异常原样上抛，交由 pg-boss 重试', async () => {
    listReleasesMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 'ghp_token', now: NOW }),
    ).rejects.toThrow('ECONNRESET');
    expect(recordSyncResultMock).not.toHaveBeenCalled();
  });

  it('未显式传 token 时回表读取用户 Token', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });

    await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, now: NOW });

    expect(getGithubTokenMock).toHaveBeenCalledWith(POOL, USER_ID);
    expect(listReleasesMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'ghp_token' }),
    );
  });
});

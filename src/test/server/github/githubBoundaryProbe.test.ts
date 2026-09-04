/**
 * QA 独立边界探查（T05）——不复跑实现者的用例，只用怀疑眼光打边界。
 *
 * 断言口径一律以 `docs/arch-github-module.md` 为权威：
 * - §4.2 时序图「处于限流熔断期且非 force → 短路返回」
 * - §4.2 退避表「成功/304 → now + 生效间隔；限流 → max(resetAt, now+5min)」
 * - §3.3 `GithubApiErrorKind`：`invalid_response` = schema 校验失败
 * - §1.1 D1：匿名强制 ≥60min；ETag 304 不计配额
 * - §7.7：dedupeKey = `github:release:{id}`
 */
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
import { GithubApiError, resolveGithubErrorKind } from '@/server/integrations/github/githubErrors';
import {
  EMPTY_RATE_LIMIT_SNAPSHOT,
  isRateLimited,
  parseRateLimitHeaders,
  resolveEffectiveIntervalMinutes,
  resolveRateLimitedUntil,
} from '@/server/integrations/github/githubRateLimit';
import { computeNextSyncAt } from '@/server/domains/github/tasks/githubBackoff';
import { mapGithubFetchError } from '@/server/domains/github/tasks/githubFetchErrorMapping';
import { buildReleaseDedupeKey, toReleaseDraft } from '@/server/integrations/github/githubResourceMapper';

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
const MINUTE = 60_000;

function sub(overrides: Record<string, unknown> = {}) {
  return {
    feedId: FEED_ID,
    userId: USER_ID,
    owner: 'facebook',
    repo: 'react',
    repoHtmlUrl: 'https://github.com/facebook/react',
    contentTypes: ['release'],
    includePrerelease: false,
    repoDescription: null,
    repoLanguage: null,
    repoStargazers: null,
    repoAvatarUrl: null,
    releasesEtag: 'W/"etag-A"',
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

function feed(overrides: Record<string, unknown> = {}) {
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

function release(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    tagName: 'v1.0.0',
    name: 'One',
    body: 'notes',
    bodyHtml: '<p>notes</p>',
    htmlUrl: 'https://github.com/facebook/react/releases/tag/v1.0.0',
    isPrerelease: false,
    isDraft: false,
    publishedAt: '2025-05-01T00:00:00.000Z',
    authorLogin: 'someone',
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getGithubTokenMock.mockResolvedValue('ghp_token');
  getFeedByIdMock.mockResolvedValue(feed());
  getSubscriptionRowMock.mockResolvedValue(sub());
  insertGithubItemMock.mockResolvedValue(undefined as never);
  recordSyncResultMock.mockResolvedValue(undefined as never);
  recordRateLimitMock.mockResolvedValue(undefined as never);
});

// ───────────────────────────────────────────────────────────────
// 1. 限流熔断（arch §4.2「处于限流熔断期且非 force」）
// ───────────────────────────────────────────────────────────────
describe('QA-1 限流熔断 rate_limited_until', () => {
  it('QA-1.1 熔断期内（非 force）必须短路，禁止再打 GitHub API', async () => {
    getSubscriptionRowMock.mockResolvedValue(
      sub({ rateLimitedUntil: new Date(NOW.getTime() + 30 * MINUTE).toISOString() }),
    );
    // 故意让外呼「可以成功」：这样若实现真的短路，是因为熔断判断而非异常。
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_token',
      now: NOW,
    });

    // arch §4.2：熔断期内直接返回 rate_limited，不外呼
    expect(listReleasesMock).not.toHaveBeenCalled();
    expect(outcome.inserted).toBe(0);
    expect(outcome.error?.errorCode).toBe('rate_limited');
  });

  it('QA-1.2 熔断期内 force 手动刷新同样不得击穿配额', async () => {
    getSubscriptionRowMock.mockResolvedValue(
      sub({ rateLimitedUntil: new Date(NOW.getTime() + 30 * MINUTE).toISOString() }),
    );
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [],
      etag: null,
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

    expect(listReleasesMock).not.toHaveBeenCalled();
  });

  it('QA-1.3 熔断已过期时应恢复正常抓取', async () => {
    getSubscriptionRowMock.mockResolvedValue(
      sub({ rateLimitedUntil: new Date(NOW.getTime() - 1 * MINUTE).toISOString() }),
    );
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [],
      etag: 'W/"etag-B"',
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });

    await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 'ghp_token', now: NOW });

    expect(listReleasesMock).toHaveBeenCalledTimes(1);
  });

  it('QA-1.4 429 二级限流也应写熔断且不抛出（保护 pg-boss 不重试）', async () => {
    listReleasesMock.mockRejectedValue(
      new GithubApiError('rate_limited', {
        status: 429,
        rateLimit: { limit: 60, remaining: 0, resetAt: null, retryAfterSeconds: 120 },
      }),
    );

    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: '',
      now: NOW,
    });

    expect(outcome.error?.errorCode).toBe('rate_limited');
    // retry-after 120s < 5min 下限 → 必须取 5min
    expect(recordRateLimitMock).toHaveBeenCalledWith(
      POOL,
      expect.objectContaining({
        rateLimitedUntil: new Date(NOW.getTime() + 5 * MINUTE).toISOString(),
      }),
    );
  });

  it('QA-1.5 过期的 resetAt 不得导致空转（下限 5min 兜底）', () => {
    const stale = { limit: 60, remaining: 0, resetAt: new Date(NOW.getTime() - 10 * MINUTE), retryAfterSeconds: null };
    expect(resolveRateLimitedUntil(stale, NOW).getTime()).toBe(NOW.getTime() + 5 * MINUTE);
  });

  it('QA-1.6 403 但 remaining>0 属权限问题，不得误判为限流', () => {
    const snap = { limit: 5000, remaining: 4999, resetAt: null, retryAfterSeconds: null };
    expect(isRateLimited(403, snap)).toBe(false);
    expect(resolveGithubErrorKind(403, snap)).toBe('forbidden');
  });

  it('QA-1.7 x-ratelimit-remaining: 0 + 403 判定为限流', () => {
    const snap = parseRateLimitHeaders({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor(NOW.getTime() / 1000) + 3600),
    });
    expect(isRateLimited(403, snap)).toBe(true);
    expect(resolveGithubErrorKind(403, snap)).toBe('rate_limited');
  });
});

// ───────────────────────────────────────────────────────────────
// 2. 退避与匿名下限（arch §4.2 退避表 / D1）
// ───────────────────────────────────────────────────────────────
describe('QA-2 退避与匿名间隔下限', () => {
  it('QA-2.1 匿名（无 Token）刷新间隔强制抬到 ≥60min', () => {
    expect(resolveEffectiveIntervalMinutes({ intervalMinutes: 15, hasToken: false })).toBe(60);
    expect(resolveEffectiveIntervalMinutes({ intervalMinutes: 120, hasToken: false })).toBe(120);
    // 有 Token 时尊重用户设置的 15min
    expect(resolveEffectiveIntervalMinutes({ intervalMinutes: 15, hasToken: true })).toBe(15);
  });

  it('QA-2.2 匿名用户 15min 配置在实际调度中也被抬到 60min', () => {
    const next = computeNextSyncAt({ intervalMinutes: 15, hasToken: false, now: NOW });
    expect(next.getTime() - NOW.getTime()).toBe(60 * MINUTE);
  });

  it('QA-2.3 指数退避序列 2^n 且封顶 24h', () => {
    const at = (failures: number, interval = 60) =>
      (computeNextSyncAt({ intervalMinutes: interval, hasToken: true, consecutiveFailures: failures, now: NOW }).getTime() -
        NOW.getTime()) /
      MINUTE;

    expect(at(1)).toBe(120); // 60 * 2^1
    expect(at(2)).toBe(240); // 60 * 2^2
    expect(at(3)).toBe(480); // 60 * 2^3
    expect(at(4)).toBe(960); // 60 * 2^4
    expect(at(5)).toBe(960); // 指数封顶在 2^4
    expect(at(99)).toBe(960);
    // 大间隔命中 24h 硬顶
    expect(at(4, 1440)).toBe(24 * 60);
  });

  it('QA-2.4 负数/0/NaN 失败次数不得产生倒退时间', () => {
    for (const failures of [0, -3, Number.NaN]) {
      const next = computeNextSyncAt({ intervalMinutes: 60, hasToken: true, consecutiveFailures: failures, now: NOW });
      expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('QA-2.5 限流熔断优先级高于失败退避', () => {
    const until = new Date(NOW.getTime() + 90 * MINUTE);
    const next = computeNextSyncAt({
      intervalMinutes: 60,
      hasToken: true,
      consecutiveFailures: 3,
      rateLimitedUntil: until.toISOString(),
      now: NOW,
    });
    expect(next.getTime()).toBe(until.getTime());
  });

  it('QA-2.6 非法 rateLimitedUntil 字符串应降级而非产生 Invalid Date', () => {
    const next = computeNextSyncAt({
      intervalMinutes: 60,
      hasToken: true,
      rateLimitedUntil: 'not-a-date',
      now: NOW,
    });
    expect(Number.isNaN(next.getTime())).toBe(false);
    expect(next.getTime()).toBe(NOW.getTime() + 60 * MINUTE);
  });
});

// ───────────────────────────────────────────────────────────────
// 3. 去重（arch §7.7 + on conflict (feed_id, gh_type, gh_id)）
// ───────────────────────────────────────────────────────────────
describe('QA-3 去重幂等', () => {
  it('QA-3.1 dedupeKey 对同一 release id 稳定，且 number/string 等价', () => {
    expect(buildReleaseDedupeKey(101)).toBe('github:release:101');
    expect(buildReleaseDedupeKey('101')).toBe('github:release:101');
    expect(buildReleaseDedupeKey(101)).toBe(buildReleaseDedupeKey('101'));
  });

  it('QA-3.2 同一 release 抓两次：第二次为 no-op，不重复写 items', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [release()],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });

    // 第一次：articles 插入成功
    insertArticleMock.mockResolvedValueOnce({ id: 'article-900' } as never);
    const first = await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW });

    // 第二次：on conflict do nothing → 返回 null
    insertArticleMock.mockResolvedValueOnce(null);
    const second = await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW });

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(insertGithubItemMock).toHaveBeenCalledTimes(1);
    // 两次用的 dedupeKey 必须完全一致，否则去重根本不会命中
    expect(insertArticleMock.mock.calls[0][1].dedupeKey).toBe(insertArticleMock.mock.calls[1][1].dedupeKey);
  });

  it('QA-3.3 release 被编辑后重新推送（title/body 变更）仍命中同一 dedupeKey（AQ-3 不更新语义）', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [release({ name: 'One (edited)', body: 'rewritten notes' })],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });
    insertArticleMock.mockResolvedValue(null);

    const outcome = await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW });

    expect(outcome.inserted).toBe(0);
    expect(insertArticleMock.mock.calls[0][1].dedupeKey).toBe('github:release:900');
    expect(insertGithubItemMock).not.toHaveBeenCalled();
  });

  it('QA-3.4 落库必须显式跳过 AI 过滤管线（filterStatus=passed，arch T03 注意事项）', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [release()],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });
    insertArticleMock.mockResolvedValue({ id: 'a1' } as never);

    await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW });

    const args = insertArticleMock.mock.calls[0][1];
    // 依赖 repo 层默认值是隐式契约；显式传值才能防止默认值被改动时静默回归
    expect(args.filterStatus ?? 'passed').toBe('passed');
  });

  it('QA-3.5 publishedAt 缺失时不得写入 Invalid Date', () => {
    const draft = toReleaseDraft(release({ publishedAt: null }), { renderBody: () => '<p>x</p>' });
    expect(Number.isNaN(new Date(draft.publishedAt).getTime())).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────
// 4. ETag / 304 短路（arch §1.1 D1）
// ───────────────────────────────────────────────────────────────
describe('QA-4 ETag 304 短路', () => {
  it('QA-4.1 304 时不 ingest、不落库、不覆盖已有 etag', async () => {
    listReleasesMock.mockResolvedValue({
      status: 304,
      releases: [],
      etag: 'W/"etag-A"',
      rateLimit: { ...EMPTY_RATE_LIMIT_SNAPSHOT, remaining: 4990 },
    });

    const outcome = await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW });

    expect(insertArticleMock).not.toHaveBeenCalled();
    expect(insertGithubItemMock).not.toHaveBeenCalled();
    expect(outcome.etag).toBe('W/"etag-A"');
    const args = recordSyncResultMock.mock.calls[0][1];
    expect(args.succeeded).toBe(true);
    expect(args.status).toBe(304);
    // 304 视作成功：next_sync_at 按正常间隔推进，不能触发退避
    expect(new Date(args.nextSyncAt).getTime() - NOW.getTime()).toBe(60 * MINUTE);
  });

  it('QA-4.2 304 且匿名用户时 next_sync_at 仍受 60min 下限约束', async () => {
    getFeedByIdMock.mockResolvedValue(feed({ fetchIntervalMinutes: 15 }));
    listReleasesMock.mockResolvedValue({
      status: 304,
      releases: [],
      etag: 'W/"etag-A"',
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });

    await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: '', now: NOW });

    const args = recordSyncResultMock.mock.calls[0][1];
    expect(new Date(args.nextSyncAt).getTime() - NOW.getTime()).toBe(60 * MINUTE);
  });

  it('QA-4.3 非 force 必须带 If-None-Match；force 必须清空以强制全量', async () => {
    listReleasesMock.mockResolvedValue({
      status: 200,
      releases: [],
      etag: null,
      rateLimit: EMPTY_RATE_LIMIT_SNAPSHOT,
    });

    await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW });
    expect(listReleasesMock.mock.calls[0][0].etag).toBe('W/"etag-A"');

    await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', force: true, now: NOW });
    expect(listReleasesMock.mock.calls[1][0].etag).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────
// 5. 错误归一（arch §3.3 GithubApiErrorKind）
// ───────────────────────────────────────────────────────────────
describe('QA-5 错误归一与上抛策略', () => {
  it('QA-5.1 404 → not_found，中文提示，走指数退避不熔断', async () => {
    listReleasesMock.mockRejectedValue(new GithubApiError('not_found', { status: 404 }));
    const outcome = await syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW });

    expect(outcome.error?.errorCode).toBe('not_found');
    expect(outcome.error?.errorMessage).toMatch(/[\u4e00-\u9fa5]/);
    expect(recordRateLimitMock).not.toHaveBeenCalled();
  });

  it('QA-5.2 401 → unauthorized 且错误文案不得泄漏 Token', async () => {
    listReleasesMock.mockRejectedValue(
      new GithubApiError('unauthorized', { status: 401, detail: 'Bad credentials' }),
    );
    const outcome = await syncSingleRepo({
      pool: POOL,
      feedId: FEED_ID,
      userId: USER_ID,
      token: 'ghp_supersecrettoken123456',
      now: NOW,
    });

    expect(outcome.error?.errorCode).toBe('unauthorized');
    const serialized = JSON.stringify(recordSyncResultMock.mock.calls[0][1]);
    expect(serialized).not.toContain('ghp_supersecrettoken123456');
  });

  it('QA-5.3 zod schema 校验失败必须归类为 invalid_response（而非 network）', () => {
    // arch §3.3：invalid_response = 「schema 校验失败 / JSON 解析失败」
    const zodLike = new Error('Expected number, received string at "id"');
    zodLike.name = 'ZodError';
    const mapped = mapGithubFetchError(
      new GithubApiError('invalid_response', { status: 200, detail: zodLike.message }),
    );
    expect(mapped.errorCode).toBe('invalid_response');
  });

  it('QA-5.4 非 GitHub 语义异常必须原样上抛给 pg-boss，且不得污染同步状态', async () => {
    listReleasesMock.mockRejectedValue(new TypeError('cannot read property of undefined'));

    await expect(
      syncSingleRepo({ pool: POOL, feedId: FEED_ID, userId: USER_ID, token: 't', now: NOW }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(recordSyncResultMock).not.toHaveBeenCalled();
    expect(recordGithubRateLimit).not.toHaveBeenCalled();
  });

  it('QA-5.5 未知异常兜底文案为中文且带 unknown 码', () => {
    const mapped = mapGithubFetchError(new Error('boom'));
    expect(mapped.errorCode).toBe('unknown');
    expect(mapped.errorMessage).toMatch(/[\u4e00-\u9fa5]/);
  });
});

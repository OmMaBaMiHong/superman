import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { ConflictError, ValidationError } from '@/server/infra/http/errors';
import {
  evaluateHot,
  pickHotBaseline,
  refreshPublishedPost,
  registerPublishedPost,
  runPublishTrackingTick,
} from '@/core/publish-tracking/service';
import type { PublishedPostRow, PostMetricsSnapshotRow } from '@/core/publish-tracking/repository';

const insertPublishedPostMock = vi.fn();
const getPublishedPostMock = vi.fn();
const listRecentSnapshotsMock = vi.fn();
const listDueTrackingPostsMock = vi.fn();
const insertSnapshotMock = vi.fn();
const markSucceededMock = vi.fn();
const markFailedMock = vi.fn();
const markHotNotifiedMock = vi.fn();

vi.mock('@/core/publish-tracking/repository', () => ({
  insertPublishedPost: (...args: unknown[]) => insertPublishedPostMock(...args),
  getPublishedPost: (...args: unknown[]) => getPublishedPostMock(...args),
  listRecentSnapshots: (...args: unknown[]) => listRecentSnapshotsMock(...args),
  listDueTrackingPosts: (...args: unknown[]) => listDueTrackingPostsMock(...args),
  insertMetricsSnapshot: (...args: unknown[]) => insertSnapshotMock(...args),
  markPostFetchSucceeded: (...args: unknown[]) => markSucceededMock(...args),
  markPostFetchFailed: (...args: unknown[]) => markFailedMock(...args),
  markPostHotNotified: (...args: unknown[]) => markHotNotifiedMock(...args),
  deletePublishedPost: vi.fn(),
  setPublishedPostTracking: vi.fn(),
  listPublishedPostsWithMetrics: vi.fn(),
  listSnapshotsSince: vi.fn(),
}));

const pool = {} as Pool;

function makePost(overrides: Partial<PublishedPostRow> = {}): PublishedPostRow {
  return {
    id: '7',
    userId: '42',
    draftId: null,
    articleId: '11',
    platform: 'bilibili',
    accountName: '',
    postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    title: '测试视频',
    publishedAt: null,
    trackingEnabled: true,
    lastFetchedAt: null,
    fetchFailCount: 0,
    lastError: null,
    lastHotNotifiedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function snap(views: number, likes: number, comments: number, fetchedAt: string): PostMetricsSnapshotRow {
  return {
    id: '1', postId: '7', fetchedAt,
    views, likes, comments,
    shares: null, favorites: null, coins: null, followersDelta: null, rawJson: null,
  };
}

function okProvider(metrics: { views: number; likes: number; comments: number }) {
  return vi.fn(async () => ({
    ok: true as const,
    metrics: {
      ...metrics,
      shares: null, favorites: null, coins: null, followersDelta: null, rawJson: {},
    },
  }));
}

describe('publish-tracking / evaluateHot 三阈值边界', () => {
  it('views：≥50% 且 ≥1000 才命中（两个条件都要满足）', () => {
    expect(evaluateHot({ views: 2000, likes: 0, comments: 0 }, { views: 3000, likes: 0, comments: 0 }).hot).toBe(true);
    // 涨幅够但绝对增量不足
    expect(evaluateHot({ views: 100, likes: 0, comments: 0 }, { views: 160, likes: 0, comments: 0 }).hot).toBe(false);
    // 增量够但涨幅不足
    expect(evaluateHot({ views: 100000, likes: 0, comments: 0 }, { views: 101200, likes: 0, comments: 0 }).hot).toBe(false);
    // 基线为 0 不判定（除零）
    expect(evaluateHot({ views: 0, likes: 0, comments: 0 }, { views: 5000, likes: 0, comments: 0 }).hot).toBe(false);
  });

  it('likes ≥100 / comments ≥50 增量边界', () => {
    expect(evaluateHot({ views: 0, likes: 50, comments: 0 }, { views: 0, likes: 150, comments: 0 }).hot).toBe(true);
    expect(evaluateHot({ views: 0, likes: 50, comments: 0 }, { views: 0, likes: 149, comments: 0 }).hot).toBe(false);
    expect(evaluateHot({ views: 0, likes: 0, comments: 10 }, { views: 0, likes: 0, comments: 60 }).hot).toBe(true);
    expect(evaluateHot({ views: 0, likes: 0, comments: 10 }, { views: 0, likes: 0, comments: 59 }).hot).toBe(false);
  });

  it('null 维度跳过不判定', () => {
    expect(evaluateHot({ views: null, likes: null, comments: null }, { views: null, likes: null, comments: null }).hot).toBe(false);
  });
});

describe('publish-tracking / pickHotBaseline', () => {
  it('优先取 20-36h 前基线；窗口内没有退回上一条；单条返回 null 基线', () => {
    const latest = snap(3000, 0, 0, '2026-09-05T12:00:00Z');
    const inWindow = snap(2000, 0, 0, '2026-09-04T14:00:00Z'); // 22h 前
    const tooOld = snap(1000, 0, 0, '2026-09-03T00:00:00Z');
    expect(pickHotBaseline([latest, inWindow, tooOld])?.baseline).toBe(inWindow);

    const prev = snap(2500, 0, 0, '2026-09-05T11:00:00Z'); // 1h 前
    expect(pickHotBaseline([latest, prev])?.baseline).toBe(prev);

    expect(pickHotBaseline([latest])?.baseline).toBeNull();
    expect(pickHotBaseline([])).toBeNull();
  });
});

describe('publish-tracking / registerPublishedPost', () => {
  beforeEach(() => {
    insertPublishedPostMock.mockReset();
  });

  it('URL 非法 → 400；平台从 URL 推断；重复登记 → 409', async () => {
    await expect(registerPublishedPost(pool, { postUrl: 'ftp://x', userId: '42' }))
      .rejects.toBeInstanceOf(ValidationError);

    insertPublishedPostMock.mockResolvedValue(makePost());
    const post = await registerPublishedPost(pool, {
      postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      title: '手工填的标题',
      userId: '42',
    });
    expect(insertPublishedPostMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      platform: 'bilibili',
      title: '手工填的标题',
      userId: '42',
    }));
    expect(post.id).toBe('7');

    insertPublishedPostMock.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    await expect(registerPublishedPost(pool, {
      postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      userId: '42',
    })).rejects.toBeInstanceOf(ConflictError);
  });

  it('B站未填标题时从 provider 自动补全', async () => {
    insertPublishedPostMock.mockResolvedValue(makePost());
    const providerFactory = vi.fn(() => ({
      platform: 'bilibili' as const,
      fetchMetrics: vi.fn(async () => ({
        ok: true as const,
        title: 'API 补全的标题',
        metrics: { views: 1, likes: 1, comments: 1, shares: null, favorites: null, coins: null, followersDelta: null, rawJson: {} },
      })),
    }));
    await registerPublishedPost(pool, {
      postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      userId: '42',
    }, { providerFactory });
    expect(insertPublishedPostMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      title: 'API 补全的标题',
    }));
  });
});

describe('publish-tracking / refresh + 火了联动', () => {
  beforeEach(() => {
    getPublishedPostMock.mockReset();
    listRecentSnapshotsMock.mockReset().mockResolvedValue([]);
    insertSnapshotMock.mockReset().mockResolvedValue({ id: 's1' });
    markSucceededMock.mockReset();
    markFailedMock.mockReset();
    markHotNotifiedMock.mockReset();
  });

  it('抓取成功写快照并清零失败；失败累计计数不写快照、不打断', async () => {
    getPublishedPostMock.mockResolvedValue(makePost());
    const providerFactory = vi.fn(() => ({
      platform: 'bilibili' as const,
      fetchMetrics: okProvider({ views: 100, likes: 10, comments: 5 }),
    }));
    const ok = await refreshPublishedPost(pool, { postId: '7', userId: '42' }, { providerFactory });
    expect(ok.ok).toBe(true);
    expect(insertSnapshotMock).toHaveBeenCalled();
    expect(markSucceededMock).toHaveBeenCalledWith(pool, '7');

    const failProvider = vi.fn(() => ({
      platform: 'bilibili' as const,
      fetchMetrics: vi.fn(async () => ({ ok: false as const, reason: 'B站 API HTTP 502' })),
    }));
    insertSnapshotMock.mockClear();
    const fail = await refreshPublishedPost(pool, { postId: '7', userId: '42' }, { providerFactory: failProvider });
    expect(fail.ok).toBe(false);
    expect(markFailedMock).toHaveBeenCalledWith(pool, '7', 'B站 API HTTP 502');
    expect(insertSnapshotMock).not.toHaveBeenCalled();
  });

  it('火了 → 通知 + requeue 联动 + 24h 防重', async () => {
    const post = makePost();
    getPublishedPostMock.mockResolvedValue(post);
    // 基线 22h 前 views 2000 → 最新 3000（+50% 且 +1000）
    listRecentSnapshotsMock.mockResolvedValue([
      snap(3000, 0, 0, '2026-09-05T12:00:00Z'),
      snap(2000, 0, 0, '2026-09-04T14:00:00Z'),
    ]);
    const notifyFn = vi.fn(async () => ({}));
    const requeueFn = vi.fn(async () => ({}));
    const providerFactory = vi.fn(() => ({
      platform: 'bilibili' as const,
      fetchMetrics: okProvider({ views: 3000, likes: 10, comments: 5 }),
    }));
    const deps = { providerFactory, notifyFn: notifyFn as never, requeueFn: requeueFn as never };

    const first = await refreshPublishedPost(pool, { postId: '7', userId: '42' }, deps);
    expect(first.hot).toBe(true);
    expect(first.hotNotified).toBe(true);
    expect(notifyFn).toHaveBeenCalledWith(pool, expect.objectContaining({
      kind: 'performance_hot',
      title: '🔥 《测试视频》数据起飞',
      link: '/#/studio?tab=performance',
    }));
    expect(requeueFn).toHaveBeenCalledWith(pool, { id: '11', userId: '42' });
    expect(markHotNotifiedMock).toHaveBeenCalledWith(pool, '7');

    // 24h 内再次命中：hot 仍 true 但不再通知/不再 requeue
    notifyFn.mockClear();
    requeueFn.mockClear();
    getPublishedPostMock.mockResolvedValue(makePost({ lastHotNotifiedAt: new Date().toISOString() }));
    const second = await refreshPublishedPost(pool, { postId: '7', userId: '42' }, deps);
    expect(second.hot).toBe(true);
    expect(second.hotNotified).toBe(false);
    expect(notifyFn).not.toHaveBeenCalled();
    expect(requeueFn).not.toHaveBeenCalled();
  });

  it('无关联 articleId 时只通知不 requeue', async () => {
    getPublishedPostMock.mockResolvedValue(makePost({ articleId: null }));
    listRecentSnapshotsMock.mockResolvedValue([
      snap(60, 150, 0, '2026-09-05T12:00:00Z'),
      snap(50, 40, 0, '2026-09-04T14:00:00Z'),
    ]);
    const requeueFn = vi.fn();
    const providerFactory = vi.fn(() => ({
      platform: 'bilibili' as const,
      fetchMetrics: okProvider({ views: 60, likes: 150, comments: 0 }),
    }));
    const result = await refreshPublishedPost(pool, { postId: '7', userId: '42' }, {
      providerFactory,
      notifyFn: vi.fn(async () => ({})) as never,
      requeueFn: requeueFn as never,
    });
    expect(result.hotNotified).toBe(true);
    expect(requeueFn).not.toHaveBeenCalled();
  });
});

describe('publish-tracking / runPublishTrackingTick', () => {
  it('批量处理到期帖：成功/失败/火了分桶计数，单帖失败不打断', async () => {
    listDueTrackingPostsMock.mockResolvedValue([makePost({ id: '1' }), makePost({ id: '2' }), makePost({ id: '3' })]);
    getPublishedPostMock.mockImplementation((_db: unknown, id: string) => makePost({ id }));
    listRecentSnapshotsMock.mockResolvedValue([]);
    insertSnapshotMock.mockResolvedValue({ id: 's' });
    let call = 0;
    const providerFactory = vi.fn(() => ({
      platform: 'bilibili' as const,
      fetchMetrics: vi.fn(async () => {
        call += 1;
        if (call === 2) return { ok: false as const, reason: '网络抖动' };
        return {
          ok: true as const,
          metrics: { views: 1, likes: 1, comments: 1, shares: null, favorites: null, coins: null, followersDelta: null, rawJson: {} },
        };
      }),
    }));
    const result = await runPublishTrackingTick(pool, { userId: '42' }, { providerFactory });
    expect(result).toEqual({ due: 3, fetched: 2, failed: 1, hot: 0 });
  });
});

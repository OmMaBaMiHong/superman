import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runCommentIntelTick, syncPostComments } from '@/core/comment-intel/service';
import type { PublishedPostRow } from '@/core/publish-tracking/repository';

const upsertMock = vi.fn();
const listTopMock = vi.fn();
const listDueMock = vi.fn();
const markSyncedMock = vi.fn();
const markIntelMock = vi.fn();

vi.mock('@/core/comment-intel/repository', () => ({
  parseCommentTime: vi.fn(),
  upsertPostComments: (...a: unknown[]) => upsertMock(...a),
  listTopComments: (...a: unknown[]) => listTopMock(...a),
  listDueCommentPosts: (...a: unknown[]) => listDueMock(...a),
  markCommentsSynced: (...a: unknown[]) => markSyncedMock(...a),
  markCommentIntelAt: (...a: unknown[]) => markIntelMock(...a),
}));
vi.mock('@/server/domains/users/userScope', () => ({ normalizeUserId: (v?: string) => v ?? '42' }));
// 设置/AI 配置查询在单测里不打真库：tick 内部容错为 null 即可。
vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: vi.fn().mockRejectedValue(new Error('no db in unit test')),
  getAiApiKey: vi.fn().mockRejectedValue(new Error('no db in unit test')),
}));

function makePost(overrides: Partial<PublishedPostRow> = {}): PublishedPostRow {
  return {
    id: '7', userId: '42', draftId: null, articleId: null, platform: 'douyin',
    accountName: '', postUrl: 'https://www.douyin.com/video/712', title: '测试视频',
    publishedAt: null, trackingEnabled: true, lastFetchedAt: null, fetchFailCount: 0,
    lastError: null, lastHotNotifiedAt: null, createdAt: '', updatedAt: '',
    commentsSyncedAt: null, commentIntelAt: null,
    ...overrides,
  } as PublishedPostRow;
}

describe('syncPostComments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('拉取（传完整 URL）→ upsert → 推进游标', async () => {
    const client = {
      fetchComments: vi.fn().mockResolvedValue({ items: [{ cid: 'c1' }], total: 1, provider: 'tikhub' }),
      fetchPostStats: vi.fn(),
    };
    upsertMock.mockResolvedValue(1);
    const result = await syncPostComments({} as Pool, makePost(), { client: client as never });
    expect(result).toEqual({ synced: true, newCount: 1 });
    expect(client.fetchComments).toHaveBeenCalledWith({
      platform: 'douyin', postId: 'https://www.douyin.com/video/712', max: 50,
    });
    expect(markSyncedMock).toHaveBeenCalledWith({}, '7');
  });

  it('服务失败返回 synced:false 不抛错、不推进游标', async () => {
    const client = {
      fetchComments: vi.fn().mockRejectedValue(new Error('爬虫服务不可达')),
      fetchPostStats: vi.fn(),
    };
    const result = await syncPostComments({} as Pool, makePost(), { client: client as never });
    expect(result.synced).toBe(false);
    expect(result.error).toContain('爬虫服务不可达');
    expect(markSyncedMock).not.toHaveBeenCalled();
  });
});

describe('runCommentIntelTick', () => {
  beforeEach(() => vi.clearAllMocks());

  it('有新评论时分析并晋升；无新评论跳过分析', async () => {
    listDueMock.mockResolvedValue([makePost(), makePost({ id: '8' })]);
    const client = {
      fetchComments: vi.fn()
        .mockResolvedValueOnce({ items: [{ cid: 'c1' }], total: 1, provider: 'tikhub' })
        .mockResolvedValueOnce({ items: [], total: 0, provider: 'tikhub' }),
      fetchPostStats: vi.fn(),
    };
    upsertMock.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    listTopMock.mockResolvedValueOnce([
      { id: '1', content: '更新一下呗', likes: 9 },
    ]);
    const analyzeFn = vi.fn().mockResolvedValue({
      title: '观众在问更新', summary: 's', aiReason: 'r', usedFallback: true,
    });
    const promoteFn = vi.fn().mockResolvedValue({ promoted: true, articleId: '99' });
    const result = await runCommentIntelTick({} as Pool, { userId: '42' }, {
      client: client as never,
      analyzeFn: analyzeFn as never,
      promoteFn: promoteFn as never,
    });
    expect(result).toEqual({ due: 2, synced: 2, failed: 0, analyzed: 1, promoted: 1 });
    expect(analyzeFn).toHaveBeenCalledTimes(1);
    expect(analyzeFn.mock.calls[0][0]).toMatchObject({ post: { id: '7' }, aiConfig: null });
    expect(promoteFn).toHaveBeenCalledTimes(1);
    expect(markIntelMock).toHaveBeenCalledTimes(1);
    expect(markIntelMock).toHaveBeenCalledWith({}, '7');
  });

  it('同步失败计 failed 不打断其他帖', async () => {
    listDueMock.mockResolvedValue([makePost(), makePost({ id: '8' })]);
    const client = {
      fetchComments: vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ items: [], total: 0, provider: 'tikhub' }),
      fetchPostStats: vi.fn(),
    };
    upsertMock.mockResolvedValue(0);
    const result = await runCommentIntelTick({} as Pool, { userId: '42' }, { client: client as never });
    expect(result).toEqual({ due: 2, synced: 1, failed: 1, analyzed: 0, promoted: 0 });
    expect(listTopMock).not.toHaveBeenCalled();
  });
});

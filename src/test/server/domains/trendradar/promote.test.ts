import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const getTrendRadarItemMock = vi.fn();
const markPromotedMock = vi.fn();
const insertArticleMock = vi.fn();

vi.mock('@/core/trendradar/repository', () => ({
  getTrendRadarItem: (...args: unknown[]) => getTrendRadarItemMock(...args),
  markTrendRadarItemPromoted: (...args: unknown[]) => markPromotedMock(...args),
}));

vi.mock('@/server/domains/articles/repositories/articlesRepo', () => ({
  insertArticleIgnoreDuplicate: (...args: unknown[]) => insertArticleMock(...args),
}));

// P2b：promote 进治理时做方向关键词分类，这里固定为「无命中 → 兜底 general」。
vi.mock('@/core/governance/directions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/governance/directions')>();
  return {
    ...original,
    listDirectionStrategies: vi.fn(async () => []),
  };
});

import { promoteTrendRadarItem } from '@/core/trendradar/promote';

const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: '77' }] }) } as unknown as Pool;

const BASE_ITEM = {
  id: '4',
  platform: 'weibo',
  platformName: '微博',
  title: '手机涨价',
  url: 'https://s.weibo.com/a',
  rank: 1,
  previousRank: null,
  hotValue: '',
  firstSeenAt: '2026-09-05T02:00:00Z',
  lastSeenAt: '2026-09-05T03:00:00Z',
  sourceDate: '2026-09-05',
  promotedAt: null,
  promotedArticleId: null,
  payload: {},
};

describe('trendradar promote / 转为选题', () => {
  it('条目不存在返回 not_found', async () => {
    getTrendRadarItemMock.mockResolvedValue(null);
    const result = await promoteTrendRadarItem(pool, { id: '404', userId: '1' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(insertArticleMock).not.toHaveBeenCalled();
  });

  it('插入治理 candidate 文章并回链 promoted_article_id', async () => {
    getTrendRadarItemMock.mockResolvedValue(BASE_ITEM);
    insertArticleMock.mockResolvedValue({ id: '891' });

    const result = await promoteTrendRadarItem(pool, { id: '4', userId: '1' });

    expect(result).toEqual({ ok: true, articleId: '891', alreadyPromoted: false });
    // 合成 feed：kind='trend_radar'，幂等 on conflict
    const feedSql = String((pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(feedSql).toContain("'trend_radar'");
    expect(feedSql).toContain('on conflict (user_id, url)');
    // 文章以 candidate 进审批台
    const articleInput = insertArticleMock.mock.calls[0][1];
    expect(articleInput.governance.status).toBe('candidate');
    expect(articleInput.dedupeKey).toBe('trendradar:4');
    expect(articleInput.link).toBe('https://s.weibo.com/a');
    expect(articleInput.userId).toBe('1');
    // 回链
    expect(markPromotedMock).toHaveBeenCalledWith(pool, {
      id: '4',
      articleId: '891',
      userId: '1',
    });
  });

  it('已转过的条目幂等返回原 article，不重复插入', async () => {
    getTrendRadarItemMock.mockResolvedValue({ ...BASE_ITEM, promotedArticleId: '891' });
    const result = await promoteTrendRadarItem(pool, { id: '4', userId: '1' });
    expect(result).toEqual({ ok: true, articleId: '891', alreadyPromoted: true });
    expect(insertArticleMock).not.toHaveBeenCalled();
  });

  it('非 http 占位 URL 不作为文章链接', async () => {
    getTrendRadarItemMock.mockResolvedValue({
      ...BASE_ITEM,
      url: 'trendradar://no-url/abc',
    });
    insertArticleMock.mockResolvedValue({ id: '892' });
    await promoteTrendRadarItem(pool, { id: '4', userId: '1' });
    expect(insertArticleMock.mock.calls[0][1].link).toBeNull();
  });
});

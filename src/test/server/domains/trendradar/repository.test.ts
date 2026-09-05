import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  listTrendRadarItemsByDate,
  getTrendRadarItem,
  markTrendRadarItemPromoted,
  resolveTrendRadarOwnerUserId,
  resolveTrendRadarItemUrl,
  upsertTrendRadarItems,
} from '@/server/domains/trendradar/repository';

function mockPool(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

describe('trendradar repository', () => {
  it('无 URL 条目用标题哈希合成占位 URL（保住唯一约束）', () => {
    const a = resolveTrendRadarItemUrl({
      platform: 'weibo',
      title: '标题A',
      url: null,
      sourceDate: '2026-09-05',
    });
    expect(a).toMatch(/^trendradar:\/\/no-url\/[0-9a-f]{64}$/);
    // 同一标题同一天稳定，不同标题不同
    expect(
      resolveTrendRadarItemUrl({ platform: 'weibo', title: '标题A', sourceDate: '2026-09-05' }),
    ).toBe(a);
    expect(
      resolveTrendRadarItemUrl({ platform: 'weibo', title: '标题B', sourceDate: '2026-09-05' }),
    ).not.toBe(a);
    // 有 URL 时原样使用
    expect(
      resolveTrendRadarItemUrl({
        platform: 'weibo',
        title: '标题A',
        url: 'https://example.com/x',
        sourceDate: '2026-09-05',
      }),
    ).toBe('https://example.com/x');
  });

  it('upsert 带 user_id + on conflict（重复写同键不产生重复行）', async () => {
    const { pool, query } = mockPool();
    const item = {
      platform: 'weibo',
      title: '热搜',
      url: 'https://s.weibo.com/a',
      rank: 1,
      sourceDate: '2026-09-05',
    };
    await upsertTrendRadarItems(pool, [item, item], '42');

    expect(query).toHaveBeenCalledTimes(2);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('on conflict (user_id, platform, url, source_date) do update');
    expect(query.mock.calls[0][1][0]).toBe('42');
    expect(query.mock.calls[1][1]).toEqual(query.mock.calls[0][1]);
  });

  it('upsert 跳过空标题/空平台条目', async () => {
    const { pool, query } = mockPool();
    const result = await upsertTrendRadarItems(
      pool,
      [
        { platform: '', title: 'x' },
        { platform: 'weibo', title: '  ' },
        { platform: 'weibo', title: '有效', sourceDate: '2026-09-05' },
      ],
      '42',
    );
    expect(result.upserted).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('所有读查询带 user_id 过滤（多用户隔离）', async () => {
    const { pool, query } = mockPool();
    await listTrendRadarItemsByDate(pool, { userId: '42' });
    await getTrendRadarItem(pool, '7', '42');
    await markTrendRadarItemPromoted(pool, { id: '7', articleId: '9', userId: '42' });

    for (const call of query.mock.calls) {
      const sql = String(call[0]);
      expect(sql).toMatch(/user_id = \$\d+/);
      expect(call[1]).toContain('42');
    }
  });

  it('resolveTrendRadarOwnerUserId 查第一个 active 管理员', async () => {
    const { pool, query } = mockPool([{ id: '1' }]);
    const userId = await resolveTrendRadarOwnerUserId(pool);
    expect(userId).toBe('1');
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("role = 'admin'");
    expect(sql).toContain("status = 'active'");
  });

  it('listTrendRadarItemsByDate 从 payload 提取 previousRank', async () => {
    const { pool } = mockPool([
      {
        id: '7',
        platform: 'weibo',
        platformName: '微博',
        title: '热搜',
        url: 'https://s.weibo.com/a',
        rank: 2,
        hotValue: '',
        firstSeenAt: '2026-09-05T02:00:00Z',
        lastSeenAt: '2026-09-05T03:00:00Z',
        sourceDate: '2026-09-05',
        promotedAt: null,
        promotedArticleId: null,
        payload: { previousRank: 5, via: 'sqlite_sync' },
      },
    ]);
    const items = await listTrendRadarItemsByDate(pool, { userId: '42' });
    expect(items[0]?.previousRank).toBe(5);
  });
});

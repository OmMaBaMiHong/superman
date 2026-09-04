import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

describe('feedsRepo (articleListDisplayMode)', () => {
  it('listFeeds selects article_list_display_mode', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    const mod = (await import('@/server/domains/feeds/repositories/feedsRepo')) as typeof import('@/server/domains/feeds/repositories/feedsRepo');

    await mod.listFeeds(pool);
    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('article_list_display_mode');
    expect(sql).toContain('articleListDisplayMode');
  });

  it('createFeed inserts and returns article_list_display_mode', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'f1' }] });
    const pool = { query } as unknown as Pool;
    const mod = (await import('@/server/domains/feeds/repositories/feedsRepo')) as typeof import('@/server/domains/feeds/repositories/feedsRepo');

    await mod.createFeed(pool, { title: 'A', url: 'https://example.com/rss.xml' });
    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('article_list_display_mode');
    expect(sql).toContain('articleListDisplayMode');
  });

  it('updateFeed supports articleListDisplayMode and url patch and returns it', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'f1' }] });
    const pool = { query } as unknown as Pool;
    const mod = (await import('@/server/domains/feeds/repositories/feedsRepo')) as typeof import('@/server/domains/feeds/repositories/feedsRepo');

    await mod.updateFeed(pool, 'f1', {
      articleListDisplayMode: 'list',
      url: 'https://example.com/rss.xml',
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('article_list_display_mode');
    expect(sql).toContain('articleListDisplayMode');
    expect(sql).toContain('url = $');
  });

  it('persists feed content view separately from category', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'f1' }] });
    const pool = { query } as unknown as Pool;
    const mod = (await import('@/server/domains/feeds/repositories/feedsRepo')) as typeof import('@/server/domains/feeds/repositories/feedsRepo');

    await mod.createFeed(pool, {
      title: 'A',
      url: 'https://example.com/rss.xml',
      categoryId: 'cat-1',
      view: 'video',
    });
    await mod.updateFeed(pool, 'f1', { view: 'social' });

    const createSql = String(query.mock.calls[0]?.[0] ?? '');
    const createValues = query.mock.calls[0]?.[1] as unknown[];
    const updateSql = String(query.mock.calls[1]?.[0] ?? '');
    const updateValues = query.mock.calls[1]?.[1] as unknown[];

    expect(createSql).toContain('view');
    expect(createSql).toContain('category_id');
    expect(createValues).toContain('video');
    expect(updateSql).toContain('view = $');
    expect(updateValues).toContain('social');
  });
});

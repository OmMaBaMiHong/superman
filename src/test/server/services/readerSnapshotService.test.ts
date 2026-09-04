import { describe, expect, it } from 'vitest';
import { buildArticleFilter, decodeCursor, encodeCursor } from '@/server/domains/reader/services/readerSnapshotService';
import { AI_DIGEST_VIEW_ID, ARTICLE_VIEW_ID, OVERVIEW_VIEW_ID, PUBLISH_CENTER_VIEW_ID, VIDEO_VIEW_ID } from '@/lib/reader/view';

const RSS_ONLY = "articles.feed_id in (select id from feeds where user_id = $1 and kind = 'rss')";
const AI_DIGEST_ONLY = "articles.feed_id in (select id from feeds where user_id = $1 and kind = 'ai_digest')";

describe('readerSnapshotService', () => {
  it('filters unread view and excludes ai_digest', () => {
    const filter = buildArticleFilter({ view: 'unread' });
    expect(filter.whereSql).toMatch(/is_read = false/);
    expect(filter.whereSql).toContain(RSS_ONLY);
  });

  it('filters starred view and excludes ai_digest', () => {
    const filter = buildArticleFilter({ view: 'starred' });
    expect(filter.whereSql).toMatch(/is_starred = true/);
    expect(filter.whereSql).toContain(RSS_ONLY);
  });

  it('filters all view and excludes ai_digest', () => {
    const filter = buildArticleFilter({ view: 'all' });
    expect(filter.whereSql).toContain(RSS_ONLY);
    expect(filter.whereSql).toContain('articles.filter_status = any');
    expect(filter.params[1]).toEqual(['passed', 'error']);
  });

  it('adds unreadOnly filter on top of aggregate view', () => {
    const filter = buildArticleFilter({ view: 'all', unreadOnly: true });
    expect(filter.whereSql).toContain('articles.is_read = false');
    expect(filter.params[1]).toEqual(['passed', 'error']);
  });

  it('adds unreadOnly filter on top of feed view', () => {
    const filter = buildArticleFilter({ view: 'feed-id-1', unreadOnly: true });
    expect(filter.whereSql).toContain('articles.is_read = false');
    expect(filter.params[2]).toEqual(['passed', 'error']);
  });

  it('filters ai-digest smart view and only returns ai_digest feeds', () => {
    const filter = buildArticleFilter({ view: AI_DIGEST_VIEW_ID });
    expect(filter.whereSql).toContain(AI_DIGEST_ONLY);
    expect(filter.whereSql).not.toContain(RSS_ONLY);
  });

  it('filters media smart views by feed content view instead of treating them as feed ids', () => {
    const videoFilter = buildArticleFilter({ view: VIDEO_VIEW_ID });
    expect(videoFilter.whereSql).toContain("feeds.view = $2");
    expect(videoFilter.params[1]).toBe('video');
    expect(videoFilter.whereSql).not.toContain(`feed_id = $2`);

    const articleFilter = buildArticleFilter({ view: ARTICLE_VIEW_ID });
    expect(articleFilter.whereSql).toContain("feeds.view = $2");
    expect(articleFilter.params[1]).toBe('article');
  });

  it('does not force rss-only when viewing a specific feedId', () => {
    const filter = buildArticleFilter({ view: 'feed-id-1' });
    expect(filter.whereSql).toMatch(/feed_id/);
    expect(filter.whereSql).not.toContain(RSS_ONLY);
    expect(filter.whereSql).not.toContain(AI_DIGEST_ONLY);
  });

  it('returns empty result for content-page views (overview / publish-center)', () => {
    const overview = buildArticleFilter({ view: OVERVIEW_VIEW_ID });
    expect(overview.whereSql).toBe('where false');
    expect(overview.params).toEqual([]);

    const publishCenter = buildArticleFilter({ view: PUBLISH_CENTER_VIEW_ID });
    expect(publishCenter.whereSql).toBe('where false');
    expect(publishCenter.params).toEqual([]);
  });

  it('allows filtered articles only for a single feed when includeFiltered=true', () => {
    const filter = buildArticleFilter({ view: 'feed-id-1', includeFiltered: true });
    expect(filter.params[2]).toEqual(['passed', 'error', 'filtered']);

    const aggregate = buildArticleFilter({ view: 'all', includeFiltered: true });
    expect(aggregate.params[1]).toEqual(['passed', 'error']);
  });

  it('keeps duplicate filtered articles visible when includeFiltered is enabled for a feed', () => {
    const filter = buildArticleFilter({ view: 'feed-id-1', includeFiltered: true });
    expect(filter.params[2]).toEqual(['passed', 'error', 'filtered']);
  });

  it('roundtrips cursor', () => {
    const cursor = encodeCursor({ publishedAt: '2026-01-01T00:00:00.000Z', id: 'id-1' });
    expect(decodeCursor(cursor)).toEqual({
      publishedAt: '2026-01-01T00:00:00.000Z',
      id: 'id-1',
    });
  });

  it('keeps fever source filtering in article query sql', async () => {
    const mod = await import('@/server/domains/reader/services/readerSnapshotService');
    expect(String(mod.getReaderSnapshot)).toContain('remoteManaged');
  });

  it('hides disabled fever feeds in feed list sql', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never;
    const feedsRepo = await import('@/server/domains/feeds/repositories/feedsRepo');

    await feedsRepo.listFeeds(pool);

    const sql = pool.query.mock.calls[0]?.[0];
    expect(sql).toContain('fever_accounts fa');
    expect(sql).toContain('fa.enabled = true');
  });
});

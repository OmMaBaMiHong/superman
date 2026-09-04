import { describe, expect, it } from 'vitest';
import {
  AI_DIGEST_VIEW_ID,
  ARTICLE_VIEW_ID,
  DISCOVER_VIEW_ID,
  GITHUB_VIEW_ID,
  OVERVIEW_VIEW_ID,
  PUBLISH_CENTER_VIEW_ID,
  VIDEO_VIEW_ID,
  isAggregateView,
  isReaderContentPageView,
  isRssSmartView,
} from '@/lib/reader/view';

describe('reader content page views', () => {
  it('exposes overview/publish-center/discover view id constants', () => {
    expect(OVERVIEW_VIEW_ID).toBe('overview');
    expect(PUBLISH_CENTER_VIEW_ID).toBe('publish-center');
    expect(DISCOVER_VIEW_ID).toBe('discover');
  });

  it('isReaderContentPageView is true for overview, publish-center and discover', () => {
    expect(isReaderContentPageView(OVERVIEW_VIEW_ID)).toBe(true);
    expect(isReaderContentPageView(PUBLISH_CENTER_VIEW_ID)).toBe(true);
    expect(isReaderContentPageView(DISCOVER_VIEW_ID)).toBe(true);
  });

  it('isReaderContentPageView is false for aggregate, smart media, digest, github and rss views', () => {
    expect(isReaderContentPageView('all')).toBe(false);
    expect(isReaderContentPageView('unread')).toBe(false);
    expect(isReaderContentPageView('starred')).toBe(false);
    expect(isReaderContentPageView(ARTICLE_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView(VIDEO_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView(AI_DIGEST_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView(GITHUB_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView('feed-1')).toBe(false);
  });

  it('content page views are NOT aggregate views (no snapshot API wiring)', () => {
    expect(isAggregateView(OVERVIEW_VIEW_ID)).toBe(false);
    expect(isAggregateView(PUBLISH_CENTER_VIEW_ID)).toBe(false);
    expect(isAggregateView(DISCOVER_VIEW_ID)).toBe(false);
    expect(isRssSmartView(OVERVIEW_VIEW_ID)).toBe(false);
    expect(isRssSmartView(PUBLISH_CENTER_VIEW_ID)).toBe(false);
    expect(isRssSmartView(DISCOVER_VIEW_ID)).toBe(false);
  });
});

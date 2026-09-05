import { describe, expect, it } from 'vitest';
import {
  FALLBACK_RECOMMENDED_FEEDS,
  inferFeedPlatform,
} from '../../core/feeds/recommendedFallback';

describe('推荐订阅兜底列表', () => {
  it('规模与结构：约 20 条，标题/URL/平台齐全', () => {
    expect(FALLBACK_RECOMMENDED_FEEDS.length).toBeGreaterThanOrEqual(18);
    for (const entry of FALLBACK_RECOMMENDED_FEEDS) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.platform).toBeTruthy();
      // URL 形态：http(s) 或 rsshub:// 协议
      expect(/^(https?:\/\/|rsshub:\/\/)/.test(entry.url)).toBe(true);
    }
  });

  it('覆盖科技 / AI / B站三类', () => {
    const platforms = new Set(FALLBACK_RECOMMENDED_FEEDS.map((entry) => entry.platform));
    expect(platforms.has('tech')).toBe(true);
    expect(platforms.has('ai')).toBe(true);
    expect(platforms.has('bilibili')).toBe(true);
  });

  it('B站条目用 rsshub 用户视频路由', () => {
    const bili = FALLBACK_RECOMMENDED_FEEDS.filter((entry) => entry.platform === 'bilibili');
    for (const entry of bili) {
      expect(entry.url).toMatch(/^rsshub:\/\/bilibili\/user\/video\/\d+$/);
    }
  });
});

describe('inferFeedPlatform（订阅 URL → 平台标签）', () => {
  it('B站/抖音/AI/RSS 分类', () => {
    expect(inferFeedPlatform('https://space.bilibili.com/163637592')).toBe('bilibili');
    expect(inferFeedPlatform('rsshub://bilibili/user/video/946974')).toBe('bilibili');
    expect(inferFeedPlatform('https://www.douyin.com/user/abc')).toBe('douyin');
    expect(inferFeedPlatform('https://openai.com/news/rss.xml')).toBe('ai');
    expect(inferFeedPlatform('https://sspai.com/feed')).toBe('rss');
  });
});

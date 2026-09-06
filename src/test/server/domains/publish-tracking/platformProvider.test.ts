import { describe, expect, it, vi } from 'vitest';
import { CrawlerServiceError } from '@/core/crawlerClient';
import { extractBvid, inferPlatformFromUrl, isPublishPlatform } from '@/core/publish-tracking/platform';
import {
  createBilibiliProvider,
  createCrawlerServiceMetricsProvider,
  getMetricsProvider,
} from '@/core/publish-tracking/metricsProvider';

describe('publish-tracking / 平台推断与 bvid 解析', () => {
  it('inferPlatformFromUrl 各平台域名', () => {
    expect(inferPlatformFromUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili');
    expect(inferPlatformFromUrl('https://b23.tv/BV1xx411c7mD')).toBe('bilibili');
    expect(inferPlatformFromUrl('https://v.douyin.com/abc123/')).toBe('douyin');
    expect(inferPlatformFromUrl('https://www.xiaohongshu.com/explore/xyz')).toBe('xhs');
    expect(inferPlatformFromUrl('https://mp.weixin.qq.com/s/abc')).toBe('wechat');
    expect(inferPlatformFromUrl('https://example.com/post')).toBe('other');
    expect(inferPlatformFromUrl('not a url')).toBe('other');
  });

  it('extractBvid 支持各种 URL 形态', () => {
    expect(extractBvid('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD');
    expect(extractBvid('https://www.bilibili.com/video/BV1xx411c7mD?p=2&vd_source=abc')).toBe('BV1xx411c7mD');
    expect(extractBvid('https://b23.tv/BV1xx411c7mD')).toBe('BV1xx411c7mD');
    expect(extractBvid('bilibili.com/video/BV1GJ411x7h7/')).toBe('BV1GJ411x7h7');
  });

  it('extractBvid 非 BV 形态返回 null', () => {
    expect(extractBvid('https://b23.tv/abc123')).toBeNull();
    expect(extractBvid('https://www.bilibili.com/video/av170001')).toBeNull();
    expect(extractBvid('')).toBeNull();
  });

  it('isPublishPlatform 校验取值', () => {
    expect(isPublishPlatform('bilibili')).toBe(true);
    expect(isPublishPlatform('youtube')).toBe(false);
  });
});

describe('publish-tracking / bilibili provider', () => {
  const STAT = { view: 123456, like: 7890, reply: 456, share: 123, favorite: 321, coin: 222 };

  it('解析 view API 的 stat 字段为标准化指标', async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      json: { code: 0, data: { title: '某视频', stat: STAT } },
    }));
    const provider = createBilibiliProvider(fetchJson);
    const result = await provider.fetchMetrics('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe('某视频');
      expect(result.metrics).toMatchObject({
        views: 123456,
        likes: 7890,
        comments: 456,
        shares: 123,
        favorites: 321,
        coins: 222,
      });
      expect(String(fetchJson.mock.calls[0][0])).toContain('bvid=BV1xx411c7mD');
    }
  });

  it('URL 无 BV 号 → 明确 reason，不发请求', async () => {
    const fetchJson = vi.fn();
    const provider = createBilibiliProvider(fetchJson);
    const result = await provider.fetchMetrics('https://www.bilibili.com/video/av170001');
    expect(result).toEqual({ ok: false, reason: '无法从 URL 解析 BV 号' });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('API 业务错误码与 HTTP 错误都转 reason', async () => {
    const provider1 = createBilibiliProvider(vi.fn(async () => ({
      status: 200,
      json: { code: -404, message: '啥都木有' },
    })));
    expect(await provider1.fetchMetrics('https://www.bilibili.com/video/BV1xx411c7mD'))
      .toEqual({ ok: false, reason: 'B站 API 返回错误：啥都木有' });

    const provider2 = createBilibiliProvider(vi.fn(async () => ({ status: 502, json: null })));
    expect(await provider2.fetchMetrics('https://www.bilibili.com/video/BV1xx411c7mD'))
      .toEqual({ ok: false, reason: 'B站 API HTTP 502' });
  });

  it('stub 平台返回 P2e 提示（接口语义完整）', async () => {
    for (const platform of ['wechat', 'other'] as const) {
      const provider = getMetricsProvider(platform);
      const result = await provider.fetchMetrics('https://example.com/x');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('P2e');
    }
  });
});

describe('publish-tracking / crawler 服务 provider（P3a）', () => {
  const STATS_OK = {
    views: 100, likes: 10, comments: 2, shares: 1, favorites: 3, coins: null,
    platform: 'douyin', postId: '712', title: '抖音文案',
  };

  function makeClient(overrides: Partial<{ stats: unknown; error: Error }> = {}) {
    return {
      fetchPostStats: overrides.error
        ? vi.fn().mockRejectedValue(overrides.error)
        : vi.fn().mockResolvedValue(overrides.stats ?? STATS_OK),
      fetchComments: vi.fn(),
    };
  }

  it('服务成功时映射 PostMetrics 并透传 title（douyin）', async () => {
    const provider = createCrawlerServiceMetricsProvider('douyin', { client: makeClient() as never });
    const result = await provider.fetchMetrics('https://www.douyin.com/video/712');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe('抖音文案');
      expect(result.metrics).toMatchObject({ views: 100, likes: 10, comments: 2, followersDelta: null });
      expect(result.metrics.rawJson).toMatchObject({ provider: 'crawler-service', crawlerPostId: '712' });
    }
  });

  it('服务失败且无兜底时返回 ok:false（原因透出，不抛错）', async () => {
    const provider = createCrawlerServiceMetricsProvider('xhs', {
      client: makeClient({ error: new CrawlerServiceError(0, '爬虫服务不可达') }) as never,
    });
    const result = await provider.fetchMetrics('https://www.xiaohongshu.com/explore/abc');
    expect(result).toEqual({ ok: false, reason: '爬虫服务：爬虫服务不可达' });
  });

  it('B站服务失败回落直连 provider', async () => {
    const fallback = {
      platform: 'bilibili' as const,
      fetchMetrics: vi.fn().mockResolvedValue({ ok: true, metrics: { views: 1, likes: null, comments: null, shares: null, favorites: null, coins: null, followersDelta: null, rawJson: {} } }),
    };
    const provider = createCrawlerServiceMetricsProvider('bilibili', {
      client: makeClient({ error: new Error('不可达') }) as never,
      bilibiliFallback: fallback as never,
    });
    const result = await provider.fetchMetrics('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(fallback.fetchMetrics).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(result.ok).toBe(true);
  });

  it('getMetricsProvider：douyin/xhs 走 crawler 通路（注入 client 验证），wechat/other 走 stub', async () => {
    const client = makeClient();
    const dyProvider = getMetricsProvider('douyin', { client: client as never });
    const dyResult = await dyProvider.fetchMetrics('https://www.douyin.com/video/712');
    expect(client.fetchPostStats).toHaveBeenCalled();
    expect(dyResult.ok).toBe(true);

    const stubResult = await getMetricsProvider('wechat').fetchMetrics('https://example.com/x');
    expect(stubResult.ok).toBe(false);
  });
});

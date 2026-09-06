import { describe, expect, it, vi } from 'vitest';
import { CrawlerServiceError, createCrawlerClient } from '@/core/crawlerClient';

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body };
}

const okEnvelope = (data: unknown, provider = 'tikhub') => ({
  code: 0,
  data,
  provider,
});

describe('createCrawlerClient', () => {
  it('fetchComments 请求正确端点与 X-Caller-Key，并映射 snake→camel', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, okEnvelope({
      items: [{
        cid: 'c1', text: '这个怎么做的？', user: '观众甲', likes: 42,
        time: '1730000000', reply_count: 3, platform: 'douyin',
        post_id: '712', ip_location: '上海',
      }],
      total: 24,
    })));
    const client = createCrawlerClient({
      fetchImpl: fetchImpl as never,
      baseUrl: 'http://127.0.0.1:5510/',
      callerKey: 'k-test',
    });
    const result = await client.fetchComments({ platform: 'douyin', postId: '712', max: 50 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://127.0.0.1:5510/v1/comments?platform=douyin&post_id=712&max=50');
    expect(init.headers['X-Caller-Key']).toBe('k-test');
    expect(result.total).toBe(24);
    expect(result.provider).toBe('tikhub');
    expect(result.items[0]).toEqual({
      cid: 'c1', text: '这个怎么做的？', user: '观众甲', likes: 42,
      time: '1730000000', replyCount: 3, platform: 'douyin',
      postId: '712', ipLocation: '上海',
    });
  });

  it('非零 code 抛 CrawlerServiceError 且携带 code（不透传响应体）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(402, {
      code: 402,
      error: 'Insufficient balance',
    }));
    const client = createCrawlerClient({ fetchImpl: fetchImpl as never, baseUrl: 'http://x', callerKey: null });
    await expect(client.fetchPostStats({ platform: 'xhs', postId: 'abc' }))
      .rejects.toMatchObject({ code: 402 });
  });

  it('网络不可达抛 CrawlerServiceError code=0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = createCrawlerClient({ fetchImpl: fetchImpl as never, baseUrl: 'http://x', callerKey: null });
    await expect(client.fetchComments({ platform: 'bilibili', postId: 'BV1xx411c7mD' }))
      .rejects.toBeInstanceOf(CrawlerServiceError);
  });

  it('fetchPostStats 映射归一字段与 title（缺省为 null）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, okEnvelope({
      views: 1000, likes: 100, comments: 20, shares: 10, favorites: 5, coins: null,
      platform: 'bilibili', post_id: 'BV1xx411c7mD',
    }, 'bilibili_direct')));
    const client = createCrawlerClient({ fetchImpl: fetchImpl as never, baseUrl: 'http://x', callerKey: null });
    const stats = await client.fetchPostStats({ platform: 'bilibili', postId: 'BV1xx411c7mD' });
    expect(stats).toEqual({
      views: 1000, likes: 100, comments: 20, shares: 10, favorites: 5, coins: null,
      platform: 'bilibili', postId: 'BV1xx411c7mD', title: null,
    });
  });
});

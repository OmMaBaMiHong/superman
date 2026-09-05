import { describe, expect, it } from 'vitest';
import {
  inferArticleContentType,
  inferTrendContentType,
} from '../../server/lib/contentType';

describe('inferArticleContentType（文章形态推断）', () => {
  it('feed 视图是 video → 视频', () => {
    expect(inferArticleContentType({ feedView: 'video' })).toBe('video');
  });

  it('视频域链接 → 视频（B站/抖音/YouTube）', () => {
    expect(inferArticleContentType({ link: 'https://www.bilibili.com/video/BV123' })).toBe('video');
    expect(inferArticleContentType({ link: 'https://www.douyin.com/video/123' })).toBe('video');
    expect(inferArticleContentType({ link: 'https://youtu.be/abc' })).toBe('video');
  });

  it('有封面图或内嵌图 → 图文', () => {
    expect(inferArticleContentType({ hasPreviewImage: true })).toBe('image');
    expect(inferArticleContentType({ hasInlineImage: true })).toBe('image');
    expect(inferArticleContentType({ feedView: 'picture' })).toBe('image');
  });

  it('无任何媒体信号 → 纯文案', () => {
    expect(inferArticleContentType({ link: 'https://example.com/post-1' })).toBe('text');
    expect(inferArticleContentType({})).toBe('text');
  });

  it('优先级：视频信号优先于图片信号', () => {
    expect(
      inferArticleContentType({
        link: 'https://www.bilibili.com/video/BV123',
        hasPreviewImage: true,
      }),
    ).toBe('video');
  });
});

describe('inferTrendContentType（热榜形态推断）', () => {
  it('视频平台 → 视频', () => {
    expect(inferTrendContentType({ platform: 'douyin' })).toBe('video');
    expect(inferTrendContentType({ platform: 'bilibili' })).toBe('video');
  });

  it('payload 带封面图 → 图文', () => {
    expect(
      inferTrendContentType({ platform: 'weibo', payload: { cover: 'https://cdn.example.com/a.jpg' } }),
    ).toBe('image');
  });

  it('无信号 → 纯文案', () => {
    expect(inferTrendContentType({ platform: 'weibo', payload: {} })).toBe('text');
    expect(inferTrendContentType({ platform: 'baidu' })).toBe('text');
  });

  it('payload 封面非 URL 不算图文', () => {
    expect(inferTrendContentType({ platform: 'zhihu', payload: { cover: 'not-a-url' } })).toBe('text');
  });
});

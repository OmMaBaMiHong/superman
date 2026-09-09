import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSubscriptionVideoUrl, fetchSubscriptionVideo } from '@/core/reader/video';
import { isSafeMediaUrl } from '@/server/integrations/media/mediaProxyGuard';

vi.mock('@/server/integrations/media/mediaProxyGuard', () => ({ isSafeMediaUrl: vi.fn(async () => true) }));
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(isSafeMediaUrl).mockResolvedValue(true); });

describe('subscription video playback', () => {
  it('extracts the RSSHub Douyin play link and decodes HTML entities', () => {
    const content = '<a href="https://www.douyin.com/aweme/v1/play/?video_id=v123&amp;line=0">视频直链</a>';
    expect(extractSubscriptionVideoUrl({ content, mediaAttachments: [] }))
      .toBe('https://www.douyin.com/aweme/v1/play/?video_id=v123&line=0');
  });

  it('prefers media attachments and also recognizes source/video tags', () => {
    expect(extractSubscriptionVideoUrl({ content: '<video src="https://cdn.example/a.mp4"></video>', mediaAttachments: [] }))
      .toBe('https://cdn.example/a.mp4');
    expect(extractSubscriptionVideoUrl({ content: '<video><source src="https://cdn.example/b.mp4"></video>',
      mediaAttachments: [{ url: 'https://cdn.example/c.mp4', mimeType: 'video/mp4' }] })).toBe('https://cdn.example/c.mp4');
    expect(extractSubscriptionVideoUrl({ content: '<a href="https://www.douyin.com/video/123">原文</a>', mediaAttachments: [] })).toBeNull();
    expect(extractSubscriptionVideoUrl({ content: '<video src="javascript:alert(1)"></video>', mediaAttachments: [] })).toBeNull();
  });

  it('forwards byte ranges and platform headers, then returns the unbuffered video response', async () => {
    const response = new Response('video bytes', { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-10/100' } });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.douyinvod.com/a.mp4' } })).mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchSubscriptionVideo('https://www.douyin.com/aweme/v1/play/?video_id=v123', { range: 'bytes=0-10', sourceUrl: 'https://www.douyin.com/video/123' });
    expect(result).toBe(response);
    expect(fetcher).toHaveBeenLastCalledWith('https://cdn.douyinvod.com/a.mp4', expect.objectContaining({ redirect: 'manual', headers: expect.objectContaining({ range: 'bytes=0-10', referer: 'https://www.douyin.com/' }) }));
    expect(isSafeMediaUrl).toHaveBeenCalledWith('https://cdn.douyinvod.com/a.mp4');
  });

  it('blocks private redirects without fetching them', async () => {
    vi.mocked(isSafeMediaUrl).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchSubscriptionVideo('https://cdn.example/a.mp4', {})).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not send HTML error pages or expired links to the video player as successful video', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('expired', { status: 403 }))
      .mockResolvedValueOnce(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchSubscriptionVideo('https://cdn.example/a.mp4', {})).rejects.toMatchObject({ status: 502 });
    await expect(fetchSubscriptionVideo('https://cdn.example/a.mp4', {})).rejects.toMatchObject({ status: 502 });
  });

  it('retains range-not-satisfiable responses for the player', async () => {
    const response = new Response(null, { status: 416, headers: { 'content-range': 'bytes */100' } });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    expect(await fetchSubscriptionVideo('https://cdn.example/a.mp4', { range: 'bytes=999-' })).toBe(response);
  });
});

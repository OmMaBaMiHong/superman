import { describe, expect, it, vi } from 'vitest';
import { resolveRssHubSourceUrl } from '@/server/integrations/rsshub/sourceResolver';

describe('resolveRssHubSourceUrl', () => {
  it('keeps an existing rsshub url as a resolved subscription', async () => {
    const result = await resolveRssHubSourceUrl('rsshub://youtube/user/@AndrejKarpathy');

    expect(result).toMatchObject({
      resolved: true,
      rssHubUrl: 'rsshub://youtube/user/@AndrejKarpathy',
      routePath: '/youtube/user/@AndrejKarpathy',
    });
  });

  it('extracts the real link from a messy Douyin share text', async () => {
    const shareText =
      '1.53 :1pm lPK:/ 05/08 V@L.wS 开源项目graft大幅降低token消耗 # codex # claudecode # aiagent  https://v.douyin.com/Y1XslSyYW2s/ 复制此链接，打开Dou音搜索，直接观看视频！';

    const result = await resolveRssHubSourceUrl(shareText, {
      fetchFinalUrl: vi.fn(async () =>
        'https://www.douyin.com/video/7684879520344253617?previous_page=web_code_link',
      ),
      fetchRadarRules: vi.fn(async () => null),
      isSafeUrl: vi.fn(async () => true),
      resolveDouyinVideoAuthor: vi.fn(async () => ({
        success: true,
        secUid: 'MS4wLjABAAAAOcPp5WgDRSX9KaiwY8qt0rO0u1CENqZUDMQ40cSRstPoPNYobtpoQuNgkjolS4rX',
        nickname: '一蛙AI',
      })),
    });

    expect(result).toMatchObject({
      resolved: true,
      rssHubUrl:
        'rsshub://douyin/user/MS4wLjABAAAAOcPp5WgDRSX9KaiwY8qt0rO0u1CENqZUDMQ40cSRstPoPNYobtpoQuNgkjolS4rX',
      title: '抖音 · 一蛙AI',
    });
  });

  it('converts a Douyin short link redirect into the native RSSHub user route', async () => {
    const result = await resolveRssHubSourceUrl('https://v.douyin.com/Cp6D0GGQF4o/', {
      fetchFinalUrl: vi.fn(async () =>
        'https://www.iesdouyin.com/share/user/MS4wLjABAAAAp6daEOfb2hRJxsXteimTyhVEMdleIodhtez1fYBTR5Q?sec_uid=MS4wLjABAAAAp6daEOfb2hRJxsXteimTyhVEMdleIodhtez1fYBTR5Q',
      ),
      fetchRadarRules: vi.fn(async () => null),
      isSafeUrl: vi.fn(async () => true),
    });

    expect(result).toMatchObject({
      resolved: true,
      finalUrl:
        'https://www.iesdouyin.com/share/user/MS4wLjABAAAAp6daEOfb2hRJxsXteimTyhVEMdleIodhtez1fYBTR5Q?sec_uid=MS4wLjABAAAAp6daEOfb2hRJxsXteimTyhVEMdleIodhtez1fYBTR5Q',
      rssHubUrl:
        'rsshub://douyin/user/MS4wLjABAAAAp6daEOfb2hRJxsXteimTyhVEMdleIodhtez1fYBTR5Q',
      routePath: '/douyin/user/MS4wLjABAAAAp6daEOfb2hRJxsXteimTyhVEMdleIodhtez1fYBTR5Q',
      title: '抖音博主',
    });
  });

  it('matches RSSHub radar rules for supported source pages', async () => {
    const result = await resolveRssHubSourceUrl('https://www.zhihu.com/people/example-user', {
      fetchFinalUrl: vi.fn(async (url) => url),
      fetchRadarRules: vi.fn(async () => ({
        _name: '知乎',
        '.': [
          {
            title: '用户动态',
            source: ['/people/:id'],
            target: '/zhihu/people/activities/:id',
          },
        ],
      })),
      isSafeUrl: vi.fn(async () => true),
    });

    expect(result).toMatchObject({
      resolved: true,
      rssHubUrl: 'rsshub://zhihu/people/activities/example-user',
      routePath: '/zhihu/people/activities/example-user',
      title: '用户动态',
    });
  });

  it('resolves a Douyin video link without sec_uid by reverse-looking-up the author', async () => {
    const resolveVideoAuthor = vi.fn(async () => ({
      success: true,
      secUid: 'MS4wLjABAAAAvideo-author-uid',
      nickname: '测试博主',
    }));

    const result = await resolveRssHubSourceUrl('https://v.douyin.com/abcdef/', {
      fetchFinalUrl: vi.fn(async () => 'https://www.iesdouyin.com/share/video/7682291366805736744/'),
      fetchRadarRules: vi.fn(async () => null),
      isSafeUrl: vi.fn(async () => true),
      resolveDouyinVideoAuthor: resolveVideoAuthor,
    });

    expect(resolveVideoAuthor).toHaveBeenCalledWith('7682291366805736744');
    expect(result).toMatchObject({
      resolved: true,
      rssHubUrl: 'rsshub://douyin/user/MS4wLjABAAAAvideo-author-uid',
      routePath: '/douyin/user/MS4wLjABAAAAvideo-author-uid',
      title: '抖音 · 测试博主',
    });
  });

  it('asks for the profile link when a Douyin video author cannot be resolved', async () => {
    const result = await resolveRssHubSourceUrl('https://v.douyin.com/abcdef/', {
      fetchFinalUrl: vi.fn(async () => 'https://www.iesdouyin.com/share/video/7682291366805736744/'),
      fetchRadarRules: vi.fn(async () => null),
      isSafeUrl: vi.fn(async () => true),
      resolveDouyinVideoAuthor: vi.fn(async () => ({ success: false })),
    });

    expect(result.resolved).toBe(false);
    expect(result.message).toContain('主页链接');
  });
});

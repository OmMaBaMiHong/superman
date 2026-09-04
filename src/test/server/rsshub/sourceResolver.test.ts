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
    const result = await resolveRssHubSourceUrl('https://www.douyin.com/user/douyin-user-id', {
      fetchFinalUrl: vi.fn(async (url) => url),
      fetchRadarRules: vi.fn(async () => ({
        _name: '抖音',
        '.': [
          {
            title: '博主',
            source: ['/user/:uid'],
            target: '/douyin/user/:uid',
          },
        ],
      })),
      isSafeUrl: vi.fn(async () => true),
    });

    expect(result).toMatchObject({
      resolved: true,
      rssHubUrl: 'rsshub://douyin/user/douyin-user-id',
      routePath: '/douyin/user/douyin-user-id',
      title: '博主',
    });
  });
});

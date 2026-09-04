import { describe, expect, it } from 'vitest';
import { getRssHubRoutePath, isRssHubUrl, resolveRssHubApiPath } from '@/lib/rsshub/url';

describe('RSSHub URL helpers', () => {
  it('converts rsshub protocol URLs into RSSHub route paths', () => {
    expect(isRssHubUrl('rsshub://youtube/user/@AndrejKarpathy')).toBe(true);
    expect(getRssHubRoutePath('rsshub://youtube/user/@AndrejKarpathy')).toBe('/youtube/user/@AndrejKarpathy');
    expect(resolveRssHubApiPath('rsshub://youtube/user/@AndrejKarpathy')).toBe(
      '/api/rsshub/youtube/user/@AndrejKarpathy',
    );
  });

  it('keeps query strings', () => {
    expect(getRssHubRoutePath('rsshub://youtube/user/@AndrejKarpathy?format=json')).toBe(
      '/youtube/user/@AndrejKarpathy?format=json',
    );
  });
});

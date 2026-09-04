import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getServerEnvMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/env', () => ({
  getServerEnv: () => getServerEnvMock(),
}));

function setPublicBaseUrl(value: string | undefined): void {
  getServerEnvMock.mockReturnValue({ FEEDFUSE_PUBLIC_BASE_URL: value });
}

describe('redirectUri', () => {
  beforeEach(() => {
    getServerEnvMock.mockReset();
    setPublicBaseUrl(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('resolvePublicBaseUrl', () => {
    it('prefers FEEDFUSE_PUBLIC_BASE_URL and strips trailing slashes', async () => {
      const { createHeaderReader, resolvePublicBaseUrl } = await import(
        '@/server/domains/oauth/redirectUri'
      );
      setPublicBaseUrl('https://reader.example.com/');

      const headers = createHeaderReader({
        host: 'attacker.example.net',
        'x-forwarded-host': 'attacker.example.net',
      });

      expect(resolvePublicBaseUrl(headers)).toBe('https://reader.example.com');
    });

    it('falls back to x-forwarded-proto + x-forwarded-host', async () => {
      const { createHeaderReader, resolvePublicBaseUrl } = await import(
        '@/server/domains/oauth/redirectUri'
      );

      const headers = createHeaderReader({
        host: 'internal:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'reader.example.com',
      });

      expect(resolvePublicBaseUrl(headers)).toBe('https://reader.example.com');
    });

    it('takes only the first hop of comma separated forwarded values', async () => {
      const { createHeaderReader, resolvePublicBaseUrl } = await import(
        '@/server/domains/oauth/redirectUri'
      );

      const headers = createHeaderReader({
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'reader.example.com, inner.local',
      });

      expect(resolvePublicBaseUrl(headers)).toBe('https://reader.example.com');
    });

    it('falls back to the host header when no forwarded headers exist', async () => {
      const { createHeaderReader, resolvePublicBaseUrl } = await import(
        '@/server/domains/oauth/redirectUri'
      );

      expect(resolvePublicBaseUrl(createHeaderReader({ host: 'reader.example.com' }))).toBe(
        'https://reader.example.com',
      );
    });

    it('uses http for loopback hosts without an explicit proto', async () => {
      const { createHeaderReader, resolvePublicBaseUrl } = await import(
        '@/server/domains/oauth/redirectUri'
      );

      expect(resolvePublicBaseUrl(createHeaderReader({ host: 'localhost:3000' }))).toBe(
        'http://localhost:3000',
      );
      expect(resolvePublicBaseUrl(createHeaderReader({ host: '127.0.0.1:3000' }))).toBe(
        'http://127.0.0.1:3000',
      );
    });

    it('rejects malformed host headers and falls back to localhost', async () => {
      const { createHeaderReader, resolvePublicBaseUrl } = await import(
        '@/server/domains/oauth/redirectUri'
      );

      expect(resolvePublicBaseUrl(createHeaderReader({ host: 'evil.com/path' }))).toBe(
        'http://localhost:3000',
      );
      expect(resolvePublicBaseUrl(createHeaderReader({ host: 'user@evil.com' }))).toBe(
        'http://localhost:3000',
      );
      expect(resolvePublicBaseUrl(null)).toBe('http://localhost:3000');
    });
  });

  describe('buildRedirectUri', () => {
    it('derives the callback path per provider from the resolved base url', async () => {
      const { buildRedirectUri } = await import('@/server/domains/oauth/redirectUri');
      setPublicBaseUrl('https://reader.example.com');

      expect(buildRedirectUri('github')).toBe(
        'https://reader.example.com/api/oauth/callback/github',
      );
      expect(buildRedirectUri('wechat')).toBe(
        'https://reader.example.com/api/oauth/callback/wechat',
      );
      expect(buildRedirectUri('douyin')).toBe(
        'https://reader.example.com/api/oauth/callback/douyin',
      );
      expect(buildRedirectUri('xiaohongshu')).toBe(
        'https://reader.example.com/api/oauth/callback/xiaohongshu',
      );
    });
  });

  describe('sanitizeReturnTo', () => {
    it('accepts in-site relative paths with query and hash', async () => {
      const { sanitizeReturnTo } = await import('@/server/domains/oauth/redirectUri');

      expect(sanitizeReturnTo('/reader')).toBe('/reader');
      expect(sanitizeReturnTo('/reader?view=article')).toBe('/reader?view=article');
      expect(sanitizeReturnTo('/reader#top')).toBe('/reader#top');
      expect(sanitizeReturnTo('/')).toBe('/');
    });

    it('rejects absolute urls', async () => {
      const { sanitizeReturnTo } = await import('@/server/domains/oauth/redirectUri');

      expect(sanitizeReturnTo('https://evil.com/steal')).toBe('/');
      expect(sanitizeReturnTo('http://evil.com')).toBe('/');
      expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
      expect(sanitizeReturnTo('data:text/html,<script>')).toBe('/');
    });

    it('rejects protocol relative urls and backslash variants', async () => {
      const { sanitizeReturnTo } = await import('@/server/domains/oauth/redirectUri');

      expect(sanitizeReturnTo('//evil.com')).toBe('/');
      expect(sanitizeReturnTo('//evil.com/path')).toBe('/');
      expect(sanitizeReturnTo('/\\evil.com')).toBe('/');
      expect(sanitizeReturnTo('/\\/evil.com')).toBe('/');
    });

    it('rejects control characters used to smuggle past prefix checks', async () => {
      const { sanitizeReturnTo } = await import('@/server/domains/oauth/redirectUri');

      expect(sanitizeReturnTo('/\r\n//evil.com')).toBe('/');
      expect(sanitizeReturnTo('/reader\u0000')).toBe('/');
    });

    it('falls back for non-string or empty input', async () => {
      const { sanitizeReturnTo } = await import('@/server/domains/oauth/redirectUri');

      expect(sanitizeReturnTo(undefined)).toBe('/');
      expect(sanitizeReturnTo(null)).toBe('/');
      expect(sanitizeReturnTo(42)).toBe('/');
      expect(sanitizeReturnTo('   ')).toBe('/');
      expect(sanitizeReturnTo('relative/path')).toBe('/');
    });

    it('honours a custom fallback', async () => {
      const { sanitizeReturnTo } = await import('@/server/domains/oauth/redirectUri');

      expect(sanitizeReturnTo('https://evil.com', '/reader')).toBe('/reader');
    });
  });

  describe('buildCallbackRedirectPath', () => {
    it('appends the documented success query contract', async () => {
      const { buildCallbackRedirectPath } = await import('@/server/domains/oauth/redirectUri');

      expect(
        buildCallbackRedirectPath({
          returnTo: '/reader',
          provider: 'github',
          outcome: 'success',
        }),
      ).toBe('/reader?settings=oauth&oauth=success&provider=github');
    });

    it('includes reason only on failure', async () => {
      const { buildCallbackRedirectPath } = await import('@/server/domains/oauth/redirectUri');

      expect(
        buildCallbackRedirectPath({
          returnTo: '/reader',
          provider: 'wechat',
          outcome: 'denied',
        }),
      ).toBe('/reader?settings=oauth&oauth=denied&provider=wechat');

      expect(
        buildCallbackRedirectPath({
          returnTo: '/reader',
          provider: 'wechat',
          outcome: 'failed',
          reason: 'state_expired',
        }),
      ).toBe('/reader?settings=oauth&oauth=failed&provider=wechat&reason=state_expired');
    });

    it('sanitizes a hostile returnTo before building the redirect', async () => {
      const { buildCallbackRedirectPath } = await import('@/server/domains/oauth/redirectUri');

      expect(
        buildCallbackRedirectPath({
          returnTo: 'https://evil.com/steal',
          provider: 'github',
          outcome: 'success',
        }),
      ).toBe('/?settings=oauth&oauth=success&provider=github');
    });

    it('preserves existing query params on returnTo', async () => {
      const { buildCallbackRedirectPath } = await import('@/server/domains/oauth/redirectUri');

      const result = buildCallbackRedirectPath({
        returnTo: '/reader?feed=12',
        provider: 'douyin',
        outcome: 'success',
      });

      const params = new URLSearchParams(result.split('?')[1] ?? '');
      expect(result.startsWith('/reader?')).toBe(true);
      expect(params.get('feed')).toBe('12');
      expect(params.get('settings')).toBe('oauth');
      expect(params.get('oauth')).toBe('success');
      expect(params.get('provider')).toBe('douyin');
    });
  });

  describe('buildCallbackRedirectUrl', () => {
    it('produces an absolute url for NextResponse.redirect', async () => {
      const { buildCallbackRedirectUrl } = await import('@/server/domains/oauth/redirectUri');
      setPublicBaseUrl('https://reader.example.com');

      expect(
        buildCallbackRedirectUrl({
          returnTo: '/reader',
          provider: 'github',
          outcome: 'success',
        }),
      ).toBe('https://reader.example.com/reader?settings=oauth&oauth=success&provider=github');
    });
  });
});

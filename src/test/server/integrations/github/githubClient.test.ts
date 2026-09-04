import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/infra/http/externalHttpClient', () => ({
  fetchExternalJson: vi.fn(),
}));

import { fetchExternalJson } from '@/server/infra/http/externalHttpClient';

// githubClient 通过 getGithubApiConfig() 解析运行时配置，而后者依赖 envSchema 的
// DATABASE_URL 校验。node 测试环境未加载 .env，这里补一个最小占位值即可（不可达网络）。
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
import { getRepository, listReleases } from '@/server/integrations/github/githubClient';
import { GithubApiError } from '@/server/integrations/github/githubErrors';

const mockedFetch = vi.mocked(fetchExternalJson);

function makeJsonResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 200,
    finalUrl: 'https://api.github.com/repos/facebook/react',
    contentType: 'application/json',
    headers: {},
    json: null,
    rawBody: '',
    jsonParseError: null,
    ...overrides,
  };
}

describe('githubClient.getRepository', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns repository metadata and parses rate limit headers on 200', async () => {
    mockedFetch.mockResolvedValue(
      makeJsonResult({
        status: 200,
        headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000' },
        json: {
          id: 10270250,
          name: 'react',
          full_name: 'facebook/react',
          private: false,
          html_url: 'https://github.com/facebook/react',
          description: 'The library',
          language: 'JavaScript',
          stargazers_count: 230000,
          owner: { login: 'facebook', avatar_url: 'https://avatars/facebook' },
        },
      }) as never,
    );

    const res = await getRepository({ owner: 'facebook', repo: 'react', token: 'tok' });

    expect(res.status).toBe(200);
    expect(res.repository?.fullName).toBe('facebook/react');
    expect(res.repository?.ownerLogin).toBe('facebook');
    expect(res.rateLimit.remaining).toBe(4999);
    // Token 注入 Authorization 头
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      }),
    );
  });

  it('does not send Authorization header when token is absent', async () => {
    mockedFetch.mockResolvedValue(
      makeJsonResult({
        status: 200,
        json: {
          id: 1,
          name: 'r',
          full_name: 'facebook/react',
          html_url: 'https://github.com/facebook/react',
          owner: { login: 'facebook' },
        },
      }) as never,
    );

    await getRepository({ owner: 'facebook', repo: 'react' });

    const options = mockedFetch.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers?.authorization).toBeUndefined();
  });

  it('throws not_found GithubApiError on 404', async () => {
    mockedFetch.mockResolvedValue(
      makeJsonResult({
        status: 404,
        json: { message: 'Not Found' },
        rawBody: '{"message":"Not Found"}',
      }) as never,
    );

    await expect(getRepository({ owner: 'x', repo: 'y' })).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('throws rate_limited GithubApiError on 403 with remaining 0', async () => {
    mockedFetch.mockResolvedValue(
      makeJsonResult({
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
        rawBody: 'rate limited',
      }) as never,
    );

    const err = await getRepository({ owner: 'x', repo: 'y' }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect((err as GithubApiError).kind).toBe('rate_limited');
  });
});

describe('githubClient.listReleases', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns parsed releases with etag on 200', async () => {
    mockedFetch.mockResolvedValue(
      makeJsonResult({
        status: 200,
        headers: { etag: 'W/"abc"' },
        json: [
          {
            id: 1,
            tag_name: 'v19.0.0',
            name: 'React 19',
            body: '# hi',
            body_html: '<h1>hi</h1>',
            html_url: 'https://github.com/facebook/react/releases/tag/v19.0.0',
            prerelease: false,
            draft: false,
            published_at: '2024-01-01T00:00:00Z',
            author: { login: 'facebook' },
          },
        ],
      }) as never,
    );

    const res = await listReleases({ owner: 'facebook', repo: 'react' });

    expect(res.status).toBe(200);
    expect(res.releases).toHaveLength(1);
    expect(res.releases[0].tagName).toBe('v19.0.0');
    expect(res.etag).toBe('W/"abc"');
  });

  it('returns empty releases on 304 without consuming quota', async () => {
    mockedFetch.mockResolvedValue(
      makeJsonResult({ status: 304, headers: { etag: 'W/"abc"' }, json: null }) as never,
    );

    const res = await listReleases({
      owner: 'facebook',
      repo: 'react',
      etag: 'W/"abc"',
    });

    expect(res.status).toBe(304);
    expect(res.releases).toEqual([]);
    // if-none-match 透传给外部客户端
    const options = mockedFetch.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers?.['if-none-match']).toBe('W/"abc"');
  });

  it('sends full+json accept header to receive body_html', async () => {
    mockedFetch.mockResolvedValue(makeJsonResult({ status: 200, json: [] }) as never);

    await listReleases({ owner: 'facebook', repo: 'react' });

    const options = mockedFetch.mock.calls[0][1] as { accept?: string };
    expect(options.accept).toContain('full+json');
  });

  it('throws GithubApiError on server error status', async () => {
    mockedFetch.mockResolvedValue(
      makeJsonResult({ status: 500, rawBody: 'boom' }) as never,
    );

    await expect(listReleases({ owner: 'facebook', repo: 'react' })).rejects.toBeInstanceOf(
      GithubApiError,
    );
  });
});

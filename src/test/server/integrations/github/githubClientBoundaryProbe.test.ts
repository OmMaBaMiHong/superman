/**
 * QA 独立边界探查（T05）—— githubClient 层。
 *
 * 关注点：错误分类是否符合 arch §3.3 的 `GithubApiErrorKind` 语义，
 * 以及 Token 是否会经由异常/日志泄漏（arch §7.8 安全红线 1）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/infra/http/externalHttpClient', () => ({
  fetchExternalJson: vi.fn(),
}));

import { fetchExternalJson } from '@/server/infra/http/externalHttpClient';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
import { listReleases, getRepository } from '@/server/integrations/github/githubClient';
import { GithubApiError } from '@/server/integrations/github/githubErrors';

const mockedFetch = vi.mocked(fetchExternalJson);
const SECRET = 'ghp_qaSuperSecretToken0123456789';

function jsonResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 200,
    finalUrl: 'https://api.github.com/repos/facebook/react/releases?per_page=30',
    contentType: 'application/json',
    headers: {},
    json: null,
    rawBody: '',
    jsonParseError: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('QA-C1 错误分类语义', () => {
  it('QA-C1.1 响应体 schema 不合法时应归类为 invalid_response（arch §3.3）', async () => {
    // GitHub 返回了结构错误的 release（id 是对象、缺 html_url）
    mockedFetch.mockResolvedValue(
      jsonResult({
        status: 200,
        json: [{ id: { nope: true }, tag_name: 'v1' }],
      }) as never,
    );

    const err = await listReleases({ owner: 'facebook', repo: 'react', token: 'tok' }).catch((e) => e);

    expect(err).toBeInstanceOf(GithubApiError);
    // schema 校验失败 ≠ 网络故障：错误码直接决定用户看到的中文提示与重试策略
    expect((err as GithubApiError).kind).toBe('invalid_response');
  });

  it('QA-C1.2 SSRF 拦截应归类为 network', async () => {
    mockedFetch.mockRejectedValue(new Error('Unsafe URL'));

    const err = await listReleases({ owner: 'evil', repo: 'x', token: null }).catch((e) => e);

    expect(err).toBeInstanceOf(GithubApiError);
    expect((err as GithubApiError).kind).toBe('network');
  });

  it('QA-C1.3 500 归类为 network，404 归类为 not_found', async () => {
    mockedFetch.mockResolvedValue(jsonResult({ status: 500, rawBody: 'oops' }) as never);
    const e500 = await listReleases({ owner: 'a', repo: 'b', token: null }).catch((e) => e);
    expect((e500 as GithubApiError).kind).toBe('network');

    mockedFetch.mockResolvedValue(jsonResult({ status: 404, rawBody: 'Not Found' }) as never);
    const e404 = await getRepository({ owner: 'a', repo: 'b', token: null }).catch((e) => e);
    expect((e404 as GithubApiError).kind).toBe('not_found');
  });
});

describe('QA-C2 Token 泄漏防线（arch §7.8）', () => {
  it('QA-C2.1 任何错误路径的异常对象都不得包含 Token 明文', async () => {
    const cases = [
      () => mockedFetch.mockResolvedValue(jsonResult({ status: 401, rawBody: 'Bad credentials' }) as never),
      () => mockedFetch.mockResolvedValue(jsonResult({ status: 403, rawBody: 'Forbidden' }) as never),
      () => mockedFetch.mockResolvedValue(jsonResult({ status: 500, rawBody: 'ISE' }) as never),
      () => mockedFetch.mockRejectedValue(new Error(`connect ETIMEDOUT`)),
    ];

    for (const setup of cases) {
      vi.clearAllMocks();
      setup();
      const err = (await listReleases({
        owner: 'facebook',
        repo: 'react',
        token: SECRET,
      }).catch((e) => e)) as GithubApiError;

      const dump = `${err.message}|${err.detail ?? ''}|${err.stack ?? ''}`;
      expect(dump).not.toContain(SECRET);
    }
  });

  it('QA-C2.2 logging 上下文不得携带 Authorization 头 / Token', async () => {
    mockedFetch.mockResolvedValue(jsonResult({ status: 200, json: [] }) as never);

    await listReleases({ owner: 'facebook', repo: 'react', token: SECRET, userId: 'u1' });

    const [, options] = mockedFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(options.logging ?? {})).not.toContain(SECRET);
    // Token 只允许出现在 headers.authorization
    expect((options.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
  });
});

describe('QA-C3 请求构造契约', () => {
  it('QA-C3.1 listReleases 必须发 full+json 媒体类型（保证 body_html，ADR-07）', async () => {
    mockedFetch.mockResolvedValue(jsonResult({ status: 200, json: [] }) as never);
    await listReleases({ owner: 'a', repo: 'b', token: null });

    const [, options] = mockedFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.accept).toBe('application/vnd.github.full+json');
  });

  it('QA-C3.2 perPage 越界应被夹到 1~100，防止构造非法请求', async () => {
    mockedFetch.mockResolvedValue(jsonResult({ status: 200, json: [] }) as never);

    await listReleases({ owner: 'a', repo: 'b', token: null, perPage: 9999 });
    expect(mockedFetch.mock.calls[0][0]).toContain('per_page=100');

    await listReleases({ owner: 'a', repo: 'b', token: null, perPage: -5 });
    expect(mockedFetch.mock.calls[1][0]).toContain('per_page=1');
  });

  it('QA-C3.3 owner/repo 含特殊字符时必须 URL 编码（防路径穿越）', async () => {
    mockedFetch.mockResolvedValue(jsonResult({ status: 200, json: [] }) as never);
    await listReleases({ owner: '../../etc', repo: 'passwd', token: null });

    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('../');
    expect(url).toContain('%2F');
  });
});

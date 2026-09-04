import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const pool = {};
const writeSystemLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/infra/logging/systemLogger', () => ({
  writeSystemLog: (...args: unknown[]) => writeSystemLogMock(...args),
}));

interface CapturedRequest {
  method: string;
  url: string;
  contentType: string | undefined;
  body: string;
}

/**
 * T01 / S1 · S2 · S3 验收：
 * externalHttpClient 的 POST + form + redactResponseBody 扩展，
 * 以及「默认行为逐字节不变」的向后兼容保证。
 */
describe('externalHttpClient · OAuth POST extension', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let baseUrl = '';
  let localHost = '';
  let captured: CapturedRequest[] = [];

  /** 本地测试服跑在 127.0.0.1 上，会被默认 SSRF 守卫拦掉，故显式放行基础校验。 */
  const allowLocal = async (): Promise<boolean> => true;

  beforeEach(async () => {
    writeSystemLogMock.mockReset();
    captured = [];

    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        captured.push({
          method: req.method ?? '',
          url: req.url ?? '',
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        });

        if (req.url === '/token') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"access_token":"gho_supersecrettoken","token_type":"bearer"}');
          return;
        }

        if (req.url === '/token-error') {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          // 故意让错误响应体里带上疑似凭据，验证 redactResponseBody 生效。
          res.end('{"error":"bad_verification_code","access_token":"gho_leaked_token"}');
          return;
        }

        if (req.url === '/token-redirect') {
          res.statusCode = 302;
          res.setHeader('location', `${baseUrl}/token`);
          res.end();
          return;
        }

        if (req.url === '/plain.json') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"ok":true}');
          return;
        }

        res.statusCode = 404;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end('{"error":"not_found"}');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    localHost = `127.0.0.1:${port}`;
    baseUrl = `http://${localHost}`;

    closeServer = async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    };
  });

  afterEach(async () => {
    await closeServer?.();
  });

  it('keeps the default GET behaviour byte-for-byte unchanged', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    const res = await fetchExternalJson<{ ok: boolean }>(`${baseUrl}/plain.json`, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      isSafeUrl: allowLocal,
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe('GET');
    expect(captured[0]?.body).toBe('');
    // 未传 form 时不得擅自加 content-type。
    expect(captured[0]?.contentType).toBeUndefined();
  });

  it('sends POST with url-encoded form body and the right content-type', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    const res = await fetchExternalJson<{ access_token: string }>(`${baseUrl}/token`, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      method: 'POST',
      form: {
        client_id: 'cid',
        client_secret: 's3cr3t',
        code: 'abc',
        redirect_uri: 'http://localhost:3000/api/oauth/callback/github',
      },
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
    });

    expect(res.status).toBe(200);
    expect(res.json?.access_token).toBe('gho_supersecrettoken');

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.contentType).toBe('application/x-www-form-urlencoded');

    const parsed = new URLSearchParams(captured[0]?.body ?? '');
    expect(parsed.get('client_id')).toBe('cid');
    expect(parsed.get('client_secret')).toBe('s3cr3t');
    expect(parsed.get('code')).toBe('abc');
    expect(parsed.get('redirect_uri')).toBe('http://localhost:3000/api/oauth/callback/github');
  });

  it('refuses to follow redirects when maxRedirects is 0 (S3: never leak secrets cross-origin)', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    await expect(
      fetchExternalJson(`${baseUrl}/token-redirect`, {
        timeoutMs: 1000,
        userAgent: 'test-agent',
        method: 'POST',
        form: { client_secret: 's3cr3t' },
        maxRedirects: 0,
        isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      }),
    ).rejects.toThrow(/redirect/i);

    // 只打到了重定向端点，secret 没有被带到第二跳。
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('/token-redirect');
  });

  it('redacts the response body from system_logs when redactResponseBody is set (S2)', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');
    const url = `${baseUrl}/token-error`;

    const res = await fetchExternalJson(url, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      method: 'POST',
      form: { code: 'bad' },
      redactResponseBody: true,
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      logging: {
        source: 'server/oauth/exchangeToken',
        requestLabel: 'OAuth token exchange',
        context: { provider: 'github' },
      },
    });

    expect(res.status).toBe(401);
    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        level: 'error',
        category: 'external_api',
        source: 'server/oauth/exchangeToken',
        details: '[redacted]',
        context: expect.objectContaining({
          url,
          method: 'POST',
          status: 401,
          provider: 'github',
        }),
      }),
    );

    // 兜底断言：整个日志调用参数里绝不能出现 token 明文。
    const serialized = JSON.stringify(writeSystemLogMock.mock.calls);
    expect(serialized).not.toContain('gho_leaked_token');
  });

  it('still writes the raw error body when redactResponseBody is not set', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');
    const url = `${baseUrl}/token-error`;

    await fetchExternalJson(url, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      logging: {
        source: 'server/github/fetchJson',
        requestLabel: 'GitHub API',
        context: {},
      },
    });

    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        level: 'error',
        details: expect.stringContaining('bad_verification_code'),
        context: expect.objectContaining({ method: 'GET', status: 401 }),
      }),
    );
  });

  it('logs method=POST on success and keeps details null', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');
    const url = `${baseUrl}/token`;

    await fetchExternalJson(url, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      method: 'POST',
      form: { code: 'abc' },
      redactResponseBody: true,
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      logging: {
        source: 'server/oauth/exchangeToken',
        requestLabel: 'OAuth token exchange',
        context: { provider: 'github' },
      },
    });

    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        level: 'info',
        details: null,
        context: expect.objectContaining({ method: 'POST', status: 200 }),
      }),
    );

    const serialized = JSON.stringify(writeSystemLogMock.mock.calls);
    expect(serialized).not.toContain('gho_supersecrettoken');
  });

  it('enforces the allowedHosts whitelist for OAuth endpoints (S1)', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    await expect(
      fetchExternalJson(`${baseUrl}/token`, {
        timeoutMs: 1000,
        userAgent: 'test-agent',
        method: 'POST',
        form: { code: 'abc' },
        isSafeUrl: allowLocal,
        allowedHosts: ['github.com'],
      }),
    ).rejects.toThrow(/unsafe url/i);

    expect(captured).toHaveLength(0);
  });
});

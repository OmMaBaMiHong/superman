/**
 * QA 独立边界探查（T05）——externalHttpClient POST 扩展的更深边缘。
 *
 * 实现者测试已覆盖：GET 默认逐字节不变、form 的 content-type、maxRedirects:0 单跳、
 * redactResponseBody 写 [redacted]。本文件只打**未覆盖**的边缘：
 * 1. `body`（JSON 体）不自动注入 content-type（调用方自担）；
 * 2. `form` 与 `body` 同时传入时 form 优先；
 * 3. POST + maxRedirects:0 + 302 指向**白名单外主机** → 抛错且第二跳零请求
 *    （跨站凭据泄漏场景，安全红线 7 的关键变体）；
 * 4. 日志 context 中命中敏感键名（access_token/secret）的值被自动脱敏，
 *    即使 `redactResponseBody` 未开启也不会让凭据顺着 context 落库。
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('[探针] externalHttpClient POST 深边缘', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let baseUrl = '';
  let localHost = '';
  let captured: CapturedRequest[] = [];

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

        if (req.url === '/json-body') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"ok":true}');
          return;
        }

        if (req.url === '/cross-host-redirect') {
          res.statusCode = 302;
          res.setHeader('location', 'https://evil.example.com/token');
          res.end();
          return;
        }

        if (req.url === '/fail-401') {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"error":"bad","access_token":"gho_leaked_token"}');
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

  it('body（JSON 体）不自动注入 content-type：调用方不声明时请求无该头', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    const res = await fetchExternalJson(`${baseUrl}/json-body`, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      method: 'POST',
      body: JSON.stringify({ client_id: 'cid' }),
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.body).toBe('{"client_id":"cid"}');
    // 未传 form 时不替调用方决定 content-type——JSON 由调用方自行声明。
    expect(captured[0]?.contentType).toBeUndefined();
  });

  it('form 与 body 同时传入时 form 优先（formBody ?? body）', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    await fetchExternalJson(`${baseUrl}/json-body`, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      method: 'POST',
      form: { client_id: 'cid', code: 'abc' },
      body: '{"should":"lose"}',
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
    });

    expect(captured[0]?.body).toBe('client_id=cid&code=abc');
    expect(captured[0]?.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('POST + maxRedirects:0 + 302 指向白名单外主机 → 抛错且第二跳零请求', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    await expect(
      fetchExternalJson(`${baseUrl}/cross-host-redirect`, {
        timeoutMs: 1000,
        userAgent: 'test-agent',
        method: 'POST',
        form: { client_secret: 's3cr3t' },
        maxRedirects: 0,
        isSafeUrl: allowLocal,
        allowedHosts: [localHost], // 第二跳 evil.example.com 不在白名单
      }),
    ).rejects.toThrow(/redirect/i);

    // 只打到了第一跳；携带 secret 的请求体从未被送往第二跳。
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('/cross-host-redirect');
    expect(captured.every((req) => req.url.startsWith('/'))).toBe(true);
  });

  it('日志 context 中敏感键名（access_token/secret）自动脱敏，即使未开 redactResponseBody', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');
    const url = `${baseUrl}/fail-401`;

    await fetchExternalJson(url, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      method: 'POST',
      form: { code: 'bad' },
      // 刻意不设 redactResponseBody：验证 context 脱敏独立生效。
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      logging: {
        source: 'server/oauth/probe',
        requestLabel: 'OAuth probe',
        context: {
          access_token: 'gho_context_leaked_token',
          client_secret: 'ghs_context_leaked_secret',
          provider: 'github',
        },
      },
    });

    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        level: 'error',
        context: expect.objectContaining({
          provider: 'github',
          access_token: '[redacted]',
          client_secret: '[redacted]',
        }),
      }),
    );

    // 兜底：日志 context 里绝不能出现明文凭据（details 里是响应体原文——
    // 本探针刻意未开 redactResponseBody，只验证 context 脱敏独立生效）。
    const contextArg = writeSystemLogMock.mock.calls.map((call) =>
      JSON.stringify(call[1]?.context ?? {}),
    );
    expect(contextArg.join()).not.toContain('gho_context_leaked_token');
    expect(contextArg.join()).not.toContain('ghs_context_leaked_secret');
  });

  it('redactResponseBody:true 时错误日志 details 恒为 [redacted]，context 无响应体', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');
    const url = `${baseUrl}/fail-401`;

    await fetchExternalJson(url, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      method: 'POST',
      form: { code: 'bad' },
      redactResponseBody: true,
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      logging: {
        source: 'server/oauth/probe',
        requestLabel: 'OAuth probe',
        context: { provider: 'github' },
      },
    });

    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        details: '[redacted]',
        context: expect.objectContaining({ status: 401 }),
      }),
    );
    const serialized = JSON.stringify(writeSystemLogMock.mock.calls);
    expect(serialized).not.toContain('gho_leaked_token');
  });
});

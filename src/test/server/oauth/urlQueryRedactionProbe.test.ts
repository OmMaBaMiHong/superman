/**
 * QA 独立边界探查（T05）——GET 请求 URL 携带敏感 query 参数的日志脱敏验证。
 *
 * 微信 token 交换是 GET（`?appid=&secret=&code=`），抖音 profile 用
 * `?access_token=`。若 externalHttpClient 把带 query 的完整 URL 写进
 * `system_logs.context.url`，则 client_secret / access_token 会顺着日志落库，
 * 直接违反安全红线 3「上述值永不进日志」。
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

describe('[探针] GET 请求 URL query 凭据脱敏', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let baseUrl = '';
  let localHost = '';

  const allowLocal = async (): Promise<boolean> => true;

  beforeEach(async () => {
    writeSystemLogMock.mockReset();

    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end('{"access_token":"ok"}');
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

  it('GET 且 URL query 含 secret / access_token 时，日志 context.url 不得含明文凭据', async () => {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    const secret = 'wx-super-secret-000';
    const token = 'access-token-in-query';
    const url = `${baseUrl}/token?appid=wxappid&secret=${secret}&code=abc&grant_type=authorization_code`;

    await fetchExternalJson(url, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      logging: {
        source: 'server/oauth/token_exchange',
        requestLabel: 'OAuth token exchange',
        context: { provider: 'wechat' },
      },
    });
    expect(writeSystemLogMock).toHaveBeenCalled();

    const serialized = JSON.stringify(writeSystemLogMock.mock.calls);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(token);
  });
});

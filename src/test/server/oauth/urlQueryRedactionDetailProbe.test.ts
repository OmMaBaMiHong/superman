/**
 * QA 第二轮回归验收——URL query 凭据脱敏的细节边界（纯函数行为，经日志观测）。
 *
 * Round 1 发现 `externalHttpClient.redactUrlCredentials` 只脱敏 userinfo、
 * 不处理 query，导致微信 GET token 交换把 `client_secret` 写进 system_logs。
 * 工程师已修复（敏感 query 键值替换为 [redacted]）。本文件对修复做
 * trust-but-verify 的细节核对，全部通过「fetchExternalJson → 日志观测」
 * 断言日志 `context.url`，不直接改生产代码。
 *
 * 核对清单（对应工程师修复摘要的边界保证）：
 * 1. 敏感键值必被替换：secret / client_secret / access_token / refresh_token / code；
 * 2. 非敏感键保留：state / scope / redirect_uri / appid / openid / grant_type；
 * 3. code_challenge / code_verifier 不被误伤（公开 PKCE 参数）；
 * 4. 无 query 的 URL 原样返回（fast-path）；
 * 5. 有 userinfo 时两者都脱敏（user:pass@ 与 query）；
 * 6. fragment 保留、非敏感 query 逐字节保留（只改日志不改变实际请求）。
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

describe('[第二轮] URL query 凭据脱敏细节', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let baseUrl = '';
  let localHost = '';

  const allowLocal = async (): Promise<boolean> => true;

  beforeEach(async () => {
    writeSystemLogMock.mockReset();

    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end('{"ok":true}');
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

  /** 发起一次 GET 并返回日志里记录的 context.url（已脱敏）。 */
  async function loggedUrl(url: string): Promise<string> {
    const { fetchExternalJson } = await import('@/server/infra/http/externalHttpClient');

    await fetchExternalJson(url, {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      isSafeUrl: allowLocal,
      allowedHosts: [localHost],
      logging: {
        source: 'server/oauth/probe',
        requestLabel: 'OAuth probe',
        context: { provider: 'github' },
      },
    });

    const call = writeSystemLogMock.mock.calls[0] as unknown[];
    const logEntry = call[1] as { context?: { url?: string } };
    return logEntry.context?.url ?? '';
  }

  it('敏感键值（secret/token/code 及带前缀变体）一律替换为 [redacted]', async () => {
    const logged = await loggedUrl(
      `${baseUrl}/token?appid=wxappid&secret=wx-secret-1&client_secret=wx-secret-2&access_token=at-1&refresh_token=rt-1&code=auth-code-1`,
    );

    expect(logged).not.toContain('wx-secret-1');
    expect(logged).not.toContain('wx-secret-2');
    expect(logged).not.toContain('at-1');
    expect(logged).not.toContain('rt-1');
    expect(logged).not.toContain('auth-code-1');
    expect(logged).toContain('secret=[redacted]');
    expect(logged).toContain('client_secret=[redacted]');
    expect(logged).toContain('access_token=[redacted]');
    expect(logged).toContain('refresh_token=[redacted]');
    expect(logged).toContain('code=[redacted]');
  });

  it('非敏感 query 键（state/scope/redirect_uri/appid/openid/grant_type）原样保留', async () => {
    const url = `${baseUrl}/authorize?state=st4te&scope=read%3Auser&redirect_uri=https%3A%2F%2Ffeedfuse.test%2Fcb&appid=wxappid&openid=open-1&grant_type=authorization_code&response_type=code`;
    const logged = await loggedUrl(url);

    expect(logged).toContain('state=st4te');
    expect(logged).toContain('scope=read%3Auser');
    expect(logged).toContain('redirect_uri=https%3A%2F%2Ffeedfuse.test%2Fcb');
    expect(logged).toContain('appid=wxappid');
    expect(logged).toContain('openid=open-1');
    expect(logged).toContain('grant_type=authorization_code');
    expect(logged).toContain('response_type=code');
  });

  it('code_challenge / code_verifier 不被误伤（公开 PKCE 参数保留）', async () => {
    const url = `${baseUrl}/authorize?client_id=cid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`;
    const logged = await loggedUrl(url);

    expect(logged).toContain('code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(logged).toContain('code_challenge_method=S256');
    expect(logged).toContain('code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  });

  it('xcode/encode/decode 等以 code 结尾但无分隔符的键不被误伤', async () => {
    const url = `${baseUrl}/t?xcode=1&encode=2&decode=3&code=real-secret`;
    const logged = await loggedUrl(url);

    expect(logged).toContain('xcode=1');
    expect(logged).toContain('encode=2');
    expect(logged).toContain('decode=3');
    // 只有整键 code 被脱敏。
    expect(logged).toContain('code=[redacted]');
    expect(logged).not.toContain('real-secret');
  });

  it('无 query 的 URL fast-path 原样返回', async () => {
    const logged = await loggedUrl(`${baseUrl}/plain`);

    expect(logged).toBe(`${baseUrl}/plain`);
  });

  it('userinfo 与 query 同时存在时两层都脱敏', async () => {
    const logged = await loggedUrl(
      `http://user:pass@${localHost}/token?secret=wx-secret-3&state=st4te`,
    );

    expect(logged).not.toContain('user:pass');
    expect(logged).not.toContain('wx-secret-3');
    expect(logged).toContain('secret=[redacted]');
    expect(logged).toContain('state=st4te');
  });

  it('fragment 在脱敏后保留', async () => {
    const logged = await loggedUrl(`${baseUrl}/t?secret=wx-secret-4#wechat_redirect`);

    expect(logged).not.toContain('wx-secret-4');
    expect(logged).toContain('#wechat_redirect');
  });

  it('敏感与非敏感混合时只替换敏感值，其余逐字节保留', async () => {
    const url = `${baseUrl}/mix?state=abc&secret=wx-secret-5&scope=snsapi_login&token=t-1`;
    const logged = await loggedUrl(url);

    expect(logged).toContain('state=abc');
    expect(logged).toContain('scope=snsapi_login');
    expect(logged).not.toContain('wx-secret-5');
    expect(logged).not.toContain('t-1');
    expect(logged).toContain('secret=[redacted]');
    expect(logged).toContain('token=[redacted]');
  });

  it('URL 编码后的敏感键（client%5Fsecret）best-effort 解码后仍被脱敏', async () => {
    const url = `${baseUrl}/t?client%5Fsecret=wx-encoded-secret&state=abc`;
    const logged = await loggedUrl(url);

    expect(logged).not.toContain('wx-encoded-secret');
    expect(logged).toContain('[redacted]');
    expect(logged).toContain('state=abc');
  });
});

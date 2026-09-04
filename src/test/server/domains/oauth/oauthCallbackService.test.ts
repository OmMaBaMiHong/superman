/**
 * T03 回调服务测试（§4.2）。
 *
 * 只 mock 最外层出网函数 `fetchExternalJson`，oauthHttp + provider 适配器
 * 全部走真实代码——这样「HTTP 200 也可能是失败」这类平台怪癖才真的被覆盖到。
 *
 * 覆盖的验收项：
 * - state 重放 / 过期 / 跨用户 / 平台不符 → 拒绝且**不写任何连接行**；
 * - token 落库前必经 `seal()`，SQL 参数里搜不到明文；
 * - `redirect_uri` 取自 state 表而非重新推导（ADR-05）；
 * - profile 拉取失败降级但主流程不中断。
 */

import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resetSecretKeyCache } from '@/server/infra/crypto/secretKeyProvider';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';

const getServerEnvMock = vi.hoisted(() => vi.fn());
const fetchExternalJsonMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/env', () => ({
  getServerEnv: () => getServerEnvMock(),
}));

vi.mock('@/server/infra/http/externalHttpClient', () => ({
  fetchExternalJson: (...args: unknown[]) => fetchExternalJsonMock(...args),
}));

const KEY_MATERIAL = '89abcdef01234567'.repeat(4);
const KEY = Buffer.from(KEY_MATERIAL, 'hex');
const PLAIN_SECRET = 'gh-client-secret-zzz';
const ACCESS_TOKEN = 'gho_realAccessToken0123456789';
const REFRESH_TOKEN = 'ghr_realRefreshToken0123456789';
const REDIRECT_URI = 'https://feedfuse.test/api/oauth/callback/github';

interface FakeQueryResult {
  rows?: unknown[];
  rowCount?: number;
}

type QueryHandler = (sql: string, params: unknown[]) => FakeQueryResult | undefined;

function createDb(handler: QueryHandler = () => undefined) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const result = handler(sql, params) ?? {};
    const rows = result.rows ?? [];
    return { rows, rowCount: result.rowCount ?? rows.length };
  });

  return { db: { query } as unknown as Pool, query };
}

function jsonResponse(json: unknown, status = 200): Record<string, unknown> {
  return {
    status,
    finalUrl: 'https://github.com/login/oauth/access_token',
    contentType: 'application/json',
    headers: {},
    json,
    rawBody: JSON.stringify(json),
    jsonParseError: null,
  };
}

function configRow(): Record<string, unknown> {
  return {
    provider: 'github',
    clientId: 'Iv1.abcdef',
    clientSecretEncrypted: seal(PLAIN_SECRET, KEY),
    enabled: true,
    createdAt: new Date('2025-03-01T00:00:00.000Z'),
    updatedAt: new Date('2025-03-01T00:00:00.000Z'),
  };
}

function authStateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'state-abc',
    userId: '1',
    provider: 'github',
    codeVerifierEncrypted: seal('verifier-plain-value-0123456789', KEY),
    redirectUri: REDIRECT_URI,
    returnTo: '/reader?feed=3',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
    ...overrides,
  };
}

function connectionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '77',
    userId: '1',
    provider: 'github',
    providerAccountId: '4242',
    displayName: 'Kou',
    avatarUrl: 'https://avatars.example.com/kou.png',
    accessTokenEncrypted: seal(ACCESS_TOKEN, KEY),
    refreshTokenEncrypted: null,
    tokenType: 'bearer',
    scope: 'read:user',
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    status: 'active',
    authorizedAt: new Date(),
    lastRefreshedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface DbOptions {
  state?: Record<string, unknown> | null;
}

function buildDb(options: DbOptions = {}) {
  const stateRow = options.state === undefined ? authStateRow() : options.state;

  return createDb((sql) => {
    if (sql.includes('delete from oauth_auth_states') && sql.includes('returning')) {
      return { rows: stateRow === null ? [] : [stateRow] };
    }
    if (sql.includes('from oauth_provider_configs')) {
      return { rows: [configRow()] };
    }
    if (sql.includes('insert into oauth_connections')) {
      return { rows: [connectionRow()] };
    }
    return { rows: [] };
  });
}

function connectionInsertCall(query: ReturnType<typeof createDb>['query']) {
  return query.mock.calls.find((call) =>
    String(call[0] ?? '').includes('insert into oauth_connections'),
  );
}

async function importService() {
  return import('@/server/domains/oauth/services/oauthCallbackService');
}

describe('oauthCallbackService.handleCallback', () => {
  beforeEach(() => {
    getServerEnvMock.mockReturnValue({ FEEDFUSE_PUBLIC_BASE_URL: 'https://feedfuse.test' });
    process.env.FEEDFUSE_SECRET_KEY = KEY_MATERIAL;
    resetSecretKeyCache();
    fetchExternalJsonMock.mockReset();
  });

  afterEach(() => {
    delete process.env.FEEDFUSE_SECRET_KEY;
    resetSecretKeyCache();
  });

  it('happy path：换 token → 拉 profile → 加密落库，返回 state 表里的 returnTo', async () => {
    fetchExternalJsonMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: ACCESS_TOKEN,
          token_type: 'bearer',
          scope: 'read:user',
          refresh_token: REFRESH_TOKEN,
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: 4242, login: 'kou', name: 'Kou', avatar_url: 'https://a.example/k.png' }),
      );

    const { db, query } = buildDb();
    const { handleCallback } = await importService();

    const result = await handleCallback(db, {
      userId: '1',
      provider: 'github',
      code: 'auth-code-1',
      state: 'state-abc',
    });

    expect(result).toEqual({ provider: 'github', connectionId: '77', returnTo: '/reader?feed=3' });

    const insert = connectionInsertCall(query);
    expect(insert).toBeDefined();
    const params = (insert?.[1] ?? []) as unknown[];

    // 安全红线 1：落库的是密文，且能解回原 token。
    expect(isSealed(String(params[3]))).toBe(true);
    expect(openSealed(String(params[3]), KEY)).toBe(ACCESS_TOKEN);
    expect(isSealed(String(params[4]))).toBe(true);
    expect(openSealed(String(params[4]), KEY)).toBe(REFRESH_TOKEN);

    // 明文 token 绝不能出现在任何 SQL 参数里。
    const allParams = JSON.stringify(query.mock.calls.map((call) => call[1]));
    expect(allParams).not.toContain(ACCESS_TOKEN);
    expect(allParams).not.toContain(REFRESH_TOKEN);
    expect(allParams).not.toContain(PLAIN_SECRET);

    // access_token_expires_at 由 expires_in 换算成绝对时刻。
    expect(params[7]).toBeInstanceOf(Date);
  });

  it('token 交换使用 state 表里的 redirect_uri 与解密后的 code_verifier（ADR-05）', async () => {
    fetchExternalJsonMock
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_TOKEN, token_type: 'bearer' }))
      .mockResolvedValueOnce(jsonResponse({ id: 4242, login: 'kou' }));

    const { db } = buildDb();
    const { handleCallback } = await importService();

    await handleCallback(db, {
      userId: '1',
      provider: 'github',
      code: 'auth-code-1',
      state: 'state-abc',
    });

    const [url, options] = fetchExternalJsonMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const form = options.form as Record<string, string>;

    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(options.method).toBe('POST');
    expect(form.redirect_uri).toBe(REDIRECT_URI);
    expect(form.code_verifier).toBe('verifier-plain-value-0123456789');
    expect(form.client_secret).toBe(PLAIN_SECRET);

    // 安全红线 3·7：响应体不落日志、不跟随重定向。
    expect(options.redactResponseBody).toBe(true);
    expect(options.maxRedirects).toBe(0);
    expect(options.allowedHosts).toEqual(['github.com', 'api.github.com']);
  });

  it('state 重放（已被消费）→ invalid_state，且不写任何连接行', async () => {
    const { db, query } = buildDb({ state: null });
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'auth-code-1',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });

    expect(connectionInsertCall(query)).toBeUndefined();
    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
  });

  it('state 过期 → state_expired，且不写任何连接行', async () => {
    const { db, query } = buildDb({
      state: authStateRow({ expiresAt: new Date(Date.now() - 1_000) }),
    });
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'auth-code-1',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'state_expired' });

    expect(connectionInsertCall(query)).toBeUndefined();
    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
  });

  it('跨用户 state（归属不符）→ invalid_state，且不写任何连接行', async () => {
    const { db, query } = buildDb({ state: authStateRow({ userId: '2' }) });
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'auth-code-1',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });

    expect(connectionInsertCall(query)).toBeUndefined();
    // 即便归属不符，state 仍已被销毁——攻击者只有一次机会。
    expect(
      query.mock.calls.some((call) =>
        String(call[0] ?? '').includes('delete from oauth_auth_states'),
      ),
    ).toBe(true);
  });

  it('state 平台与回调平台不一致 → invalid_state', async () => {
    const { db } = buildDb({ state: authStateRow({ provider: 'wechat' }) });
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'auth-code-1',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });
  });

  it('state 缺失或空串 → invalid_state，连消费都不发生', async () => {
    const { db, query } = buildDb();
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, { userId: '1', provider: 'github', code: 'c', state: '   ' }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });

    expect(query).not.toHaveBeenCalled();
  });

  it('code_verifier 解密失败（密钥轮换）→ invalid_state，且不出网', async () => {
    // 用另一把密钥加密，模拟密钥轮换后残留的旧密文。
    const rotatedKey = Buffer.from('1122334455667788'.repeat(4), 'hex');
    const { db, query } = buildDb({
      state: authStateRow({ codeVerifierEncrypted: seal('verifier-plain', rotatedKey) }),
    });
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'auth-code-1',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });

    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
    expect(connectionInsertCall(query)).toBeUndefined();
  });

  it('code_verifier 被篡改成非密文时失败关闭，绝不降级为「无 PKCE」继续换 token', async () => {
    const { db } = buildDb({
      state: authStateRow({ codeVerifierEncrypted: 'plain-verifier-not-sealed' }),
    });
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'auth-code-1',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });

    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
  });

  it('平台回调带 error=access_denied → user_denied，且仍然消费 state', async () => {
    const { db, query } = buildDb();
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        state: 'state-abc',
        error: 'access_denied',
      }),
    ).rejects.toMatchObject({ kind: 'user_denied' });

    expect(
      query.mock.calls.some((call) =>
        String(call[0] ?? '').includes('delete from oauth_auth_states'),
      ),
    ).toBe(true);
    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
  });

  it('平台回调带未知 error → provider_error', async () => {
    const { db } = buildDb();
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        state: 'state-abc',
        error: 'server_error',
      }),
    ).rejects.toMatchObject({ kind: 'provider_error' });
  });

  it('缺少 code → token_exchange_failed，且不出网', async () => {
    const { db } = buildDb();
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, { userId: '1', provider: 'github', code: '  ', state: 'state-abc' }),
    ).rejects.toMatchObject({ kind: 'token_exchange_failed' });

    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
  });

  it('HTTP 200 + {error} 的平台业务错误必须被识别为失败，不写库', async () => {
    fetchExternalJsonMock.mockResolvedValueOnce(
      jsonResponse({ error: 'bad_verification_code', error_description: 'The code expired' }),
    );

    const { db, query } = buildDb();
    const { handleCallback } = await importService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'auth-code-1',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'provider_error' });

    expect(connectionInsertCall(query)).toBeUndefined();
  });

  it('token 端点非 2xx → token_exchange_failed，错误里只带状态码不带响应体', async () => {
    fetchExternalJsonMock.mockResolvedValueOnce(
      jsonResponse({ error: 'oops', leaked: ACCESS_TOKEN }, 401),
    );

    const { db } = buildDb();
    const { handleCallback } = await importService();

    const error = await handleCallback(db, {
      userId: '1',
      provider: 'github',
      code: 'auth-code-1',
      state: 'state-abc',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).kind).toBe('token_exchange_failed');
    expect((error as OAuthError).debugHint).toBe('HTTP 401');
    expect(JSON.stringify(error)).not.toContain(ACCESS_TOKEN);
  });

  it('profile 拉取失败时降级落库，主流程不中断', async () => {
    fetchExternalJsonMock
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_TOKEN, token_type: 'bearer' }))
      .mockRejectedValueOnce(new Error('profile endpoint down'));

    const { db, query } = buildDb();
    const { handleCallback } = await importService();

    const result = await handleCallback(db, {
      userId: '1',
      provider: 'github',
      code: 'auth-code-1',
      state: 'state-abc',
    });

    expect(result.connectionId).toBe('77');

    const params = ((connectionInsertCall(query)?.[1] ?? []) as unknown[]);
    // GitHub 的 token 响应不含账号 id，profile 又挂了，只能落占位标识。
    expect(params[2]).toBe('unknown:github');
    expect(JSON.parse(String(params[9]))).toEqual({});
  });

  it('同一 (user, provider) 重新授权时先删后插，天然覆盖旧连接（R14）', async () => {
    fetchExternalJsonMock
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_TOKEN }))
      .mockResolvedValueOnce(jsonResponse({ id: 4242, login: 'kou' }));

    const { db, query } = buildDb();
    const { handleCallback } = await importService();

    await handleCallback(db, {
      userId: '1',
      provider: 'github',
      code: 'auth-code-1',
      state: 'state-abc',
    });

    const statements = query.mock.calls.map((call) => String(call[0] ?? ''));
    const deleteIndex = statements.findIndex((sql) =>
      sql.includes('delete from oauth_connections'),
    );
    const insertIndex = statements.findIndex((sql) =>
      sql.includes('insert into oauth_connections'),
    );

    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeLessThan(insertIndex);
  });
});

describe('oauthCallbackService 辅助函数', () => {
  it('resolveCallbackReturnTo 在失败分支回落默认路径', async () => {
    const { resolveCallbackReturnTo } = await importService();

    expect(resolveCallbackReturnTo(null)).toBe('/');
    expect(
      resolveCallbackReturnTo({ provider: 'github', connectionId: '1', returnTo: '/reader' }),
    ).toBe('/reader');
  });

  it('normalizeCallbackError 把任意异常归一为 OAuthError', async () => {
    const { normalizeCallbackError } = await importService();

    const fromPlain = normalizeCallbackError(new Error('boom'));
    expect(fromPlain).toBeInstanceOf(OAuthError);
    expect(fromPlain.kind).toBe('provider_error');

    const original = new OAuthError('state_expired', { provider: 'github' });
    expect(normalizeCallbackError(original)).toBe(original);
  });
});

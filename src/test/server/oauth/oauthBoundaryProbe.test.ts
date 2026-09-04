/**
 * QA 独立边界探查（T05）——不复跑实现者的用例，只用怀疑眼光打边界。
 *
 * 本文件是独立于实现工程师的第二层验证，覆盖七类核心安全/契约边界：
 * 1. PKCE 纵深防御：非 PKCE 平台即使被传入 codeChallenge 也绝不产出 code_challenge；
 *    verifier 长度边界 43/128；challenge 确定性。
 * 2. state 一次性消费：过期 state 与跨用户 state 都「拒绝 + 销毁」，攻击者只有一次机会。
 * 3. token 加密链路：落库值 isSealed + open 解回原文；打码契约（maskSecret）；
 *    DB 中断言无明文。
 * 4. API 打码契约（服务层真实现）：providers / connections 整棵 DTO 不含明文 token、
 *    不含密文 `v1:` 前缀。
 * 5. 四家 provider 契约补充：微信 token 请求无 code_verifier/client_id；抖音扁平响应
 *    兼容；小红书 error 优先于 code。
 * 6. 错误归一补充：微信 HTTP 200 + errcode=40029 直判 provider_error。
 *
 * 断言口径一律以 `docs/arch-oauth-hub.md`（§3.3 / §7.5 安全红线）为权威。
 */

import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resetSecretKeyCache } from '@/server/infra/crypto/secretKeyProvider';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';
import { requireProvider } from '@/server/integrations/oauth/oauthProviderRegistry';
import {
  CODE_VERIFIER_MAX_LENGTH,
  CODE_VERIFIER_MIN_LENGTH,
  createCodeVerifier,
  deriveCodeChallenge,
  isValidCodeVerifier,
} from '@/server/integrations/oauth/pkce';

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
const ACCESS_TOKEN = 'gho_ProbeAccessToken0123456789';
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

function configRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'github',
    clientId: 'Iv1.abcdef',
    clientSecretEncrypted: seal(PLAIN_SECRET, KEY),
    enabled: true,
    createdAt: new Date('2025-03-01T00:00:00.000Z'),
    updatedAt: new Date('2025-03-01T00:00:00.000Z'),
    ...overrides,
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
    avatarUrl: null,
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

/** 有状态 fake：state 表就是一个 Map，delete...returning 真的会「取出即销毁」。 */
function buildStatefulDb(stateRows: Record<string, unknown>[]) {
  const states = new Map(stateRows.map((row) => [String(row.state), row]));

  const handler: QueryHandler = (sql, params) => {
    if (sql.includes('delete from oauth_auth_states') && sql.includes('returning')) {
      const state = String(params[0] ?? '');
      if (state === '') return { rows: [] };
      const row = states.get(state);
      states.delete(state);
      return { rows: row === undefined ? [] : [row] };
    }
    if (sql.includes('from oauth_provider_configs')) {
      return { rows: [configRow()] };
    }
    if (sql.includes('insert into oauth_connections')) {
      return { rows: [connectionRow()] };
    }
    return { rows: [] };
  };

  return {
    ...createDb(handler),
    states,
  };
}

function connectionInsertCall(query: ReturnType<typeof createDb>['query']) {
  return query.mock.calls.find((call) =>
    String(call[0] ?? '').includes('insert into oauth_connections'),
  );
}

async function importCallbackService() {
  return import('@/server/domains/oauth/services/oauthCallbackService');
}

async function importConfigService() {
  return import('@/server/domains/oauth/services/oauthConfigService');
}

async function importConnectionService() {
  return import('@/server/domains/oauth/services/oauthConnectionService');
}

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

// ---------------------------------------------------------------------------
// 1. PKCE 纵深防御
// ---------------------------------------------------------------------------
describe('[探针] PKCE 纵深防御', () => {
  it('code_verifier 长度边界：43 与 128 合法，42 与 129 非法', () => {
    expect(isValidCodeVerifier('a'.repeat(CODE_VERIFIER_MIN_LENGTH))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(CODE_VERIFIER_MAX_LENGTH))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(CODE_VERIFIER_MIN_LENGTH - 1))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(CODE_VERIFIER_MAX_LENGTH + 1))).toBe(false);
  });

  it('code_verifier 字符集：RFC 7636 unreserved 之外一律拒绝（含非 ASCII）', () => {
    expect(isValidCodeVerifier(`${'a'.repeat(43)}$`)).toBe(false);
    expect(isValidCodeVerifier(`${'a'.repeat(43)}!`)).toBe(false);
    expect(isValidCodeVerifier('é'.repeat(43))).toBe(false);
    expect(isValidCodeVerifier('中'.repeat(43))).toBe(false);
  });

  it('deriveCodeChallenge 是确定性的：同一 verifier 永远得到同一 challenge', () => {
    const verifier = createCodeVerifier();
    expect(deriveCodeChallenge(verifier)).toBe(deriveCodeChallenge(verifier));
  });

  it('非 PKCE 平台（微信/抖音/小红书）即使被传入 codeChallenge 也绝不产出 code_challenge 参数', () => {
    const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    for (const id of ['wechat', 'douyin', 'xiaohongshu'] as const) {
      const provider = requireProvider(id);
      expect(provider.capabilities.supportsPkce).toBe(false);

      const url = provider.buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: REDIRECT_URI,
        state: 'st4te',
        scopes: provider.defaultScopes,
        codeChallenge: CHALLENGE, // 恶意/防御失败时流程层也可能传入
      });

      expect(url).not.toContain('code_challenge');
      expect(url).not.toContain('code_challenge_method');
    }
  });

  it('GitHub 授权 URL 的 PKCE 只允许 S256，绝不出现 plain', () => {
    const github = requireProvider('github');
    const url = github.buildAuthorizeUrl({
      clientId: 'Iv1.abc',
      redirectUri: REDIRECT_URI,
      state: 'st4te',
      scopes: ['read:user'],
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url).not.toContain('plain');
  });

  it('微信不支持 PKCE：即使传入 codeVerifier，token 请求也绝不携带 code_verifier 参数', () => {
    const wechat = requireProvider('wechat');
    const request = wechat.buildTokenRequest({
      clientId: 'wxappid',
      clientSecret: 'wxsecret',
      code: 'code-1',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'some-verifier-value',
    });

    expect(request.form.code_verifier).toBeUndefined();
    expect(request.form.appid).toBe('wxappid');
    expect(request.form.secret).toBe('wxsecret');
    expect(request.form.client_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. state 一次性消费（拒绝 + 销毁）
// ---------------------------------------------------------------------------
describe('[探针] state 一次性消费：拒绝即销毁', () => {
  it('过期 state：拒绝（state_expired）+ 不写连接行 + 行已被销毁', async () => {
    const expired = authStateRow({ expiresAt: new Date(Date.now() - 1_000) });
    const { db, query, states } = buildStatefulDb([expired]);
    const { handleCallback } = await importCallbackService();

    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'code-x',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'state_expired' });

    expect(connectionInsertCall(query)).toBeUndefined();
    // 销毁：即使调用方重试同一 state，也已无行可消费。
    expect(states.has('state-abc')).toBe(false);
  });

  it('跨用户 state：拒绝（invalid_state）+ 不写连接行 + 行已被销毁（攻击者只有一次机会）', async () => {
    const foreign = authStateRow({ userId: '2' });
    const { db, query, states } = buildStatefulDb([foreign]);
    const { handleCallback } = await importCallbackService();

    // 攻击者（user 1）拿 user 2 的 state 来换 token。
    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'code-x',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });

    expect(connectionInsertCall(query)).toBeUndefined();
    expect(states.has('state-abc')).toBe(false);
    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
  });

  it('授权成功后 state 同样被消费：同一 state 二次回调必然 invalid_state', async () => {
    const { db, query, states } = buildStatefulDb([authStateRow()]);
    const { handleCallback } = await importCallbackService();

    fetchExternalJsonMock
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_TOKEN, token_type: 'bearer' }))
      .mockResolvedValueOnce(jsonResponse({ id: 4242, login: 'kou' }));

    const first = await handleCallback(db, {
      userId: '1',
      provider: 'github',
      code: 'code-1',
      state: 'state-abc',
    });
    expect(first.connectionId).toBe('77');
    expect(states.has('state-abc')).toBe(false);

    // 重放：state 已被消费，必然失败且不出网。
    fetchExternalJsonMock.mockClear();
    await expect(
      handleCallback(db, {
        userId: '1',
        provider: 'github',
        code: 'code-2',
        state: 'state-abc',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });

    expect(fetchExternalJsonMock).not.toHaveBeenCalled();
    expect(
      query.mock.calls.filter((call) =>
        String(call[0] ?? '').includes('delete from oauth_auth_states'),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 3. token 加密链路 + 打码契约
// ---------------------------------------------------------------------------
describe('[探针] token 加密链路与打码契约', () => {
  it('回调落库的 access_token / refresh_token 均为密文，open() 可解回原文', async () => {
    const { db, query } = buildStatefulDb([authStateRow()]);
    const { handleCallback } = await importCallbackService();

    fetchExternalJsonMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: ACCESS_TOKEN,
          refresh_token: 'ghr_refreshProbeToken',
          token_type: 'bearer',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 4242, login: 'kou' }));

    await handleCallback(db, {
      userId: '1',
      provider: 'github',
      code: 'code-1',
      state: 'state-abc',
    });

    const insert = connectionInsertCall(query);
    expect(insert).toBeDefined();
    const params = (insert?.[1] ?? []) as unknown[];

    expect(isSealed(String(params[3]))).toBe(true);
    expect(openSealed(String(params[3]), KEY)).toBe(ACCESS_TOKEN);
    expect(isSealed(String(params[4]))).toBe(true);
    expect(openSealed(String(params[4]), KEY)).toBe('ghr_refreshProbeToken');

    // 明文 token / secret 绝不能出现在任何 SQL 参数里（安全红线 1）。
    const allParams = JSON.stringify(query.mock.calls.map((call) => call[1]));
    expect(allParams).not.toContain(ACCESS_TOKEN);
    expect(allParams).not.toContain('ghr_refreshProbeToken');
    expect(allParams).not.toContain(PLAIN_SECRET);
  });

  it('maskSecret 边界：空 → null；≤8 → ****；>8 → 前4 + **** + 后4（与 maskToken 同范式）', async () => {
    const { maskSecret } = await importConfigService();

    expect(maskSecret('')).toBeNull();
    expect(maskSecret('   ')).toBeNull();
    expect(maskSecret('12345678')).toBe('****');
    expect(maskSecret('123456789')).toBe('1234****6789');
    expect(maskSecret('abcdefghijklmnop')).toBe('abcd****mnop');
  });

  it('saveProviderConfig：secret 加密后落库，SQL 参数中无明文', async () => {
    const captured: unknown[][] = [];
    const { db } = createDb((sql, params) => {
      if (sql.includes('insert into oauth_provider_configs')) {
        captured.push(params);
        return { rows: [configRow()] };
      }
      if (sql.includes('from oauth_provider_configs')) {
        return { rows: [configRow()] };
      }
      return { rows: [] };
    });
    const { saveProviderConfig } = await importConfigService();

    await saveProviderConfig(db, {
      provider: 'github',
      clientId: 'Iv1.abcdef',
      clientSecret: PLAIN_SECRET,
    });

    expect(captured.length).toBe(1);
    const sealedSecret = String(captured[0]?.[2] ?? '');
    expect(isSealed(sealedSecret)).toBe(true);
    expect(openSealed(sealedSecret, KEY)).toBe(PLAIN_SECRET);
    expect(JSON.stringify(captured)).not.toContain(PLAIN_SECRET);
  });

  it('DB 中 secret 密文损坏（非 v1 密文）时 fail-closed：视为未配置而非泄漏', async () => {
    const tampered = configRow({ clientSecretEncrypted: 'plain-not-sealed' });
    const { db } = createDb(() => ({ rows: [tampered] }));
    const { getProviderConfigStatuses } = await importConfigService();

    const statuses = await getProviderConfigStatuses(db);
    const github = statuses.find((item) => item.provider === 'github');

    expect(github?.configured).toBe(false);
    expect(github?.maskedClientSecret).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. API 打码契约（服务层真实现）：整棵 DTO 不含明文 / 不含密文 v1: 前缀
// ---------------------------------------------------------------------------
describe('[探针] API 响应体打码契约', () => {
  it('getProviderConfigStatuses 整棵 JSON 无 secret 明文、无 v1: 密文前缀', async () => {
    const { db } = createDb(() => ({ rows: [configRow()] }));
    const { getProviderConfigStatuses } = await importConfigService();

    const statuses = await getProviderConfigStatuses(db);
    const serialized = JSON.stringify(statuses);

    expect(serialized).not.toContain(PLAIN_SECRET);
    expect(serialized).not.toContain('v1:');
    // 打码契约：对外只有 masked 形态（前 4 + **** + 后 4），密文绝不出现在 DTO。
    expect(serialized).toContain('gh-c****-zzz');
    // 打码契约：对外只有 masked 形态。
    expect(JSON.parse(serialized).find((s: { provider: string }) => s.provider === 'github')
      .maskedClientSecret).toMatch(/^\S{4}\*{4}\S{4}$/);
  });

  it('connections 对外 DTO（toConnectionView）整棵 JSON 无 token 明文、无 v1: 前缀', async () => {
    const { toConnectionView } = await importConnectionService();
    const row = {
      id: '77',
      userId: '1',
      provider: 'github',
      providerAccountId: '4242',
      displayName: 'Kou',
      avatarUrl: null,
      accessTokenEncrypted: seal(ACCESS_TOKEN, KEY),
      refreshTokenEncrypted: null,
      tokenType: 'bearer',
      scope: 'read:user',
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      status: 'active',
      authorizedAt: new Date('2025-03-01T00:00:00.000Z'),
      lastRefreshedAt: null,
      createdAt: new Date('2025-03-01T00:00:00.000Z'),
      updatedAt: new Date('2025-03-01T00:00:00.000Z'),
    } as never;

    const view = toConnectionView(row);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain('v1:');
    expect(serialized).not.toContain('_encrypted');
  });
});

// ---------------------------------------------------------------------------
// 5. provider 契约补充
// ---------------------------------------------------------------------------
describe('[探针] 四家 provider 契约补充', () => {
  it('抖音：扁平响应（无 data 包装）也能解析，缺省 error_code 不误判失败', () => {
    const douyin = requireProvider('douyin');

    const flat = douyin.parseTokenResponse({ access_token: 'dy_token', open_id: 'open-1' });
    expect(flat.accessToken).toBe('dy_token');
    expect(flat.providerAccountId).toBe('open-1');

    const nestedNoError = douyin.parseTokenResponse({ data: { access_token: 'dy2' } });
    expect(nestedNoError.accessToken).toBe('dy2');
  });

  it('小红书：error 与 code 同时存在时 error 优先（RFC 语义不被国内 code 形态掩盖）', () => {
    const xhs = requireProvider('xiaohongshu');

    try {
      xhs.parseTokenResponse({ error: 'invalid_grant', code: 0, access_token: 'xhs_token' });
      expect.unreachable('error 优先，即使 code===0 也应失败');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      expect((err as OAuthError).kind).toBe('provider_error');
    }
  });

  it('GitHub token 请求带 accept: application/json（否则平台回 form-urlencoded）', () => {
    const github = requireProvider('github');
    const request = github.buildTokenRequest({
      clientId: 'Iv1.abc',
      clientSecret: 's3cr3t',
      code: 'code-1',
      redirectUri: REDIRECT_URI,
      codeVerifier: null,
    });

    expect(request.headers.accept).toBe('application/json');
    expect(request.method).toBe('POST');
    expect(request.bodyKind).toBe('form-urlencoded');
  });
});

// ---------------------------------------------------------------------------
// 6. 错误归一补充
// ---------------------------------------------------------------------------
describe('[探针] 错误归一', () => {
  it('微信 HTTP 200 + errcode=40029 必须判为 provider_error，绝不能当作成功', () => {
    const wechat = requireProvider('wechat');

    expect(() =>
      wechat.parseTokenResponse({ errcode: 40029, errmsg: 'invalid code' }),
    ).toThrowError(OAuthError);

    try {
      wechat.parseTokenResponse({ errcode: 40029, errmsg: 'invalid code' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as OAuthError).kind).toBe('provider_error');
      // 平台 errcode 只进 debugHint，绝不进用户可见 message。
      expect((err as OAuthError).message).not.toContain('40029');
    }
  });

  it('九种 OAuthErrorKind 的 message 均含中文且不泄露 kind 标识', () => {
    const kinds = [
      'not_configured',
      'user_denied',
      'invalid_state',
      'state_expired',
      'redirect_uri_mismatch',
      'token_exchange_failed',
      'refresh_failed',
      'provider_error',
      'network',
    ] as const;

    for (const kind of kinds) {
      const error = new OAuthError(kind);
      expect(error.message).toMatch(/[\u4e00-\u9fa5]/);
      expect(error.message).not.toContain(kind);
    }
  });
});

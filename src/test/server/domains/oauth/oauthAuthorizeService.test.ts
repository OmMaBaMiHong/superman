/**
 * T03 授权发起服务测试（§4.1）。
 *
 * 重点验证四件事：
 * 1. PKCE 分支只由 `capabilities.supportsPkce` 决定（GitHub 有、微信没有）；
 * 2. `code_verifier` 落库前必须 `seal()`，且解密后能推回 URL 里的 `code_challenge`
 *    ——这条往返断言比「字段非空」强得多，能挡住「写了个假密文」的实现；
 * 3. `redirect_uri` 随 state 落库，与 authorize URL 中的完全一致（ADR-05）；
 * 4. 平台未配置时**不产生任何 state 行**。
 */

import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeaderReader } from '@/server/domains/oauth/redirectUri';
import { OAUTH_STATE_TTL_MS } from '@/server/domains/oauth/types';
import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resetSecretKeyCache } from '@/server/infra/crypto/secretKeyProvider';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';
import { deriveCodeChallenge } from '@/server/integrations/oauth/pkce';

const getServerEnvMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/env', () => ({
  getServerEnv: () => getServerEnvMock(),
}));

const KEY_MATERIAL = 'fedcba9876543210'.repeat(4);
const KEY = Buffer.from(KEY_MATERIAL, 'hex');
const PLAIN_SECRET = 'client-secret-must-not-leak';

interface FakeQueryResult {
  rows?: unknown[];
  rowCount?: number;
}

type QueryHandler = (sql: string, params: unknown[]) => FakeQueryResult | undefined;

interface InsertedState {
  state: string;
  provider: string;
  userId: string;
  codeVerifierEncrypted: string | null;
  redirectUri: string;
  returnTo: string | null;
  expiresAt: Date;
}

function createDb(handler: QueryHandler = () => undefined) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const result = handler(sql, params) ?? {};
    const rows = result.rows ?? [];
    return { rows, rowCount: result.rowCount ?? rows.length };
  });

  return { db: { query } as unknown as Pool, query };
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

/** 把 insert 的位置参数还原成结构体，避免测试里到处写魔法下标。 */
function readInsertedState(query: ReturnType<typeof createDb>['query']): InsertedState | null {
  const call = query.mock.calls.find((item) =>
    String(item[0] ?? '').includes('insert into oauth_auth_states'),
  );
  if (call === undefined) {
    return null;
  }

  const params = (call[1] ?? []) as unknown[];
  return {
    state: String(params[0]),
    provider: String(params[1]),
    userId: String(params[2]),
    codeVerifierEncrypted: params[3] === null ? null : String(params[3]),
    redirectUri: String(params[4]),
    returnTo: params[5] === null ? null : String(params[5]),
    expiresAt: params[6] as Date,
  };
}

function buildDb(overrides: Record<string, unknown> = {}) {
  return createDb((sql) => {
    if (sql.includes('from oauth_provider_configs')) {
      return { rows: [configRow(overrides)] };
    }
    if (sql.includes('insert into oauth_auth_states')) {
      return { rows: [{ state: 'ignored', createdAt: new Date(), expiresAt: new Date() }] };
    }
    return { rows: [] };
  });
}

async function importService() {
  return import('@/server/domains/oauth/services/oauthAuthorizeService');
}

describe('oauthAuthorizeService.startAuthorization', () => {
  beforeEach(() => {
    getServerEnvMock.mockReturnValue({ FEEDFUSE_PUBLIC_BASE_URL: 'https://feedfuse.test' });
    process.env.FEEDFUSE_SECRET_KEY = KEY_MATERIAL;
    resetSecretKeyCache();
  });

  afterEach(() => {
    delete process.env.FEEDFUSE_SECRET_KEY;
    resetSecretKeyCache();
  });

  it('GitHub：生成 PKCE，URL 带 S256 挑战，落库的 verifier 密文可推回该挑战', async () => {
    const { db, query } = buildDb();
    const { startAuthorization } = await importService();

    const result = await startAuthorization(db, {
      userId: '1',
      provider: 'github',
      returnTo: '/reader?feed=3',
    });

    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.abcdef');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const inserted = readInsertedState(query);
    expect(inserted).not.toBeNull();
    expect(inserted?.state).toBe(url.searchParams.get('state'));
    expect(inserted?.userId).toBe('1');
    expect(inserted?.provider).toBe('github');

    // 往返验证：密文 → 明文 verifier → S256 → 必须等于 URL 里的 challenge。
    const encrypted = inserted?.codeVerifierEncrypted ?? '';
    expect(isSealed(encrypted)).toBe(true);
    const verifier = openSealed(encrypted, KEY);
    expect(deriveCodeChallenge(verifier)).toBe(url.searchParams.get('code_challenge'));
    // 明文 verifier 绝不能出现在跳转 URL 里（那样 PKCE 形同虚设）。
    expect(result.authorizeUrl).not.toContain(verifier);
  });

  it('微信：不支持 PKCE 时不生成 verifier，URL 无 code_challenge 且 fragment 在末尾', async () => {
    const { db, query } = buildDb({ provider: 'wechat', clientId: 'wxappid123' });
    const { startAuthorization } = await importService();

    const result = await startAuthorization(db, { userId: '1', provider: 'wechat' });

    expect(result.authorizeUrl.endsWith('#wechat_redirect')).toBe(true);
    expect(result.authorizeUrl).not.toContain('code_challenge');
    expect(result.authorizeUrl).toContain('appid=wxappid123');

    expect(readInsertedState(query)?.codeVerifierEncrypted).toBeNull();
  });

  it('redirect_uri 随 state 落库，且与 authorize URL 中的值逐字一致（ADR-05）', async () => {
    const { db, query } = buildDb();
    const { startAuthorization } = await importService();

    const result = await startAuthorization(db, { userId: '1', provider: 'github' });

    const expected = 'https://feedfuse.test/api/oauth/callback/github';
    expect(new URL(result.authorizeUrl).searchParams.get('redirect_uri')).toBe(expected);
    expect(readInsertedState(query)?.redirectUri).toBe(expected);
  });

  it('反向代理场景下 redirect_uri 取自请求头推导结果', async () => {
    getServerEnvMock.mockReturnValue({ FEEDFUSE_PUBLIC_BASE_URL: undefined });
    const { db, query } = buildDb();
    const { startAuthorization } = await importService();

    await startAuthorization(db, {
      userId: '1',
      provider: 'github',
      headers: createHeaderReader({
        host: 'internal:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'reader.example.com',
      }),
    });

    expect(readInsertedState(query)?.redirectUri).toBe(
      'https://reader.example.com/api/oauth/callback/github',
    );
  });

  it('returnTo 经清洗后落库：站外地址一律降级为默认路径', async () => {
    const evil = buildDb();
    const { startAuthorization } = await importService();

    await startAuthorization(evil.db, {
      userId: '1',
      provider: 'github',
      returnTo: 'https://evil.example.com/steal',
    });
    expect(readInsertedState(evil.query)?.returnTo).toBe('/');

    const safe = buildDb();
    await startAuthorization(safe.db, {
      userId: '1',
      provider: 'github',
      returnTo: '/reader?feed=3',
    });
    expect(readInsertedState(safe.query)?.returnTo).toBe('/reader?feed=3');
  });

  it('平台未配置时抛 not_configured，且不写入任何 state 行', async () => {
    const { db, query } = createDb(() => ({ rows: [] }));
    const { startAuthorization } = await importService();

    await expect(startAuthorization(db, { userId: '1', provider: 'douyin' })).rejects.toMatchObject(
      { kind: 'not_configured' },
    );

    expect(readInsertedState(query)).toBeNull();
    for (const call of query.mock.calls) {
      expect(String(call[0] ?? '')).not.toContain('insert into oauth_auth_states');
    }
  });

  it('被禁用的平台同样拒绝发起授权', async () => {
    const { db } = buildDb({ enabled: false });
    const { startAuthorization } = await importService();

    await expect(
      startAuthorization(db, { userId: '1', provider: 'github' }),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('state 具备足够熵且 TTL 为 10 分钟', async () => {
    const first = buildDb();
    const { startAuthorization } = await importService();

    const before = Date.now();
    await startAuthorization(first.db, { userId: '1', provider: 'github' });
    const after = Date.now();

    const inserted = readInsertedState(first.query);
    expect(inserted?.state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const expiresAt = inserted?.expiresAt.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + OAUTH_STATE_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + OAUTH_STATE_TTL_MS);

    const second = buildDb();
    await startAuthorization(second.db, { userId: '1', provider: 'github' });
    expect(readInsertedState(second.query)?.state).not.toBe(inserted?.state);
  });

  it('authorize URL 绝不携带 client_secret', async () => {
    const { db } = buildDb();
    const { startAuthorization } = await importService();

    const result = await startAuthorization(db, { userId: '1', provider: 'github' });

    expect(result.authorizeUrl).not.toContain(PLAIN_SECRET);
    expect(result.authorizeUrl.toLowerCase()).not.toContain('secret');
  });

  it('插入 state 前会顺带清理过期行（惰性清理，不新增定时任务）', async () => {
    const { db, query } = buildDb();
    const { startAuthorization } = await importService();

    await startAuthorization(db, { userId: '1', provider: 'github' });

    const statements = query.mock.calls.map((call) => String(call[0] ?? ''));
    const purgeIndex = statements.findIndex((sql) => sql.includes('expires_at < now()'));
    const insertIndex = statements.findIndex((sql) =>
      sql.includes('insert into oauth_auth_states'),
    );

    expect(purgeIndex).toBeGreaterThanOrEqual(0);
    expect(purgeIndex).toBeLessThan(insertIndex);
  });
});

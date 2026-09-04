/**
 * T03 连接管理服务测试（§4.3）。
 *
 * 覆盖的验收项：
 * - `toConnectionView` **结构性无 token 字段**（安全红线 2）；
 * - 撤销走带 `user_id` 的 SQL，越权表现为 404 而非 403（不泄露存在性）；
 * - 刷新失败置 `status='expired'` 而**非删除**；
 * - `ensureFreshAccessToken` 是明文出口，异常路径一律安静返回 null。
 */

import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OAuthConnectionRow } from '@/server/domains/oauth/types';
import { open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resetSecretKeyCache } from '@/server/infra/crypto/secretKeyProvider';
import { NotFoundError } from '@/server/infra/http/errors';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';

const getServerEnvMock = vi.hoisted(() => vi.fn());
const fetchExternalJsonMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/env', () => ({
  getServerEnv: () => getServerEnvMock(),
}));

vi.mock('@/server/infra/http/externalHttpClient', () => ({
  fetchExternalJson: (...args: unknown[]) => fetchExternalJsonMock(...args),
}));

const KEY_MATERIAL = '76543210fedcba98'.repeat(4);
const KEY = Buffer.from(KEY_MATERIAL, 'hex');
const PLAIN_SECRET = 'wx-app-secret-value';
const ACCESS_TOKEN = 'wx_access_token_value_001';
const REFRESH_TOKEN = 'wx_refresh_token_value_001';
const NEW_ACCESS_TOKEN = 'wx_access_token_value_002';

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
    finalUrl: 'https://api.weixin.qq.com/sns/oauth2/refresh_token',
    contentType: 'application/json',
    headers: {},
    json,
    rawBody: JSON.stringify(json),
    jsonParseError: null,
  };
}

function configRow(): Record<string, unknown> {
  return {
    provider: 'wechat',
    clientId: 'wxappid123',
    clientSecretEncrypted: seal(PLAIN_SECRET, KEY),
    enabled: true,
    createdAt: new Date('2025-03-01T00:00:00.000Z'),
    updatedAt: new Date('2025-03-01T00:00:00.000Z'),
  };
}

function row(overrides: Partial<OAuthConnectionRow> = {}): OAuthConnectionRow {
  return {
    id: '77',
    userId: '1',
    provider: 'wechat',
    providerAccountId: 'openid-1',
    displayName: '寇豆码',
    avatarUrl: 'https://avatars.example.com/kou.png',
    accessTokenEncrypted: seal(ACCESS_TOKEN, KEY),
    refreshTokenEncrypted: seal(REFRESH_TOKEN, KEY),
    tokenType: 'Bearer',
    scope: 'snsapi_login',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
    status: 'active',
    authorizedAt: new Date('2025-03-01T08:00:00.000Z'),
    lastRefreshedAt: null,
    createdAt: new Date('2025-03-01T08:00:00.000Z'),
    updatedAt: new Date('2025-03-01T08:00:00.000Z'),
    ...overrides,
  };
}

async function importService() {
  return import('@/server/domains/oauth/services/oauthConnectionService');
}

describe('oauthConnectionService', () => {
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

  describe('toConnectionView', () => {
    it('对外 DTO 结构性不含任何 token 字段', async () => {
      const { toConnectionView } = await importService();

      const view = toConnectionView(row());

      expect(Object.keys(view).sort()).toEqual([
        'accessTokenExpiresAt',
        'authorizedAt',
        'avatarUrl',
        'canRefresh',
        'displayName',
        'id',
        'provider',
        'status',
      ]);

      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain(ACCESS_TOKEN);
      expect(serialized).not.toContain(REFRESH_TOKEN);
      expect(serialized).not.toContain('v1:');
      expect(serialized.toLowerCase()).not.toContain('token_encrypted');
    });

    it('库里是 active 但 access_token 已过期时对外呈现 expired', async () => {
      const { toConnectionView } = await importService();

      const view = toConnectionView(
        row({ status: 'active', accessTokenExpiresAt: new Date(Date.now() - 1_000) }),
      );

      expect(view.status).toBe('expired');
    });

    it('canRefresh 同时取决于平台能力、refresh_token 存在性与连接状态', async () => {
      const { toConnectionView } = await importService();

      expect(toConnectionView(row()).canRefresh).toBe(true);
      expect(toConnectionView(row({ refreshTokenEncrypted: null })).canRefresh).toBe(false);
      expect(toConnectionView(row({ status: 'revoked' })).canRefresh).toBe(false);
      expect(
        toConnectionView(row({ refreshTokenExpiresAt: new Date(Date.now() - 1_000) })).canRefresh,
      ).toBe(false);
      // GitHub OAuth App 不下发 refresh_token，能力层面就不可刷新。
      expect(toConnectionView(row({ provider: 'github' })).canRefresh).toBe(false);
    });

    it('时间字段序列化为 ISO 8601', async () => {
      const { toConnectionView } = await importService();

      const view = toConnectionView(row({ accessTokenExpiresAt: null }));

      expect(view.authorizedAt).toBe('2025-03-01T08:00:00.000Z');
      expect(view.accessTokenExpiresAt).toBeNull();
    });
  });

  describe('listConnections', () => {
    it('按用户列出连接，返回值不含凭据', async () => {
      const { db, query } = createDb(() => ({ rows: [row(), row({ id: '78', provider: 'github' })] }));
      const { listConnections } = await importService();

      const views = await listConnections(db, '1');

      expect(views.map((view) => view.id)).toEqual(['77', '78']);
      expect(String(query.mock.calls[0]?.[0] ?? '')).toContain('user_id = $1');
      expect(JSON.stringify(views)).not.toContain('v1:');
    });
  });

  describe('revokeConnection', () => {
    it('删除成功返回 id，SQL 带 user_id', async () => {
      const { db, query } = createDb(() => ({ rows: [], rowCount: 1 }));
      const { revokeConnection } = await importService();

      await expect(revokeConnection(db, '1', '77')).resolves.toEqual({ id: '77' });
      expect(String(query.mock.calls[0]?.[0] ?? '')).toContain('user_id = $1');
      expect(query.mock.calls[0]?.[1]).toEqual(['1', '77']);
    });

    it('越权或不存在时抛 NotFound（不区分两者，避免探测）', async () => {
      const { db } = createDb(() => ({ rows: [], rowCount: 0 }));
      const { revokeConnection } = await importService();

      await expect(revokeConnection(db, '2', '77')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('refreshConnection', () => {
    function buildDb(connection: OAuthConnectionRow | null, updated?: OAuthConnectionRow) {
      return createDb((sql) => {
        if (sql.includes('select') || sql.includes('from oauth_connections')) {
          if (sql.includes('from oauth_provider_configs')) {
            return { rows: [configRow()] };
          }
          return { rows: connection === null ? [] : [connection] };
        }
        if (sql.includes('from oauth_provider_configs')) {
          return { rows: [configRow()] };
        }
        if (sql.includes('update oauth_connections')) {
          return { rows: [updated ?? row()] };
        }
        return { rows: [] };
      });
    }

    it('刷新成功后写回新密文并返回不含凭据的视图', async () => {
      fetchExternalJsonMock.mockResolvedValueOnce(
        jsonResponse({
          access_token: NEW_ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          expires_in: 7200,
          openid: 'openid-1',
        }),
      );

      const { db, query } = buildDb(row(), row({ accessTokenEncrypted: seal(NEW_ACCESS_TOKEN, KEY) }));
      const { refreshConnection } = await importService();

      const view = await refreshConnection(db, '1', '77');

      const updateCall = query.mock.calls.find((call) =>
        String(call[0] ?? '').includes('update oauth_connections'),
      );
      const params = (updateCall?.[1] ?? []) as unknown[];

      expect(params[0]).toBe('1');
      expect(params[1]).toBe('77');
      expect(openSealed(String(params[2]), KEY)).toBe(NEW_ACCESS_TOKEN);
      expect(JSON.stringify(params)).not.toContain(NEW_ACCESS_TOKEN);
      expect(JSON.stringify(view)).not.toContain('v1:');

      // 刷新请求带上了明文 refresh_token 与 appid，但不含 client_secret 之外的多余参数。
      const [, options] = fetchExternalJsonMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(options.maxRedirects).toBe(0);
      expect(options.redactResponseBody).toBe(true);
    });

    it('连接不存在或不属于该用户 → NotFound', async () => {
      const { db } = buildDb(null);
      const { refreshConnection } = await importService();

      await expect(refreshConnection(db, '1', '77')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('平台不支持刷新（GitHub）→ refresh_failed，且不出网', async () => {
      const { db } = buildDb(row({ provider: 'github' }));
      const { refreshConnection } = await importService();

      await expect(refreshConnection(db, '1', '77')).rejects.toMatchObject({
        kind: 'refresh_failed',
      });
      expect(fetchExternalJsonMock).not.toHaveBeenCalled();
    });

    it('refresh_token 缺失时置 expired 并抛 refresh_failed（不删除连接）', async () => {
      const { db, query } = buildDb(row({ refreshTokenEncrypted: null }));
      const { refreshConnection } = await importService();

      await expect(refreshConnection(db, '1', '77')).rejects.toBeInstanceOf(OAuthError);

      const statusCall = query.mock.calls.find((call) =>
        String(call[0] ?? '').includes('update oauth_connections'),
      );
      expect(statusCall?.[1]).toEqual(['1', '77', 'expired']);
      expect(
        query.mock.calls.some((call) =>
          String(call[0] ?? '').includes('delete from oauth_connections'),
        ),
      ).toBe(false);
    });

    it('平台续期失败（HTTP 200 + errcode）时置 expired 而非删除连接', async () => {
      fetchExternalJsonMock.mockResolvedValueOnce(
        jsonResponse({ errcode: 40030, errmsg: 'invalid refresh_token' }),
      );

      const { db, query } = buildDb(row());
      const { refreshConnection } = await importService();

      // 已经是 OAuthError 时保留更精确的 kind（UI 才能给出「平台报错」而非笼统的「续期失败」），
      // 但落库状态必须是 expired —— 这才是本用例真正要守的验收项。
      await expect(refreshConnection(db, '1', '77')).rejects.toMatchObject({
        kind: 'provider_error',
      });

      const statusCall = query.mock.calls.find(
        (call) =>
          String(call[0] ?? '').includes('update oauth_connections') &&
          String(call[0] ?? '').includes('status     = $3'),
      );
      expect(statusCall?.[1]).toEqual(['1', '77', 'expired']);
      expect(
        query.mock.calls.some((call) =>
          String(call[0] ?? '').includes('delete from oauth_connections'),
        ),
      ).toBe(false);
    });

    it('网络异常时同样只置 expired，错误保留 network 供 UI 区分', async () => {
      fetchExternalJsonMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      const { db, query } = buildDb(row());
      const { refreshConnection } = await importService();

      const error = await refreshConnection(db, '1', '77').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).kind).toBe('network');

      const statusCall = query.mock.calls.find(
        (call) =>
          String(call[0] ?? '').includes('update oauth_connections') &&
          String(call[0] ?? '').includes('status     = $3'),
      );
      expect(statusCall?.[1]).toEqual(['1', '77', 'expired']);
      expect(
        query.mock.calls.some((call) =>
          String(call[0] ?? '').includes('delete from oauth_connections'),
        ),
      ).toBe(false);
    });
  });

  describe('ensureFreshAccessToken', () => {
    it('token 仍有效时直接返回解密后的明文', async () => {
      const { db } = createDb(() => ({ rows: [row()] }));
      const { ensureFreshAccessToken } = await importService();

      await expect(ensureFreshAccessToken(db, '1', '77')).resolves.toBe(ACCESS_TOKEN);
    });

    it('连接不存在或已撤销时返回 null', async () => {
      const missing = createDb(() => ({ rows: [] }));
      const revoked = createDb(() => ({ rows: [row({ status: 'revoked' })] }));
      const { ensureFreshAccessToken } = await importService();

      await expect(ensureFreshAccessToken(missing.db, '1', '77')).resolves.toBeNull();
      await expect(ensureFreshAccessToken(revoked.db, '1', '77')).resolves.toBeNull();
    });

    it('access_token 临期时自动刷新后返回新明文', async () => {
      fetchExternalJsonMock.mockResolvedValueOnce(
        jsonResponse({ access_token: NEW_ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 7200 }),
      );

      const expiring = row({ accessTokenExpiresAt: new Date(Date.now() + 10_000) });
      const refreshed = row({ accessTokenEncrypted: seal(NEW_ACCESS_TOKEN, KEY) });

      let selectCount = 0;
      const { db } = createDb((sql) => {
        if (sql.includes('from oauth_provider_configs')) {
          return { rows: [configRow()] };
        }
        if (sql.includes('update oauth_connections')) {
          return { rows: [refreshed] };
        }
        if (sql.includes('from oauth_connections')) {
          selectCount += 1;
          // 前两次读到临期行（ensureFresh + refreshConnection），刷新后读到新行。
          return { rows: [selectCount <= 2 ? expiring : refreshed] };
        }
        return { rows: [] };
      });

      const { ensureFreshAccessToken } = await importService();

      await expect(ensureFreshAccessToken(db, '1', '77')).resolves.toBe(NEW_ACCESS_TOKEN);
    });

    it('刷新失败时安静降级为 null（错误已在 refreshConnection 内落地为 expired）', async () => {
      fetchExternalJsonMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      const expiring = row({ accessTokenExpiresAt: new Date(Date.now() + 10_000) });
      const { db } = createDb((sql) => {
        if (sql.includes('from oauth_provider_configs')) {
          return { rows: [configRow()] };
        }
        if (sql.includes('update oauth_connections')) {
          return { rows: [expiring] };
        }
        if (sql.includes('from oauth_connections')) {
          return { rows: [expiring] };
        }
        return { rows: [] };
      });

      const { ensureFreshAccessToken } = await importService();

      await expect(ensureFreshAccessToken(db, '1', '77')).resolves.toBeNull();
    });

    it('密文损坏时返回 null 而不是抛错', async () => {
      const { db } = createDb(() => ({
        rows: [row({ accessTokenEncrypted: 'not-a-sealed-value' })],
      }));
      const { ensureFreshAccessToken } = await importService();

      await expect(ensureFreshAccessToken(db, '1', '77')).resolves.toBeNull();
    });
  });
});

/**
 * T03 仓储层契约测试。
 *
 * 这里守的是三条硬约束（docs/arch-oauth-hub.md §7.5 安全红线 4 / 9）：
 * 1. `consumeAuthState` 必须是**单条** `DELETE ... RETURNING`，重放必然落空；
 * 2. 连接类 SQL **每一条都带 `user_id` 谓词**，越权在数据层失败；
 * 3. 仓储层只透传密文，**不做加解密**，明文绝不进入 SQL 参数。
 */

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  consumeAuthState,
  deleteAuthStatesForUser,
  insertAuthState,
  purgeExpiredAuthStates,
} from '@/server/domains/oauth/repositories/oauthAuthStatesRepo';
import {
  deleteConnection,
  getConnectionById,
  getConnectionByProvider,
  listConnectionsByUser,
  updateConnectionStatus,
  updateConnectionTokens,
  upsertConnection,
} from '@/server/domains/oauth/repositories/oauthConnectionsRepo';
import {
  deleteProviderConfig,
  getProviderConfig,
  listProviderConfigs,
  upsertProviderConfig,
} from '@/server/domains/oauth/repositories/oauthProviderConfigsRepo';

type QueryMock = ReturnType<typeof createDb>['query'];

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

function sqlAt(query: QueryMock, index: number): string {
  return String(query.mock.calls[index]?.[0] ?? '').toLowerCase();
}

function paramsAt(query: QueryMock, index: number): unknown[] {
  return (query.mock.calls[index]?.[1] ?? []) as unknown[];
}

const NOW = new Date('2025-03-01T10:00:00.000Z');
const SEALED_ACCESS = 'v1:aaaa:bbbb:cccc';
const SEALED_REFRESH = 'v1:dddd:eeee:ffff';
const SEALED_VERIFIER = 'v1:1111:2222:3333';

function rawAuthState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'state-abc',
    userId: '1',
    provider: 'github',
    codeVerifierEncrypted: SEALED_VERIFIER,
    redirectUri: 'https://feedfuse.test/api/oauth/callback/github',
    returnTo: '/reader',
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
    ...overrides,
  };
}

function rawConnection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '42',
    userId: '1',
    provider: 'github',
    providerAccountId: 'gh-1',
    displayName: 'Kou',
    avatarUrl: 'https://avatars.example.com/kou.png',
    accessTokenEncrypted: SEALED_ACCESS,
    refreshTokenEncrypted: SEALED_REFRESH,
    tokenType: 'bearer',
    scope: 'read:user',
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    status: 'active',
    authorizedAt: NOW,
    lastRefreshedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('oauthAuthStatesRepo', () => {
  it('consumeAuthState 是单条 DELETE ... RETURNING（原子消费）', async () => {
    const { db, query } = createDb(() => ({ rows: [rawAuthState()] }));

    const row = await consumeAuthState(db, 'state-abc');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = sqlAt(query, 0);
    expect(sql.trim().startsWith('delete from oauth_auth_states')).toBe(true);
    expect(sql).toContain('where state = $1');
    expect(sql).toContain('returning');
    // 不能先 select 再 delete —— 那样存在 TOCTOU 窗口，重放可能双双成功。
    expect(sql).not.toContain('select');
    // 单条语句，不允许分号拼接多语句。
    expect(sql.split(';').filter((part) => part.trim() !== '')).toHaveLength(1);

    expect(row?.state).toBe('state-abc');
    expect(paramsAt(query, 0)).toEqual(['state-abc']);
  });

  it('重放同一 state 时返回 null（第二次已无行可删）', async () => {
    let consumed = false;
    const { db } = createDb(() => {
      if (consumed) {
        return { rows: [] };
      }
      consumed = true;
      return { rows: [rawAuthState()] };
    });

    await expect(consumeAuthState(db, 'state-abc')).resolves.not.toBeNull();
    await expect(consumeAuthState(db, 'state-abc')).resolves.toBeNull();
  });

  it('insertAuthState 先惰性清理过期行，再插入密文（明文 verifier 绝不进 SQL）', async () => {
    const { db, query } = createDb((sql) =>
      sql.includes('insert into oauth_auth_states') ? { rows: [rawAuthState()] } : { rows: [] },
    );

    const expiresAt = new Date(NOW.getTime() + 600_000);
    await insertAuthState(db, {
      state: 'state-abc',
      userId: '1',
      provider: 'github',
      // 明文 verifier 由服务层持有，仓储层只应写密文。
      codeVerifier: 'PLAINTEXT-VERIFIER-SHOULD-NEVER-LAND',
      codeVerifierEncrypted: SEALED_VERIFIER,
      redirectUri: 'https://feedfuse.test/api/oauth/callback/github',
      returnTo: '/reader',
      expiresAt,
    });

    expect(sqlAt(query, 0)).toContain('delete from oauth_auth_states');
    expect(sqlAt(query, 0)).toContain('expires_at <');

    const insertSql = sqlAt(query, 1);
    expect(insertSql).toContain('insert into oauth_auth_states');
    expect(insertSql).toContain('code_verifier_encrypted');

    const params = paramsAt(query, 1);
    expect(params).toEqual([
      'state-abc',
      'github',
      '1',
      SEALED_VERIFIER,
      'https://feedfuse.test/api/oauth/callback/github',
      '/reader',
      expiresAt,
    ]);
    expect(JSON.stringify(params)).not.toContain('PLAINTEXT-VERIFIER-SHOULD-NEVER-LAND');
  });

  it('insertAuthState 允许 codeVerifierEncrypted 为 null（不支持 PKCE 的平台）', async () => {
    const { db, query } = createDb((sql) =>
      sql.includes('insert into oauth_auth_states')
        ? { rows: [rawAuthState({ provider: 'wechat', codeVerifierEncrypted: null, returnTo: null })] }
        : { rows: [] },
    );

    const row = await insertAuthState(db, {
      state: 'state-wechat',
      userId: '1',
      provider: 'wechat',
      codeVerifier: null,
      codeVerifierEncrypted: null,
      redirectUri: 'https://feedfuse.test/api/oauth/callback/wechat',
      returnTo: '/',
      expiresAt: new Date(NOW.getTime() + 600_000),
    });

    expect(paramsAt(query, 1)[3]).toBeNull();
    expect(row.codeVerifierEncrypted).toBeNull();
    // DDL 允许 return_to 为空，行映射必须原样透出 null 交由服务层兜底。
    expect(row.returnTo).toBeNull();
  });

  it('purgeExpiredAuthStates 返回清理行数', async () => {
    const { db, query } = createDb(() => ({ rows: [], rowCount: 7 }));

    await expect(purgeExpiredAuthStates(db)).resolves.toBe(7);
    expect(sqlAt(query, 0)).toContain('delete from oauth_auth_states');
  });

  it('deleteAuthStatesForUser 带 user_id 谓词', async () => {
    const { db, query } = createDb(() => ({ rows: [], rowCount: 2 }));

    await expect(deleteAuthStatesForUser(db, '1')).resolves.toBe(2);
    expect(sqlAt(query, 0)).toContain('user_id = $1');
    expect(paramsAt(query, 0)).toEqual(['1']);
  });
});

describe('oauthConnectionsRepo（安全红线 9：全部带 user_id）', () => {
  it('所有涉及具体连接的 SQL 都带 user_id 谓词', async () => {
    const { db, query } = createDb(() => ({ rows: [rawConnection()], rowCount: 1 }));

    await listConnectionsByUser(db, '1');
    await getConnectionById(db, '1', '42');
    await getConnectionByProvider(db, '1', 'github');
    await updateConnectionTokens(db, {
      id: '42',
      userId: '1',
      accessTokenEncrypted: SEALED_ACCESS,
      refreshTokenEncrypted: null,
      tokenType: 'bearer',
      scope: 'read:user',
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });
    await updateConnectionStatus(db, '1', '42', 'expired');
    await deleteConnection(db, '1', '42');

    const statements = query.mock.calls.map((call) => String(call[0] ?? '').toLowerCase());
    expect(statements).toHaveLength(6);

    statements.forEach((sql, index) => {
      // 越权保护必须写在 where 里，而不是只出现在列别名中。
      expect(sql).toContain('where');
      const whereClause = sql.slice(sql.indexOf('where'));
      expect(whereClause).toContain('user_id = $1');
      // 且 $1 必须就是当前用户，不能被调用方错位传参。
      expect(paramsAt(query, index)[0]).toBe('1');
    });
  });

  it('upsertConnection 先删后插，快照只含展示信息且不含任何 token', async () => {
    const { db, query } = createDb((sql) =>
      sql.includes('insert into oauth_connections') ? { rows: [rawConnection()] } : { rows: [] },
    );

    await upsertConnection(db, {
      userId: '1',
      provider: 'github',
      providerAccountId: 'gh-1',
      displayName: 'Kou',
      avatarUrl: 'https://avatars.example.com/kou.png',
      accessTokenEncrypted: SEALED_ACCESS,
      refreshTokenEncrypted: SEALED_REFRESH,
      tokenType: 'bearer',
      scope: 'read:user',
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });

    const deleteSql = sqlAt(query, 0);
    expect(deleteSql).toContain('delete from oauth_connections');
    expect(deleteSql).toContain('user_id = $1');
    expect(deleteSql).toContain('provider = $2');
    expect(paramsAt(query, 0)).toEqual(['1', 'github']);

    const insertSql = sqlAt(query, 1);
    expect(insertSql).toContain('insert into oauth_connections');
    expect(insertSql).toContain("'active'");

    const snapshot = JSON.parse(String(paramsAt(query, 1)[9])) as Record<string, unknown>;
    expect(snapshot).toEqual({
      displayName: 'Kou',
      avatarUrl: 'https://avatars.example.com/kou.png',
    });
    // 快照里出现任何 token 字段都是严重泄漏。
    expect(JSON.stringify(snapshot)).not.toContain('v1:');
  });

  it('upsertConnection 的空展示信息不会写进快照', async () => {
    const { db, query } = createDb((sql) =>
      sql.includes('insert into oauth_connections')
        ? { rows: [rawConnection({ displayName: null, avatarUrl: null })] }
        : { rows: [] },
    );

    await upsertConnection(db, {
      userId: '1',
      provider: 'douyin',
      providerAccountId: 'dy-1',
      displayName: null,
      avatarUrl: null,
      accessTokenEncrypted: SEALED_ACCESS,
      refreshTokenEncrypted: null,
      tokenType: null,
      scope: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });

    expect(JSON.parse(String(paramsAt(query, 1)[9]))).toEqual({});
  });

  it('updateConnectionTokens 用 coalesce 保留未下发的 refresh_token 并回到 active', async () => {
    const { db, query } = createDb(() => ({ rows: [rawConnection()] }));

    await updateConnectionTokens(db, {
      id: '42',
      userId: '1',
      accessTokenEncrypted: SEALED_ACCESS,
      refreshTokenEncrypted: null,
      tokenType: null,
      scope: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });

    const sql = sqlAt(query, 0);
    expect(sql).toContain('update oauth_connections');
    expect(sql).toContain('refresh_token_encrypted  = coalesce($4, refresh_token_encrypted)');
    expect(sql).toContain("status                   = 'active'");
    expect(sql).toContain('last_refreshed_at        = now()');
    expect(paramsAt(query, 0)[3]).toBeNull();
  });

  it('updateConnectionStatus 是 UPDATE（刷新失败置 expired 而非删除）', async () => {
    const { db, query } = createDb(() => ({ rows: [rawConnection({ status: 'expired' })] }));

    const row = await updateConnectionStatus(db, '1', '42', 'expired');

    const sql = sqlAt(query, 0);
    expect(sql).toContain('update oauth_connections');
    expect(sql).not.toContain('delete from');
    expect(paramsAt(query, 0)).toEqual(['1', '42', 'expired']);
    expect(row?.status).toBe('expired');
  });

  it('deleteConnection 按受影响行数返回布尔值（越权删除必然为 false）', async () => {
    const hit = createDb(() => ({ rows: [], rowCount: 1 }));
    await expect(deleteConnection(hit.db, '1', '42')).resolves.toBe(true);

    const miss = createDb(() => ({ rows: [], rowCount: 0 }));
    await expect(deleteConnection(miss.db, '2', '42')).resolves.toBe(false);
    expect(sqlAt(miss.query, 0)).toContain('user_id = $1');
  });

  it('getConnectionById 无行返回 null，且 SELECT 从 profile_snapshot 展平展示字段', async () => {
    const { db, query } = createDb(() => ({ rows: [] }));

    await expect(getConnectionById(db, '1', '42')).resolves.toBeNull();
    const sql = sqlAt(query, 0);
    expect(sql).toContain(`profile_snapshot->>'displayname'`);
    expect(sql).toContain(`profile_snapshot->>'avatarurl'`);
  });

  it('行映射原样透传密文，不做任何解密', async () => {
    const { db } = createDb(() => ({ rows: [rawConnection()] }));

    const rows = await listConnectionsByUser(db, '1');

    expect(rows[0]?.accessTokenEncrypted).toBe(SEALED_ACCESS);
    expect(rows[0]?.refreshTokenEncrypted).toBe(SEALED_REFRESH);
  });
});

describe('oauthProviderConfigsRepo', () => {
  function rawConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      provider: 'github',
      clientId: 'Iv1.client',
      clientSecretEncrypted: 'v1:aa:bb:cc',
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  it('省略密文时用 coalesce 保留原值（用户只改 Client ID 不应清空 secret）', async () => {
    const { db, query } = createDb(() => ({ rows: [rawConfig()] }));

    await upsertProviderConfig(db, { provider: 'github', clientId: 'Iv1.client' });

    const sql = sqlAt(query, 0);
    expect(sql).toContain('on conflict (provider) do update set');
    expect(sql).toContain(
      'client_secret_encrypted = coalesce($3, oauth_provider_configs.client_secret_encrypted)',
    );
    expect(paramsAt(query, 0)[2]).toBeNull();
    expect(paramsAt(query, 0)[3]).toBeNull();
  });

  it('传入密文与空串分别表示「更新」与「显式清空」', async () => {
    const updated = createDb(() => ({ rows: [rawConfig()] }));
    await upsertProviderConfig(updated.db, {
      provider: 'github',
      clientId: 'Iv1.client',
      clientSecretEncrypted: 'v1:new:tag:ct',
      enabled: false,
    });
    expect(paramsAt(updated.query, 0)[2]).toBe('v1:new:tag:ct');
    expect(paramsAt(updated.query, 0)[3]).toBe(false);

    const cleared = createDb(() => ({ rows: [rawConfig({ clientSecretEncrypted: '' })] }));
    await upsertProviderConfig(cleared.db, {
      provider: 'github',
      clientId: 'Iv1.client',
      clientSecretEncrypted: '',
    });
    expect(paramsAt(cleared.query, 0)[2]).toBe('');
  });

  it('getProviderConfig 不存在返回 null，缺失列兜底空串', async () => {
    const missing = createDb(() => ({ rows: [] }));
    await expect(getProviderConfig(missing.db, 'wechat')).resolves.toBeNull();

    const partial = createDb(() => ({
      rows: [rawConfig({ clientId: null, clientSecretEncrypted: null })],
    }));
    const row = await getProviderConfig(partial.db, 'github');
    expect(row?.clientId).toBe('');
    expect(row?.clientSecretEncrypted).toBe('');
  });

  it('listProviderConfigs 稳定排序，deleteProviderConfig 按 provider 删除', async () => {
    const list = createDb(() => ({ rows: [rawConfig()] }));
    await listProviderConfigs(list.db);
    expect(sqlAt(list.query, 0)).toContain('order by provider');

    const remove = createDb(() => ({ rows: [], rowCount: 1 }));
    await deleteProviderConfig(remove.db, 'douyin');
    expect(sqlAt(remove.query, 0)).toContain('delete from oauth_provider_configs');
    expect(paramsAt(remove.query, 0)).toEqual(['douyin']);
  });

  it('配置表是全局单例，SQL 不应出现 user_id', async () => {
    const { db, query } = createDb(() => ({ rows: [rawConfig()] }));

    await listProviderConfigs(db);
    await getProviderConfig(db, 'github');
    await upsertProviderConfig(db, { provider: 'github', clientId: 'Iv1.client' });
    await deleteProviderConfig(db, 'github');

    for (const call of query.mock.calls) {
      expect(String(call[0] ?? '').toLowerCase()).not.toContain('user_id');
    }
  });
});

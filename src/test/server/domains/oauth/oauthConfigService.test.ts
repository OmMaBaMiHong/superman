/**
 * T03 平台配置服务测试。
 *
 * 守两条红线：
 * - 安全红线 1：secret 落库前必须 `seal()`，SQL 参数里不得出现明文；
 * - 安全红线 2：对外 DTO 只有 `maskedClientSecret`，整棵返回值里搜不到明文。
 *
 * 这里刻意**不 mock secretBox**——用真密钥跑真加密，
 * 才能断言「落库值确实是密文且能解回原文」，mock 掉就等于什么都没验。
 */

import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resetSecretKeyCache } from '@/server/infra/crypto/secretKeyProvider';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';

const getServerEnvMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/env', () => ({
  getServerEnv: () => getServerEnvMock(),
}));

/** 固定测试密钥，保证密文可复现解密。 */
const KEY_MATERIAL = '0123456789abcdef'.repeat(4);
const KEY = Buffer.from(KEY_MATERIAL, 'hex');
const PLAIN_SECRET = 'gh-super-secret-value-9527';

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

/** 复用真实实现造密文，避免测试里自造一套加密逻辑。 */
function sealForTest(plain: string): string {
  return seal(plain, KEY);
}

function configRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'github',
    clientId: 'Iv1.abcdef',
    clientSecretEncrypted: sealForTest(PLAIN_SECRET),
    enabled: true,
    createdAt: new Date('2025-03-01T00:00:00.000Z'),
    updatedAt: new Date('2025-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function importService() {
  return import('@/server/domains/oauth/services/oauthConfigService');
}

describe('oauthConfigService', () => {
  beforeEach(() => {
    getServerEnvMock.mockReturnValue({ FEEDFUSE_PUBLIC_BASE_URL: 'https://feedfuse.test' });
    process.env.FEEDFUSE_SECRET_KEY = KEY_MATERIAL;
    resetSecretKeyCache();
  });

  afterEach(() => {
    delete process.env.FEEDFUSE_SECRET_KEY;
    resetSecretKeyCache();
  });

  describe('maskSecret', () => {
    it('长 secret 打码为「前 4 + **** + 后 4」', async () => {
      const { maskSecret } = await importService();
      expect(maskSecret('abcdefghijklmnop')).toBe('abcd****mnop');
    });

    it('短 secret 全部遮蔽，空值返回 null', async () => {
      const { maskSecret } = await importService();
      expect(maskSecret('12345678')).toBe('****');
      expect(maskSecret('   ')).toBeNull();
      expect(maskSecret('')).toBeNull();
    });
  });

  describe('getProviderConfigStatuses', () => {
    it('返回四个平台（含未配置态），顺序与 registry 一致', async () => {
      const { db } = createDb(() => ({ rows: [] }));
      const { getProviderConfigStatuses } = await importService();

      const statuses = await getProviderConfigStatuses(db);

      expect(statuses.map((item) => item.provider)).toEqual([
        'github',
        'wechat',
        'douyin',
        'xiaohongshu',
      ]);
      for (const status of statuses) {
        expect(status.configured).toBe(false);
        expect(status.maskedClientSecret).toBeNull();
        expect(status.clientId).toBe('');
        expect(status.redirectUri).toBe(
          `https://feedfuse.test/api/oauth/callback/${status.provider}`,
        );
      }
    });

    it('已配置平台返回打码 secret，整棵返回值里搜不到明文', async () => {
      const { db } = createDb(() => ({ rows: [configRow()] }));
      const { getProviderConfigStatuses } = await importService();

      const statuses = await getProviderConfigStatuses(db);
      const github = statuses.find((item) => item.provider === 'github');

      expect(github?.configured).toBe(true);
      expect(github?.clientId).toBe('Iv1.abcdef');
      expect(github?.maskedClientSecret).toBe('gh-s****9527');
      expect(github?.supportsPkce).toBe(true);

      const serialized = JSON.stringify(statuses);
      expect(serialized).not.toContain(PLAIN_SECRET);
      // 密文同样不得出现在对外 DTO 里。
      expect(serialized).not.toContain('v1:');
    });

    it('平台能力开关如实透出（微信要求 redirect_uri 严格匹配且无 PKCE）', async () => {
      const { db } = createDb(() => ({ rows: [] }));
      const { getProviderConfigStatuses } = await importService();

      const statuses = await getProviderConfigStatuses(db);
      const wechat = statuses.find((item) => item.provider === 'wechat');

      expect(wechat?.supportsPkce).toBe(false);
      expect(wechat?.requiresExactRedirectUri).toBe(true);
      expect(wechat?.displayName).toBe('微信');
    });

    it('enabled=false 时视为未配置（UI 呈引导态）', async () => {
      const { db } = createDb(() => ({ rows: [configRow({ enabled: false })] }));
      const { getProviderConfigStatuses } = await importService();

      const github = (await getProviderConfigStatuses(db)).find(
        (item) => item.provider === 'github',
      );

      expect(github?.enabled).toBe(false);
      expect(github?.configured).toBe(false);
    });

    it('密钥轮换导致解密失败时降级为未配置，而不是抛错炸掉设置页', async () => {
      const { db } = createDb(() => ({
        rows: [configRow({ clientSecretEncrypted: 'v1:ZmFrZQ==:ZmFrZQ==:ZmFrZQ==' })],
      }));
      const { getProviderConfigStatuses } = await importService();

      const github = (await getProviderConfigStatuses(db)).find(
        (item) => item.provider === 'github',
      );

      expect(github?.configured).toBe(false);
      expect(github?.maskedClientSecret).toBeNull();
    });
  });

  describe('saveProviderConfig', () => {
    it('secret 先 seal 再落库，SQL 参数中不含明文', async () => {
      const { db, query } = createDb((sql) =>
        sql.includes('insert into oauth_provider_configs')
          ? { rows: [configRow()] }
          : { rows: [configRow()] },
      );
      const { saveProviderConfig } = await importService();

      const status = await saveProviderConfig(db, {
        provider: 'github',
        clientId: 'Iv1.abcdef',
        clientSecret: PLAIN_SECRET,
      });

      const upsertCall = query.mock.calls.find((call) =>
        String(call[0] ?? '').includes('insert into oauth_provider_configs'),
      );
      const params = (upsertCall?.[1] ?? []) as unknown[];
      const stored = String(params[2]);

      expect(isSealed(stored)).toBe(true);
      expect(stored).not.toContain(PLAIN_SECRET);
      expect(openSealed(stored, KEY)).toBe(PLAIN_SECRET);
      expect(JSON.stringify(params)).not.toContain(PLAIN_SECRET);

      expect(status.maskedClientSecret).toBe('gh-s****9527');
    });

    it('省略 clientSecret 表示保留原值（参数传 null 交给 SQL coalesce）', async () => {
      const { db, query } = createDb(() => ({ rows: [configRow()] }));
      const { saveProviderConfig } = await importService();

      await saveProviderConfig(db, { provider: 'github', clientId: 'Iv1.updated' });

      const upsertCall = query.mock.calls.find((call) =>
        String(call[0] ?? '').includes('insert into oauth_provider_configs'),
      );
      expect((upsertCall?.[1] as unknown[])[2]).toBeNull();
    });

    it('传空串表示显式清空 secret', async () => {
      const { db, query } = createDb(() => ({
        rows: [configRow({ clientSecretEncrypted: '' })],
      }));
      const { saveProviderConfig } = await importService();

      const status = await saveProviderConfig(db, {
        provider: 'github',
        clientId: 'Iv1.abcdef',
        clientSecret: '   ',
      });

      const upsertCall = query.mock.calls.find((call) =>
        String(call[0] ?? '').includes('insert into oauth_provider_configs'),
      );
      expect((upsertCall?.[1] as unknown[])[2]).toBe('');
      expect(status.configured).toBe(false);
    });
  });

  describe('clearProviderConfig', () => {
    it('删除整行并返回未配置态', async () => {
      const { db, query } = createDb((sql) =>
        sql.includes('delete from') ? { rows: [], rowCount: 1 } : { rows: [] },
      );
      const { clearProviderConfig } = await importService();

      const status = await clearProviderConfig(db, 'douyin');

      expect(String(query.mock.calls[0]?.[0] ?? '')).toContain(
        'delete from oauth_provider_configs',
      );
      expect(status.configured).toBe(false);
      expect(status.clientId).toBe('');
    });
  });

  describe('resolveClientCredentials（明文唯一出口）', () => {
    it('配置完整时返回明文凭据', async () => {
      const { db } = createDb(() => ({ rows: [configRow()] }));
      const { resolveClientCredentials } = await importService();

      await expect(resolveClientCredentials(db, 'github')).resolves.toEqual({
        clientId: 'Iv1.abcdef',
        clientSecret: PLAIN_SECRET,
      });
    });

    it.each([
      ['无配置行', () => ({ rows: [] })],
      ['被禁用', () => ({ rows: [configRow({ enabled: false })] })],
      ['clientId 为空', () => ({ rows: [configRow({ clientId: '   ' })] })],
      ['secret 为空', () => ({ rows: [configRow({ clientSecretEncrypted: '' })] })],
      [
        'secret 是未加密的历史明文（防御性拒绝）',
        () => ({ rows: [configRow({ clientSecretEncrypted: PLAIN_SECRET })] }),
      ],
    ])('%s 时抛 not_configured', async (_label, handler) => {
      const { db } = createDb(handler as QueryHandler);
      const { resolveClientCredentials } = await importService();

      await expect(resolveClientCredentials(db, 'github')).rejects.toBeInstanceOf(OAuthError);
      await expect(resolveClientCredentials(db, 'github')).rejects.toMatchObject({
        kind: 'not_configured',
      });
    });

    it('抛出的错误消息为中文引导语，不含任何凭据线索', async () => {
      const { db } = createDb(() => ({ rows: [] }));
      const { resolveClientCredentials } = await importService();

      const error = await resolveClientCredentials(db, 'wechat').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).message).toContain('未配置');
      expect((error as OAuthError).message).not.toContain(PLAIN_SECRET);
    });
  });
});

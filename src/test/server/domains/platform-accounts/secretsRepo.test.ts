import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  decodeSecretKey,
  encodeSecretKey,
  generateSecretKey,
  open,
  seal,
} from '@/server/infra/crypto/secretBox';
import { resetSecretKeyCache } from '@/server/infra/crypto/secretKeyProvider';
import { maskCredential } from '@/core/platform-accounts/secrets';
import {
  createPlatformAccount,
  deletePlatformAccount,
  getDecryptedCredential,
  getPlatformAccount,
  listPlatformAccounts,
  markAccountVerified,
} from '@/core/platform-accounts/repository';

function mockPool(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

describe('platform-accounts / secretBox 加解密', () => {
  it('seal/open 往返：同一明文两次密文不同（随机 IV），篡改即失败', () => {
    const key = generateSecretKey();
    const plaintext = '{"appid":"wx123","secret":"shhh"}';
    const sealed1 = seal(plaintext, key);
    const sealed2 = seal(plaintext, key);
    expect(sealed1).not.toBe(sealed2);
    expect(sealed1.startsWith('v1:')).toBe(true);
    expect(open(sealed1, key)).toBe(plaintext);
    expect(open(sealed2, key)).toBe(plaintext);

    // 篡改密文 → GCM 校验失败
    const tampered = `${sealed1.slice(0, -4)}AAAA`;
    expect(() => open(tampered, key)).toThrow();
    // 错误密钥 → 失败
    expect(() => open(sealed1, generateSecretKey())).toThrow();
  });

  it('密钥编码链：hex/base64 解码必须恰好 32 字节', () => {
    const key = generateSecretKey();
    const hex = encodeSecretKey(key);
    expect(decodeSecretKey(hex)).toEqual(key);
    expect(decodeSecretKey(key.toString('base64'))).toEqual(key);
    expect(() => decodeSecretKey('tooshort')).toThrow();
    expect(() => decodeSecretKey('')).toThrow();
  });

  it('masked 格式：前4****后4；短凭据全打码', () => {
    expect(maskCredential('abcdefgh1234')).toBe('abcd****1234');
    expect(maskCredential('{"appid":"wx1234567890abc","secret":"s"}'))
      .toBe('{"ap****"s"}');
    expect(maskCredential('short')).toBe('****');
    expect(maskCredential('')).toBe('****');
  });
});

describe('platform-accounts / repository 不明文泄漏', () => {
  beforeEach(() => {
    resetSecretKeyCache();
    process.env.FEEDFUSE_SECRET_KEY = encodeSecretKey(generateSecretKey());
  });

  it('create：凭据加密入库，返回值不含明文/密文', async () => {
    const { pool, query } = mockPool([{ id: '3', platform: 'wechat', credentialMasked: '{"a****s"}' }]);
    const view = await createPlatformAccount(pool, {
      platform: 'wechat',
      accountName: '主号',
      credKind: 'app_secret',
      credentialPlaintext: '{"appid":"wx123456","secret":"topsecret"}',
      userId: '42',
    });
    const params = query.mock.calls[0][1] as string[];
    // 落库的第 5 个参数是密文（v1:iv:tag:ct），第 6 个是 masked
    expect(params[4]).toMatch(/^v1:/);
    expect(params[4]).not.toContain('topsecret');
    expect(params[5]).not.toContain('topsecret');
    expect(params[5]).toContain('****');
    // 返回视图不含 credential 字段
    expect(JSON.stringify(view)).not.toContain('topsecret');
    expect(view).not.toHaveProperty('credentialEncrypted');
    expect(view).not.toHaveProperty('credential_encrypted');
    delete process.env.FEEDFUSE_SECRET_KEY;
  });

  it('list/get 的 SELECT 列表不含 credential_encrypted 列', async () => {
    const { pool, query } = mockPool([]);
    await listPlatformAccounts(pool, { userId: '42' });
    await listPlatformAccounts(pool, { userId: '42', platform: 'wechat' });
    await getPlatformAccount(pool, '3', '42');
    for (const call of query.mock.calls) {
      const selectList = String(call[0]).split(/from platform_accounts/i)[0];
      expect(selectList).not.toContain('credential_encrypted');
      expect(call[1]).toContain('42');
    }
  });

  it('getDecryptedCredential：能解回明文且视图剥离密文字段', async () => {
    const key = decodeSecretKey(process.env.FEEDFUSE_SECRET_KEY!);
    const plaintext = '{"appid":"wx123456","secret":"topsecret"}';
    const { pool } = mockPool([{
      id: '3',
      userId: '42',
      platform: 'wechat',
      accountName: '主号',
      credKind: 'app_secret',
      credentialMasked: '{"a****}',
      status: 'active',
      credential_encrypted: seal(plaintext, key),
    }]);
    const result = await getDecryptedCredential(pool, '3', '42');
    expect(result?.credentialPlaintext).toBe(plaintext);
    expect(JSON.stringify(result?.view)).not.toContain('credential_encrypted');
    delete process.env.FEEDFUSE_SECRET_KEY;
  });

  it('delete / markAccountVerified 带用户过滤', async () => {
    const { pool, query } = mockPool([]);
    await deletePlatformAccount(pool, '3', '42');
    await markAccountVerified(pool, { id: '3', ok: true, userId: '42' });
    await markAccountVerified(pool, { id: '3', ok: false, failStatus: 'expired', userId: '42' });
    expect(query.mock.calls[0][1]).toEqual(['3', '42']);
    expect(query.mock.calls[1][1]).toEqual(['3', '42', 'active']);
    expect(query.mock.calls[2][1]).toEqual(['3', '42', 'expired']);
  });
});

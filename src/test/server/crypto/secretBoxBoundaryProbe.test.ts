/**
 * QA 独立边界探查（T05）—— 加解密与密钥来源。
 *
 * 权威口径：arch ADR-06 / §5.3
 * - `seal`/`open` 往返一致；篡改密文或用错密钥必须抛错，绝不返回垃圾明文
 * - `FEEDFUSE_SECRET_KEY` env 优先；**格式错误在启动期直接失败、绝不静默回落 DB**
 * - `maskToken` 永不返回完整明文
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

import {
  decodeSecretKey,
  encodeSecretKey,
  generateSecretKey,
  isSealed,
  open as openSealed,
  seal,
  SecretBoxError,
} from '@/server/infra/crypto/secretBox';
import {
  resolveSecretKey,
  resolveSecretKeySource,
  resetSecretKeyCache,
} from '@/server/infra/crypto/secretKeyProvider';
import { maskToken } from '@/server/domains/github/services/githubTokenService';

const ORIGINAL_ENV = process.env.FEEDFUSE_SECRET_KEY;

function poolWith(secretEncryptionKey: string | null): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ secretEncryptionKey }] }),
  } as unknown as Pool;
}

beforeEach(() => {
  resetSecretKeyCache();
  delete process.env.FEEDFUSE_SECRET_KEY;
});

afterEach(() => {
  resetSecretKeyCache();
  if (typeof ORIGINAL_ENV === 'string') process.env.FEEDFUSE_SECRET_KEY = ORIGINAL_ENV;
  else delete process.env.FEEDFUSE_SECRET_KEY;
});

describe('QA-S1 seal/open 往返与完整性', () => {
  it('QA-S1.1 各类明文往返一致（含中文/emoji/超长/空串）', () => {
    const key = generateSecretKey();
    const samples = [
      'ghp_abcdefghijklmnopqrstuvwxyz012345',
      '中文 Token 测试',
      '🔐🚀',
      'x'.repeat(4096),
      '',
      'a:b:c:d', // 明文含分隔符，不得破坏格式解析
    ];

    for (const plain of samples) {
      expect(openSealed(seal(plain, key), key)).toBe(plain);
    }
  });

  it('QA-S1.2 同一明文两次 seal 结果不同（随机 IV），但都能解开', () => {
    const key = generateSecretKey();
    const a = seal('same-token', key);
    const b = seal('same-token', key);

    expect(a).not.toBe(b);
    expect(openSealed(a, key)).toBe('same-token');
    expect(openSealed(b, key)).toBe('same-token');
  });

  it('QA-S1.3 用错误密钥解密必须抛 decrypt_failed，绝不返回垃圾明文', () => {
    const sealed = seal('secret', generateSecretKey());
    const wrongKey = generateSecretKey();

    try {
      openSealed(sealed, wrongKey);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretBoxError);
      expect((err as SecretBoxError).code).toBe('decrypt_failed');
    }
  });

  it('QA-S1.4 篡改密文任一段（iv/tag/ciphertext）都必须抛错', () => {
    const key = generateSecretKey();
    const sealed = seal('tamper-me', key);
    const [v, iv, tag, ct] = sealed.split(':');

    const flip = (s: string) => {
      const c = s[0] === 'A' ? 'B' : 'A';
      return c + s.slice(1);
    };

    const mutations = [
      [v, flip(iv), tag, ct].join(':'),
      [v, iv, flip(tag), ct].join(':'),
      [v, iv, tag, flip(ct)].join(':'),
    ];

    for (const bad of mutations) {
      expect(() => openSealed(bad, key)).toThrow(SecretBoxError);
    }
  });

  it('QA-S1.5 截断/多段/错版本前缀一律抛 invalid_format 或 unsupported_version', () => {
    const key = generateSecretKey();
    const sealed = seal('x', key);

    expect(() => openSealed('', key)).toThrow(SecretBoxError);
    expect(() => openSealed('v1:only:three', key)).toThrow(SecretBoxError);
    expect(() => openSealed(`${sealed}:extra`, key)).toThrow(SecretBoxError);
    expect(() => openSealed(sealed.replace(/^v1:/, 'v2:'), key)).toThrow(SecretBoxError);
    expect(() => openSealed('plaintext-token', key)).toThrow(SecretBoxError);
  });

  it('QA-S1.6 错误长度的密钥必须被拒绝（不得用弱密钥静默加密）', () => {
    expect(() => seal('x', Buffer.alloc(16))).toThrow(SecretBoxError);
    expect(() => seal('x', Buffer.alloc(31))).toThrow(SecretBoxError);
    expect(() => openSealed(seal('x', generateSecretKey()), Buffer.alloc(16))).toThrow(SecretBoxError);
  });

  it('QA-S1.7 isSealed 能区分密文 / 明文 / 空串', () => {
    const key = generateSecretKey();
    expect(isSealed(seal('x', key))).toBe(true);
    expect(isSealed('')).toBe(false);
    expect(isSealed('ghp_plaintexttoken')).toBe(false);
    expect(isSealed('v1:a:b:c')).toBe(false); // 段长度不合法
  });
});

describe('QA-S2 密钥材料解码', () => {
  it('QA-S2.1 hex(64) 与 base64(32B) 都能解码为 32 字节', () => {
    const key = generateSecretKey();
    expect(decodeSecretKey(encodeSecretKey(key)).equals(key)).toBe(true);
    expect(decodeSecretKey(key.toString('base64')).equals(key)).toBe(true);
    expect(decodeSecretKey(key.toString('base64url')).equals(key)).toBe(true);
  });

  it('QA-S2.2 长度不足/含非法字符的材料必须抛 invalid_key（不得静默截断）', () => {
    for (const bad of ['', '   ', 'abc', 'zz'.repeat(32), Buffer.alloc(16).toString('hex')]) {
      expect(() => decodeSecretKey(bad)).toThrow(SecretBoxError);
    }
  });
});

describe('QA-S3 secretKeyProvider：env 优先 / 错误即失败 / DB 兜底', () => {
  it('QA-S3.1 env 配置合法时优先生效，且不回表读 DB', async () => {
    const key = generateSecretKey();
    process.env.FEEDFUSE_SECRET_KEY = encodeSecretKey(key);
    const pool = poolWith(encodeSecretKey(generateSecretKey()));

    const resolved = await resolveSecretKey(pool);

    expect(resolved.equals(key)).toBe(true);
    expect(await resolveSecretKeySource(pool)).toBe('env');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('QA-S3.2 env 格式错误必须抛错，绝不静默回落 DB（ADR-06 红线）', async () => {
    process.env.FEEDFUSE_SECRET_KEY = 'obviously-not-a-32-byte-key';
    const dbKey = encodeSecretKey(generateSecretKey());
    const pool = poolWith(dbKey);

    await expect(resolveSecretKey(pool)).rejects.toBeInstanceOf(SecretBoxError);
    // 关键：不得回落到 DB 密钥，否则会用另一把密钥加密新数据导致后续无法解密
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('QA-S3.3 env 缺省时回落 DB 密钥', async () => {
    const dbKey = generateSecretKey();
    const pool = poolWith(encodeSecretKey(dbKey));

    const resolved = await resolveSecretKey(pool);

    expect(resolved.equals(dbKey)).toBe(true);
    expect(await resolveSecretKeySource(pool)).toBe('database');
  });

  it('QA-S3.4 env 为空串视作未配置（不得当成非法值报错）', async () => {
    process.env.FEEDFUSE_SECRET_KEY = '   ';
    const dbKey = generateSecretKey();
    const pool = poolWith(encodeSecretKey(dbKey));

    const resolved = await resolveSecretKey(pool);
    expect(resolved.equals(dbKey)).toBe(true);
  });

  it('QA-S3.5 并发首调只解析一次，避免生成两把不同的兜底密钥', async () => {
    const dbKey = encodeSecretKey(generateSecretKey());
    const pool = poolWith(dbKey);

    const results = await Promise.all([
      resolveSecretKey(pool),
      resolveSecretKey(pool),
      resolveSecretKey(pool),
    ]);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(results[0].equals(results[1])).toBe(true);
    expect(results[1].equals(results[2])).toBe(true);
  });
});

describe('QA-S4 maskToken 脱敏', () => {
  it('QA-S4.1 正常 Token 脱敏为「前4****后4」且不含中段明文', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz';
    const masked = maskToken(token) as string;

    expect(masked).toBe('ghp_****wxyz');
    expect(masked).not.toContain('efghijklmnopqrstuv');
    expect(masked.length).toBeLessThan(token.length);
  });

  it('QA-S4.2 短 Token（≤8）整体打码，不得泄漏任何片段', () => {
    expect(maskToken('12345678')).toBe('****');
    expect(maskToken('abc')).toBe('****');
  });

  it('QA-S4.3 空串 / 纯空白返回 null', () => {
    expect(maskToken('')).toBeNull();
    expect(maskToken('    ')).toBeNull();
  });
});

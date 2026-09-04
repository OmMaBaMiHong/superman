import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeSecretKey,
  generateSecretKey,
  encodeSecretKey,
  isSameSecretKey,
  SECRET_KEY_BYTES,
  SecretBoxError,
} from '@/server/infra/crypto/secretBox';
import {
  resetSecretKeyCache,
  resolveSecretKey,
  resolveSecretKeySource,
} from '@/server/infra/crypto/secretKeyProvider';

const ENV_KEY_HEX = 'a'.repeat(64);
const DB_KEY_HEX = 'b'.repeat(64);

interface FakePoolOptions {
  storedKey?: string;
  /** 模拟并发落败：update 返回 0 行，但回读能拿到别人写入的密钥 */
  updateReturnsNoRows?: boolean;
  /** 模拟 app_settings 行缺失 */
  rowMissing?: boolean;
}

function createFakePool(options: FakePoolOptions = {}) {
  let stored = options.storedKey ?? '';
  const queries: string[] = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    queries.push(sql);

    if (sql.includes('update app_settings')) {
      if (options.updateReturnsNoRows || options.rowMissing) {
        return { rows: [] as { secretEncryptionKey: string }[] };
      }

      stored = String(params[1]);
      return { rows: [{ secretEncryptionKey: stored }] };
    }

    if (options.rowMissing) {
      return { rows: [] as { secretEncryptionKey: string | null }[] };
    }

    return { rows: [{ secretEncryptionKey: stored }] };
  });

  return {
    pool: { query } as unknown as Pool,
    query,
    queries,
    getStored: () => stored,
    setStored: (value: string) => {
      stored = value;
    },
  };
}

describe('secretKeyProvider', () => {
  const originalEnvKey = process.env.FEEDFUSE_SECRET_KEY;

  beforeEach(() => {
    resetSecretKeyCache();
    delete process.env.FEEDFUSE_SECRET_KEY;
  });

  afterEach(() => {
    resetSecretKeyCache();
    if (originalEnvKey === undefined) {
      delete process.env.FEEDFUSE_SECRET_KEY;
    } else {
      process.env.FEEDFUSE_SECRET_KEY = originalEnvKey;
    }
  });

  it('prefers FEEDFUSE_SECRET_KEY over the database fallback', async () => {
    process.env.FEEDFUSE_SECRET_KEY = ENV_KEY_HEX;
    const fake = createFakePool({ storedKey: DB_KEY_HEX });

    const key = await resolveSecretKey(fake.pool);

    expect(isSameSecretKey(key, decodeSecretKey(ENV_KEY_HEX))).toBe(true);
    expect(await resolveSecretKeySource(fake.pool)).toBe('env');
    // env 命中时完全不碰数据库
    expect(fake.query).not.toHaveBeenCalled();
  });

  it('accepts base64 env key material', async () => {
    const raw = generateSecretKey();
    process.env.FEEDFUSE_SECRET_KEY = raw.toString('base64');
    const fake = createFakePool({ storedKey: DB_KEY_HEX });

    expect(isSameSecretKey(await resolveSecretKey(fake.pool), raw)).toBe(true);
  });

  it('falls back to app_settings.secret_encryption_key when env is unset', async () => {
    const fake = createFakePool({ storedKey: DB_KEY_HEX });

    const key = await resolveSecretKey(fake.pool);

    expect(isSameSecretKey(key, decodeSecretKey(DB_KEY_HEX))).toBe(true);
    expect(await resolveSecretKeySource(fake.pool)).toBe('database');
    expect(fake.queries[0]).toContain('select secret_encryption_key');
  });

  it('treats a blank env value as unset', async () => {
    process.env.FEEDFUSE_SECRET_KEY = '   ';
    const fake = createFakePool({ storedKey: DB_KEY_HEX });

    expect(isSameSecretKey(await resolveSecretKey(fake.pool), decodeSecretKey(DB_KEY_HEX))).toBe(
      true,
    );
  });

  it('generates and persists a key when neither env nor database has one', async () => {
    const fake = createFakePool({ storedKey: '' });

    const key = await resolveSecretKey(fake.pool);

    expect(key).toHaveLength(SECRET_KEY_BYTES);
    expect(fake.getStored()).toMatch(/^[0-9a-f]{64}$/);
    expect(isSameSecretKey(key, decodeSecretKey(fake.getStored()))).toBe(true);
    expect(fake.queries.some((sql) => sql.includes('update app_settings'))).toBe(true);
  });

  it('re-reads the winning key when a concurrent writer wins the race', async () => {
    const fake = createFakePool({ storedKey: '', updateReturnsNoRows: true });
    // 模拟并发：update 落败后回读到对方写入的值
    fake.setStored(DB_KEY_HEX);

    const key = await resolveSecretKey(fake.pool);

    expect(isSameSecretKey(key, decodeSecretKey(DB_KEY_HEX))).toBe(true);
  });

  it('throws when the app_settings row is missing', async () => {
    const fake = createFakePool({ rowMissing: true });

    await expect(resolveSecretKey(fake.pool)).rejects.toThrow(SecretBoxError);
  });

  it('throws instead of silently falling back when the env key is malformed', async () => {
    process.env.FEEDFUSE_SECRET_KEY = 'not-a-valid-key';
    const fake = createFakePool({ storedKey: DB_KEY_HEX });

    await expect(resolveSecretKey(fake.pool)).rejects.toThrow(SecretBoxError);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it('caches the resolved key across calls', async () => {
    const fake = createFakePool({ storedKey: DB_KEY_HEX });

    await resolveSecretKey(fake.pool);
    await resolveSecretKey(fake.pool);
    await resolveSecretKey(fake.pool);

    expect(fake.query).toHaveBeenCalledTimes(1);
  });

  it('shares a single database read across concurrent first calls', async () => {
    const fake = createFakePool({ storedKey: '' });

    const keys = await Promise.all([
      resolveSecretKey(fake.pool),
      resolveSecretKey(fake.pool),
      resolveSecretKey(fake.pool),
    ]);

    expect(new Set(keys.map((key) => key.toString('hex'))).size).toBe(1);
    expect(fake.queries.filter((sql) => sql.includes('update app_settings'))).toHaveLength(1);
  });

  it('re-resolves after the cache is reset', async () => {
    const first = createFakePool({ storedKey: DB_KEY_HEX });
    await resolveSecretKey(first.pool);

    resetSecretKeyCache();

    const rotated = encodeSecretKey(generateSecretKey());
    const second = createFakePool({ storedKey: rotated });
    const key = await resolveSecretKey(second.pool);

    expect(isSameSecretKey(key, decodeSecretKey(rotated))).toBe(true);
  });
});

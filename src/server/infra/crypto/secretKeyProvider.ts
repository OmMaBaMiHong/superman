import type { Pool, PoolClient } from 'pg';
import {
  decodeSecretKey,
  encodeSecretKey,
  generateSecretKey,
  SecretBoxError,
} from '@/server/infra/crypto/secretBox';

/**
 * 应用级加密密钥解析器。
 *
 * 策略：**env 优先 + DB 兜底**
 *   1. `process.env.FEEDFUSE_SECRET_KEY`（hex 64 字符 或 base64，解码后须为 32 字节）
 *   2. 回落到 `app_settings.secret_encryption_key`
 *   3. DB 里也没有 → 自动生成 32 字节随机密钥并持久化
 *
 * ⚠️ 生产环境推荐做法是 **env 方式**：
 *   DB 兜底密钥与被加密的数据同库，只能防「备份/日志泄漏 + 随手翻库」，
 *   无法防数据库整体失陷。用 env 注入可以把密钥与数据物理分离。
 *   保留 DB 兜底的唯一目的是让 Docker 用户零配置即可使用（见 arch AQ-1）。
 */

type Queryable = Pool | PoolClient;

interface CachedSecretKey {
  key: Buffer;
  source: SecretKeySource;
}

export type SecretKeySource = 'env' | 'database';

const APP_SETTINGS_ID = 1;

let cache: CachedSecretKey | null = null;
let inflight: Promise<CachedSecretKey> | null = null;

function readEnvSecretKeyMaterial(): string | null {
  const raw = process.env.FEEDFUSE_SECRET_KEY;
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

async function readDatabaseSecretKeyMaterial(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ secretEncryptionKey: string | null }>(
    `select secret_encryption_key as "secretEncryptionKey"
       from app_settings
      where id = $1`,
    [APP_SETTINGS_ID],
  );

  return rows[0]?.secretEncryptionKey?.trim() ?? '';
}

/**
 * 生成并持久化兜底密钥。
 *
 * `where coalesce(secret_encryption_key, '') = ''` 保证并发调用只有一个写入者成功，
 * 落败方通过 returning 为空感知冲突，再回读胜出者写入的值，避免两个进程用不同密钥加密。
 */
async function generateAndPersistSecretKeyMaterial(db: Queryable): Promise<string> {
  const material = encodeSecretKey(generateSecretKey());

  const { rows } = await db.query<{ secretEncryptionKey: string }>(
    `update app_settings
        set secret_encryption_key = $2,
            updated_at = now()
      where id = $1
        and coalesce(secret_encryption_key, '') = ''
      returning secret_encryption_key as "secretEncryptionKey"`,
    [APP_SETTINGS_ID, material],
  );

  if (rows.length > 0) {
    return rows[0].secretEncryptionKey;
  }

  // 并发落败或 app_settings 行缺失：回读一次，确认最终生效的密钥。
  const existing = await readDatabaseSecretKeyMaterial(db);
  if (existing.length > 0) {
    return existing;
  }

  throw new SecretBoxError(
    'invalid_key',
    'Unable to persist fallback secret key: app_settings row is missing',
  );
}

async function resolveSecretKeyUncached(db: Queryable): Promise<CachedSecretKey> {
  const envMaterial = readEnvSecretKeyMaterial();
  if (envMaterial) {
    // env 配置错误必须显式失败，绝不能静默回落到 DB 密钥——
    // 否则会用另一把密钥加密新数据，导致后续无法解密。
    return { key: decodeSecretKey(envMaterial), source: 'env' };
  }

  const dbMaterial = await readDatabaseSecretKeyMaterial(db);
  if (dbMaterial.length > 0) {
    return { key: decodeSecretKey(dbMaterial), source: 'database' };
  }

  const generated = await generateAndPersistSecretKeyMaterial(db);
  return { key: decodeSecretKey(generated), source: 'database' };
}

/**
 * 获取应用级加密密钥（带进程内缓存）。
 *
 * 缓存是必要的：Token 加解密在同步链路上是高频操作，
 * 每次都回表读 app_settings 会给数据库带来无谓压力。
 */
export async function resolveSecretKey(db: Queryable): Promise<Buffer> {
  if (cache) {
    return cache.key;
  }

  // 并发首调时共享同一个 promise，避免多次生成兜底密钥。
  if (!inflight) {
    inflight = resolveSecretKeyUncached(db)
      .then((resolved) => {
        cache = resolved;
        return resolved;
      })
      .finally(() => {
        inflight = null;
      });
  }

  const resolved = await inflight;
  return resolved.key;
}

/**
 * 读取缓存中的密钥来源。
 *
 * 抽成独立函数是为了规避 TS 的控制流收窄问题：
 * `resolveSecretKey` 通过闭包改写模块级 `cache`，类型检查器在 `await` 之后
 * 仍会沿用早前 `if (cache) return` 留下的 `null` 收窄，导致 `cache?.source`
 * 被误判为 `never`。在独立函数里 `cache` 不再被收窄，可选链可正常求值。
 */
function readCachedSource(): SecretKeySource {
  return cache?.source ?? 'database';
}

/** 返回当前密钥来源，供设置页/诊断接口提示「是否已用 env 管理密钥」。 */
export async function resolveSecretKeySource(db: Queryable): Promise<SecretKeySource> {
  if (cache) {
    return cache.source;
  }

  await resolveSecretKey(db);
  return readCachedSource();
}

/** 清空进程内缓存。仅供测试与密钥轮换后重载使用。 */
export function resetSecretKeyCache(): void {
  cache = null;
  inflight = null;
}

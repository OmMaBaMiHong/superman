/**
 * 平台账号凭据加密纪律（P2e-1）。
 *
 * 直接复用 server/infra/crypto 的 secretBox 信封（AES-256-GCM，
 * v1:iv:tag:ct）与 secretKeyProvider 的 env 优先 + DB 兜底密钥链——
 * 与 oauth hub / user_rsshub_cookies 同一套纪律：
 *   明文只在加解密函数内存在；masked 只存「前4****后4」快照；
 *   日志 / 返回值 / 错误消息里永不出现明文。
 * core 不再复制实现（单一事实源），本模块只做语义封装。
 */
import type { Pool, PoolClient } from 'pg';
import {
  open as secretBoxOpen,
  seal as secretBoxSeal,
} from '@/server/infra/crypto/secretBox';
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider';

type DbClient = Pool | PoolClient;

export { isSealed } from '@/server/infra/crypto/secretBox';
export { resolveSecretKey, resetSecretKeyCache } from '@/server/infra/crypto/secretKeyProvider';

/** 打码快照：前 4 + **** + 后 4；不足 8 字符全打码。 */
export function maskCredential(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length < 8) return '****';
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

/** 加密凭据（密钥走 env → DB 兜底链）。 */
export async function sealCredential(db: DbClient, plaintext: string): Promise<string> {
  const key = await resolveSecretKey(db);
  return secretBoxSeal(plaintext, key);
}

/**
 * 解密凭据。解密失败（密钥轮换/密文损坏）视为不可用，
 * 由调用方按「凭据失效」处理，绝不返回部分内容。
 */
export async function openCredential(db: DbClient, sealed: string): Promise<string> {
  const key = await resolveSecretKey(db);
  return secretBoxOpen(sealed, key);
}

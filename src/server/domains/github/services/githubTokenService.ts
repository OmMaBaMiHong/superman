import type { Pool } from 'pg';
import {
  clearGithubToken as clearStoredToken,
  getGithubTokenEncrypted,
  setGithubTokenEncrypted,
} from '@/server/domains/settings/repositories/settingsRepo';
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider';
import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { normalizeUserId } from '@/server/domains/users/userScope';
import type { GithubRateLimitStatus, GithubTokenStatus } from '@/types';

/**
 * GitHub Token 服务。
 *
 * 安全模型（见 arch §1.1）：
 * - 明文 Token 永不落库、永不进日志、永不出现在任何 GET 响应
 * - 落库的是 AES-256-GCM 密文（`secretBox.seal`），密钥来自 `resolveSecretKey`
 * - 对外只暴露 `maskedToken`（如 `ghp_****cdef`），且必须先解密再打码
 */
export async function getGithubToken(pool: Pool, userId?: string): Promise<string> {
  const encrypted = await getGithubTokenEncrypted(pool, userId);
  if (!encrypted.trim()) {
    return '';
  }

  if (!isSealed(encrypted)) {
    // 不应出现未加密值；防御性返回空串，避免明文泄露。
    return '';
  }

  try {
    const key = await resolveSecretKey(pool);
    return openSealed(encrypted, key);
  } catch {
    // 密钥轮换导致解密失败：视作无 Token，由上层在同步时回退匿名配额。
    return '';
  }
}

export async function setGithubToken(pool: Pool, userId: string, token: string): Promise<void> {
  const normalized = token?.trim();
  if (!normalized) {
    await clearGithubToken(pool, userId);
    return;
  }

  const key = await resolveSecretKey(pool);
  const sealed = seal(normalized, key);
  await setGithubTokenEncrypted(pool, userId, sealed);
}

export async function clearGithubToken(pool: Pool, userId?: string): Promise<void> {
  await clearStoredToken(pool, userId);
}

/** 把明文 Token 打码，永不返回完整明文。 */
export function maskToken(plainToken: string): string | null {
  const trimmed = plainToken.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) {
    return '****';
  }
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

async function aggregateRateLimit(
  pool: Pool,
  userId: string,
): Promise<GithubRateLimitStatus | null> {
  const { rows } = await pool.query<{
    minRemaining: number | null;
    maxUntil: string | null;
  }>(
    `
      select
        min(rate_limit_remaining) as "minRemaining",
        max(rate_limited_until) as "maxUntil"
      from github_repo_subscriptions
      where user_id = $1
        and rate_limit_remaining is not null
    `,
    [userId],
  );

  const minRemaining = rows[0]?.minRemaining ?? null;
  const maxUntil = rows[0]?.maxUntil ?? null;
  if (minRemaining === null && maxUntil === null) {
    return null;
  }

  return { limit: null, remaining: minRemaining, resetAt: maxUntil };
}

export async function getGithubTokenStatus(pool: Pool, userId?: string): Promise<GithubTokenStatus> {
  const scopedUserId = normalizeUserId(userId);
  const encrypted = await getGithubTokenEncrypted(pool, scopedUserId);
  const hasToken = encrypted.trim().length > 0;

  let maskedToken: string | null = null;
  if (hasToken && isSealed(encrypted)) {
    try {
      const key = await resolveSecretKey(pool);
      maskedToken = maskToken(openSealed(encrypted, key));
    } catch {
      maskedToken = null;
    }
  }

  const rateLimit = await aggregateRateLimit(pool, scopedUserId);

  return { hasToken, maskedToken, rateLimit };
}

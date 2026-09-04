/**
 * 连接管理服务：列表 / 撤销 / 刷新 / `ensureFreshAccessToken`（见 §4.3）。
 *
 * 安全约定：
 * - `toConnectionView` 是**唯一**的对外映射出口，结构上就不含任何 token 字段
 *   （安全红线 2）。新增字段时请确认不会把 `*Encrypted` 带出去。
 * - 撤销走仓储层带 `user_id` 的 SQL，越权在数据层失败。
 * - 刷新失败置 `status='expired'` 而非删除，用户需要看到「已过期 + 重新授权」。
 */

import type { Pool, PoolClient } from 'pg';

import {
  deleteConnection,
  getConnectionById,
  listConnectionsByUser,
  updateConnectionStatus,
  updateConnectionTokens,
} from '@/server/domains/oauth/repositories/oauthConnectionsRepo';
import { resolveClientCredentials } from '@/server/domains/oauth/services/oauthConfigService';
import type {
  OAuthConnectionRow,
  OAuthConnectionView,
} from '@/server/domains/oauth/types';
import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider';
import { NotFoundError } from '@/server/infra/http/errors';
import { OAuthError, normalizeOAuthError } from '@/server/integrations/oauth/oauthErrors';
import { requestToken } from '@/server/integrations/oauth/oauthHttp';
import { requireProvider } from '@/server/integrations/oauth/oauthProviderRegistry';

type DbClient = Pool | PoolClient;

/** access_token 剩余寿命低于此值即视为「该刷新了」，留足出网往返时间。 */
const REFRESH_LEEWAY_MS = 60 * 1000;

function isExpired(expiresAt: Date | null, leewayMs = 0): boolean {
  if (expiresAt === null) {
    return false;
  }
  return expiresAt.getTime() - leewayMs <= Date.now();
}

/**
 * 行 → 对外 DTO。**绝不含任何 token 字段。**
 *
 * `status` 做一次即时修正：库里是 `active` 但 token 已过期时，
 * 对外呈现 `expired`，避免 UI 显示「已连接」却什么都做不了。
 */
export function toConnectionView(row: OAuthConnectionRow): OAuthConnectionView {
  const provider = requireProvider(row.provider);
  const accessTokenExpired = isExpired(row.accessTokenExpiresAt);
  const refreshTokenExpired = isExpired(row.refreshTokenExpiresAt);

  const status: OAuthConnectionView['status'] =
    row.status === 'active' && accessTokenExpired ? 'expired' : row.status;

  return {
    id: row.id,
    provider: row.provider,
    status,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    authorizedAt: row.authorizedAt.toISOString(),
    accessTokenExpiresAt: row.accessTokenExpiresAt?.toISOString() ?? null,
    canRefresh:
      provider.capabilities.supportsRefresh &&
      row.refreshTokenEncrypted !== null &&
      !refreshTokenExpired &&
      row.status !== 'revoked',
  };
}

/** 列出当前用户的全部连接（不含任何凭据）。 */
export async function listConnections(
  db: DbClient,
  userId: string,
): Promise<OAuthConnectionView[]> {
  const rows = await listConnectionsByUser(db, userId);
  return rows.map(toConnectionView);
}

/**
 * 撤销连接。
 *
 * @throws {NotFoundError} id 不存在或不属于该用户（两者对外不可区分，避免探测）。
 */
export async function revokeConnection(
  db: DbClient,
  userId: string,
  id: string,
): Promise<{ id: string }> {
  const deleted = await deleteConnection(db, userId, id);
  if (!deleted) {
    throw new NotFoundError('未找到该授权连接');
  }
  return { id };
}

/** 解密 refresh_token；失败返回 null 由调用方归一为 `refresh_failed`。 */
async function openRefreshToken(db: DbClient, encrypted: string | null): Promise<string | null> {
  if (encrypted === null || encrypted.trim() === '' || !isSealed(encrypted)) {
    return null;
  }

  try {
    const key = await resolveSecretKey(db);
    return openSealed(encrypted, key);
  } catch {
    return null;
  }
}

function toExpiresAt(expiresInSeconds: number | null): Date | null {
  if (expiresInSeconds === null || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    return null;
  }
  return new Date(Date.now() + expiresInSeconds * 1000);
}

/**
 * 刷新连接的 access_token。
 *
 * 失败时把连接置为 `expired` 而非删除（§4.3），
 * 让用户在 UI 上看到「已过期 + 重新授权」的明确出路。
 *
 * @throws {NotFoundError} 连接不存在或不属于该用户。
 * @throws {OAuthError} `refresh_failed` —— 平台不支持刷新、无 refresh_token 或续期失败。
 */
export async function refreshConnection(
  db: DbClient,
  userId: string,
  id: string,
): Promise<OAuthConnectionView> {
  const row = await getConnectionById(db, userId, id);
  if (row === null) {
    throw new NotFoundError('未找到该授权连接');
  }

  const provider = requireProvider(row.provider);
  if (!provider.capabilities.supportsRefresh) {
    throw new OAuthError('refresh_failed', {
      provider: row.provider,
      debugHint: 'provider does not support refresh',
    });
  }

  const refreshToken = await openRefreshToken(db, row.refreshTokenEncrypted);
  if (refreshToken === null) {
    await updateConnectionStatus(db, userId, id, 'expired');
    throw new OAuthError('refresh_failed', {
      provider: row.provider,
      debugHint: 'refresh_token missing or undecryptable',
    });
  }

  const credentials = await resolveClientCredentials(db, row.provider);
  const request = provider.buildRefreshRequest({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken,
  });

  if (request === null) {
    throw new OAuthError('refresh_failed', {
      provider: row.provider,
      debugHint: 'provider has no refresh endpoint',
    });
  }

  let bundle;
  try {
    bundle = await requestToken({ provider, request, purpose: 'refresh' });
  } catch (err) {
    // 失败不删除连接，只置 expired。
    await updateConnectionStatus(db, userId, id, 'expired');
    throw normalizeOAuthError(err, 'refresh_failed');
  }

  const key = await resolveSecretKey(db);
  const updated = await updateConnectionTokens(db, {
    id,
    userId,
    accessTokenEncrypted: seal(bundle.accessToken, key),
    refreshTokenEncrypted:
      bundle.refreshToken === null ? null : seal(bundle.refreshToken, key),
    tokenType: bundle.tokenType,
    scope: bundle.scope,
    accessTokenExpiresAt: toExpiresAt(bundle.expiresIn),
    refreshTokenExpiresAt: toExpiresAt(bundle.refreshExpiresIn),
  });

  if (updated === null) {
    throw new NotFoundError('未找到该授权连接');
  }

  return toConnectionView(updated);
}

/**
 * 取一个可用的 access_token，必要时自动刷新（供后续抓取模块复用，R20 预留）。
 *
 * **注意：返回明文 token**，调用方只能把它塞进出网请求头，
 * 不得日志化、不得放进任何响应体（安全红线 2·3）。
 *
 * @returns 明文 access_token；连接不可用时返回 null。
 */
export async function ensureFreshAccessToken(
  db: DbClient,
  userId: string,
  connectionId: string,
): Promise<string | null> {
  const row = await getConnectionById(db, userId, connectionId);
  if (row === null || row.status === 'revoked') {
    return null;
  }

  const needsRefresh = isExpired(row.accessTokenExpiresAt, REFRESH_LEEWAY_MS);
  if (needsRefresh) {
    try {
      await refreshConnection(db, userId, connectionId);
    } catch {
      // 刷新失败已在 refreshConnection 里置 expired，这里安静降级。
      return null;
    }

    const refreshed = await getConnectionById(db, userId, connectionId);
    if (refreshed === null) {
      return null;
    }
    return decryptAccessToken(db, refreshed);
  }

  return decryptAccessToken(db, row);
}

async function decryptAccessToken(
  db: DbClient,
  row: OAuthConnectionRow,
): Promise<string | null> {
  if (!isSealed(row.accessTokenEncrypted)) {
    return null;
  }

  try {
    const key = await resolveSecretKey(db);
    return openSealed(row.accessTokenEncrypted, key);
  } catch {
    return null;
  }
}

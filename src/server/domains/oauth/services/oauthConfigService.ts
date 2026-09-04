/**
 * 平台配置服务：配置状态、保存/清除、凭据解析、secret 打码。
 *
 * 这是**明文 `client_secret` 唯一被允许出现的文件**（连同 callback/connection
 * 两个服务里的 token）。约定：
 * - 明文只在单次函数调用内存活，绝不返回给调用方（除 `resolveClientCredentials`
 *   这个专供出网使用的内部函数）；
 * - 对外一律 `maskSecret()` 打码（安全红线 2）。
 */

import type { Pool, PoolClient } from 'pg';

import {
  deleteProviderConfig,
  getProviderConfig,
  listProviderConfigs,
  upsertProviderConfig,
} from '@/server/domains/oauth/repositories/oauthProviderConfigsRepo';
import type { HeaderReader } from '@/server/domains/oauth/redirectUri';
import { buildRedirectUri } from '@/server/domains/oauth/redirectUri';
import type {
  OAuthClientCredentials,
  OAuthProviderConfigRow,
  OAuthProviderConfigStatus,
} from '@/server/domains/oauth/types';
import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';
import {
  listProviders,
  requireProvider,
} from '@/server/integrations/oauth/oauthProviderRegistry';
import type {
  OAuthProviderDefinition,
  OAuthProviderId,
} from '@/server/integrations/oauth/oauthProviderTypes';

type DbClient = Pool | PoolClient;

/**
 * 把明文 secret 打码，永不返回完整明文。
 * 与 `githubTokenService.maskToken` 保持同一范式（前 4 + **** + 后 4）。
 */
export function maskSecret(plainSecret: string): string | null {
  const trimmed = plainSecret.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.length <= 8) {
    return '****';
  }
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

/** 解密已落库的 secret 密文；失败一律当作「未配置」而非抛错。 */
async function openSecret(db: DbClient, encrypted: string): Promise<string> {
  const trimmed = encrypted.trim();
  if (trimmed === '') {
    return '';
  }
  if (!isSealed(trimmed)) {
    // 不应出现未加密值；防御性返回空串，避免明文泄露路径。
    return '';
  }

  try {
    const key = await resolveSecretKey(db);
    return openSealed(trimmed, key);
  } catch {
    // 密钥轮换导致解密失败：视作未配置，UI 会引导用户重填。
    return '';
  }
}

function buildStatus(
  provider: OAuthProviderDefinition,
  row: OAuthProviderConfigRow | null,
  maskedClientSecret: string | null,
  headers: HeaderReader | null | undefined,
): OAuthProviderConfigStatus {
  const clientId = row?.clientId.trim() ?? '';
  const enabled = row?.enabled ?? true;

  return {
    provider: provider.id,
    displayName: provider.displayName,
    // 「已配置」= client_id 与 secret 都在，且未被禁用。
    configured: clientId !== '' && maskedClientSecret !== null && enabled,
    clientId,
    maskedClientSecret,
    enabled,
    redirectUri: buildRedirectUri(provider.id, headers),
    supportsPkce: provider.capabilities.supportsPkce,
    requiresExactRedirectUri: provider.capabilities.requiresExactRedirectUri,
  };
}

/**
 * 返回四个平台的配置状态（未配置的平台也会出现，呈「未配置」引导态）。
 * **返回值绝不含 secret 明文**——只有 `maskedClientSecret`。
 */
export async function getProviderConfigStatuses(
  db: DbClient,
  headers?: HeaderReader | null,
): Promise<OAuthProviderConfigStatus[]> {
  const rows = await listProviderConfigs(db);
  const rowByProvider = new Map(rows.map((row) => [row.provider, row]));

  const statuses: OAuthProviderConfigStatus[] = [];
  for (const provider of listProviders()) {
    const row = rowByProvider.get(provider.id) ?? null;
    const plainSecret = row === null ? '' : await openSecret(db, row.clientSecretEncrypted);
    statuses.push(buildStatus(provider, row, maskSecret(plainSecret), headers));
  }

  return statuses;
}

/** 返回单个平台的配置状态。 */
export async function getProviderConfigStatus(
  db: DbClient,
  providerId: OAuthProviderId,
  headers?: HeaderReader | null,
): Promise<OAuthProviderConfigStatus> {
  const provider = requireProvider(providerId);
  const row = await getProviderConfig(db, providerId);
  const plainSecret = row === null ? '' : await openSecret(db, row.clientSecretEncrypted);

  return buildStatus(provider, row, maskSecret(plainSecret), headers);
}

export interface SaveProviderConfigInput {
  provider: OAuthProviderId;
  clientId: string;
  /** 省略（`undefined`）表示保留原 secret；传空串表示清空。 */
  clientSecret?: string | undefined;
  enabled?: boolean;
}

/**
 * 保存平台配置。secret 在此处 `seal()` 后落库，明文不出本函数。
 */
export async function saveProviderConfig(
  db: DbClient,
  input: SaveProviderConfigInput,
  headers?: HeaderReader | null,
): Promise<OAuthProviderConfigStatus> {
  const clientId = input.clientId.trim();

  let clientSecretEncrypted: string | undefined;
  if (input.clientSecret !== undefined) {
    const plainSecret = input.clientSecret.trim();
    if (plainSecret === '') {
      // 显式清空。
      clientSecretEncrypted = '';
    } else {
      const key = await resolveSecretKey(db);
      clientSecretEncrypted = seal(plainSecret, key);
    }
  }

  await upsertProviderConfig(db, {
    provider: input.provider,
    clientId,
    ...(clientSecretEncrypted === undefined ? {} : { clientSecretEncrypted }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  });

  return getProviderConfigStatus(db, input.provider, headers);
}

/** 清除平台配置，回到「未配置」引导态。 */
export async function clearProviderConfig(
  db: DbClient,
  providerId: OAuthProviderId,
  headers?: HeaderReader | null,
): Promise<OAuthProviderConfigStatus> {
  await deleteProviderConfig(db, providerId);
  return getProviderConfigStatus(db, providerId, headers);
}

/**
 * 解析出网所需的明文凭据。
 *
 * **这是明文 secret 唯一的出口**，只允许 authorize / callback / connection
 * 三个服务在紧邻出网处调用，返回值不得日志化、不得放进任何 DTO。
 *
 * @throws {OAuthError} `not_configured` —— clientId 为空、secret 为空或 `enabled=false`。
 *   这正是微信/抖音/小红书在本机的默认表现（AQ-3 验收口径）。
 */
export async function resolveClientCredentials(
  db: DbClient,
  providerId: OAuthProviderId,
): Promise<OAuthClientCredentials> {
  const row = await getProviderConfig(db, providerId);

  if (row === null || !row.enabled) {
    throw new OAuthError('not_configured', { provider: providerId });
  }

  const clientId = row.clientId.trim();
  if (clientId === '') {
    throw new OAuthError('not_configured', { provider: providerId });
  }

  const clientSecret = await openSecret(db, row.clientSecretEncrypted);
  if (clientSecret === '') {
    throw new OAuthError('not_configured', { provider: providerId });
  }

  return { clientId, clientSecret };
}

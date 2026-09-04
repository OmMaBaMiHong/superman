/**
 * 平台应用配置仓储（`oauth_provider_configs`）。
 *
 * 该表是**全局单例配置**（与用户无关，属部署级设置），故不带 `user_id` 谓词。
 * 仓储层只做行读写与密文透传，**不做加解密**——加解密归 `oauthConfigService`，
 * 这样「明文只在 service 单次调用内存活」这条边界只需在一个文件里守住。
 */

import type { Pool, PoolClient } from 'pg';

import type { OAuthProviderConfigRow } from '@/server/domains/oauth/types';
import type { OAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';

type DbClient = Pool | PoolClient;

interface RawConfigRow {
  provider: OAuthProviderId;
  clientId: string;
  clientSecretEncrypted: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_COLUMNS = `
  provider,
  client_id                as "clientId",
  client_secret_encrypted  as "clientSecretEncrypted",
  enabled,
  created_at               as "createdAt",
  updated_at               as "updatedAt"
`;

function toRow(raw: RawConfigRow): OAuthProviderConfigRow {
  return {
    provider: raw.provider,
    clientId: raw.clientId ?? '',
    clientSecretEncrypted: raw.clientSecretEncrypted ?? '',
    enabled: raw.enabled,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** 读取全部平台配置。未配置的平台不会有行，由 service 补齐默认态。 */
export async function listProviderConfigs(db: DbClient): Promise<OAuthProviderConfigRow[]> {
  const { rows } = await db.query<RawConfigRow>(`
    select ${SELECT_COLUMNS}
    from oauth_provider_configs
    order by provider
  `);

  return rows.map(toRow);
}

/** 读取单个平台配置，不存在返回 null。 */
export async function getProviderConfig(
  db: DbClient,
  provider: OAuthProviderId,
): Promise<OAuthProviderConfigRow | null> {
  const { rows } = await db.query<RawConfigRow>(
    `
      select ${SELECT_COLUMNS}
      from oauth_provider_configs
      where provider = $1
    `,
    [provider],
  );

  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

export interface UpsertProviderConfigRowInput {
  provider: OAuthProviderId;
  clientId: string;
  /**
   * 已 seal 的密文。传 `undefined` 表示**保留原值**（用户只改了 Client ID）。
   * 传空串表示显式清空 secret。
   */
  clientSecretEncrypted?: string | undefined;
  enabled?: boolean;
}

/**
 * 写入平台配置。
 *
 * `client_secret_encrypted` 的「保留原值」语义用 SQL 层的 coalesce 实现：
 * 传 null 时 `coalesce($3, oauth_provider_configs.client_secret_encrypted)`
 * 会保留旧密文，避免 service 层先读后写产生竞态。
 */
export async function upsertProviderConfig(
  db: DbClient,
  input: UpsertProviderConfigRowInput,
): Promise<OAuthProviderConfigRow> {
  const { rows } = await db.query<RawConfigRow>(
    `
      insert into oauth_provider_configs (provider, client_id, client_secret_encrypted, enabled)
      values ($1, $2, coalesce($3, ''), coalesce($4, true))
      on conflict (provider) do update set
        client_id               = excluded.client_id,
        client_secret_encrypted = coalesce($3, oauth_provider_configs.client_secret_encrypted),
        enabled                 = coalesce($4, oauth_provider_configs.enabled),
        updated_at              = now()
      returning ${SELECT_COLUMNS}
    `,
    [
      input.provider,
      input.clientId,
      input.clientSecretEncrypted ?? null,
      input.enabled ?? null,
    ],
  );

  return toRow(rows[0]);
}

/** 清除某平台配置（整行删除，回到「未配置」态）。 */
export async function deleteProviderConfig(
  db: DbClient,
  provider: OAuthProviderId,
): Promise<void> {
  await db.query(`delete from oauth_provider_configs where provider = $1`, [provider]);
}

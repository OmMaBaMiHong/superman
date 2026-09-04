/**
 * 用户授权连接仓储（`oauth_connections`）。
 *
 * 安全红线 9：**本文件里每一条涉及具体连接的 SQL 都必须带 `user_id` 谓词**，
 * 越权在数据层即失败，不依赖上层判断。新增函数时请遵守同一约定，
 * 并在 `oauthConnectionsRepo.test.ts` 里补上对应的跨用户隔离用例。
 *
 * 仓储层只做行读写与密文透传，加解密归 service 层。
 */

import type { Pool, PoolClient } from 'pg';

import type {
  OAuthConnectionRow,
  OAuthConnectionStatus,
  UpsertOAuthConnectionInput,
} from '@/server/domains/oauth/types';
import type { OAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';

type DbClient = Pool | PoolClient;

interface RawConnectionRow {
  id: string;
  userId: string;
  provider: OAuthProviderId;
  providerAccountId: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenType: string | null;
  scope: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  status: OAuthConnectionStatus;
  authorizedAt: Date;
  lastRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `displayName` / `avatarUrl` 从 `profile_snapshot` jsonb 展平。
 * 快照里只放展示信息，严禁写入任何凭据。
 */
const SELECT_COLUMNS = `
  id::text                       as "id",
  user_id::text                  as "userId",
  provider,
  provider_account_id            as "providerAccountId",
  profile_snapshot->>'displayName' as "displayName",
  profile_snapshot->>'avatarUrl'   as "avatarUrl",
  access_token_encrypted         as "accessTokenEncrypted",
  refresh_token_encrypted        as "refreshTokenEncrypted",
  token_type                     as "tokenType",
  scope,
  access_token_expires_at        as "accessTokenExpiresAt",
  refresh_token_expires_at       as "refreshTokenExpiresAt",
  status,
  authorized_at                  as "authorizedAt",
  last_refreshed_at              as "lastRefreshedAt",
  created_at                     as "createdAt",
  updated_at                     as "updatedAt"
`;

function toRow(raw: RawConnectionRow): OAuthConnectionRow {
  return {
    id: raw.id,
    userId: raw.userId,
    provider: raw.provider,
    providerAccountId: raw.providerAccountId,
    displayName: raw.displayName,
    avatarUrl: raw.avatarUrl,
    accessTokenEncrypted: raw.accessTokenEncrypted,
    refreshTokenEncrypted: raw.refreshTokenEncrypted,
    tokenType: raw.tokenType,
    scope: raw.scope,
    accessTokenExpiresAt: raw.accessTokenExpiresAt,
    refreshTokenExpiresAt: raw.refreshTokenExpiresAt,
    status: raw.status,
    authorizedAt: raw.authorizedAt,
    lastRefreshedAt: raw.lastRefreshedAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function buildProfileSnapshot(
  displayName: string | null,
  avatarUrl: string | null,
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  if (displayName !== null && displayName !== '') {
    snapshot.displayName = displayName;
  }
  if (avatarUrl !== null && avatarUrl !== '') {
    snapshot.avatarUrl = avatarUrl;
  }
  return snapshot;
}

/** 列出某用户全部连接。SQL 带 `user_id`。 */
export async function listConnectionsByUser(
  db: DbClient,
  userId: string,
): Promise<OAuthConnectionRow[]> {
  const { rows } = await db.query<RawConnectionRow>(
    `
      select ${SELECT_COLUMNS}
      from oauth_connections
      where user_id = $1
      order by provider, authorized_at desc
    `,
    [userId],
  );

  return rows.map(toRow);
}

/** 按 id 读取连接。SQL 带 `user_id`——用户 A 读不到 B 的行。 */
export async function getConnectionById(
  db: DbClient,
  userId: string,
  id: string,
): Promise<OAuthConnectionRow | null> {
  const { rows } = await db.query<RawConnectionRow>(
    `
      select ${SELECT_COLUMNS}
      from oauth_connections
      where user_id = $1
        and id = $2
    `,
    [userId, id],
  );

  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

/** 按平台读取某用户的连接（MVP 每平台单连接）。SQL 带 `user_id`。 */
export async function getConnectionByProvider(
  db: DbClient,
  userId: string,
  provider: OAuthProviderId,
): Promise<OAuthConnectionRow | null> {
  const { rows } = await db.query<RawConnectionRow>(
    `
      select ${SELECT_COLUMNS}
      from oauth_connections
      where user_id = $1
        and provider = $2
      order by authorized_at desc
      limit 1
    `,
    [userId, provider],
  );

  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

export interface UpsertConnectionRowInput
  extends Omit<UpsertOAuthConnectionInput, 'accessToken' | 'refreshToken'> {
  /** 已 seal 的密文。 */
  accessTokenEncrypted: string;
  /** 已 seal 的密文；平台不下发时为 null。 */
  refreshTokenEncrypted: string | null;
}

/**
 * 写入连接：同一 `(userId, provider)` **先删后插**。
 *
 * 这是 R14「重新授权」的实现方式：旧连接（可能是另一个平台账号）整体作废，
 * 避免出现「换了个微信号授权，结果库里躺着两条 active」的歧义。
 * MVP 每平台单连接的约束由此在数据层落地；R13 放开多账号时改这里即可。
 */
export async function upsertConnection(
  db: DbClient,
  input: UpsertConnectionRowInput,
): Promise<OAuthConnectionRow> {
  await db.query(`delete from oauth_connections where user_id = $1 and provider = $2`, [
    input.userId,
    input.provider,
  ]);

  const { rows } = await db.query<RawConnectionRow>(
    `
      insert into oauth_connections (
        user_id, provider, provider_account_id,
        access_token_encrypted, refresh_token_encrypted,
        token_type, scope,
        access_token_expires_at, refresh_token_expires_at,
        status, profile_snapshot, authorized_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10::jsonb, now())
      returning ${SELECT_COLUMNS}
    `,
    [
      input.userId,
      input.provider,
      input.providerAccountId,
      input.accessTokenEncrypted,
      input.refreshTokenEncrypted,
      input.tokenType,
      input.scope,
      input.accessTokenExpiresAt,
      input.refreshTokenExpiresAt,
      JSON.stringify(buildProfileSnapshot(input.displayName, input.avatarUrl)),
    ],
  );

  return toRow(rows[0]);
}

export interface UpdateConnectionTokensRowInput {
  id: string;
  userId: string;
  accessTokenEncrypted: string;
  /** null 表示平台未下发新 refresh_token，保留原密文。 */
  refreshTokenEncrypted: string | null;
  tokenType: string | null;
  scope: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

/**
 * 刷新成功后更新 token。SQL 带 `user_id`。
 * `refresh_token_encrypted` 传 null 时用 coalesce 保留原值。
 */
export async function updateConnectionTokens(
  db: DbClient,
  input: UpdateConnectionTokensRowInput,
): Promise<OAuthConnectionRow | null> {
  const { rows } = await db.query<RawConnectionRow>(
    `
      update oauth_connections set
        access_token_encrypted   = $3,
        refresh_token_encrypted  = coalesce($4, refresh_token_encrypted),
        token_type               = coalesce($5, token_type),
        scope                    = coalesce($6, scope),
        access_token_expires_at  = $7,
        refresh_token_expires_at = coalesce($8, refresh_token_expires_at),
        status                   = 'active',
        last_refreshed_at        = now(),
        updated_at               = now()
      where user_id = $1
        and id = $2
      returning ${SELECT_COLUMNS}
    `,
    [
      input.userId,
      input.id,
      input.accessTokenEncrypted,
      input.refreshTokenEncrypted,
      input.tokenType,
      input.scope,
      input.accessTokenExpiresAt,
      input.refreshTokenExpiresAt,
    ],
  );

  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

/**
 * 更新连接状态。SQL 带 `user_id`。
 *
 * 刷新失败时置 `expired` 而非删除——用户需要看到「已过期 + 重新授权」，
 * 而不是连接凭空消失（§4.3）。
 */
export async function updateConnectionStatus(
  db: DbClient,
  userId: string,
  id: string,
  status: OAuthConnectionStatus,
): Promise<OAuthConnectionRow | null> {
  const { rows } = await db.query<RawConnectionRow>(
    `
      update oauth_connections set
        status     = $3,
        updated_at = now()
      where user_id = $1
        and id = $2
      returning ${SELECT_COLUMNS}
    `,
    [userId, id, status],
  );

  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

/**
 * 撤销（删除）连接。SQL 带 `user_id`——越权删除在数据层即失败。
 *
 * @returns 是否真的删掉了一行。false 表示 id 不存在或不属于该用户。
 */
export async function deleteConnection(
  db: DbClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await db.query(
    `delete from oauth_connections where user_id = $1 and id = $2`,
    [userId, id],
  );

  return (result.rowCount ?? 0) > 0;
}

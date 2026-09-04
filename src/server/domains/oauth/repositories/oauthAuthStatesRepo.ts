/**
 * 授权临时态仓储（`oauth_auth_states`）。
 *
 * 核心安全属性（安全红线 4）：
 * - `consumeAuthState` 是**单条 `DELETE ... RETURNING`**，天然原子，重放必然落空；
 * - TTL 与归属用户校验放在 service 层，仓储只负责「取出即销毁」；
 * - 清理不新增定时任务，插入前顺带 `purgeExpiredAuthStates`（惰性清理，见 AQ-2）。
 */

import type { Pool, PoolClient } from 'pg';

import type { CreateOAuthAuthStateInput, OAuthAuthStateRow } from '@/server/domains/oauth/types';
import type { OAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';

type DbClient = Pool | PoolClient;

interface RawAuthStateRow {
  state: string;
  userId: string;
  provider: OAuthProviderId;
  codeVerifierEncrypted: string | null;
  redirectUri: string;
  returnTo: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const SELECT_COLUMNS = `
  state,
  user_id                 as "userId",
  provider,
  code_verifier_encrypted as "codeVerifierEncrypted",
  redirect_uri            as "redirectUri",
  return_to               as "returnTo",
  created_at              as "createdAt",
  expires_at              as "expiresAt"
`;

function toRow(raw: RawAuthStateRow): OAuthAuthStateRow {
  return {
    state: raw.state,
    userId: raw.userId,
    provider: raw.provider,
    codeVerifierEncrypted: raw.codeVerifierEncrypted,
    redirectUri: raw.redirectUri,
    returnTo: raw.returnTo,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
  };
}

/**
 * 惰性清理过期临时态。
 * 配合 `idx_oauth_auth_states_expires_at`，开销为 O(过期行数)。
 *
 * @returns 被清理的行数。
 */
export async function purgeExpiredAuthStates(db: DbClient): Promise<number> {
  const result = await db.query(`delete from oauth_auth_states where expires_at < now()`);
  return result.rowCount ?? 0;
}

/**
 * 插入一条授权临时态。
 * `codeVerifierEncrypted` 必须是已 seal 的密文，仓储层不做加密。
 */
export async function insertAuthState(
  db: DbClient,
  input: CreateOAuthAuthStateInput & { codeVerifierEncrypted: string | null },
): Promise<OAuthAuthStateRow> {
  // 惰性清理：搭车执行，不新增定时任务（AQ-2）。
  await purgeExpiredAuthStates(db);

  const { rows } = await db.query<RawAuthStateRow>(
    `
      insert into oauth_auth_states
        (state, provider, user_id, code_verifier_encrypted, redirect_uri, return_to, expires_at)
      values ($1, $2, $3, $4, $5, $6, $7)
      returning ${SELECT_COLUMNS}
    `,
    [
      input.state,
      input.provider,
      input.userId,
      input.codeVerifierEncrypted,
      input.redirectUri,
      input.returnTo,
      input.expiresAt,
    ],
  );

  return toRow(rows[0]);
}

/**
 * **原子消费** state：取出的同时删除。
 *
 * 这一条 SQL 就是 R03「state 为一次性，重放无效」的实现依据：
 * 并发或重放时只有第一个请求能拿到行，后续一律返回 null。
 * 注意此处**故意不带 user_id 谓词**——归属校验必须在 service 层比对后
 * 报 `invalid_state`，若下推到 SQL 会让攻击者无法与「不存在」区分（这是好事），
 * 但也会让合法用户的排障信息丢失；更重要的是：无论归属是否匹配，
 * 该 state 都应当被销毁，不能给攻击者留下可再次尝试的记录。
 */
export async function consumeAuthState(
  db: DbClient,
  state: string,
): Promise<OAuthAuthStateRow | null> {
  const { rows } = await db.query<RawAuthStateRow>(
    `
      delete from oauth_auth_states
      where state = $1
      returning ${SELECT_COLUMNS}
    `,
    [state],
  );

  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

/** 删除某用户全部未消费的临时态（用户注销 / 重新发起时的清场，可选调用）。 */
export async function deleteAuthStatesForUser(db: DbClient, userId: string): Promise<number> {
  const result = await db.query(`delete from oauth_auth_states where user_id = $1`, [userId]);
  return result.rowCount ?? 0;
}

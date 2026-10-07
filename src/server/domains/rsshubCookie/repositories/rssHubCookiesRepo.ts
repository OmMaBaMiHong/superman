/**
 * 平台采集 Cookie 仓储 —— 已统一到 `platform_accounts`（purpose='collect'）。
 *
 * 历史：原 `user_rsshub_cookies` 表，迁移 0065 已并入 platform_accounts。
 * 语义保持「每用户每平台一条采集 cookie」，仅存储后端换表。
 *
 * 安全红线：**每一条 SQL 都必须带 `user_id` 谓词**；仓储层只做行读写与密文透传，
 * 加解密归 service 层。
 */

import type { Pool, PoolClient } from 'pg';

import type { RssHubCookieProvider, RssHubCookieRow } from '@/server/domains/rsshubCookie/types';

type DbClient = Pool | PoolClient;

interface RawCookieRow {
  id: string;
  userId: string;
  provider: RssHubCookieProvider;
  cookieEncrypted: string;
  maskedCookie: string;
  remark: string;
  createdAt: Date;
  updatedAt: Date;
}

/** provider（RSSHub 语义）→ platform（platform_accounts 语义）。 */
const PROVIDER_TO_PLATFORM: Record<RssHubCookieProvider, string> = {
  douyin: 'douyin',
  xiaohongshu: 'xhs',
  weibo: 'weibo',
};

const SELECT_COLUMNS = `
  id::text                                                     as "id",
  user_id::text                                                as "userId",
  (case platform when 'xhs' then 'xiaohongshu' else platform end) as "provider",
  credential_encrypted                                         as "cookieEncrypted",
  credential_masked                                            as "maskedCookie",
  remark,
  created_at                                                   as "createdAt",
  updated_at                                                   as "updatedAt"
`;

function toRow(raw: RawCookieRow): RssHubCookieRow {
  return {
    id: raw.id,
    userId: raw.userId,
    provider: raw.provider,
    cookieEncrypted: raw.cookieEncrypted,
    maskedCookie: raw.maskedCookie,
    remark: raw.remark,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** 列出某用户全部平台采集 Cookie。SQL 带 `user_id`。 */
export async function listCookiesByUser(
  db: DbClient,
  userId: string,
): Promise<RssHubCookieRow[]> {
  const { rows } = await db.query<RawCookieRow>(
    `
      select ${SELECT_COLUMNS}
      from platform_accounts
      where user_id = $1 and purpose = 'collect' and cred_kind = 'cookie'
      order by platform
    `,
    [userId],
  );

  return rows.map(toRow);
}

/** 按平台读取某用户采集 Cookie。SQL 带 `user_id`。 */
export async function getCookieByProvider(
  db: DbClient,
  userId: string,
  provider: RssHubCookieProvider,
): Promise<RssHubCookieRow | null> {
  const { rows } = await db.query<RawCookieRow>(
    `
      select ${SELECT_COLUMNS}
      from platform_accounts
      where user_id = $1
        and platform = $2
        and purpose = 'collect'
        and cred_kind = 'cookie'
      limit 1
    `,
    [userId, PROVIDER_TO_PLATFORM[provider]],
  );

  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

export interface UpsertCookieRowInput {
  userId: string;
  provider: RssHubCookieProvider;
  /** 已 seal 的密文。 */
  cookieEncrypted: string;
  /** 展示用打码快照。 */
  maskedCookie: string;
  remark: string;
}

/** 写入采集 Cookie：同一 `(user_id, platform, purpose='collect')` 先删后插（每平台单条）。 */
export async function upsertCookie(
  db: DbClient,
  input: UpsertCookieRowInput,
): Promise<RssHubCookieRow> {
  const platform = PROVIDER_TO_PLATFORM[input.provider];

  await db.query(
    `delete from platform_accounts where user_id = $1 and platform = $2 and purpose = 'collect'`,
    [input.userId, platform],
  );

  const { rows } = await db.query<RawCookieRow>(
    `
      insert into platform_accounts (
        user_id, platform, account_name, cred_kind,
        credential_encrypted, credential_masked, status, purpose, remark
      )
      values ($1, $2, '', 'cookie', $3, $4, 'active', 'collect', $5)
      returning ${SELECT_COLUMNS}
    `,
    [input.userId, platform, input.cookieEncrypted, input.maskedCookie, input.remark],
  );

  return toRow(rows[0]);
}

/** 删除某用户某平台采集 Cookie。SQL 带 `user_id`。 */
export async function deleteCookie(
  db: DbClient,
  userId: string,
  provider: RssHubCookieProvider,
): Promise<boolean> {
  const result = await db.query(
    `delete from platform_accounts where user_id = $1 and platform = $2 and purpose = 'collect'`,
    [userId, PROVIDER_TO_PLATFORM[provider]],
  );

  return (result.rowCount ?? 0) > 0;
}

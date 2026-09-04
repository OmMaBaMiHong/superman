/**
 * RSSHub 平台 Cookie 仓储（`user_rsshub_cookies`）。
 *
 * 安全红线：**每一条涉及 Cookie 的 SQL 都必须带 `user_id` 谓词**，
 * 越权在数据层即失败。仓储层只做行读写与密文透传，加解密归 service 层。
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

const SELECT_COLUMNS = `
  id::text                as "id",
  user_id::text           as "userId",
  provider,
  cookie_encrypted        as "cookieEncrypted",
  masked_cookie           as "maskedCookie",
  remark,
  created_at              as "createdAt",
  updated_at              as "updatedAt"
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

/** 列出某用户全部平台 Cookie。SQL 带 `user_id`。 */
export async function listCookiesByUser(
  db: DbClient,
  userId: string,
): Promise<RssHubCookieRow[]> {
  const { rows } = await db.query<RawCookieRow>(
    `
      select ${SELECT_COLUMNS}
      from user_rsshub_cookies
      where user_id = $1
      order by provider
    `,
    [userId],
  );

  return rows.map(toRow);
}

/** 按平台读取某用户 Cookie。SQL 带 `user_id`——用户 A 读不到 B 的行。 */
export async function getCookieByProvider(
  db: DbClient,
  userId: string,
  provider: RssHubCookieProvider,
): Promise<RssHubCookieRow | null> {
  const { rows } = await db.query<RawCookieRow>(
    `
      select ${SELECT_COLUMNS}
      from user_rsshub_cookies
      where user_id = $1
        and provider = $2
      limit 1
    `,
    [userId, provider],
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

/**
 * 写入 Cookie：同一 `(user_id, provider)` 先删后插（每平台单条）。
 * SQL 带 `user_id`。
 */
export async function upsertCookie(
  db: DbClient,
  input: UpsertCookieRowInput,
): Promise<RssHubCookieRow> {
  await db.query(`delete from user_rsshub_cookies where user_id = $1 and provider = $2`, [
    input.userId,
    input.provider,
  ]);

  const { rows } = await db.query<RawCookieRow>(
    `
      insert into user_rsshub_cookies (
        user_id, provider, cookie_encrypted, masked_cookie, remark
      )
      values ($1, $2, $3, $4, $5)
      returning ${SELECT_COLUMNS}
    `,
    [input.userId, input.provider, input.cookieEncrypted, input.maskedCookie, input.remark],
  );

  return toRow(rows[0]);
}

/** 删除某用户某平台 Cookie。SQL 带 `user_id`。 */
export async function deleteCookie(
  db: DbClient,
  userId: string,
  provider: RssHubCookieProvider,
): Promise<boolean> {
  const result = await db.query(
    `delete from user_rsshub_cookies where user_id = $1 and provider = $2`,
    [userId, provider],
  );

  return (result.rowCount ?? 0) > 0;
}

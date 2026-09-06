import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import {
  maskCredential,
  openCredential,
  sealCredential,
} from '@/core/platform-accounts/secrets';

type DbClient = Pool | PoolClient;

export type AccountPlatform = 'wechat' | 'douyin' | 'xhs' | 'bilibili' | 'channels';
export type CredKind = 'app_secret' | 'cookie' | 'oauth';
export type AccountStatus = 'active' | 'expired' | 'error';

/** 对外视图：永不包含 credential_encrypted / 明文。 */
export interface PlatformAccountView {
  id: string;
  userId: string;
  platform: AccountPlatform;
  accountName: string;
  credKind: CredKind;
  credentialMasked: string;
  status: AccountStatus;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  metaJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

const viewSelectSql = `
  id,
  user_id::text as "userId",
  platform,
  account_name as "accountName",
  cred_kind as "credKind",
  credential_masked as "credentialMasked",
  status,
  expires_at as "expiresAt",
  last_verified_at as "lastVerifiedAt",
  meta_json as "metaJson",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

interface FullRow extends PlatformAccountView {
  credentialEncrypted: string;
}

export async function createPlatformAccount(
  db: DbClient,
  input: {
    platform: AccountPlatform;
    accountName?: string;
    credKind: CredKind;
    /** 凭据明文（JSON 字符串）。只在加密封装内存在，落库即密文。 */
    credentialPlaintext: string;
    metaJson?: Record<string, unknown> | null;
    userId?: string;
  },
): Promise<PlatformAccountView> {
  const scopedUserId = normalizeUserId(input.userId);
  const credentialEncrypted = await sealCredential(db, input.credentialPlaintext);
  const credentialMasked = maskCredential(input.credentialPlaintext);
  const { rows } = await db.query<PlatformAccountView>(
    `
      insert into platform_accounts(
        user_id, platform, account_name, cred_kind,
        credential_encrypted, credential_masked, meta_json
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      returning ${viewSelectSql}
    `,
    [
      scopedUserId,
      input.platform,
      input.accountName ?? '',
      input.credKind,
      credentialEncrypted,
      credentialMasked,
      input.metaJson ? JSON.stringify(input.metaJson) : null,
    ],
  );
  return rows[0];
}

export async function listPlatformAccounts(
  db: DbClient,
  input?: { userId?: string; platform?: AccountPlatform },
): Promise<PlatformAccountView[]> {
  const scopedUserId = normalizeUserId(input?.userId);
  const conditions = ['user_id = $1'];
  const values: string[] = [scopedUserId];
  if (input?.platform) {
    conditions.push('platform = $2');
    values.push(input.platform);
  }
  const { rows } = await db.query<PlatformAccountView>(
    `
      select ${viewSelectSql}
      from platform_accounts
      where ${conditions.join(' and ')}
      order by platform asc, account_name asc, id asc
    `,
    values,
  );
  return rows;
}

export async function getPlatformAccount(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<PlatformAccountView | null> {
  const { rows } = await db.query<PlatformAccountView>(
    `select ${viewSelectSql} from platform_accounts where id = $1 and user_id = $2 limit 1`,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

/** 内部使用：取凭据明文（仅 verify / 发布链路调用，绝不进任何返回值）。 */
export async function getDecryptedCredential(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<{ view: PlatformAccountView; credentialPlaintext: string } | null> {
  const { rows } = await db.query<FullRow & { credential_encrypted: string }>(
    `
      select
        ${viewSelectSql},
        credential_encrypted
      from platform_accounts
      where id = $1 and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  const row = rows[0] as (PlatformAccountView & { credential_encrypted?: string }) | undefined;
  if (!row?.credential_encrypted) return null;
  const plaintext = await openCredential(db, row.credential_encrypted);
  const view = { ...row };
  delete view.credential_encrypted;
  return { view: view as PlatformAccountView, credentialPlaintext: plaintext };
}

export async function deletePlatformAccount(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<boolean> {
  const res = await db.query('delete from platform_accounts where id = $1 and user_id = $2', [
    id,
    normalizeUserId(userId),
  ]);
  return (res.rowCount ?? 0) > 0;
}

/** verify 结果回写：成功 → active + last_verified_at；失败 → status（expired/error）。 */
export async function markAccountVerified(
  db: DbClient,
  input: { id: string; ok: boolean; failStatus?: 'expired' | 'error'; userId?: string },
): Promise<void> {
  await db.query(
    `
      update platform_accounts
      set status = $3,
          last_verified_at = now(),
          updated_at = now()
      where id = $1 and user_id = $2
    `,
    [
      input.id,
      normalizeUserId(input.userId),
      input.ok ? 'active' : (input.failStatus ?? 'error'),
    ],
  );
}

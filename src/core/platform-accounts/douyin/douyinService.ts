/**
 * @deprecated P2e-3 起泛化为 sau/sauService（douyin = platform 'douyin' 特例）。
 * 本文件仅保留旧名兼容（P2e-2 的调用方与测试），新代码请直接用 sau/。
 */
import type { Pool, PoolClient } from 'pg';
import type { PlatformAccountView } from '@/core/platform-accounts/repository';
import {
  collectSauAccount,
  confirmSauLoginSession,
  handleSauLoginCallback,
  verifySauAccount,
  type SauCallbackPayload,
  type SauCollectDeps,
} from '@/core/platform-accounts/sau/sauService';

type DbClient = Pool | PoolClient;

export type DouyinCollectDeps = SauCollectDeps;
export type DouyinCallbackPayload = SauCallbackPayload;

export async function collectDouyinAccount(
  db: DbClient,
  input: {
    userId: string;
    accountName: string;
    vendorUserName: string;
    filePath: string;
    storageState: Record<string, unknown>;
  },
): Promise<PlatformAccountView> {
  return collectSauAccount(db, { platform: 'douyin', ...input });
}

export async function handleDouyinLoginCallback(
  db: DbClient,
  payload: DouyinCallbackPayload,
): Promise<{ accountId: string; userId: string }> {
  const result = await handleSauLoginCallback(db, { ...payload, type: 3 });
  return { accountId: result.accountId, userId: result.userId };
}

export async function confirmDouyinLoginSession(
  db: DbClient,
  input: { sessionId: string; userId?: string },
  deps?: DouyinCollectDeps,
): Promise<PlatformAccountView> {
  return confirmSauLoginSession(db, input, deps);
}

export async function verifyDouyinAccount(
  account: PlatformAccountView,
  deps?: DouyinCollectDeps,
): Promise<{ verified: boolean; reason?: string }> {
  return verifySauAccount('douyin', account, deps);
}

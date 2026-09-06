/**
 * 抖音授权与发布服务（P2e-2）。
 *
 * cookie 上收两路：
 *   ① vendor 回调（SAU_CALLBACK_URL → /s/api/platform-accounts/douyin/callback）
 *      —— handleDouyinLoginCallback，按 vendorUserName(=扫码会话 id) 绑回用户；
 *   ② confirm 拉取兜底 —— confirmDouyinLoginSession：
 *      /getAccounts 对账 → /downloadCookie 取 storage_state → 加密落库。
 * 两路都经 collectDouyinAccount 统一落 platform_accounts（有则更新凭据，无则新建）。
 */
import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { normalizeUserId } from '@/server/domains/users/userScope';
import {
  createPlatformAccount,
  findPlatformAccountByName,
  updatePlatformAccountCredential,
  type PlatformAccountView,
} from '@/core/platform-accounts/repository';
import {
  downloadVendorCookie,
  getDouyinLoginSession,
  listVendorAccounts,
  resolveSauConfig,
  type SauConfig,
  type SauFetcher,
} from '@/core/platform-accounts/douyin/douyinProvider';

type DbClient = Pool | PoolClient;

export interface DouyinCollectDeps {
  config?: SauConfig;
  fetcher?: SauFetcher;
}

/** 统一落库：凭据密文 + masked；meta 记录 vendor 对账字段。 */
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
  const scopedUserId = normalizeUserId(input.userId);
  const meta = { vendorUserName: input.vendorUserName, vendorFilePath: input.filePath };
  const credentialPlaintext = JSON.stringify(input.storageState);

  const existing = await findPlatformAccountByName(db, {
    platform: 'douyin',
    accountName: input.accountName,
    userId: scopedUserId,
  });
  if (existing) {
    const updated = await updatePlatformAccountCredential(db, {
      id: existing.id,
      credentialPlaintext,
      metaJson: meta,
      userId: scopedUserId,
    });
    return updated ?? existing;
  }
  return createPlatformAccount(db, {
    platform: 'douyin',
    accountName: input.accountName,
    credKind: 'cookie',
    credentialPlaintext,
    metaJson: meta,
    userId: scopedUserId,
  });
}

export interface DouyinCallbackPayload {
  type: number;
  userName: string;
  filePath: string;
  storageState: Record<string, unknown>;
}

/**
 * vendor 登录成功回调。userName 是扫码会话 id（startDouyinLoginSession 生成），
 * 据此绑回发起用户；未知会话拒绝（防伪造回调灌库）。
 */
export async function handleDouyinLoginCallback(
  db: DbClient,
  payload: DouyinCallbackPayload,
): Promise<{ accountId: string; userId: string }> {
  const session = getDouyinLoginSession(payload.userName);
  if (!session) {
    throw new ValidationError('未知的扫码会话', { userName: '会话不存在或已过期' });
  }
  const account = await collectDouyinAccount(db, {
    userId: session.userId,
    accountName: session.accountName,
    vendorUserName: payload.userName,
    filePath: payload.filePath,
    storageState: payload.storageState,
  });
  return { accountId: account.id, userId: session.userId };
}

/**
 * confirm 拉取兜底：vendor 回调没到时，用户点「完成」主动对账上收。
 */
export async function confirmDouyinLoginSession(
  db: DbClient,
  input: { sessionId: string; userId?: string },
  deps?: DouyinCollectDeps,
): Promise<PlatformAccountView> {
  const scopedUserId = normalizeUserId(input.userId);
  const session = getDouyinLoginSession(input.sessionId);
  if (!session || session.userId !== scopedUserId) {
    throw new NotFoundError('扫码会话不存在');
  }
  if (session.status !== 'confirmed') {
    throw new ConflictError(`扫码尚未完成（当前状态：${session.status}）`);
  }

  const config = deps?.config ?? resolveSauConfig();
  const vendorAccounts = await listVendorAccounts(config, { fetcher: deps?.fetcher });
  const vendorRow = vendorAccounts.find((row) => row.userName === session.vendorUserName);
  if (!vendorRow) {
    throw new ConflictError('执行器侧未找到该账号记录');
  }
  const storageState = await downloadVendorCookie(config, vendorRow.filePath, {
    fetcher: deps?.fetcher,
  });
  if (!storageState) {
    throw new ConflictError('执行器侧 cookie 文件读取失败');
  }
  return collectDouyinAccount(db, {
    userId: scopedUserId,
    accountName: session.accountName,
    vendorUserName: session.vendorUserName,
    filePath: vendorRow.filePath,
    storageState,
  });
}

// ============================================================
// verify / publish
// ============================================================

function readVendorMeta(account: PlatformAccountView): { vendorUserName: string | null } {
  const meta = account.metaJson ?? {};
  const vendorUserName = typeof meta.vendorUserName === 'string' ? meta.vendorUserName : null;
  return { vendorUserName };
}

/** verify（抖音 cookie 账号）：执行器账号记录存在且 status=1 即视为有效。 */
export async function verifyDouyinAccount(
  account: PlatformAccountView,
  deps?: DouyinCollectDeps,
): Promise<{ verified: boolean; reason?: string }> {
  const { vendorUserName } = readVendorMeta(account);
  if (!vendorUserName) {
    return { verified: false, reason: '账号缺少执行器对账信息（vendorUserName），请重新扫码授权' };
  }
  const config = deps?.config ?? resolveSauConfig();
  try {
    const vendorAccounts = await listVendorAccounts(config, { fetcher: deps?.fetcher });
    const row = vendorAccounts.find((item) => item.userName === vendorUserName);
    if (!row) return { verified: false, reason: '执行器侧无此账号（可能已被清理），请重新扫码' };
    if (row.status !== 1) return { verified: false, reason: '登录态已失效，请重新扫码' };
    return { verified: true };
  } catch (err) {
    return {
      verified: false,
      reason: `执行器不可用：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

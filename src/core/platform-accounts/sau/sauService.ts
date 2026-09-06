/**
 * SAU 平台（douyin/xhs）授权服务（P2e-3 泛化自 P2e-2 抖音版）。
 *
 * cookie 上收两路（与 P2e-2 同构）：
 *   ① vendor 回调 → handleSauLoginCallback（payload.type 区分平台，
 *      按 vendorUserName=扫码会话 id 绑回用户，未知会话拒绝防灌库）；
 *   ② confirm 拉取兜底 → confirmSauLoginSession（对账 + downloadCookie）。
 */
import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { normalizeUserId } from '@/server/domains/users/userScope';
import {
  createPlatformAccount,
  findPlatformAccountByName,
  updatePlatformAccountCredential,
  type AccountPlatform,
  type PlatformAccountView,
} from '@/core/platform-accounts/repository';
import {
  downloadVendorCookie,
  getSauLoginSession,
  listVendorAccounts,
  resolveSauConfig,
  sauPlatformFromType,
  type SauConfig,
  type SauFetcher,
  type SauPlatform,
} from '@/core/platform-accounts/sau/sauProvider';

type DbClient = Pool | PoolClient;

export interface SauCollectDeps {
  config?: SauConfig;
  fetcher?: SauFetcher;
}

/** 统一落库：凭据密文 + masked；meta 记录 vendor 对账字段。 */
export async function collectSauAccount(
  db: DbClient,
  input: {
    platform: SauPlatform;
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
    platform: input.platform as AccountPlatform,
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
    platform: input.platform as AccountPlatform,
    accountName: input.accountName,
    credKind: 'cookie',
    credentialPlaintext,
    metaJson: meta,
    userId: scopedUserId,
  });
}

export interface SauCallbackPayload {
  type: number;
  userName: string;
  filePath: string;
  storageState: Record<string, unknown>;
}

/**
 * vendor 登录成功回调（泛化版）：payload.type → 平台（1=xhs / 3=douyin）。
 * userName 是扫码会话 id，据此绑回发起用户；未知会话拒绝（防伪造回调灌库）。
 */
export async function handleSauLoginCallback(
  db: DbClient,
  payload: SauCallbackPayload,
): Promise<{ accountId: string; userId: string; platform: SauPlatform }> {
  const platform = sauPlatformFromType(payload.type);
  if (!platform) {
    throw new ValidationError('回调平台类型不支持', { type: '仅支持 1(xhs)/3(douyin)' });
  }
  const session = getSauLoginSession(payload.userName);
  if (!session) {
    throw new ValidationError('未知的扫码会话', { userName: '会话不存在或已过期' });
  }
  if (session.platform !== platform) {
    throw new ValidationError('回调平台与会话不匹配', { platform: '会话平台与回调 type 不一致' });
  }
  const account = await collectSauAccount(db, {
    platform,
    userId: session.userId,
    accountName: session.accountName,
    vendorUserName: payload.userName,
    filePath: payload.filePath,
    storageState: payload.storageState,
  });
  return { accountId: account.id, userId: session.userId, platform };
}

/**
 * confirm 拉取兜底：vendor 回调没到时，用户点「完成」主动对账上收。
 */
export async function confirmSauLoginSession(
  db: DbClient,
  input: { sessionId: string; userId?: string },
  deps?: SauCollectDeps,
): Promise<PlatformAccountView> {
  const scopedUserId = normalizeUserId(input.userId);
  const session = getSauLoginSession(input.sessionId);
  if (!session || session.userId !== scopedUserId) {
    throw new NotFoundError('扫码会话不存在');
  }
  if (session.status !== 'confirmed') {
    throw new ConflictError(`扫码尚未完成（当前状态：${session.status}）`);
  }

  const config = deps?.config ?? resolveSauConfig();
  const vendorAccounts = await listVendorAccounts(config, session.platform, { fetcher: deps?.fetcher });
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
  return collectSauAccount(db, {
    platform: session.platform,
    userId: scopedUserId,
    accountName: session.accountName,
    vendorUserName: session.vendorUserName,
    filePath: vendorRow.filePath,
    storageState,
  });
}

function readVendorUserName(account: PlatformAccountView): string | null {
  const meta = account.metaJson ?? {};
  return typeof meta.vendorUserName === 'string' ? meta.vendorUserName : null;
}

/** verify（SAU cookie 账号）：执行器账号记录存在且 status=1 即视为有效。 */
export async function verifySauAccount(
  platform: SauPlatform,
  account: PlatformAccountView,
  deps?: SauCollectDeps,
): Promise<{ verified: boolean; reason?: string }> {
  const vendorUserName = readVendorUserName(account);
  if (!vendorUserName) {
    return { verified: false, reason: '账号缺少执行器对账信息（vendorUserName），请重新扫码授权' };
  }
  const config = deps?.config ?? resolveSauConfig();
  try {
    const vendorAccounts = await listVendorAccounts(config, platform, { fetcher: deps?.fetcher });
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

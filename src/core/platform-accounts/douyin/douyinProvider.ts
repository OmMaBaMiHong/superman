/**
 * @deprecated P2e-3 起泛化为 sau/sauProvider（douyin = platform 'douyin' 特例）。
 * 本文件仅保留旧名兼容（P2e-2 的调用方与测试），新代码请直接用 sau/。
 */
import {
  downloadVendorCookie as sauDownloadVendorCookie,
  getSauLoginSession,
  listVendorAccounts as sauListVendorAccounts,
  startSauLoginSession,
  type SauConfig,
  type SauFetcher,
  type SauLoginDeps,
  type SauLoginSession,
  type SauLoginSessionStatus,
  type VendorAccountRow,
} from '@/core/platform-accounts/sau/sauProvider';

export {
  resolveSauConfig,
  resetSauLoginSessionsForTest as resetDouyinLoginSessionsForTest,
} from '@/core/platform-accounts/sau/sauProvider';
export type {
  SauConfig,
  SauFetcher,
  SauLoginDeps,
  VendorAccountRow,
} from '@/core/platform-accounts/sau/sauProvider';

export type DouyinLoginSessionStatus = SauLoginSessionStatus;
export type DouyinLoginSession = SauLoginSession;
export type DouyinLoginDeps = SauLoginDeps;

export function getDouyinLoginSession(id: string): DouyinLoginSession | null {
  return getSauLoginSession(id);
}

export function startDouyinLoginSession(input: {
  userId: string;
  accountName: string;
  deps?: DouyinLoginDeps;
}): DouyinLoginSession {
  return startSauLoginSession({ platform: 'douyin', ...input });
}

export async function listVendorAccounts(
  config: SauConfig,
  deps?: { fetcher?: SauFetcher },
): Promise<VendorAccountRow[]> {
  return sauListVendorAccounts(config, 'douyin', deps);
}

export async function downloadVendorCookie(
  config: SauConfig,
  filePath: string,
  deps?: { fetcher?: SauFetcher },
): Promise<Record<string, unknown> | null> {
  return sauDownloadVendorCookie(config, filePath, deps);
}

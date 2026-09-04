/**
 * RSSHub 平台 Cookie 服务。
 *
 * 这是**明文 Cookie 唯一被允许出现的文件**（连同注入 RSSHub 的调用点）。
 * 约定：
 * - 明文只在单次函数调用内存活，绝不进入任何 DTO / 日志；
 * - 对外一律返回 `RssHubCookieView`（只含打码快照）；
 * - `getPlainRssHubCookie` 是明文唯一出口，仅供 RSSHub 路由注入时紧邻出网调用。
 */

import type { Pool, PoolClient } from 'pg';

import {
  deleteCookie,
  getCookieByProvider,
  listCookiesByUser,
  upsertCookie,
} from '@/server/domains/rsshubCookie/repositories/rssHubCookiesRepo';
import {
  RSSHUB_COOKIE_PROVIDER_META,
  RSSHUB_COOKIE_PROVIDERS,
  type RssHubCookieProvider,
  type RssHubCookieView,
} from '@/server/domains/rsshubCookie/types';
import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider';

type DbClient = Pool | PoolClient;

/** 与 oauth secret 打码同一范式：前 4 + **** + 后 4。 */
function maskCookie(cookie: string): string {
  const trimmed = cookie.trim();
  if (trimmed === '') {
    return '';
  }
  if (trimmed.length <= 8) {
    return '****';
  }
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

/** 解密已落库的 Cookie 密文；失败一律当作「未配置」而非抛错。 */
async function openCookie(db: DbClient, encrypted: string): Promise<string> {
  const trimmed = encrypted.trim();
  if (trimmed === '' || !isSealed(trimmed)) {
    return '';
  }

  try {
    const key = await resolveSecretKey(db);
    return openSealed(trimmed, key);
  } catch {
    // 密钥轮换导致解密失败：视作未配置，UI 会引导用户重填。
    return '';
  }
}

function isProvider(value: string): value is RssHubCookieProvider {
  return (RSSHUB_COOKIE_PROVIDERS as string[]).includes(value);
}

/** 返回所有平台的 Cookie 状态（未配置的平台也出现，呈「未配置」引导态）。 */
export async function listRssHubCookieViews(
  db: DbClient,
  userId: string,
): Promise<RssHubCookieView[]> {
  const rows = await listCookiesByUser(db, userId);
  const rowByProvider = new Map(rows.map((row) => [row.provider, row]));

  return RSSHUB_COOKIE_PROVIDERS.map((provider) => {
    const row = rowByProvider.get(provider) ?? null;
    return {
      provider,
      displayName: RSSHUB_COOKIE_PROVIDER_META[provider].displayName,
      configured: row !== null && row.maskedCookie !== '',
      maskedCookie: row?.maskedCookie || null,
      remark: row?.remark ?? '',
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

/** 返回单个平台的 Cookie 状态。 */
export async function getRssHubCookieView(
  db: DbClient,
  userId: string,
  provider: RssHubCookieProvider,
): Promise<RssHubCookieView> {
  const row = await getCookieByProvider(db, userId, provider);
  return {
    provider,
    displayName: RSSHUB_COOKIE_PROVIDER_META[provider].displayName,
    configured: row !== null && row.maskedCookie !== '',
    maskedCookie: row?.maskedCookie || null,
    remark: row?.remark ?? '',
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export interface SaveRssHubCookieInput {
  provider: RssHubCookieProvider;
  /** 明文 Cookie。空串表示清空。 */
  cookie: string;
  remark?: string;
}

/** 保存平台 Cookie。明文在此处 `seal()` 后落库，明文不出本函数。 */
export async function saveRssHubCookie(
  db: DbClient,
  userId: string,
  input: SaveRssHubCookieInput,
): Promise<RssHubCookieView> {
  const cookie = input.cookie.trim();
  const remark = (input.remark ?? '').trim();

  if (cookie === '') {
    await deleteCookie(db, userId, input.provider);
  } else {
    const key = await resolveSecretKey(db);
    await upsertCookie(db, {
      userId,
      provider: input.provider,
      cookieEncrypted: seal(cookie, key),
      maskedCookie: maskCookie(cookie),
      remark,
    });
  }

  return getRssHubCookieView(db, userId, input.provider);
}

/** 删除平台 Cookie。 */
export async function clearRssHubCookie(
  db: DbClient,
  userId: string,
  provider: RssHubCookieProvider,
): Promise<RssHubCookieView> {
  await deleteCookie(db, userId, provider);
  return getRssHubCookieView(db, userId, provider);
}

/**
 * 解析出网所需的明文 Cookie。
 *
 * **这是明文 Cookie 唯一的出口**，只允许 RSSHub 路由注入服务在紧邻出网处调用，
 * 返回值不得日志化、不得放进任何 DTO。
 */
export async function getPlainRssHubCookie(
  db: DbClient,
  userId: string,
  provider: RssHubCookieProvider,
): Promise<string | null> {
  const row = await getCookieByProvider(db, userId, provider);
  if (row === null) {
    return null;
  }

  const plain = await openCookie(db, row.cookieEncrypted);
  return plain === '' ? null : plain;
}

export { isProvider };

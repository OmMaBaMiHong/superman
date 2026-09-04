/**
 * RSSHub Cookie 注入辅助函数。
 *
 * 检测请求路由是否为需要 Cookie 的 douyin 路由，若是则从数据库读取用户 Cookie
 * 并作为 `x-feedfuse-cookie` 自定义头注入，供 vendor 路由补丁读取。
 *
 * 安全：Cookie 明文只在请求头中瞬时传递，不落日志。
 */

import { getPool } from '@/server/infra/db/pool';
import { getPlainRssHubCookie } from '@/server/domains/rsshubCookie/services/rssHubCookieService';
import type { RssHubCookieProvider } from '@/server/domains/rsshubCookie/types';

/** 需要 Cookie 的平台路由前缀。 */
const COOKIE_REQUIRED_ROUTES: Array<{ prefix: string; provider: RssHubCookieProvider }> = [
  { prefix: '/douyin/user', provider: 'douyin' },
  { prefix: '/douyin/hashtag', provider: 'douyin' },
  { prefix: '/douyin/live', provider: 'douyin' },
];

/** 判断路由路径是否需要注入 Cookie。 */
function isCookieRequiredRoute(routePath: string): RssHubCookieProvider | null {
  const lower = routePath.toLowerCase();
  for (const { prefix, provider } of COOKIE_REQUIRED_ROUTES) {
    if (lower.startsWith(prefix)) {
      return provider;
    }
  }
  return null;
}

/**
 * 向请求头注入当前用户的 RSSHub 平台 Cookie。
 *
 * 只在路由匹配时读取数据库，避免不必要的查询。
 * 返回修改后的 Headers（若无 Cookie 则返回原样）。
 */
export async function injectRssHubCookieHeader(
  routePath: string,
  userId: string,
  headers: Headers,
): Promise<Headers> {
  const provider = isCookieRequiredRoute(routePath);
  if (!provider) {
    return headers;
  }

  const cookie = await getPlainRssHubCookie(getPool(), userId, provider);
  if (!cookie) {
    return headers;
  }

  const injected = new Headers(headers);
  injected.set('x-feedfuse-cookie', cookie);
  return injected;
}
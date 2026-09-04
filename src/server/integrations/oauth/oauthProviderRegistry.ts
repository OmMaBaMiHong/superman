/**
 * Provider 注册表（见 docs/arch-oauth-hub.md §2.1 / §7.4 / ADR-07）。
 *
 * 这是流程层访问平台适配器的**唯一入口**：
 * - `getProvider` / `requireProvider` 按 id 取适配器；
 * - `listProviders` 供设置页按固定顺序渲染四个卡片；
 * - `collectAllowedHosts` 汇总 SSRF 白名单，全部从代码常量派生，
 *   用户输入永远无法影响出网目标（S3 的落点）。
 *
 * 新增平台的完整改动面：`OAUTH_PROVIDER_IDS` + 新适配器文件 + 本表 + DB CHECK。
 */

import {
  OAUTH_PROVIDER_IDS,
  isOAuthProviderId,
  type OAuthProviderDefinition,
  type OAuthProviderId,
} from './oauthProviderTypes';
import { douyinProvider } from './providers/douyin';
import { githubProvider } from './providers/github';
import { wechatProvider } from './providers/wechat';
import { xiaohongshuProvider } from './providers/xiaohongshu';

const PROVIDER_REGISTRY: Readonly<Record<OAuthProviderId, OAuthProviderDefinition>> =
  Object.freeze({
    github: githubProvider,
    wechat: wechatProvider,
    douyin: douyinProvider,
    xiaohongshu: xiaohongshuProvider,
  });

/** 按 id 取适配器；id 非法时返回 null（供路由做入参校验）。 */
export function getProvider(providerId: unknown): OAuthProviderDefinition | null {
  if (!isOAuthProviderId(providerId)) {
    return null;
  }
  return PROVIDER_REGISTRY[providerId];
}

/**
 * 按 id 取适配器，取不到即抛。
 * 仅在调用方已确认 id 合法（如来自 DB 的枚举列）时使用。
 */
export function requireProvider(providerId: OAuthProviderId): OAuthProviderDefinition {
  return PROVIDER_REGISTRY[providerId];
}

/** 按 `OAUTH_PROVIDER_IDS` 的声明顺序返回全部适配器，保证 UI 渲染顺序稳定。 */
export function listProviders(): OAuthProviderDefinition[] {
  return OAUTH_PROVIDER_IDS.map((id) => PROVIDER_REGISTRY[id]);
}

/**
 * 汇总四家的出网主机白名单（去重、小写、顺序稳定）。
 * authorize 端点是浏览器跳转、不经服务端 fetch，故不计入。
 */
export function collectAllowedHosts(): string[] {
  const hosts = new Set<string>();
  for (const provider of listProviders()) {
    for (const host of provider.allowedHosts) {
      hosts.add(host.trim().toLowerCase());
    }
  }
  return [...hosts];
}

/**
 * RSSHub 平台 Cookie 领域类型。
 *
 * 安全约定（与 oauth_hub 一致）：
 * - `cookieEncrypted` 为 secretBox 密文，仅存于仓储层与内存，永不回显。
 * - 对外一律 `RssHubCookieView`（只含打码快照），明文只在注入 RSSHub 时瞬时使用。
 */

export type RssHubCookieProvider = 'douyin' | 'xiaohongshu' | 'weibo';

export const RSSHUB_COOKIE_PROVIDERS: RssHubCookieProvider[] = ['douyin', 'xiaohongshu', 'weibo'];

export const RSSHUB_COOKIE_PROVIDER_META: Record<
  RssHubCookieProvider,
  { displayName: string; hint: string }
> = {
  douyin: {
    displayName: '抖音',
    hint: '在浏览器登录抖音后，从开发者工具复制整段 Cookie 填入，用于绕过反爬 WAF。',
  },
  xiaohongshu: {
    displayName: '小红书',
    hint: '在浏览器登录小红书后，从开发者工具复制整段 Cookie 填入，用于绕过反爬限制。',
  },
  weibo: {
    displayName: '微博',
    hint: '在浏览器登录微博后，从开发者工具复制整段 Cookie 填入。',
  },
};

/** 仓储层行。cookieEncrypted 为密文，只允许 service 层解密使用。 */
export interface RssHubCookieRow {
  id: string;
  userId: string;
  provider: RssHubCookieProvider;
  cookieEncrypted: string;
  maskedCookie: string;
  remark: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 对外视图：只含打码快照，永不携带明文或密文。 */
export interface RssHubCookieView {
  provider: RssHubCookieProvider;
  displayName: string;
  configured: boolean;
  maskedCookie: string | null;
  remark: string;
  updatedAt: string | null;
}

export interface UpsertRssHubCookieInput {
  userId: string;
  provider: RssHubCookieProvider;
  cookie: string;
  remark?: string;
}

/**
 * 前端侧 RSSHub 平台 Cookie 的展示元信息。
 *
 * 纯静态文案：如何拿到 Cookie、各平台用于哪些路由。接口只回动态的
 * 配置状态（`configured` / `maskedCookie` / `updatedAt`）。
 */

import type { RssHubCookieProvider } from '@/types';

export interface RssHubCookieMeta {
  provider: RssHubCookieProvider;
  displayName: string;
  /** 卡片副标题：填了这个 Cookie 能解锁什么。 */
  summary: string;
  /** 获取 Cookie 的步骤说明，直接渲染成列表。 */
  steps: string[];
}

export const RSSHUB_COOKIE_PROVIDERS: RssHubCookieProvider[] = [
  'douyin',
  'xiaohongshu',
  'weibo',
];

/** 展示顺序与服务端 `RSSHUB_COOKIE_PROVIDERS` 保持一致。 */
export const RSSHUB_COOKIE_META: Record<RssHubCookieProvider, RssHubCookieMeta> = {
  douyin: {
    provider: 'douyin',
    displayName: '抖音',
    summary: '配置后即可订阅抖音博主主页与话题，绕过反爬 WAF 的拦截。',
    steps: [
      '在浏览器中登录 douyin.com，确保能正常看到博主主页。',
      '按 F12 打开开发者工具，切到「网络」或「应用」标签。',
      '复制整段 Cookie（形如 passport_csrf_token=…; …），粘贴到下方输入框。',
      'Cookie 会加密落库，仅用于内嵌 RSSHub 抓取时注入，不会回显明文。',
    ],
  },
  xiaohongshu: {
    provider: 'xiaohongshu',
    displayName: '小红书',
    summary: '配置后即可订阅小红书笔记，绕过反爬限制。',
    steps: [
      '在浏览器中登录 xiaohongshu.com，确保能正常浏览笔记。',
      '按 F12 打开开发者工具，找到请求头里的 Cookie 字段。',
      '复制整段 Cookie，粘贴到下方输入框后保存。',
    ],
  },
  weibo: {
    provider: 'weibo',
    displayName: '微博',
    summary: '配置后即可订阅微博用户动态，绕过反爬限制。',
    steps: [
      '在浏览器中登录 weibo.com，确保能正常刷新时间线。',
      '按 F12 打开开发者工具，复制请求头里的整段 Cookie。',
      '粘贴到下方输入框后保存。',
    ],
  },
};

export function getRssHubCookieMeta(provider: RssHubCookieProvider): RssHubCookieMeta {
  return RSSHUB_COOKIE_META[provider];
}

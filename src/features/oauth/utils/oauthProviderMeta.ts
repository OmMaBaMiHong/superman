/**
 * 前端侧的平台展示元信息。
 *
 * 为什么不从接口取：这些是纯静态的文案与外链，随代码走版本控制比随 DB 走更可控；
 * 接口只负责回「配置状态」这类真正的动态数据。
 *
 * 注意：`displayName` 服务端也会返回一份（来自 provider registry），
 * 渲染时**以接口返回的为准**，这里的仅作为接口未覆盖平台时的兜底。
 */

import type { OAuthCallbackOutcome, OAuthConnectionStatus, OAuthProviderId } from '@/types';

export interface OAuthProviderMeta {
  id: OAuthProviderId;
  displayName: string;
  /** 卡片副标题：这个平台接进来能干什么。 */
  summary: string;
  /** 去哪里申请 Client ID / Secret。 */
  consoleName: string;
  consoleUrl: string;
  /** 申请凭据时的关键注意事项，直接渲染成列表。 */
  tips: string[];
}

/** 展示顺序与服务端 `OAUTH_PROVIDER_IDS` 保持一致，GitHub 打头（MVP 唯一可端到端跑通的平台）。 */
export const OAUTH_PROVIDER_META: Record<OAuthProviderId, OAuthProviderMeta> = {
  github: {
    id: 'github',
    displayName: 'GitHub',
    summary: '授权后可读取你的公开身份信息，用于后续的仓库能力扩展。',
    consoleName: 'GitHub Developer Settings',
    consoleUrl: 'https://github.com/settings/developers',
    tips: [
      '在 Developer Settings 中新建 OAuth App（不是 GitHub App）。',
      '把下方的回调地址原样填入 Authorization callback URL。',
      '支持 PKCE，无需额外开关。',
    ],
  },
  wechat: {
    id: 'wechat',
    displayName: '微信',
    summary: '授权后可获取微信开放平台的用户标识（UnionID）。',
    consoleName: '微信开放平台',
    consoleUrl: 'https://open.weixin.qq.com/',
    tips: [
      '需要已认证的开放平台账号（个人开发者通常无法申请网站应用）。',
      '回调域名必须与下方回调地址**逐字节一致**，且需在平台后台备案。',
      'AppID / AppSecret 对应下方的 Client ID / Client Secret。',
    ],
  },
  douyin: {
    id: 'douyin',
    displayName: '抖音',
    summary: '授权后可获取抖音开放平台的用户标识（OpenID）。',
    consoleName: '抖音开放平台',
    consoleUrl: 'https://developer.open-douyin.com/',
    tips: [
      '需要在开放平台创建「网站应用」并通过审核。',
      'Client Key / Client Secret 对应下方的 Client ID / Client Secret。',
      '回调地址需在平台后台的授权回调域中登记。',
    ],
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    displayName: '小红书',
    summary: '授权后可获取小红书开放平台的用户标识。',
    consoleName: '小红书开放平台',
    consoleUrl: 'https://open.xiaohongshu.com/',
    tips: [
      '开放平台目前对接入方有资质要求，需先完成企业认证。',
      '接口端点以平台最新文档为准，若授权失败请先核对应用类型。',
      '回调地址需在平台后台登记后才会生效。',
    ],
  },
};

/** 取展示元信息；未知平台返回 null，由调用方决定降级方式。 */
export function getOAuthProviderMeta(provider: string): OAuthProviderMeta | null {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDER_META, provider)
    ? OAUTH_PROVIDER_META[provider as OAuthProviderId]
    : null;
}

/** 连接状态的中文标签与语义色，badge 与列表共用。 */
export const OAUTH_CONNECTION_STATUS_META: Record<
  OAuthConnectionStatus,
  { label: string; toneClassName: string }
> = {
  active: {
    label: '已连接',
    toneClassName: 'border-success/20 bg-success/10 text-success',
  },
  expired: {
    label: '已过期',
    toneClassName: 'border-warning/20 bg-warning/10 text-warning',
  },
  revoked: {
    label: '已撤销',
    toneClassName: 'border-border/70 bg-muted text-muted-foreground',
  },
};

/**
 * 回调 302 回站时 `reason` 参数（取自服务端 `OAuthErrorKind`）到中文文案的映射。
 *
 * 与服务端 `oauthErrors.ts` 的文案表保持同义——之所以前端再存一份，
 * 是因为回调走的是 302 而非 JSON 接口，拿不到 `error.message`，只能拿到枚举值。
 */
const OAUTH_CALLBACK_REASON_MESSAGES: Record<string, string> = {
  not_configured: '该平台尚未配置应用凭据，请先填写 Client ID 与 Client Secret',
  user_denied: '你在平台侧取消了授权',
  invalid_state: '授权校验失败，请返回设置页重新发起授权',
  state_expired: '授权链接已超时，请返回设置页重新发起授权',
  redirect_uri_mismatch: '平台校验回调地址不匹配，请将设置页展示的回调地址原样填入平台后台',
  token_exchange_failed: '获取访问令牌失败，请稍后重试或检查平台应用配置',
  refresh_failed: '刷新访问令牌失败，请重新授权该平台',
  provider_error: '平台返回了错误，请稍后重试',
  network: '无法连接平台服务，请检查网络后重试',
};

/** 把回调 query 中的 `reason` 翻成用户能看懂的话；未知值给通用兜底。 */
export function resolveOAuthCallbackReason(reason: string | null): string {
  if (reason !== null && Object.prototype.hasOwnProperty.call(OAUTH_CALLBACK_REASON_MESSAGES, reason)) {
    return OAUTH_CALLBACK_REASON_MESSAGES[reason];
  }
  return '授权未完成，请返回设置页重试';
}

/** 校验回调 query 中的 `oauth` 参数是否为已知结果值。 */
export function isOAuthCallbackOutcome(value: string | null): value is OAuthCallbackOutcome {
  return value === 'success' || value === 'denied' || value === 'failed';
}

/**
 * OAuth 领域错误（见 docs/arch-oauth-hub.md §3.2 / §6）。
 *
 * 约定：服务端内部一律抛 `OAuthError`，只在**路由边界**调用 `toAppError()`
 * 转成既有 `AppError` 后交给 `fail()`，避免领域层依赖 HTTP 状态码。
 *
 * 安全红线：`OAuthError.message` 会进入 API 响应与 toast，
 * 因此**永远只使用下方中文文案表里的固定文案**，禁止把平台原始响应体拼进 message。
 * 平台细节请放进 `debugHint`，该字段只用于服务端日志且已确保不含凭据。
 */

import { AppError } from '@/server/infra/http/errors';

export type OAuthErrorKind =
  | 'not_configured' // 平台未配置 client_id / secret
  | 'user_denied' // 用户在平台侧点了取消
  | 'invalid_state' // state 不存在 / 已消费 / 归属用户不符
  | 'state_expired' // state 超过 10 分钟 TTL
  | 'redirect_uri_mismatch' // 平台判定 redirect_uri 不匹配
  | 'token_exchange_failed' // code 换 token 失败
  | 'refresh_failed' // refresh_token 续期失败
  | 'provider_error' // 平台返回业务错误码
  | 'network'; // 超时 / DNS / SSRF 拦截

interface OAuthErrorProfile {
  /** 面向用户的中文文案，直接用于 toast 与 API error.message。 */
  message: string;
  /** 映射到统一信封的 error.code。 */
  code: string;
  /** 映射到 HTTP 状态码。 */
  status: number;
}

/**
 * 中文文案表。
 * 文案原则：说清「哪一步失败」+「用户可以做什么」，不暴露平台内部错误码。
 */
const OAUTH_ERROR_PROFILES: Record<OAuthErrorKind, OAuthErrorProfile> = {
  not_configured: {
    message: '该平台尚未配置应用凭据，请先在设置中填写 Client ID 与 Client Secret',
    code: 'oauth_not_configured',
    status: 400,
  },
  user_denied: {
    message: '你在平台侧取消了授权',
    code: 'oauth_user_denied',
    status: 400,
  },
  invalid_state: {
    message: '授权校验失败，请返回设置页重新发起授权',
    code: 'oauth_invalid_state',
    status: 400,
  },
  state_expired: {
    message: '授权链接已超时，请返回设置页重新发起授权',
    code: 'oauth_state_expired',
    status: 400,
  },
  redirect_uri_mismatch: {
    message: '平台校验回调地址不匹配，请将设置页展示的回调地址原样填入平台后台',
    code: 'oauth_redirect_uri_mismatch',
    status: 400,
  },
  token_exchange_failed: {
    message: '获取访问令牌失败，请稍后重试或检查平台应用配置',
    code: 'oauth_token_exchange_failed',
    status: 502,
  },
  refresh_failed: {
    message: '刷新访问令牌失败，请重新授权该平台',
    code: 'oauth_refresh_failed',
    status: 502,
  },
  provider_error: {
    message: '平台返回了错误，请稍后重试',
    code: 'oauth_provider_error',
    status: 502,
  },
  network: {
    message: '无法连接平台服务，请检查网络后重试',
    code: 'oauth_network_error',
    status: 503,
  },
};

/** 供 UI 与测试读取的只读文案表。 */
export function getOAuthErrorMessage(kind: OAuthErrorKind): string {
  return OAUTH_ERROR_PROFILES[kind].message;
}

export interface OAuthErrorOptions {
  /**
   * 仅用于服务端日志的补充信息（如平台 errcode）。
   * 调用方有责任确保其中不含 token / secret。
   */
  debugHint?: string;
  /** 关联的平台标识，便于日志定位。 */
  provider?: string;
  /** 原始异常，仅在服务端保留。 */
  cause?: unknown;
}

export class OAuthError extends Error {
  readonly kind: OAuthErrorKind;
  readonly debugHint: string | null;
  readonly provider: string | null;
  readonly cause: unknown;

  constructor(kind: OAuthErrorKind, options: OAuthErrorOptions = {}) {
    super(OAUTH_ERROR_PROFILES[kind].message);
    this.name = 'OAuthError';
    this.kind = kind;
    this.debugHint = options.debugHint ?? null;
    this.provider = options.provider ?? null;
    this.cause = options.cause;
  }
}

export function isOAuthError(value: unknown): value is OAuthError {
  return value instanceof OAuthError;
}

/**
 * 路由边界统一转换：`OAuthError` → `AppError`。
 * 非 OAuthError 的未知异常一律归一为 `network`，避免把内部堆栈泄漏给前端。
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const kind: OAuthErrorKind = isOAuthError(error) ? error.kind : 'network';
  const profile = OAUTH_ERROR_PROFILES[kind];
  return new AppError(profile.message, profile.code, profile.status);
}

/**
 * 把任意异常归一为 `OAuthError`。
 * 供 `oauthHttp` 与服务层使用：网络层抛出的原生错误统一包成 `network`。
 *
 * @param error 原始异常。
 * @param fallbackKind 非 OAuthError 时使用的兜底类型，默认 `network`。
 */
export function normalizeOAuthError(
  error: unknown,
  fallbackKind: OAuthErrorKind = 'network',
): OAuthError {
  if (isOAuthError(error)) {
    return error;
  }

  const debugHint = error instanceof Error ? error.message : String(error);
  return new OAuthError(fallbackKind, { debugHint, cause: error });
}

/**
 * 把平台在回调 query 中返回的 `error` 参数归一为内部错误类型。
 * 覆盖 RFC 6749 §4.1.2.1 常见值与 GitHub / 微信的扩展值。
 */
export function mapProviderCallbackError(
  providerErrorCode: string | null | undefined,
): OAuthErrorKind {
  if (typeof providerErrorCode !== 'string' || providerErrorCode.trim() === '') {
    return 'provider_error';
  }

  const normalized = providerErrorCode.trim().toLowerCase();
  switch (normalized) {
    case 'access_denied':
    case 'user_denied':
    case 'authorization_declined':
      return 'user_denied';
    case 'redirect_uri_mismatch':
      return 'redirect_uri_mismatch';
    case 'invalid_client':
    case 'unauthorized_client':
      return 'not_configured';
    case 'invalid_request':
    case 'invalid_scope':
    case 'unsupported_response_type':
    case 'server_error':
    case 'temporarily_unavailable':
      return 'provider_error';
    default:
      return 'provider_error';
  }
}

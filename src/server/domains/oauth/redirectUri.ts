/**
 * redirect_uri 推导与 returnTo 防护（见 docs/arch-oauth-hub.md ADR-05 / §7.5 第 8 条）。
 *
 * 设计要点：
 * - redirect_uri **由服务端单向推导**，前端只读展示供用户复制到平台后台，
 *   绝不接受前端传入的回调地址（否则等于开放重定向 + 凭据劫持）。
 * - 反向代理场景优先读 `FEEDFUSE_PUBLIC_BASE_URL`；未配置时按
 *   `x-forwarded-proto` + `x-forwarded-host` → `host` 顺序回落。
 * - `returnTo` 只允许**站内相对路径**，绝对 URL 与协议相对 URL 一律降级为默认路径。
 */

import { getServerEnv } from '@/server/infra/env';
import type { OAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';

/** returnTo 非法或缺省时回落的站内路径。 */
export const DEFAULT_RETURN_TO = '/';

/** 回调路由前缀，端点为代码常量（ADR-07）。 */
const OAUTH_CALLBACK_PATH_PREFIX = '/api/oauth/callback';

/** 本地开发在完全拿不到 Host 头时的兜底基址。 */
const FALLBACK_BASE_URL = 'http://localhost:3000';

/**
 * 只读的请求头访问器。
 * 用接口而非直接依赖 `Headers`，便于单测传普通对象。
 */
export interface HeaderReader {
  get(name: string): string | null;
}

/** 把 `Record<string, string>` 适配成 `HeaderReader`，仅测试与内部复用。 */
export function createHeaderReader(headers: Record<string, string | undefined>): HeaderReader {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized.set(key.toLowerCase(), value);
    }
  }
  return {
    get(name: string): string | null {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * `x-forwarded-*` 可能是逗号分隔的链路值，取**第一跳**（最靠近客户端的那个）。
 */
function firstForwardedValue(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const first = raw.split(',')[0]?.trim() ?? '';
  return first === '' ? null : first;
}

function isValidHost(host: string): boolean {
  // 拒绝含空白、路径分隔符、@（凭据段）等可被用于伪造 Host 的字符。
  return host !== '' && !/[\s/\\@?#]/.test(host);
}

function normalizeProto(raw: string | null): 'http' | 'https' | null {
  if (raw === null) {
    return null;
  }
  const proto = raw.trim().toLowerCase();
  if (proto === 'http' || proto === 'https') {
    return proto;
  }
  return null;
}

/**
 * 解析站点对外基址。
 *
 * 优先级：`FEEDFUSE_PUBLIC_BASE_URL` > `x-forwarded-proto`/`x-forwarded-host` > `host` > 本地兜底。
 * 返回值**不含**尾部斜杠。
 */
export function resolvePublicBaseUrl(headers?: HeaderReader | null): string {
  const configured = getServerEnv().FEEDFUSE_PUBLIC_BASE_URL;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return stripTrailingSlash(configured.trim());
  }

  if (headers === undefined || headers === null) {
    return FALLBACK_BASE_URL;
  }

  const forwardedHost = firstForwardedValue(headers.get('x-forwarded-host'));
  const rawHost = forwardedHost ?? firstForwardedValue(headers.get('host'));
  if (rawHost === null || !isValidHost(rawHost)) {
    return FALLBACK_BASE_URL;
  }

  const forwardedProto = normalizeProto(firstForwardedValue(headers.get('x-forwarded-proto')));
  // 无 x-forwarded-proto 时：本机地址默认 http，其余默认 https（自部署通常挂 TLS 反代）。
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(rawHost);
  const proto = forwardedProto ?? (isLoopback ? 'http' : 'https');

  return stripTrailingSlash(`${proto}://${rawHost}`);
}

/**
 * 推导某平台的 redirect_uri。
 * 该值同时用于：① 拼 authorize URL；② 设置页只读展示供用户复制。
 * 两处必须来自同一函数，否则会出现「展示的和实际发的不一致」的经典事故。
 */
export function buildRedirectUri(provider: OAuthProviderId, headers?: HeaderReader | null): string {
  return `${resolvePublicBaseUrl(headers)}${OAUTH_CALLBACK_PATH_PREFIX}/${provider}`;
}

/**
 * 清洗 returnTo，防止开放重定向。
 *
 * 允许：以单个 `/` 开头的站内相对路径（可带 query 与 hash）。
 * 拒绝：绝对 URL（`https://evil.com`）、协议相对 URL（`//evil.com`）、
 *      反斜杠变体（`/\evil.com`）、含控制字符或换行的输入、非字符串。
 */
export function sanitizeReturnTo(
  raw: unknown,
  fallback: string = DEFAULT_RETURN_TO,
): string {
  if (typeof raw !== 'string') {
    return fallback;
  }

  const value = raw.trim();
  if (value === '') {
    return fallback;
  }

  // 控制字符（含 \r \n \t 与 NUL）可用于绕过前缀判断，直接拒绝。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }

  // 必须以 / 开头，且第二个字符不能是 / 或 \（协议相对 URL / 反斜杠变体）。
  if (!value.startsWith('/')) {
    return fallback;
  }
  if (value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }

  // 兜底：交给 URL 解析器验证，若能被解析成异源绝对 URL 则拒绝。
  try {
    const parsed = new URL(value, FALLBACK_BASE_URL);
    if (parsed.origin !== FALLBACK_BASE_URL) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export type OAuthCallbackOutcome = 'success' | 'denied' | 'failed';

export interface BuildCallbackRedirectInput {
  returnTo: string;
  provider: OAuthProviderId;
  outcome: OAuthCallbackOutcome;
  /** 仅 outcome === 'failed' 时附带，取 `OAuthErrorKind` 值。 */
  reason?: string | null;
}

/**
 * 构造回调路由的 302 目标（见 §3.3「回调路由的重定向契约」）。
 * `returnTo` 必须已过 `sanitizeReturnTo`，此处再次兜底一次。
 */
export function buildCallbackRedirectPath(input: BuildCallbackRedirectInput): string {
  const safeReturnTo = sanitizeReturnTo(input.returnTo);
  const parsed = new URL(safeReturnTo, FALLBACK_BASE_URL);

  parsed.searchParams.set('settings', 'oauth');
  parsed.searchParams.set('oauth', input.outcome);
  parsed.searchParams.set('provider', input.provider);
  if (input.outcome === 'failed' && typeof input.reason === 'string' && input.reason !== '') {
    parsed.searchParams.set('reason', input.reason);
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** 拼绝对回调地址，供 `NextResponse.redirect()` 使用（其要求绝对 URL）。 */
export function buildCallbackRedirectUrl(
  input: BuildCallbackRedirectInput,
  headers?: HeaderReader | null,
): string {
  return `${resolvePublicBaseUrl(headers)}${buildCallbackRedirectPath(input)}`;
}

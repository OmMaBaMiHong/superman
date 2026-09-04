import { ZodError } from 'zod';
import {
  isRateLimited,
  type GithubRateLimitSnapshot,
} from '@/server/integrations/github/githubRateLimit';

/**
 * GitHub API 错误分类。
 *
 * 分类而非裸 status 的原因：403 有「权限不足」和「限流」两种完全不同的处置策略
 * （前者要退避 + 提示用户，后者要熔断且**绝不能重试**）。
 */
export type GithubApiErrorKind =
  | 'not_found' // 404：仓库不存在，或私有且当前 Token 无权限
  | 'unauthorized' // 401：Token 无效 / 过期
  | 'forbidden' // 403 非限流：SSO 未授权 / 权限不足
  | 'rate_limited' // 403 + remaining=0，或 429
  | 'network' // 超时 / DNS / SSRF 拦截 / 5xx
  | 'invalid_response'; // schema 校验失败 / JSON 解析失败

/** 各错误分类的默认中文提示。面向用户的 message 一律中文（arch §7.1）。 */
const GITHUB_API_ERROR_MESSAGES: Record<GithubApiErrorKind, string> = {
  not_found: '仓库不存在或无访问权限（私有仓库需配置 GitHub Token）',
  unauthorized: 'GitHub Token 无效或已过期，请重新配置',
  forbidden: 'GitHub 拒绝访问该仓库，请检查 Token 权限或组织 SSO 授权',
  rate_limited: 'GitHub 请求已达速率上限，稍后将自动恢复',
  network: '无法连接 GitHub，请稍后重试',
  invalid_response: 'GitHub 返回了无法识别的数据格式',
};

export function githubApiErrorMessage(kind: GithubApiErrorKind): string {
  return GITHUB_API_ERROR_MESSAGES[kind];
}

/**
 * GitHub API 统一错误。
 *
 * 安全约定：`message` / `detail` 中**绝不允许**出现 Authorization header 或 Token 明文。
 * 构造点只接收 status / kind / 速率快照，天然不接触凭据。
 */
export class GithubApiError extends Error {
  readonly kind: GithubApiErrorKind;
  readonly status: number | null;
  readonly rateLimit: GithubRateLimitSnapshot | null;
  /** 原始英文错误信息，只用于 `rawErrorMessage` 落库，不直接展示给用户。 */
  readonly detail: string | null;

  constructor(
    kind: GithubApiErrorKind,
    options: {
      message?: string;
      status?: number | null;
      rateLimit?: GithubRateLimitSnapshot | null;
      detail?: string | null;
    } = {},
  ) {
    super(options.message ?? GITHUB_API_ERROR_MESSAGES[kind]);
    this.name = 'GithubApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.rateLimit = options.rateLimit ?? null;
    this.detail = options.detail ?? null;
  }
}

export function isGithubApiError(value: unknown): value is GithubApiError {
  return value instanceof GithubApiError;
}

function truncateDetail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
}

/** 把 HTTP 响应状态映射成错误分类。 */
export function resolveGithubErrorKind(
  status: number,
  rateLimit: GithubRateLimitSnapshot,
): GithubApiErrorKind {
  if (isRateLimited(status, rateLimit)) {
    return 'rate_limited';
  }

  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'invalid_response';
  if (status >= 500) return 'network';

  return 'invalid_response';
}

/** 由非 2xx 响应构造 `GithubApiError`。 */
export function toGithubResponseError(input: {
  status: number;
  rateLimit: GithubRateLimitSnapshot;
  detail?: string | null;
}): GithubApiError {
  const kind = resolveGithubErrorKind(input.status, input.rateLimit);
  return new GithubApiError(kind, {
    status: input.status,
    rateLimit: input.rateLimit,
    detail: truncateDetail(input.detail),
  });
}

/**
 * 把传输层异常（超时 / DNS / SSRF 拦截）归一成 `GithubApiError`。
 *
 * `Unsafe URL` 是 `externalHttpClient` 的 SSRF 拦截信号，单独给出可诊断的中文文案。
 */
export function toGithubNetworkError(err: unknown): GithubApiError {
  if (isGithubApiError(err)) {
    return err;
  }

  // schema 校验失败 / JSON 解析失败（200 响应但 body 不符合预期）归一为 invalid_response，
  // 而非 network——否则会被当成网络故障反复重试（arch §3.3）。
  if (err instanceof ZodError) {
    const detail = err.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    return new GithubApiError('invalid_response', { status: 200, detail: truncateDetail(detail) });
  }

  const rawMessage = err instanceof Error ? err.message || err.name : String(err ?? '');

  if (rawMessage === 'Unsafe URL') {
    return new GithubApiError('network', {
      message: 'GitHub 请求被安全策略拦截（地址不在允许列表内）',
      detail: rawMessage,
    });
  }

  if (/abort|timeout|timed out/i.test(rawMessage)) {
    return new GithubApiError('network', {
      message: '连接 GitHub 超时，请稍后重试',
      detail: truncateDetail(rawMessage),
    });
  }

  return new GithubApiError('network', { detail: truncateDetail(rawMessage) });
}

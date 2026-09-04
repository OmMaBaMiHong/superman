import { githubApiErrorMessage, isGithubApiError, type GithubApiErrorKind } from '@/server/integrations/github/githubErrors';

/**
 * 把 GitHub 同步链路错误归一化为「错误码 + 中文提示 + 原始错误」。
 *
 * 与 `feedFetchErrorMapping` 同构：面向用户的 `errorMessage` 一律中文，
 * `rawErrorMessage` 只用于落库诊断，绝不包含 Token 明文（GithubApiError 构造时已保证）。
 */
export interface GithubFetchErrorResult {
  errorCode: string;
  errorMessage: string;
  rawErrorMessage: string | null;
}

function truncate(value: string | null | undefined, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

export function mapGithubFetchError(err: unknown): GithubFetchErrorResult {
  if (isGithubApiError(err)) {
    const kind: GithubApiErrorKind = err.kind;
    return {
      errorCode: kind,
      errorMessage: githubApiErrorMessage(kind),
      rawErrorMessage: truncate(err.detail ?? err.message),
    };
  }

  const raw = err instanceof Error ? (err.stack || err.message || err.name) : String(err ?? '');
  return {
    errorCode: 'unknown',
    errorMessage: 'GitHub 同步失败，请稍后重试',
    rawErrorMessage: truncate(raw),
  };
}

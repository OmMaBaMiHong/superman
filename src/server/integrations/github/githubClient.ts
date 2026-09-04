import {
  fetchExternalJson,
  type FetchExternalJsonResult,
} from '@/server/infra/http/externalHttpClient';
import { getGithubApiConfig } from '@/server/infra/env';
import {
  parseRateLimitHeaders,
  type GithubRateLimitSnapshot,
} from '@/server/integrations/github/githubRateLimit';
import {
  toGithubNetworkError,
  toGithubResponseError,
} from '@/server/integrations/github/githubErrors';
import {
  githubReleaseSchema,
  githubRepositorySchema,
  type GithubRelease,
  type GithubRepository,
} from '@/server/integrations/github/githubSchemas';

/**
 * GitHub REST 客户端。
 *
 * 复用 `externalHttpClient.fetchExternalJson`（同一套 SSRF 逐跳校验 + 主机白名单 +
 * 日志脱敏管线），只负责把 GitHub 的鉴权头、ETag 条件请求、媒体类型与速率头
 * 封装成领域友好的返回值。
 *
 * 安全红线：Token 只进 `Authorization` 头，**绝不**进入日志上下文；错误归一时
 * detail 只装响应体片段且截断到 500 字符（见 githubErrors.toGithubResponseError）。
 */

const DEFAULT_PER_PAGE = 30;
const GITHUB_REQUEST_SOURCE = 'integrations/github/githubClient';
const DETAIL_MAX_CHARS = 500;

export interface GetRepositoryOptions {
  owner: string;
  repo: string;
  token?: string | null;
  userId?: string | null;
}

export interface ListReleasesOptions {
  owner: string;
  repo: string;
  token?: string | null;
  /** 单页数量，限制 1~100。 */
  perPage?: number;
  /** 上次同步拿到的 ETag，命中 304 不计入 GitHub 速率配额。 */
  etag?: string | null;
  userId?: string | null;
}

export interface GetRepositoryResult {
  status: number;
  repository: GithubRepository | null;
  rateLimit: GithubRateLimitSnapshot;
}

export interface GithubReleasesResult {
  status: number;
  releases: GithubRelease[];
  etag: string | null;
  rateLimit: GithubRateLimitSnapshot;
}

export interface GithubRateLimitProbeResult {
  status: number;
  rateLimit: GithubRateLimitSnapshot;
}

function buildAuthHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof token === 'string' && token.trim().length > 0) {
    headers.authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function readEtag(headers: FetchExternalJsonResult['headers']): string | null {
  const value = headers?.['etag'];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function truncateDetail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.length > DETAIL_MAX_CHARS
    ? `${normalized.slice(0, DETAIL_MAX_CHARS)}...`
    : normalized;
}

/**
 * 取仓库元数据（POST 添加订阅前的存在性校验用）。
 *
 * 404 → 抛出 `not_found` 错误，由上层路由翻译成「仓库不存在或无权访问」。
 */
export async function getRepository(
  options: GetRepositoryOptions,
): Promise<GetRepositoryResult> {
  const config = getGithubApiConfig();
  const url = `${config.baseUrl}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;

  try {
    const res = await fetchExternalJson(url, {
      timeoutMs: config.timeoutMs,
      userAgent: config.userAgent,
      accept: 'application/vnd.github+json',
      headers: buildAuthHeaders(options.token),
      allowedHosts: config.allowedHosts,
      logging: {
        userId: options.userId ?? null,
        source: GITHUB_REQUEST_SOURCE,
        requestLabel: `GET repo ${options.owner}/${options.repo}`,
      },
    });

    const rateLimit = parseRateLimitHeaders(res.headers);

    if (res.status === 200 && res.json) {
      const repository = githubRepositorySchema.parse(res.json);
      return { status: res.status, repository, rateLimit };
    }

    if (res.status >= 400) {
      throw toGithubResponseError({
        status: res.status,
        rateLimit,
        detail: truncateDetail(res.rawBody),
      });
    }

    return { status: res.status, repository: null, rateLimit };
  } catch (err) {
    throw toGithubNetworkError(err);
  }
}

/**
 * 探测 Token 有效性 / 剩余配额。
 *
 * `GET /rate_limit` 是 GitHub 唯一**不消耗配额**的端点，因此适合做保存前校验：
 * Token 无效会直接返回 401，由 `toGithubResponseError` 归一成 `unauthorized`。
 */
export async function probeRateLimit(options: {
  token?: string | null;
  userId?: string | null;
}): Promise<GithubRateLimitProbeResult> {
  const config = getGithubApiConfig();
  const url = `${config.baseUrl}/rate_limit`;

  try {
    const res = await fetchExternalJson(url, {
      timeoutMs: config.timeoutMs,
      userAgent: config.userAgent,
      accept: 'application/vnd.github+json',
      headers: buildAuthHeaders(options.token),
      allowedHosts: config.allowedHosts,
      logging: {
        userId: options.userId ?? null,
        source: GITHUB_REQUEST_SOURCE,
        requestLabel: 'GET rate_limit',
      },
    });

    const rateLimit = parseRateLimitHeaders(res.headers);

    if (res.status >= 400) {
      throw toGithubResponseError({
        status: res.status,
        rateLimit,
        detail: truncateDetail(res.rawBody),
      });
    }

    return { status: res.status, rateLimit };
  } catch (err) {
    throw toGithubNetworkError(err);
  }
}

/**
 * 拉取仓库 Release 列表（MVP 只消费 release 类型）。
 *
 * 媒体类型用 `application/vnd.github.full+json`，确保响应带 `body_html`（ADR-07
 * 服务端渲染优先）。命中 304 时返回空数组且不消耗配额。
 */
export async function listReleases(
  options: ListReleasesOptions,
): Promise<GithubReleasesResult> {
  const config = getGithubApiConfig();
  const perPage = Math.min(Math.max(options.perPage ?? DEFAULT_PER_PAGE, 1), 100);
  const url = `${config.baseUrl}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/releases?per_page=${perPage}`;

  try {
    const headers: Record<string, string> = buildAuthHeaders(options.token);
    if (options.etag && options.etag.trim().length > 0) {
      headers['if-none-match'] = options.etag.trim();
    }

    const res = await fetchExternalJson(url, {
      timeoutMs: config.timeoutMs,
      userAgent: config.userAgent,
      accept: 'application/vnd.github.full+json',
      headers,
      allowedHosts: config.allowedHosts,
      logging: {
        userId: options.userId ?? null,
        source: GITHUB_REQUEST_SOURCE,
        requestLabel: `GET releases ${options.owner}/${options.repo}`,
      },
    });

    const rateLimit = parseRateLimitHeaders(res.headers);
    const etag = readEtag(res.headers);

    if (res.status === 304) {
      return { status: 304, releases: [], etag, rateLimit };
    }

    if (res.status === 200 && res.json) {
      const rawList = Array.isArray(res.json) ? res.json : [];
      const releases = rawList.map((raw) => githubReleaseSchema.parse(raw));
      return { status: 200, releases, etag, rateLimit };
    }

    if (res.status >= 400) {
      throw toGithubResponseError({
        status: res.status,
        rateLimit,
        detail: truncateDetail(res.rawBody),
      });
    }

    return { status: res.status, releases: [], etag, rateLimit };
  } catch (err) {
    throw toGithubNetworkError(err);
  }
}

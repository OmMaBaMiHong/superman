import ky from 'ky';
import type {
  Article,
  Board,
  BoardItem,
  Category,
  Feed,
  FeedContentView,
  GithubArticleMeta,
  GithubContentType,
  GithubRepoSubscription,
  GithubTokenStatus,
  Highlight,
  HighlightColor,
  OAuthAuthorizeResult,
  OAuthConnectionView,
  OAuthProviderConfigStatus,
  OAuthProviderId,
  PersistedSettings,
  RssHubCookieProvider,
  RssHubCookieView,
  SystemLogsPage,
  Tag,
  UserType,
} from '@/types';
import { notifyApiError } from './apiErrorNotifier';
import { normalizeFeedAutoTriggerFlags } from '@/lib/feeds/feedAutoTriggerPolicy';
import { AI_DIGEST_ICON_URL } from '@/lib/feeds/feedIcons';
import { isRssHubUrl } from '@/lib/rsshub/url';
import { isRecord } from '@/lib/utils';

export interface ApiErrorPayload {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  status?: number;
  cause?: unknown;

  constructor(
    message: string,
    public code: string,
    public fields?: Record<string, string>,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message);
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: ApiErrorPayload };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

export interface RequestApiOptions {
  notifyOnError?: boolean;
  notifyMessage?: string;
  redirectOnUnauthorized?: boolean;
}

const api = ky.create({
  timeout: 15_000,
  retry: 0,
  throwHttpErrors: false,
});

/* ── 宿主路径配置（K3：同一 apiClient 同时伺服 Next 版与 DSH 插件 H5 版）──
   Next 版：/api/*；插件 H5 版：/s/api/*、登录页 '#/login'。默认 Next 行为不变。 */
let apiPathPrefix = '';
let loginRedirectPath = '/login';

/** H5 宿主启动时调用一次；不传/缺省保持 Next 版行为。 */
export function configureApiClientPaths(input: { apiPrefix?: string; loginPath?: string }): void {
  if (typeof input.apiPrefix === 'string') apiPathPrefix = input.apiPrefix.replace(/\/$/, '');
  if (typeof input.loginPath === 'string') loginRedirectPath = input.loginPath;
}

function getBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

function toAbsoluteUrl(path: string): string {
  return new URL(apiPathPrefix + path, getBaseUrl()).toString();
}

function throwTransportApiError(
  err: unknown,
  options?: RequestApiOptions & { timeoutMs?: number },
): never {
  const isTimeout =
    err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  const message = isTimeout ? '请求超时，请稍后重试' : '网络异常，请检查网络后重试';
  const code = isTimeout ? 'timeout' : 'network_error';

  if (options?.notifyOnError !== false) {
    notifyApiError(options?.notifyMessage ?? message);
  }

  throw new ApiError(options?.notifyMessage ?? message, code, undefined, { cause: err });
}

function throwInvalidResponseApiError(
  status?: number,
  options?: RequestApiOptions & { timeoutMs?: number },
): never {
  if (options?.notifyOnError !== false) {
    notifyApiError(options?.notifyMessage ?? '暂时无法完成请求，请稍后重试');
  }

  throw new ApiError('服务返回了无效数据，请稍后重试', 'invalid_response', undefined, {
    status,
  });
}

function redirectToLoginIfNeeded(options?: RequestApiOptions) {
  if (
    options?.redirectOnUnauthorized === false ||
    typeof window === 'undefined' ||
    window.location.pathname === loginRedirectPath ||
    window.location.href.endsWith(loginRedirectPath)
  ) {
    return;
  }

  window.location.assign(loginRedirectPath);
}

function parseContentDispositionFileName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.code === 'string' && typeof value.message === 'string';
}

async function requestApi<T>(
  path: string,
  init?: RequestInit,
  options?: RequestApiOptions & { timeoutMs?: number },
): Promise<T> {
  let res: Response;

  try {
    res = await api(toAbsoluteUrl(path), {
      ...(init ?? {}),
      timeout: options?.timeoutMs ?? 15_000,
      headers: {
        ...(init?.headers ?? {}),
        accept: 'application/json',
      },
    });
  } catch (err) {
    throwTransportApiError(err, options);
  }

  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json) || typeof json.ok !== 'boolean') {
    throwInvalidResponseApiError(res.status, options);
  }

  const envelope = json as ApiEnvelope<T>;
  if (envelope.ok) return envelope.data;

  const payload = envelope.error;
  if (res.status === 401 || payload?.code === 'unauthorized') {
    redirectToLoginIfNeeded(options);
  }
  const message = options?.notifyMessage ?? payload?.message ?? '暂时无法完成请求，请稍后重试';
  if (options?.notifyOnError !== false) {
    notifyApiError(message);
  }

  throw new ApiError(
    payload?.message ?? '暂时无法完成请求，请稍后重试',
    payload?.code ?? 'unknown_error',
    payload?.fields,
    { status: res.status },
  );
}

export interface OpmlImportResult {
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  createdCategoryCount: number;
  duplicates: Array<{ title: string; xmlUrl: string; reason: 'duplicate_in_file' | 'duplicate_in_db' }>;
  invalidItems: Array<{ title: string | null; xmlUrl: string | null; reason: 'missing_xml_url' | 'invalid_url' }>;
}

export type CurrentUserRole = 'admin' | 'member';
export type CurrentUserStatus = 'active' | 'disabled';

export interface CurrentUser {
  id: string;
  username?: string;
  type?: UserType;
  role: CurrentUserRole;
  status?: CurrentUserStatus;
  sessionVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function login(
  input: { username: string; password: string },
  options?: RequestApiOptions,
): Promise<{ authenticated: boolean; user?: CurrentUser }> {
  return requestApi(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function getCurrentUser(options?: RequestApiOptions): Promise<CurrentUser> {
  return requestApi('/api/auth/me', undefined, {
    ...(options ?? {}),
    redirectOnUnauthorized: false,
  });
}

export async function logout(options?: RequestApiOptions): Promise<{ authenticated: boolean }> {
  return requestApi(
    '/api/auth/logout',
    {
      method: 'POST',
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function changePassword(
  input: { currentPassword: string; nextPassword: string },
  options?: RequestApiOptions,
): Promise<{ updated: boolean }> {
  return requestApi(
    '/api/settings/auth/password',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function changeOwnPassword(
  input: { currentPassword: string; nextPassword: string },
  options?: RequestApiOptions,
): Promise<{ updated: boolean }> {
  return requestApi(
    '/api/users/me/password',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function updateCurrentUserProfile(
  input: {
    username: string;
    nextPassword?: string;
  },
  options?: RequestApiOptions,
): Promise<CurrentUser> {
  return requestApi(
    '/api/users/me',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function listUsers(options?: RequestApiOptions): Promise<CurrentUser[]> {
  return requestApi('/api/users', undefined, options);
}

export async function createUser(
  input: { username: string; password: string; role: CurrentUserRole },
  options?: RequestApiOptions,
): Promise<CurrentUser> {
  return requestApi(
    '/api/users',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function updateUser(
  userId: string,
  input: {
    username?: string;
    role?: CurrentUserRole;
    status?: CurrentUserStatus;
    password?: string;
  },
  options?: RequestApiOptions,
): Promise<CurrentUser> {
  return requestApi(
    `/api/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteUser(
  userId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: boolean }> {
  return requestApi(
    `/api/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function importOpml(input: {
  content: string;
  fileName?: string | null;
}, options?: RequestApiOptions): Promise<OpmlImportResult> {
  return requestApi(
    '/api/opml/import',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function exportOpml(
  options?: RequestApiOptions & { timeoutMs?: number },
): Promise<{ xml: string; fileName: string }> {
  let res: Response;

  try {
    res = await api(toAbsoluteUrl('/api/opml/export'), {
      method: 'GET',
      headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' },
      timeout: options?.timeoutMs ?? 15_000,
    });
  } catch (err) {
    throwTransportApiError(err, options);
  }

  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    if (!isRecord(json) || json.ok !== false || !isApiErrorPayload(json.error)) {
      throwInvalidResponseApiError(res.status, options);
    }

    const payload = json.error;
    const message = payload.message ?? '暂时无法完成请求，请稍后重试';
    if (options?.notifyOnError !== false) {
      notifyApiError(message);
    }
    throw new ApiError(
      payload.message ?? '暂时无法完成请求，请稍后重试',
      payload.code ?? 'unknown_error',
      payload.fields,
      { status: res.status },
    );
  }

  return {
    xml: await res.text(),
    fileName:
      parseContentDispositionFileName(res.headers.get('content-disposition')) ??
      'feedfuse-subscriptions.opml',
  };
}

export interface RecommendedFeedItem {
  id: string;
  title: string;
  url: string;
  siteUrl: string | null;
  iconUrl: string | null;
  description: string | null;
  subscriberCount: number;
  source: 'builtin' | 'aggregated';
}

export async function getRecommendedFeeds(options?: RequestApiOptions): Promise<RecommendedFeedItem[]> {
  return requestApi('/api/feeds/recommended', undefined, options);
}

export type RssValidationErrorCode =
  | 'invalid_url'
  | 'unsafe_url'
  | 'unauthorized'
  | 'timeout'
  | 'not_feed'
  | 'dns_error'
  | 'network_error';

export interface RssValidationResult {
  ok: boolean;
  kind?: 'rss' | 'atom';
  title?: string;
  siteUrl?: string;
  errorCode?: RssValidationErrorCode;
  message?: string;
}

type RssValidationEnvelope =
  | {
      ok: true;
      data: {
        valid: boolean;
        reason?: RssValidationErrorCode;
        message?: string;
        kind?: 'rss' | 'atom';
        title?: string;
        siteUrl?: string;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
  };

export interface RssHubSourceResolveResult {
  resolved: boolean;
  inputUrl: string;
  finalUrl?: string;
  rssHubUrl?: string;
  routePath?: string;
  title?: string;
  sourceDomain?: string;
  message?: string;
}

type RssHubSourceResolveEnvelope =
  | {
      ok: true;
      data: RssHubSourceResolveResult;
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

export async function resolveRssHubSourceUrl(url: string): Promise<RssHubSourceResolveResult> {
  try {
    const endpoint = new URL('/api/rsshub/resolve', getBaseUrl());
    endpoint.searchParams.set('url', url);

    const res = await api(endpoint.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeout: 12_000,
    });

    const json: unknown = await res.json().catch(() => null);
    if (typeof json !== 'object' || json === null || !('ok' in json)) {
      return { resolved: false, inputUrl: url, message: '暂时无法识别该链接。' };
    }

    const envelope = json as RssHubSourceResolveEnvelope;
    if (envelope.ok) return envelope.data;

    return {
      resolved: false,
      inputUrl: url,
      message: envelope.error.message,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      resolved: false,
      inputUrl: url,
      message: isTimeout ? '识别超时，请稍后重试。' : '暂时无法识别该链接。',
    };
  }
}

export async function validateRssUrl(url: string): Promise<RssValidationResult> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      errorCode: 'invalid_url',
      message: '请输入完整链接，例如 https://example.com/feed.xml',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && !isRssHubUrl(url)) {
    return {
      ok: false,
      errorCode: 'invalid_url',
      message: '链接必须以 http://、https:// 或 rsshub:// 开头',
    };
  }

  try {
    const endpoint = new URL('/api/rss/validate', getBaseUrl());
    endpoint.searchParams.set('url', url);

    const res = await api(endpoint.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeout: 12_000,
    });

    const json: unknown = await res.json().catch(() => null);
    if (typeof json !== 'object' || json === null || !('ok' in json)) {
      return { ok: false, errorCode: 'network_error', message: '暂时无法验证链接，请稍后重试' };
    }

    const envelope = json as RssValidationEnvelope;

    if (!envelope.ok) {
      return {
        ok: false,
        errorCode: 'network_error',
        message: envelope.error.message,
      };
    }

    if (envelope.data.valid) {
      return {
        ok: true,
        kind: envelope.data.kind,
        title: envelope.data.title,
        siteUrl: envelope.data.siteUrl,
      };
    }

    return {
      ok: false,
      errorCode: envelope.data.reason,
      message: envelope.data.message,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (isTimeout) {
      return { ok: false, errorCode: 'timeout', message: '验证超时，请稍后重试' };
    }
    return { ok: false, errorCode: 'network_error', message: '暂时无法验证链接，请稍后重试' };
  }
}

export interface ReaderSnapshotDto {
  categories: Array<{
    id: string;
    name: string;
    position: number;
  }>;
  feeds: Array<{
    id: string;
    kind: Feed['kind'];
    provider?: Feed['provider'];
    remoteManaged?: boolean;
    remoteSource?: 'fever' | null;
    title: string;
    url: string;
    siteUrl: string | null;
    iconUrl: string | null;
    enabled: boolean;
    fullTextOnOpenEnabled: boolean;
    fullTextOnFetchEnabled: boolean;
    aiSummaryOnOpenEnabled: boolean;
    aiSummaryOnFetchEnabled: boolean;
    bodyTranslateOnFetchEnabled: boolean;
    bodyTranslateOnOpenEnabled: boolean;
    titleTranslateEnabled: boolean;
    bodyTranslateEnabled: boolean;
    articleListDisplayMode: 'card' | 'list';
    view?: FeedContentView;
    categoryId: string | null;
    fetchIntervalMinutes: number;
    lastFetchStatus: number | null;
    lastFetchError: string | null;
    lastFetchRawError: string | null;
    unreadCount: number;
    isPodcast?: boolean;
  }>;
  articles: {
    items: Array<{
      id: string;
      feedId: string;
      title: string;
      titleOriginal?: string | null;
      titleZh?: string | null;
      summary: string | null;
      previewImage?: string | null;
      author: string | null;
      publishedAt: string | null;
      link: string | null;
      filterStatus: 'pending' | 'passed' | 'filtered' | 'error';
      isFiltered: boolean;
      filteredBy: string[];
      isRead: boolean;
      isStarred: boolean;
      remoteSource?: 'fever' | null;
      bodyTranslationEligible?: boolean;
      bodyTranslationBlockedReason?: string | null;
      aiSummarySession?: ArticleAiSummarySessionSnapshotDto | null;
      githubMeta?: GithubArticleMeta | null;
    }>;
    nextCursor: string | null;
    totalCount: number;
  };
}

export async function getReaderSnapshot(
  input?: {
    view?: string;
    limit?: number;
    cursor?: string;
    unreadOnly?: boolean;
    includeFiltered?: boolean;
  },
  options?: RequestApiOptions,
): Promise<ReaderSnapshotDto> {
  const params = new URLSearchParams();
  if (input?.view) params.set('view', input.view);
  if (typeof input?.limit === 'number') params.set('limit', String(input.limit));
  if (input?.cursor) params.set('cursor', input.cursor);
  if (typeof input?.unreadOnly === 'boolean') {
    params.set('unreadOnly', String(input.unreadOnly));
  }
  if (typeof input?.includeFiltered === 'boolean') {
    params.set('includeFiltered', String(input.includeFiltered));
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestApi<ReaderSnapshotDto>(`/api/reader/snapshot${suffix}`, undefined, options);
}

export async function createFeed(input: {
  title: string;
  url: string;
  siteUrl?: string | null;
  view?: FeedContentView;
  categoryId?: string | null;
  categoryName?: string | null;
  fullTextOnOpenEnabled?: boolean;
  fullTextOnFetchEnabled?: boolean;
  aiSummaryOnOpenEnabled?: boolean;
  aiSummaryOnFetchEnabled?: boolean;
  bodyTranslateOnFetchEnabled?: boolean;
  bodyTranslateOnOpenEnabled?: boolean;
  titleTranslateEnabled?: boolean;
  bodyTranslateEnabled?: boolean;
}, options?: RequestApiOptions): Promise<
  ReaderSnapshotDto['feeds'][number] & {
    unreadCount: number;
  }
> {
  const payload = Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value !== 'undefined'),
  );

  return requestApi(
    '/api/feeds',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export async function createAiDigest(input: {
  title: string;
  prompt: string;
  intervalMinutes: number;
  selectedFeedIds: string[];
  categoryId?: string | null;
  categoryName?: string | null;
}, options?: RequestApiOptions): Promise<
  ReaderSnapshotDto['feeds'][number] & {
    unreadCount: number;
  }
> {
  return requestApi(
    '/api/ai-digests',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export interface AiDigestConfigDto {
  feedId: string;
  prompt: string;
  intervalMinutes: number;
  selectedFeedIds: string[];
}

export async function getAiDigestConfig(feedId: string): Promise<AiDigestConfigDto> {
  return requestApi(`/api/ai-digests/${encodeURIComponent(feedId)}`);
}

export async function patchAiDigest(
  feedId: string,
  input: {
    title: string;
    prompt: string;
    intervalMinutes: number;
    selectedFeedIds: string[];
    categoryId?: string | null;
    categoryName?: string | null;
  },
  options?: RequestApiOptions,
): Promise<FeedRowDto> {
  const payload = Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value !== 'undefined'),
  );

  return requestApi(
    `/api/ai-digests/${encodeURIComponent(feedId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export async function generateAiDigest(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ enqueued: boolean; jobId?: string; reason?: string; runId?: string }> {
  return requestApi(
    `/api/ai-digests/${encodeURIComponent(feedId)}/generate`,
    {
      method: 'POST',
    },
    options,
  );
}

export async function getAiDigestRunStatus(runId: string): Promise<{
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped_no_updates';
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
}> {
  return requestApi(`/api/ai-digests/runs/${encodeURIComponent(runId)}`);
}

export async function getFeedRefreshRunStatus(runId: string): Promise<{
  id: string;
  scope: 'single' | 'all';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  feedId: string | null;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  errorMessage: string | null;
  updatedAt: string;
  finishedAt: string | null;
}> {
  return requestApi(`/api/feed-refresh-runs/${encodeURIComponent(runId)}`);
}

export async function refreshFeed(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ enqueued: true; jobId: string; runId?: string }> {
  return requestApi(
    `/api/feeds/${encodeURIComponent(feedId)}/refresh`,
    {
      method: 'POST',
    },
    options,
  );
}

export async function refreshAllFeeds(
  options?: RequestApiOptions,
): Promise<{ enqueued: true; jobId: string; runId?: string }> {
  return requestApi(
    '/api/feeds/refresh',
    {
      method: 'POST',
    },
    options,
  );
}

export interface FeedRowDto {
  id: string;
  kind: Feed['kind'];
  provider?: Feed['provider'];
  remoteManaged?: boolean;
  remoteSource?: 'fever' | null;
  title: string;
  url: string;
  siteUrl: string | null;
  iconUrl: string | null;
  enabled: boolean;
  fullTextOnOpenEnabled: boolean;
  fullTextOnFetchEnabled: boolean;
  aiSummaryOnOpenEnabled: boolean;
  aiSummaryOnFetchEnabled: boolean;
  bodyTranslateOnFetchEnabled: boolean;
  bodyTranslateOnOpenEnabled: boolean;
  titleTranslateEnabled: boolean;
  bodyTranslateEnabled: boolean;
  articleListDisplayMode: 'card' | 'list';
  view: FeedContentView;
  categoryId: string | null;
  fetchIntervalMinutes: number;
  isPodcast?: boolean;
}

type FeedDtoLike =
  | ReaderSnapshotDto['feeds'][number]
  | (FeedRowDto & {
      unreadCount?: number;
      lastFetchStatus?: number | null;
      lastFetchError?: string | null;
      lastFetchRawError?: string | null;
    });

export async function patchFeed(
  feedId: string,
  input: {
    title?: string;
    url?: string;
    siteUrl?: string | null;
    enabled?: boolean;
    view?: FeedContentView;
    categoryId?: string | null;
    categoryName?: string | null;
    fullTextOnOpenEnabled?: boolean;
    fullTextOnFetchEnabled?: boolean;
    aiSummaryOnOpenEnabled?: boolean;
    aiSummaryOnFetchEnabled?: boolean;
    bodyTranslateOnFetchEnabled?: boolean;
    bodyTranslateOnOpenEnabled?: boolean;
    titleTranslateEnabled?: boolean;
    articleListDisplayMode?: 'card' | 'list';
  },
  options?: RequestApiOptions,
): Promise<FeedRowDto> {
  const payload = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => key !== 'bodyTranslateEnabled' && typeof value !== 'undefined',
    ),
  );

  return requestApi(
    `/api/feeds/${encodeURIComponent(feedId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export async function deleteFeed(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: true }> {
  return requestApi(
    `/api/feeds/${encodeURIComponent(feedId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export interface CategoryDto {
  id: string;
  name: string;
  position: number;
}

export async function listCategories(): Promise<CategoryDto[]> {
  return requestApi('/api/categories');
}

export async function createCategory(
  input: { name: string },
  options?: RequestApiOptions,
): Promise<CategoryDto> {
  return requestApi(
    '/api/categories',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function patchCategory(
  categoryId: string,
  input: { name?: string; position?: number },
  options?: RequestApiOptions,
): Promise<CategoryDto> {
  return requestApi(
    `/api/categories/${encodeURIComponent(categoryId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteCategory(
  categoryId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: true }> {
  return requestApi(
    `/api/categories/${encodeURIComponent(categoryId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function reorderCategories(
  items: Array<{ id: string; position: number }>,
  options?: RequestApiOptions,
): Promise<CategoryDto[]> {
  return requestApi(
    '/api/categories/reorder',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    },
    options,
  );
}

export async function patchArticle(
  articleId: string,
  input: { isRead?: boolean; isStarred?: boolean },
  options?: RequestApiOptions,
): Promise<{ updated: true }> {
  return requestApi(
    `/api/articles/${encodeURIComponent(articleId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function markAllRead(
  input: { feedId?: string } = {},
  options?: RequestApiOptions,
): Promise<{ updatedCount: number }> {
  return requestApi(
    '/api/articles/mark-all-read',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export interface FeverAccountDto {
  id: string;
  baseUrl: string;
  username: string;
  enabled: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export async function listFeverAccounts(
  options?: RequestApiOptions,
): Promise<FeverAccountDto[]> {
  return requestApi('/api/fever/accounts', undefined, options);
}

export async function createFeverAccount(
  input: {
    baseUrl: string;
    username: string;
    apiKey: string;
    enabled?: boolean;
    autoSyncIntervalMinutes?: number;
  },
  options?: RequestApiOptions,
): Promise<FeverAccountDto> {
  return requestApi(
    '/api/fever/accounts',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function updateFeverAccountSettings(
  input: {
    id: string;
    baseUrl: string;
    username: string;
    apiKey?: string;
    enabled: boolean;
    autoSyncIntervalMinutes: number;
  },
  options?: RequestApiOptions,
): Promise<FeverAccountDto> {
  return requestApi(
    '/api/fever/accounts',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteFeverAccount(
  accountId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: boolean }> {
  return requestApi(
    `/api/fever/accounts?id=${encodeURIComponent(accountId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function syncFeverAccountNow(
  accountId: string,
  options?: RequestApiOptions,
): Promise<{ queued: boolean; reason?: 'already_enqueued' }> {
  return requestApi(
    `/api/fever/accounts/${encodeURIComponent(accountId)}/sync`,
    {
      method: 'POST',
    },
    options,
  );
}

// === GitHub 订阅 ===

export interface CreateGithubRepoInput {
  repoInput: string;
  title?: string;
  contentTypes?: GithubContentType[];
  includePrerelease?: boolean;
  fetchIntervalMinutes?: number;
  categoryId?: string | null;
  categoryName?: string | null;
}

export interface UpdateGithubRepoInput {
  title?: string;
  enabled?: boolean;
  fetchIntervalMinutes?: number;
  includePrerelease?: boolean;
  contentTypes?: GithubContentType[];
  categoryId?: string | null;
  categoryName?: string | null;
}

export async function listGithubRepos(
  options?: RequestApiOptions,
): Promise<GithubRepoSubscription[]> {
  return requestApi('/api/github/repos', undefined, options);
}

export async function createGithubRepo(
  input: CreateGithubRepoInput,
  options?: RequestApiOptions,
): Promise<GithubRepoSubscription> {
  return requestApi(
    '/api/github/repos',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function patchGithubRepo(
  feedId: string,
  input: UpdateGithubRepoInput,
  options?: RequestApiOptions,
): Promise<GithubRepoSubscription> {
  return requestApi(
    `/api/github/repos/${encodeURIComponent(feedId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteGithubRepo(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ id: string }> {
  return requestApi(
    `/api/github/repos/${encodeURIComponent(feedId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function refreshGithubRepo(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ enqueued: boolean; feedId: string; reason?: 'already_enqueued' }> {
  return requestApi(
    `/api/github/repos/${encodeURIComponent(feedId)}/refresh`,
    {
      method: 'POST',
    },
    options,
  );
}

export async function getGithubTokenStatus(
  options?: RequestApiOptions,
): Promise<GithubTokenStatus> {
  return requestApi('/api/settings/github/token', undefined, options);
}

export async function putGithubToken(
  token: string,
  options?: RequestApiOptions,
): Promise<GithubTokenStatus> {
  return requestApi(
    '/api/settings/github/token',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    },
    options,
  );
}

export async function deleteGithubToken(
  options?: RequestApiOptions,
): Promise<GithubTokenStatus> {
  return requestApi(
    '/api/settings/github/token',
    {
      method: 'DELETE',
    },
    options,
  );
}

// === OAuth 三方授权中心 ===

/**
 * 保存平台应用配置的入参。
 *
 * `clientSecret` 省略（`undefined`）表示保留服务端已有的 secret，
 * 传空串表示显式清空。明文 secret 只在本次请求体中出现一次，
 * 服务端落库前即 `seal()`，响应体永远只回打码值。
 */
export interface SaveOAuthProviderConfigInput {
  clientId: string;
  clientSecret?: string;
  enabled?: boolean;
}

export async function listOAuthProviders(
  options?: RequestApiOptions,
): Promise<OAuthProviderConfigStatus[]> {
  return requestApi('/api/oauth/providers', undefined, options);
}

export async function putOAuthProviderConfig(
  provider: OAuthProviderId,
  input: SaveOAuthProviderConfigInput,
  options?: RequestApiOptions,
): Promise<OAuthProviderConfigStatus> {
  return requestApi(
    `/api/oauth/providers/${encodeURIComponent(provider)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteOAuthProviderConfig(
  provider: OAuthProviderId,
  options?: RequestApiOptions,
): Promise<OAuthProviderConfigStatus> {
  return requestApi(
    `/api/oauth/providers/${encodeURIComponent(provider)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

/**
 * 发起授权。
 *
 * 返回的 `authorizeUrl` 由服务端拼装（含 state 与 PKCE challenge），
 * 前端只负责跳转，不参与任何参数构造。
 */
export async function startOAuthAuthorization(
  provider: OAuthProviderId,
  returnTo?: string,
  options?: RequestApiOptions,
): Promise<OAuthAuthorizeResult> {
  return requestApi(
    '/api/oauth/authorize',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(returnTo === undefined ? { provider } : { provider, returnTo }),
    },
    options,
  );
}

export async function listOAuthConnections(
  options?: RequestApiOptions,
): Promise<OAuthConnectionView[]> {
  return requestApi('/api/oauth/connections', undefined, options);
}

export async function deleteOAuthConnection(
  id: string,
  options?: RequestApiOptions,
): Promise<{ id: string }> {
  return requestApi(
    `/api/oauth/connections/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function refreshOAuthConnection(
  id: string,
  options?: RequestApiOptions,
): Promise<OAuthConnectionView> {
  return requestApi(
    `/api/oauth/connections/${encodeURIComponent(id)}/refresh`,
    {
      method: 'POST',
    },
    options,
  );
}

// === RSSHub 平台 Cookie 授权 ===

export async function listRssHubCookies(
  options?: RequestApiOptions,
): Promise<RssHubCookieView[]> {
  return requestApi('/api/rsshub/cookies', undefined, options);
}

export interface SaveRssHubCookieInput {
  cookie: string;
  remark?: string;
}

export async function putRssHubCookie(
  provider: RssHubCookieProvider,
  input: SaveRssHubCookieInput,
  options?: RequestApiOptions,
): Promise<RssHubCookieView> {
  return requestApi(
    `/api/rsshub/cookies/${encodeURIComponent(provider)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteRssHubCookie(
  provider: RssHubCookieProvider,
  options?: RequestApiOptions,
): Promise<RssHubCookieView> {
  return requestApi(
    `/api/rsshub/cookies/${encodeURIComponent(provider)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export interface ArticleDto {
  id: string;
  feedId: string;
  dedupeKey: string;
  title: string;
  titleOriginal: string;
  titleZh: string | null;
  link: string | null;
  author: string | null;
  publishedAt: string | null;
  contentHtml: string | null;
  contentFullHtml: string | null;
  contentFullFetchedAt: string | null;
  contentFullError: string | null;
  contentFullSourceUrl: string | null;
  aiSummary: string | null;
  aiSummaryModel: string | null;
  aiSummarizedAt: string | null;
  aiSummarySession?: ArticleAiSummarySessionSnapshotDto | null;
  aiTranslationBilingualHtml: string | null;
  aiTranslationZhHtml: string | null;
  aiTranslationModel: string | null;
  aiTranslatedAt: string | null;
  summary: string | null;
  filterStatus: 'pending' | 'passed' | 'filtered' | 'error';
  isFiltered: boolean;
  filteredBy: string[];
  isRead: boolean;
  readAt: string | null;
  isStarred: boolean;
  starredAt: string | null;
  bodyTranslationEligible?: boolean;
  bodyTranslationBlockedReason?: string | null;
  aiDigestSources?: ArticleAiDigestSourceDto[] | null;
  mediaAttachments?: ArticleMediaAttachmentDto[] | null;
}

export interface ArticleMediaAttachmentDto {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

export interface ArticleAiDigestSourceDto {
  articleId: string;
  feedId: string;
  feedTitle: string;
  title: string;
  link: string | null;
  publishedAt: string | null;
  position: number;
}

export interface ArticleSearchItemDto {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  titleOriginal: string | null;
  titleZh: string | null;
  summary: string;
  excerpt: string;
  publishedAt: string | null;
}

export async function searchArticles(
  input: {
    keyword: string;
    limit?: number;
  },
  options?: RequestApiOptions,
): Promise<{ items: ArticleSearchItemDto[] }> {
  const params = new URLSearchParams();
  const normalizedKeyword = input.keyword.trim().replace(/\s+/g, ' ');

  if (normalizedKeyword) {
    params.set('keyword', normalizedKeyword);
  }

  if (typeof input.limit === 'number') {
    params.set('limit', String(input.limit));
  }

  const query = params.toString();
  return requestApi(query ? `/api/articles/search?${query}` : '/api/articles/search', undefined, options);
}

export async function getArticle(
  articleId: string,
  options?: RequestApiOptions,
): Promise<ArticleDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}`, undefined, options);
}

export type ArticleTaskType = 'fulltext' | 'ai_summary' | 'ai_translate';
export type ArticleTaskStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

export interface ArticleTaskDto {
  type: ArticleTaskType;
  status: ArticleTaskStatus;
  jobId: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  rawErrorMessage?: string | null;
}

export interface ArticleTasksDto {
  fulltext: ArticleTaskDto;
  ai_summary: ArticleTaskDto;
  ai_translate: ArticleTaskDto;
}

export async function getArticleTasks(articleId: string): Promise<ArticleTasksDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/tasks`);
}

export async function enqueueArticleFulltext(
  articleId: string,
  input?: { force?: boolean },
): Promise<{ enqueued: boolean; jobId?: string }> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/fulltext`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: Boolean(input?.force) }),
  });
}

export async function enqueueArticleAiSummary(
  articleId: string,
  input?: { force?: boolean },
): Promise<{ enqueued: boolean; jobId?: string; reason?: string; sessionId?: string }> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: Boolean(input?.force) }),
  });
}

export async function enqueueArticleAiTranslate(
  articleId: string,
  input?: { force?: boolean },
): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: Boolean(input?.force) }),
  });
}

export type TranslationSessionStatus = 'running' | 'succeeded' | 'partial_failed' | 'failed';
export type TranslationSegmentStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type AiSummarySessionStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ArticleAiSummarySessionSnapshotDto {
  id: string;
  status: AiSummarySessionStatus;
  draftText: string;
  finalText: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rawErrorMessage?: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
}

export interface ArticleAiSummarySnapshotDto {
  session: ArticleAiSummarySessionSnapshotDto | null;
}

export interface ArticleAiTranslateSessionSnapshotDto {
  id: string;
  articleId: string;
  sourceHtmlHash: string;
  status: TranslationSessionStatus;
  totalSegments: number;
  translatedSegments: number;
  failedSegments: number;
  rawErrorMessage?: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
}

export interface ArticleAiTranslateSegmentSnapshotDto {
  id: string;
  segmentIndex: number;
  sourceText: string;
  translatedText: string | null;
  status: TranslationSegmentStatus;
  errorCode: string | null;
  errorMessage: string | null;
  rawErrorMessage?: string | null;
  updatedAt: string;
}

export interface ArticleAiTranslateSnapshotDto {
  session: ArticleAiTranslateSessionSnapshotDto | null;
  segments: ArticleAiTranslateSegmentSnapshotDto[];
}

export async function getArticleAiTranslateSnapshot(
  articleId: string,
): Promise<ArticleAiTranslateSnapshotDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-translate`);
}

export async function getArticleAiSummarySnapshot(
  articleId: string,
): Promise<ArticleAiSummarySnapshotDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-summary`);
}

export async function retryArticleAiTranslateSegment(
  articleId: string,
  segmentIndex: number,
): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
  return requestApi(
    `/api/articles/${encodeURIComponent(articleId)}/ai-translate/segments/${segmentIndex}/retry`,
    {
      method: 'POST',
    },
  );
}

export function createArticleAiTranslateEventSource(articleId: string): EventSource {
  const path = `/api/articles/${encodeURIComponent(articleId)}/ai-translate/stream`;
  return new EventSource(toAbsoluteUrl(path));
}

export function createArticleAiSummaryEventSource(articleId: string): EventSource {
  const path = `/api/articles/${encodeURIComponent(articleId)}/ai-summary/stream`;
  return new EventSource(toAbsoluteUrl(path));
}

export async function getSettings(options?: RequestApiOptions): Promise<PersistedSettings> {
  return requestApi('/api/settings', undefined, options);
}

export async function putSettings(
  input: PersistedSettings,
  options?: RequestApiOptions,
): Promise<PersistedSettings> {
  return requestApi(
    '/api/settings',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function getSystemLogs(input: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<SystemLogsPage> {
  const params = new URLSearchParams();

  if (input.keyword?.trim()) {
    params.set('keyword', input.keyword.trim());
  }

  if (typeof input.page === 'number') {
    params.set('page', String(input.page));
  }

  if (typeof input.pageSize === 'number') {
    params.set('pageSize', String(input.pageSize));
  }

  const query = params.toString();
  return requestApi(query ? `/api/logs?${query}` : '/api/logs');
}

export async function deleteSystemLogs(): Promise<{ deletedCount: number }> {
  return requestApi('/api/logs', {
    method: 'DELETE',
  });
}

export async function putAiApiKey(
  input: { apiKey: string },
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/ai/api-key',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function getAiApiKeyStatus(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi('/api/settings/ai/api-key', undefined, options);
}

export async function deleteAiApiKey(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/ai/api-key',
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function putTranslationApiKey(
  input: { apiKey: string },
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/translation/api-key',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function getTranslationApiKeyStatus(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi('/api/settings/translation/api-key', undefined, options);
}

export async function deleteTranslationApiKey(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/translation/api-key',
    {
      method: 'DELETE',
    },
    options,
  );
}

export function mapFeedDto(dto: FeedDtoLike, categories: Category[]): Feed {
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const resolvedIconUrl =
    dto.kind === 'ai_digest' ? (dto.iconUrl ?? AI_DIGEST_ICON_URL) : dto.iconUrl;
  const normalizedTriggers = normalizeFeedAutoTriggerFlags({
    fullTextOnOpenEnabled: dto.fullTextOnOpenEnabled,
    fullTextOnFetchEnabled: dto.fullTextOnFetchEnabled,
    aiSummaryOnOpenEnabled: dto.aiSummaryOnOpenEnabled,
    aiSummaryOnFetchEnabled: Boolean(dto.aiSummaryOnFetchEnabled),
    bodyTranslateOnFetchEnabled: Boolean(dto.bodyTranslateOnFetchEnabled),
    bodyTranslateOnOpenEnabled: Boolean(dto.bodyTranslateOnOpenEnabled),
  });
  return {
    id: dto.id,
    kind: dto.kind,
    provider: dto.provider ?? 'local_rss',
    remoteManaged: dto.remoteManaged ?? dto.provider === 'fever',
    remoteSource: dto.remoteSource ?? (dto.provider === 'fever' ? 'fever' : null),
    title: dto.title,
    url: dto.url,
    siteUrl: dto.siteUrl,
    icon: resolvedIconUrl ?? undefined,
    unreadCount: 'unreadCount' in dto ? dto.unreadCount ?? 0 : 0,
    enabled: dto.enabled,
    fullTextOnOpenEnabled: Boolean(normalizedTriggers.fullTextOnOpenEnabled),
    fullTextOnFetchEnabled: Boolean(normalizedTriggers.fullTextOnFetchEnabled),
    aiSummaryOnOpenEnabled: Boolean(normalizedTriggers.aiSummaryOnOpenEnabled),
    aiSummaryOnFetchEnabled: Boolean(normalizedTriggers.aiSummaryOnFetchEnabled),
    bodyTranslateOnFetchEnabled: Boolean(normalizedTriggers.bodyTranslateOnFetchEnabled),
    bodyTranslateOnOpenEnabled: Boolean(normalizedTriggers.bodyTranslateOnOpenEnabled),
    titleTranslateEnabled: dto.titleTranslateEnabled,
    bodyTranslateEnabled: dto.bodyTranslateEnabled,
    articleListDisplayMode: dto.articleListDisplayMode,
    view: dto.view ?? (dto.kind === 'ai_digest' ? 'digest' : 'article'),
    categoryId: dto.categoryId,
    category: dto.categoryId ? categoryNameById.get(dto.categoryId) ?? null : null,
    fetchStatus: ('lastFetchStatus' in dto ? dto.lastFetchStatus : null) ?? null,
    fetchError: ('lastFetchError' in dto ? dto.lastFetchError : null) ?? null,
    fetchRawError: ('lastFetchRawError' in dto ? dto.lastFetchRawError : null) ?? null,
    isPodcast: Boolean(dto.isPodcast),
  };
}

export function mapSnapshotArticleItem(dto: ReaderSnapshotDto['articles']['items'][number]): Article {
  const titleOriginal = dto.titleOriginal?.trim() ? dto.titleOriginal : dto.title;
  const titleZh = dto.titleZh?.trim() ? dto.titleZh : undefined;
  const effectiveTitle = titleZh ?? dto.title;

  return {
    id: dto.id,
    feedId: dto.feedId,
    title: effectiveTitle,
    titleOriginal,
    titleZh,
    content: '',
    previewImage: dto.previewImage ?? undefined,
    summary: dto.summary ?? '',
    author: dto.author ?? undefined,
    publishedAt: dto.publishedAt ?? new Date().toISOString(),
    link: dto.link ?? '',
    filterStatus: dto.filterStatus,
    isFiltered: dto.isFiltered,
    filteredBy: dto.filteredBy,
    isRead: dto.isRead,
    isStarred: dto.isStarred,
    remoteSource: dto.remoteSource ?? null,
    bodyTranslationEligible: dto.bodyTranslationEligible,
    bodyTranslationBlockedReason: dto.bodyTranslationBlockedReason,
    aiSummarySession: dto.aiSummarySession,
    githubMeta: dto.githubMeta ?? null,
  };
}

// 知识库问答
export interface KnowledgeAskRequest {
  question: string;
  mode?: 'personal_assistant' | 'content_creation' | 'information_filtering';
}

export interface KnowledgeSearchResult {
  articleId: number;
  chunkIndex: number;
  chunkText: string;
  title: string;
  score: number;
}

// 流式问答
export async function askKnowledge(
  params: KnowledgeAskRequest,
  onChunk: (content: string) => void,
  onDone: (sources: Array<{ title: string; articleId: number }>) => void,
  onError: (error: string) => void,
  options?: RequestApiOptions,
): Promise<void> {
  const response = await fetch('/api/knowledge/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: { message: '请求失败' } }));
    onError(err?.error?.message || '请求失败');
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError('无法读取响应流');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.done) {
          onDone(parsed.sources || []);
        } else if (parsed.content) {
          onChunk(parsed.content);
        } else if (parsed.error) {
          onError(parsed.error);
        }
      } catch { /* ignore parse errors */ }
    }
  }
}

// 知识库搜索（非流式）
export async function searchKnowledge(q: string, options?: RequestApiOptions): Promise<KnowledgeSearchResult[]> {
  return requestApi(`/api/knowledge/search?q=${encodeURIComponent(q)}`, undefined, options);
}

export function mapArticleDto(dto: ArticleDto): Article {
  return {
    id: dto.id,
    feedId: dto.feedId,
    title: dto.title,
    titleOriginal: dto.titleOriginal,
    titleZh: dto.titleZh ?? undefined,
    content: dto.contentFullHtml ?? dto.contentHtml ?? '',
    aiSummary: dto.aiSummary ?? undefined,
    aiSummarySession: dto.aiSummarySession,
    aiTranslationBilingualHtml: dto.aiTranslationBilingualHtml ?? undefined,
    aiTranslationZhHtml: dto.aiTranslationZhHtml ?? undefined,
    summary: dto.summary ?? '',
    author: dto.author ?? undefined,
    publishedAt: dto.publishedAt ?? new Date().toISOString(),
    link: dto.link ?? '',
    filterStatus: dto.filterStatus,
    isFiltered: dto.isFiltered,
    filteredBy: dto.filteredBy,
    isRead: dto.isRead,
    isStarred: dto.isStarred,
    bodyTranslationEligible: dto.bodyTranslationEligible,
    bodyTranslationBlockedReason: dto.bodyTranslationBlockedReason,
    aiDigestSources: dto.aiDigestSources?.map((source) => ({
      articleId: source.articleId,
      feedId: source.feedId,
      feedTitle: source.feedTitle,
      title: source.title,
      link: source.link,
      publishedAt: source.publishedAt,
      position: source.position,
    })) ?? undefined,
    mediaAttachments: dto.mediaAttachments?.map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      durationSeconds: attachment.durationSeconds,
    })) ?? undefined,
  };
}

// === Highlights API ===

export async function getArticleHighlights(
  articleId: number,
  options?: RequestApiOptions,
): Promise<Highlight[]> {
  return requestApi(`/api/articles/${articleId}/highlights`, undefined, options);
}

export async function createHighlight(
  articleId: number,
  params: {
    text: string;
    rangeStartSelector: string;
    rangeStartOffset: number;
    rangeEndSelector: string;
    rangeEndOffset: number;
    color: HighlightColor;
    note?: string | null;
  },
  options?: RequestApiOptions,
): Promise<Highlight> {
  return requestApi(
    `/api/articles/${articleId}/highlights`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    },
    options,
  );
}

export async function updateHighlight(
  highlightId: string,
  updates: { color?: HighlightColor; note?: string | null },
  options?: RequestApiOptions,
): Promise<Highlight> {
  return requestApi(
    `/api/highlights/${encodeURIComponent(highlightId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updates),
    },
    options,
  );
}

export async function deleteHighlight(
  highlightId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: boolean }> {
  return requestApi(
    `/api/highlights/${encodeURIComponent(highlightId)}`,
    { method: 'DELETE' },
    options,
  );
}

// === Tags API ===

export async function getTags(options?: RequestApiOptions): Promise<Tag[]> {
  return requestApi('/api/tags', undefined, options);
}

export async function createTag(
  name: string,
  color?: string,
  options?: RequestApiOptions,
): Promise<Tag> {
  return requestApi(
    '/api/tags',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, color }),
    },
    options,
  );
}

export async function updateTag(
  tagId: string,
  updates: { name?: string; color?: string },
  options?: RequestApiOptions,
): Promise<Tag> {
  return requestApi(
    `/api/tags/${encodeURIComponent(tagId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updates),
    },
    options,
  );
}

export async function deleteTag(
  tagId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: boolean }> {
  return requestApi(
    `/api/tags/${encodeURIComponent(tagId)}`,
    { method: 'DELETE' },
    options,
  );
}

export async function getArticleTags(
  articleId: number,
  options?: RequestApiOptions,
): Promise<Tag[]> {
  return requestApi(`/api/articles/${articleId}/tags`, undefined, options);
}

export async function addTagsToArticle(
  articleId: number,
  tagIds: string[],
  options?: RequestApiOptions,
): Promise<{ added: boolean }> {
  return requestApi(
    `/api/articles/${articleId}/tags`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds }),
    },
    options,
  );
}

export async function removeTagFromArticle(
  articleId: number,
  tagId: string,
  options?: RequestApiOptions,
): Promise<{ removed: boolean }> {
  return requestApi(
    `/api/articles/${articleId}/tags/${encodeURIComponent(tagId)}`,
    { method: 'DELETE' },
    options,
  );
}

// === Boards API ===

export async function getBoards(options?: RequestApiOptions): Promise<Board[]> {
  return requestApi('/api/boards', undefined, options);
}

export async function createBoard(
  title: string,
  options?: { description?: string; icon?: string } & RequestApiOptions,
): Promise<Board> {
  const { description, icon, ...requestOptions } = options ?? {};
  return requestApi(
    '/api/boards',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, description, icon }),
    },
    requestOptions,
  );
}

export async function updateBoard(
  boardId: string,
  updates: { title?: string; description?: string; icon?: string; sortOrder?: number },
  options?: RequestApiOptions,
): Promise<Board> {
  return requestApi(
    `/api/boards/${encodeURIComponent(boardId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updates),
    },
    options,
  );
}

export async function deleteBoard(
  boardId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: boolean }> {
  return requestApi(
    `/api/boards/${encodeURIComponent(boardId)}`,
    { method: 'DELETE' },
    options,
  );
}

export async function getBoardItems(
  boardId: string,
  options?: RequestApiOptions,
): Promise<BoardItem[]> {
  return requestApi(`/api/boards/${encodeURIComponent(boardId)}/items`, undefined, options);
}

export async function addArticleToBoard(
  boardId: string,
  articleId: number,
  options?: RequestApiOptions,
): Promise<{ added: boolean }> {
  return requestApi(
    `/api/boards/${encodeURIComponent(boardId)}/items`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articleId }),
    },
    options,
  );
}

export async function removeArticleFromBoard(
  boardId: string,
  articleId: number,
  options?: RequestApiOptions,
): Promise<{ removed: boolean }> {
  return requestApi(
    `/api/boards/${encodeURIComponent(boardId)}/items/${articleId}`,
    { method: 'DELETE' },
    options,
  );
}

/* ── 审批台（治理层）── */

export type GovernanceStatus = 'candidate' | 'pending' | 'archived' | 'rejected' | 'used';

export interface GovernanceQueueItem {
  id: string;
  title: string;
  summary: string | null;
  aiReason: string | null;
  qualityScore: number | null;
  feedId: string;
  feedTitle: string;
  categoryId: string | null;
  categoryTitle: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  governanceStatus: GovernanceStatus;
  redraftCount: number;
  contentType: ContentType;
  /** 治理方向（P2b；存量为 null）。 */
  directionKey: string | null;
  directionReason: string | null;
}

/** 治理条目详情：全文/图/来源，供详情 sheet 渲染。 */
export interface GovernanceItemDetail extends GovernanceQueueItem {
  titleOriginal: string | null;
  author: string | null;
  content: string | null;
  previewImage: string | null;
}

export interface GovernanceQueueResult {
  items: GovernanceQueueItem[];
  total: number;
}

export interface GovernanceStats {
  todayPending: number;
  todayArchived: number;
  todayFetchSucceeded: number;
  todayFetchFailed: number;
  queueSize: number;
}

export async function getGovernanceQueue(
  input?: {
    statuses?: GovernanceStatus[];
    categoryId?: string;
    keyword?: string;
    /** 方向筛选（direction_key 精确匹配，P2b）。 */
    direction?: string;
    page?: number;
    pageSize?: number;
  },
  options?: RequestApiOptions,
): Promise<GovernanceQueueResult> {
  const params = new URLSearchParams();
  if (input?.statuses && input.statuses.length > 0) {
    params.set('status', input.statuses.join(','));
  }
  if (input?.categoryId) params.set('categoryId', input.categoryId);
  if (input?.keyword) params.set('keyword', input.keyword);
  if (input?.direction) params.set('direction', input.direction);
  if (typeof input?.page === 'number') params.set('page', String(input.page));
  if (typeof input?.pageSize === 'number') params.set('pageSize', String(input.pageSize));

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestApi<GovernanceQueueResult>(`/api/governance/queue${suffix}`, undefined, options);
}

export async function getGovernanceStats(
  options?: RequestApiOptions,
): Promise<GovernanceStats> {
  return requestApi('/api/governance/stats', undefined, options);
}

export async function approveGovernanceItem(
  id: string,
  options?: RequestApiOptions,
): Promise<unknown> {
  return requestApi(
    `/api/governance/items/${encodeURIComponent(id)}/approve`,
    { method: 'POST' },
    options,
  );
}

export async function rejectGovernanceItem(
  id: string,
  input: { reason: string },
  options?: RequestApiOptions,
): Promise<unknown> {
  return requestApi(
    `/api/governance/items/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function redraftGovernanceItem(
  id: string,
  input: { reason: string },
  options?: RequestApiOptions,
): Promise<unknown> {
  return requestApi(
    `/api/governance/items/${encodeURIComponent(id)}/redraft`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function restoreGovernanceItem(
  id: string,
  options?: RequestApiOptions,
): Promise<unknown> {
  return requestApi(
    `/api/governance/items/${encodeURIComponent(id)}/restore`,
    { method: 'POST' },
    options,
  );
}

export async function getGovernanceItemDetail(
  id: string,
  options?: RequestApiOptions,
): Promise<GovernanceItemDetail> {
  return requestApi(`/api/governance/items/${encodeURIComponent(id)}`, undefined, options);
}

/* ── 热点雷达（TrendRadar）── */

export type ContentType = 'video' | 'image' | 'text';

export interface TrendRadarItem {
  id: string;
  platform: string;
  platformName: string;
  title: string;
  url: string;
  rank: number | null;
  previousRank: number | null;
  hotValue: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceDate: string;
  promotedAt: string | null;
  promotedArticleId: string | null;
  contentType: ContentType;
  /** 已转选题条目的治理方向（未转为 null，P2b）。 */
  directionKey: string | null;
}

/** 热榜详情：行字段 + payload_json 全量（有啥返回啥）。 */
export interface TrendRadarItemDetail extends TrendRadarItem {
  payload: Record<string, unknown>;
}

export interface TrendRadarPlatformGroup {
  platform: string;
  platformName: string;
  items: TrendRadarItem[];
}

export interface TrendRadarToday {
  date: string;
  total: number;
  platforms: TrendRadarPlatformGroup[];
}

export async function getTrendRadarToday(
  input?: { date?: string },
  options?: RequestApiOptions,
): Promise<TrendRadarToday> {
  const suffix = input?.date ? `?date=${encodeURIComponent(input.date)}` : '';
  return requestApi(`/api/trend-radar/today${suffix}`, undefined, options);
}

export async function promoteTrendRadarItem(
  id: string,
  options?: RequestApiOptions,
): Promise<{ itemId: string; articleId: string; alreadyPromoted: boolean }> {
  return requestApi(
    `/api/trend-radar/items/${encodeURIComponent(id)}/promote`,
    { method: 'POST' },
    options,
  );
}

export async function getTrendRadarItemDetail(
  id: string,
  options?: RequestApiOptions,
): Promise<TrendRadarItemDetail> {
  return requestApi(`/api/trend-radar/items/${encodeURIComponent(id)}`, undefined, options);
}

/* ── 创作流水线（洗稿）── */

export type RewritePlatform = 'wechat' | 'xhs' | 'novel';

export interface RewriteJobCreated {
  id: string;
  articleId: string;
  kind: 'rewrite';
  platform: string;
  status: PipelineJobStatus;
  reused: boolean;
  enqueued: boolean;
  queueJobId: string | null;
  createdAt: string;
}

export type PipelineJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface PipelineJobItem {
  id: string;
  articleId: string;
  kind: string;
  platform: string;
  status: PipelineJobStatus;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  articleTitle: string;
}

export async function createRewriteJobs(
  input: { articleId: string; platforms: RewritePlatform[] },
  options?: RequestApiOptions,
): Promise<{ jobs: RewriteJobCreated[] }> {
  return requestApi(
    '/api/pipelines/rewrite',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function listPipelineJobs(
  input?: { kind?: 'rewrite' | 'voiceover' | 'video'; status?: PipelineJobStatus; page?: number; pageSize?: number },
  options?: RequestApiOptions,
): Promise<{ items: PipelineJobItem[]; total: number }> {
  const params = new URLSearchParams();
  if (input?.kind) params.set('kind', input.kind);
  if (input?.status) params.set('status', input.status);
  if (typeof input?.page === 'number') params.set('page', String(input.page));
  if (typeof input?.pageSize === 'number') params.set('pageSize', String(input.pageSize));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestApi(`/api/pipelines/jobs${suffix}`, undefined, options);
}

export async function retryPipelineJob(
  id: string,
  options?: RequestApiOptions,
): Promise<unknown> {
  return requestApi(
    `/api/pipelines/jobs/${encodeURIComponent(id)}/retry`,
    { method: 'POST' },
    options,
  );
}

export type OriginalityFlag = 'ok' | 'rewritten' | 'needs_review';
export type DraftStatus = 'draft' | 'accepted' | 'exported';

export interface DraftItem {
  id: string;
  articleId: string;
  jobId: string | null;
  platform: string;
  title: string;
  similarityScore: number | null;
  originalityFlag: OriginalityFlag;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  articleTitle: string;
}

export interface DraftDetail extends DraftItem {
  body: string;
  articleTitle: string;
  articleSummary: string | null;
  articleLink: string | null;
}

export async function listDrafts(
  input?: { articleId?: string; platform?: string; page?: number; pageSize?: number },
  options?: RequestApiOptions,
): Promise<{ items: DraftItem[]; total: number }> {
  const params = new URLSearchParams();
  if (input?.articleId) params.set('articleId', input.articleId);
  if (input?.platform) params.set('platform', input.platform);
  if (typeof input?.page === 'number') params.set('page', String(input.page));
  if (typeof input?.pageSize === 'number') params.set('pageSize', String(input.pageSize));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestApi(`/api/drafts${suffix}`, undefined, options);
}

export async function getDraftDetail(
  id: string,
  options?: RequestApiOptions,
): Promise<DraftDetail> {
  // 路由返回 { draft } 包装，这里拆平
  const result = await requestApi<{ draft: DraftDetail }>(
    `/api/drafts/${encodeURIComponent(id)}`,
    undefined,
    options,
  );
  return result.draft;
}

export async function acceptDraft(
  id: string,
  options?: RequestApiOptions,
): Promise<unknown> {
  return requestApi(
    `/api/drafts/${encodeURIComponent(id)}/accept`,
    { method: 'POST' },
    options,
  );
}

/** 导出草稿 Markdown：返回文本与文件名（浏览器侧自行触发下载）。 */
export async function exportDraftMarkdown(
  id: string,
  options?: RequestApiOptions & { timeoutMs?: number },
): Promise<{ markdown: string; fileName: string }> {
  let res: Response;
  try {
    res = await api(toAbsoluteUrl(`/api/drafts/${encodeURIComponent(id)}/export`), {
      method: 'GET',
      timeout: options?.timeoutMs ?? 15_000,
    });
  } catch (err) {
    throwTransportApiError(err, options);
  }
  if (!res.ok) {
    throwInvalidResponseApiError(res.status, options);
  }
  return {
    markdown: await res.text(),
    fileName:
      parseContentDispositionFileName(res.headers.get('content-disposition')) ??
      `draft-${id}.md`,
  };
}

/* ── 订阅源管理（P1-A，H5/插件侧使用）── */

export interface FeedListItem {
  id: string;
  title: string;
  url: string;
  siteUrl: string | null;
  kind: string;
  view: string;
  enabled: boolean;
  categoryId: string | null;
  categoryTitle: string | null;
  lastFetchStatus: number | null;
  lastFetchError: string | null;
  lastFetchedAt: string | null;
  articleCount: number;
}

export async function listFeedItems(
  options?: RequestApiOptions,
): Promise<{ items: FeedListItem[] }> {
  return requestApi('/api/feeds', undefined, options);
}

/** 推荐条目带平台标签（插件侧 inferFeedPlatform 派生）。 */
export interface RecommendedFeedEntry extends RecommendedFeedItem {
  platform?: 'rss' | 'bilibili' | 'douyin' | 'ai' | 'tech';
}

export async function listRecommendedFeeds(
  options?: RequestApiOptions,
): Promise<RecommendedFeedEntry[]> {
  return requestApi('/api/feeds/recommended', undefined, options);
}

/** 送回审批台：archived → candidate（阅读器「送审批」）。 */
export async function requeueGovernanceItem(
  id: string,
  options?: RequestApiOptions,
): Promise<unknown> {
  return requestApi(
    `/api/governance/items/${encodeURIComponent(id)}/requeue`,
    { method: 'POST' },
    options,
  );
}

/* ── 消息中心（P2a）── */

export type NotificationKind =
  | 'fetch_failed'
  | 'pending_backlog'
  | 'pipeline_done'
  | 'redraft_done'
  | 'system';

export interface NotificationItem {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(
  input?: { unreadOnly?: boolean; page?: number; pageSize?: number },
  options?: RequestApiOptions,
): Promise<{ items: NotificationItem[]; total: number }> {
  const params = new URLSearchParams();
  if (input?.unreadOnly) params.set('unreadOnly', 'true');
  if (typeof input?.page === 'number') params.set('page', String(input.page));
  if (typeof input?.pageSize === 'number') params.set('pageSize', String(input.pageSize));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestApi(`/api/notifications${suffix}`, undefined, options);
}

export async function getUnreadNotificationCount(
  options?: RequestApiOptions,
): Promise<{ count: number }> {
  return requestApi('/api/notifications/unread-count', undefined, options);
}

export async function markNotificationRead(
  id: string,
  options?: RequestApiOptions,
): Promise<{ item: NotificationItem }> {
  return requestApi(
    `/api/notifications/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
    options,
  );
}

export async function markAllNotificationsRead(
  options?: RequestApiOptions,
): Promise<{ updated: number }> {
  return requestApi('/api/notifications/read-all', { method: 'POST' }, options);
}

/* ── 治理方向模板（P2b）── */

export interface DirectionTemplate {
  id: string;
  key: string;
  name: string;
  color: string;
  icon: string;
  keywordsDsl: string;
  aiHint: string;
  quotaWeight: number;
  enabled: boolean;
  sort: number;
  builtin: boolean;
}

export async function listDirections(
  options?: RequestApiOptions,
): Promise<{ items: DirectionTemplate[] }> {
  return requestApi('/api/directions', undefined, options);
}

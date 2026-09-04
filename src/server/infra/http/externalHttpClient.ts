import got from 'got';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { getPool } from '@/server/infra/db/pool';
import { writeSystemLog } from '@/server/infra/logging/systemLogger';
import { getFetchUrlCandidates } from '@/server/integrations/rss/fetchUrlCandidates';
import { isSafeMediaUrl } from '@/server/integrations/media/mediaProxyGuard';
import { isSafeExternalUrl } from '@/server/integrations/rss/ssrfGuard';

/**
 * 外部 HTTP 客户端专用 Agent，带 keepAlive + 并发限制 + 空闲超时。
 *
 * 避免每次外部请求都创建新 TCP 连接（创建而不销毁会导致 CLOSE_WAIT 堆积），
 * 同时限制单 host 并发数，防止文件描述符被耗尽。
 */
const HTTP_AGENT = new http.Agent({
  keepAlive: true,
  maxSockets: 20,
  timeout: 15_000,
});
const HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  timeout: 15_000,
});

const client = got.extend({
  retry: { limit: 0 },
  throwHttpErrors: false,
  agent: { http: HTTP_AGENT, https: HTTPS_AGENT },
});
const DEFAULT_MAX_RSS_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_JSON_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const LOG_DETAILS_MAX_CHARS = 4096;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** 日志上下文里命中这些键名的值一律脱敏，避免凭据顺着 context 落进 system_logs。 */
const SENSITIVE_CONTEXT_KEY_PATTERN =
  /(authorization|token|secret|password|passwd|credential|api[_-]?key)/i;
const REDACTED_PLACEHOLDER = '[redacted]';

export interface FetchRssXmlResult {
  status: number;
  xml: string | null;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
}

export interface FetchHtmlResult {
  status: number;
  finalUrl: string;
  contentType: string | null;
  html: string;
}

export interface FetchExternalJsonResult<T = unknown> {
  status: number;
  finalUrl: string;
  contentType: string | null;
  /** 响应头原样透出，供调用方读取 `etag` / `x-ratelimit-*` / `retry-after`。 */
  headers: Record<string, string | string[] | undefined>;
  /** 解析成功的 JSON；空响应体（如 304）或解析失败时为 null。 */
  json: T | null;
  /** 原始响应体，便于错误分支保留上下文。 */
  rawBody: string;
  /** JSON 解析失败原因；解析成功或响应体为空时为 null。 */
  jsonParseError: string | null;
}

interface ExternalRequestLogging {
  userId?: string | null;
  source: string;
  requestLabel: string;
  context?: Record<string, unknown>;
  /**
   * 非 2xx 分支是否把响应体写进 `system_logs.details`。
   *
   * 置 `true` 时 `details` 一律写 `[redacted]`。OAuth token 交换的错误响应
   * 里可能回显 `access_token` / `client_secret`，必须启用（见 arch §1.4 S1）。
   */
  redactResponseBody?: boolean;
}

/** 出网请求方法。默认 `GET`，与扩展前的行为完全一致。 */
export type ExternalRequestMethod = 'GET' | 'POST';

type SafeUrlChecker = (url: string) => boolean | Promise<boolean>;

type FetchTextOkResult = {
  kind: 'ok';
  status: number;
  finalUrl: string;
  contentType: string | null;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

type FetchTextHopResult = { kind: 'redirect'; nextUrl: string } | FetchTextOkResult;

function getHeaderValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

function getExternalErrorDetails(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || 'Unknown error';
  }

  if (typeof err === 'string') {
    return err;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function truncateLogDetails(details: string | null): string | null {
  if (details === null || details.length <= LOG_DETAILS_MAX_CHARS) {
    return details;
  }

  return `${details.slice(0, LOG_DETAILS_MAX_CHARS)}\n...[truncated]`;
}

function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

async function assertSafeUrl(url: string, isSafeUrl: SafeUrlChecker): Promise<void> {
  if (!(await isSafeUrl(url))) {
    throw new Error('Unsafe URL');
  }
}

function isTerminalFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return ['Unsafe URL', 'Response too large', 'Too many redirects'].includes(
    err.message,
  );
}

/**
 * URL query 中命中即脱敏的敏感键（值一律替换为 `[redacted]`）。
 *
 * 覆盖真实链路：微信 GET token 交换（`appid`/`secret`/`code`）、微信 refresh
 * （`refresh_token`）、抖音 profile（`access_token`）等。只匹配整键或以
 * `_`/`-`/`.` 分隔的尾段，避免误伤 `code_challenge`/`code_verifier` 这类
 * 公开 PKCE 参数，也避免 `encode`/`decode` 这类以 code 结尾的非凭据键。
 */
function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized === 'authorization') {
    return true;
  }
  return /(^|_|-|\.)(secret|token|password|passwd|credential|code|api[_-]?key)$/.test(
    normalized,
  );
}

/** 解码 query 键做匹配；解码失败按原文参与判断（best-effort）。 */
function decodeQueryKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return rawKey;
  }
}

/**
 * 对 URL 的 query 部分做敏感值脱敏。
 *
 * 只在确实命中敏感键时才重写字符串；其余 query 对、编码与 fragment 原样保留，
 * 未命中时整串逐字节返回（保证既有日志断言不受影响）。
 */
function redactSensitiveQuery(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) {
    return url;
  }

  const fragmentStart = url.indexOf('#', queryStart + 1);
  const queryEnd = fragmentStart === -1 ? url.length : fragmentStart;
  const queryRaw = url.slice(queryStart + 1, queryEnd);
  if (queryRaw === '') {
    return url;
  }

  const parts = queryRaw.split('&');
  let changed = false;
  const redactedParts = parts.map((part) => {
    if (part === '') {
      return part;
    }
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    if (!isSensitiveQueryKey(decodeQueryKey(rawKey))) {
      return part;
    }
    changed = true;
    return `${rawKey}=${REDACTED_PLACEHOLDER}`;
  });

  if (!changed) {
    return url;
  }

  return `${url.slice(0, queryStart + 1)}${redactedParts.join('&')}${url.slice(queryEnd)}`;
}

/**
 * 去掉 URL 里的凭据，只用于日志（`system_logs.context.url`），**绝不改变实际请求**。
 *
 * 两层脱敏：
 * 1. userinfo（`https://user:pass@host/...`）——既有行为；
 * 2. 敏感 query 键的值（微信 GET token 交换把 `client_secret`/`code` 拼进 query，
 *    `redactSensitiveQuery` 把这些值替换为 `[redacted]`，防止主密钥顺着日志落库）。
 *
 * 两处都未命中时原样返回，保证既有日志断言不受影响。
 */
function redactUrlCredentials(url: string): string {
  if (!url.includes('@') && !url.includes('?')) {
    return url;
  }

  let redacted = url;
  if (url.includes('@')) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) {
        parsed.username = '';
        parsed.password = '';
        redacted = parsed.toString();
      }
    } catch {
      // 解析失败保持原样，query 脱敏仍会执行。
    }
  }

  return redactSensitiveQuery(redacted);
}

/** 对日志上下文做一层凭据脱敏，作为「Authorization 永不进日志」红线的兜底防线。 */
function redactSensitiveContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!context) {
    return {};
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    redacted[key] = SENSITIVE_CONTEXT_KEY_PATTERN.test(key) ? REDACTED_PLACEHOLDER : value;
  }

  return redacted;
}

async function writeExternalRequestLog(input: {
  logging?: ExternalRequestLogging;
  url: string;
  method: ExternalRequestMethod;
  status?: number;
  durationMs: number;
  details: string | null;
  /** 覆盖 `logging.redactResponseBody`，供调用方在顶层选项里直接开启脱敏。 */
  redactResponseBody?: boolean;
}) {
  if (!input.logging) {
    return;
  }

  const isSuccess =
    input.status === 304 ||
    (input.status !== undefined && input.status >= 200 && input.status < 300);
  const shouldRedactBody =
    input.redactResponseBody ?? input.logging.redactResponseBody ?? false;

  await writeSystemLog(getPool(), {
    userId: input.logging.userId ?? null,
    level: isSuccess ? 'info' : 'error',
    category: 'external_api',
    source: input.logging.source,
    message: `${input.logging.requestLabel} ${isSuccess ? 'completed' : 'failed'}`,
    details: isSuccess
      ? null
      : shouldRedactBody
        ? REDACTED_PLACEHOLDER
        : truncateLogDetails(input.details),
    context: {
      url: redactUrlCredentials(input.url),
      method: input.method,
      status: input.status ?? null,
      durationMs: input.durationMs,
      ...redactSensitiveContext(input.logging.context),
    },
  });
}

async function fetchTextHop(
  url: string,
  options: {
    timeoutMs: number;
    headers: Record<string, string>;
    maxBytes: number;
    /** 默认 `GET`：不传时与扩展前的硬编码行为逐字节一致。 */
    method?: ExternalRequestMethod;
    /** 请求体，仅 POST 有意义。编码与 content-type 由调用方决定。 */
    body?: string;
  },
): Promise<FetchTextHopResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const req = client.stream(url, {
      method: options.method ?? 'GET',
      followRedirect: false,
      headers: options.headers,
      ...(options.body === undefined ? {} : { body: options.body }),
      signal: controller.signal,
    });

    return await new Promise<FetchTextHopResult>((resolve, reject) => {
      let settled = false;
      let status = 0;
      let finalUrl = url;
      let contentType: string | null = null;
      let responseHeaders: Record<string, string | string[] | undefined> = {};
      const chunks: Buffer[] = [];
      let received = 0;

      const cleanup = () => clearTimeout(timeout);
      const safeResolve = (value: FetchTextHopResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const safeReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      req.on('close', cleanup);
      req.on('error', safeReject);

      req.on('response', (res) => {
        status = res.statusCode;
        finalUrl = res.url || finalUrl;
        responseHeaders = res.headers;
        contentType = getHeaderValue(res.headers['content-type']);

        if (!isRedirectStatus(status)) {
          return;
        }

        const location = getHeaderValue(res.headers.location);
        if (!location) {
          safeReject(new Error('Missing redirect location'));
          req.destroy();
          return;
        }

        try {
          // 手动处理重定向，确保下一跳请求发出前能先做 SSRF 校验。
          safeResolve({ kind: 'redirect', nextUrl: new URL(location, url).toString() });
        } catch (err) {
          safeReject(err);
        }
        req.destroy();
      });

      req.on('data', (chunk) => {
        if (settled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.byteLength;
        if (received > options.maxBytes) {
          req.destroy(new Error('Response too large'));
          return;
        }

        chunks.push(buf);
      });

      req.on('end', () => {
        safeResolve({
          kind: 'ok',
          status,
          finalUrl,
          contentType,
          headers: responseHeaders,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithValidatedRedirects(
  url: string,
  options: {
    timeoutMs: number;
    headers: Record<string, string>;
    maxBytes: number;
    maxRedirects: number;
    isSafeUrl: SafeUrlChecker;
    method?: ExternalRequestMethod;
    body?: string;
  },
): Promise<FetchTextOkResult> {
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    await assertSafeUrl(currentUrl, options.isSafeUrl);
    const hop = await fetchTextHop(currentUrl, options);

    if (hop.kind === 'ok') {
      return hop;
    }

    if (redirects >= options.maxRedirects) {
      throw new Error('Too many redirects');
    }

    redirects += 1;
    currentUrl = hop.nextUrl;
  }
}

export async function fetchRssXml(
  url: string,
  options: {
    timeoutMs: number;
    userAgent: string;
    etag?: string | null;
    lastModified?: string | null;
    maxBytes?: number;
    maxRedirects?: number;
    isSafeUrl?: SafeUrlChecker;
    logging?: ExternalRequestLogging;
  },
): Promise<FetchRssXmlResult> {
  const startedAt = Date.now();

  try {
    const headers: Record<string, string> = {
      accept:
        'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'user-agent': options.userAgent,
    };

    if (options.etag) headers['if-none-match'] = options.etag;
    if (options.lastModified) headers['if-modified-since'] = options.lastModified;

    const candidates = getFetchUrlCandidates(url);
    let lastError: unknown = null;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_RSS_BYTES;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const isSafeUrl = options.isSafeUrl ?? isSafeExternalUrl;

    for (const candidate of candidates) {
      try {
        const hop = await fetchTextWithValidatedRedirects(candidate, {
          timeoutMs: options.timeoutMs,
          headers,
          maxBytes,
          maxRedirects,
          isSafeUrl,
        });
        const status = hop.status;
        const etag = typeof hop.headers.etag === 'string' ? hop.headers.etag : null;
        const lastModified =
          typeof hop.headers['last-modified'] === 'string'
            ? hop.headers['last-modified']
            : null;
        const finalUrl = hop.finalUrl;

        if (status === 304) {
          await writeExternalRequestLog({
            logging: options.logging,
            url: finalUrl,
            method: 'GET',
            status,
            details: null,
            durationMs: Date.now() - startedAt,
          });
          return { status, xml: null, etag, lastModified, finalUrl };
        }

        await writeExternalRequestLog({
          logging: options.logging,
          url: finalUrl,
          method: 'GET',
          status,
          details: hop.body,
          durationMs: Date.now() - startedAt,
        });
        return { status, xml: hop.body, etag, lastModified, finalUrl };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        // 只有网络失败才尝试 Docker fallback，安全和响应限制错误必须保留原始结论。
        if (isTerminalFetchError(err)) throw err;
        lastError = err;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('Network error');
  } catch (err) {
    await writeExternalRequestLog({
      logging: options.logging,
      url,
      method: 'GET',
      details: getExternalErrorDetails(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

export async function fetchHtml(
  url: string,
  options: {
    timeoutMs: number;
    userAgent: string;
    maxBytes: number;
    maxRedirects?: number;
    isSafeUrl?: SafeUrlChecker;
    headers?: Record<string, string>;
    logging?: ExternalRequestLogging;
  },
): Promise<FetchHtmlResult> {
  const startedAt = Date.now();

  try {
    const headers: Record<string, string> = {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': options.userAgent,
      ...options.headers,
    };
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const isSafeUrl = options.isSafeUrl ?? isSafeExternalUrl;
    const hop = await fetchTextWithValidatedRedirects(url, {
      timeoutMs: options.timeoutMs,
      headers,
      maxBytes: options.maxBytes,
      maxRedirects,
      isSafeUrl,
    });

    await writeExternalRequestLog({
      logging: options.logging,
      url: hop.finalUrl,
      method: 'GET',
      status: hop.status,
      details: hop.body,
      durationMs: Date.now() - startedAt,
    });
    return {
      status: hop.status,
      finalUrl: hop.finalUrl,
      contentType: hop.contentType,
      html: hop.body,
    };
  } catch (err) {
    await writeExternalRequestLog({
      logging: options.logging,
      url,
      method: 'GET',
      details: getExternalErrorDetails(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

function normalizeAllowedHost(host: string): string {
  return host.trim().toLowerCase();
}

/**
 * 构造「SSRF 校验 + 主机白名单」的组合校验器。
 *
 * 关键点：白名单必须作用在**每一跳**上，而不是只校验首个 URL。
 * `fetchTextWithValidatedRedirects` 会把同一组 headers（含 Authorization）
 * 带到重定向后的地址，若不逐跳校验主机，一次跨站重定向就会把凭据送给第三方。
 */
function buildJsonSafeUrlChecker(
  baseChecker: SafeUrlChecker,
  allowedHosts: string[] | undefined,
): SafeUrlChecker {
  if (!allowedHosts || allowedHosts.length === 0) {
    return baseChecker;
  }

  const allowList = new Set(allowedHosts.map(normalizeAllowedHost));

  return async (candidate: string) => {
    let host: string;
    try {
      host = new URL(candidate).host.toLowerCase();
    } catch {
      return false;
    }

    if (!allowList.has(host)) {
      return false;
    }

    return baseChecker(candidate);
  };
}

/**
 * 拉取外部 JSON 接口。
 *
 * 与 `fetchRssXml` / `fetchHtml` 共用同一条安全管线：
 * `isSafeExternalUrl` 逐跳 SSRF 校验 + 手动重定向 + 响应体大小限制 + `system_logs` 外部请求日志。
 *
 * 安全约定：
 * - `options.headers` 里的 Authorization **不会**出现在任何日志或异常信息中；
 *   本模块只记录 URL / method / status / durationMs / 响应体片段。
 * - 传 `allowedHosts` 可叠加主机白名单（GitHub 场景由 `GITHUB_API_BASE_URL` 派生）。
 * - 命中 SSRF 拦截或白名单拦截时抛 `Error('Unsafe URL')`。
 *
 * POST 扩展（OAuth token 交换用，见 arch ADR-04）：
 * - `method: 'POST'` + `form` 自动编码为 `application/x-www-form-urlencoded`；
 *   需要 JSON 体时改用 `body` 并自行在 `headers` 里声明 content-type。
 * - 携带 `client_secret` 的 POST 必须显式传 `maxRedirects: 0`：
 *   重定向会把同一组 header/body 带去下一跳，跨站重定向即凭据泄漏。
 * - `redactResponseBody: true` 时错误响应体不进 `system_logs.details`。
 *
 * 非 2xx 不抛错，交由调用方按 status 分流（GitHub 需要区分 304/401/403/404）。
 */
export async function fetchExternalJson<T = unknown>(
  url: string,
  options: {
    timeoutMs: number;
    userAgent: string;
    headers?: Record<string, string>;
    accept?: string;
    maxBytes?: number;
    maxRedirects?: number;
    isSafeUrl?: SafeUrlChecker;
    allowedHosts?: string[];
    logging?: ExternalRequestLogging;
    /** 默认 `GET`；不传时行为与扩展前完全一致。 */
    method?: ExternalRequestMethod;
    /** 表单体，自动序列化为 `application/x-www-form-urlencoded`。与 `body` 互斥。 */
    form?: Record<string, string>;
    /** 原始请求体（如 JSON 字符串）。content-type 需自行通过 `headers` 指定。 */
    body?: string;
    /** 非 2xx 时把响应体从日志中抹去，写 `[redacted]`。 */
    redactResponseBody?: boolean;
  },
): Promise<FetchExternalJsonResult<T>> {
  const startedAt = Date.now();
  const method: ExternalRequestMethod = options.method ?? 'GET';

  try {
    const formBody =
      options.form === undefined
        ? undefined
        : new URLSearchParams(options.form).toString();
    const headers: Record<string, string> = {
      accept: options.accept ?? 'application/json',
      'user-agent': options.userAgent,
      ...(formBody === undefined
        ? {}
        : { 'content-type': 'application/x-www-form-urlencoded' }),
      ...options.headers,
    };
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const isSafeUrl = buildJsonSafeUrlChecker(
      options.isSafeUrl ?? isSafeExternalUrl,
      options.allowedHosts,
    );

    const hop = await fetchTextWithValidatedRedirects(url, {
      timeoutMs: options.timeoutMs,
      headers,
      maxBytes,
      maxRedirects,
      isSafeUrl,
      method,
      body: formBody ?? options.body,
    });

    let json: T | null = null;
    let jsonParseError: string | null = null;
    const trimmedBody = hop.body.trim();

    if (trimmedBody.length > 0) {
      try {
        json = JSON.parse(trimmedBody) as T;
      } catch (err) {
        jsonParseError = err instanceof Error ? err.message : 'Invalid JSON response';
      }
    }

    await writeExternalRequestLog({
      logging: options.logging,
      url: hop.finalUrl,
      method,
      status: hop.status,
      details: hop.body,
      durationMs: Date.now() - startedAt,
      redactResponseBody: options.redactResponseBody,
    });

    return {
      status: hop.status,
      finalUrl: hop.finalUrl,
      contentType: hop.contentType,
      headers: hop.headers,
      json,
      rawBody: hop.body,
      jsonParseError,
    };
  } catch (err) {
    // 传输层错误只记录错误文案（不含响应体），无需按 redactResponseBody 再抹一次。
    await writeExternalRequestLog({
      logging: options.logging,
      url,
      method,
      details: getExternalErrorDetails(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

export type FetchImageStreamResult =
  | FetchImageStreamOkResult
  | { kind: 'forbidden' }
  | { kind: 'too_many_redirects' }
  | { kind: 'bad_gateway' }
  | { kind: 'unsupported_media_type' };

type FetchImageStreamOkResult = {
  kind: 'ok';
  status: number;
  contentType: string | null;
  cacheControl: string;
  contentEncoding: string | null;
  contentLength: string | null;
  etag: string | null;
  lastModified: string | null;
  body: ReadableStream<Uint8Array>;
};

type FetchImageStreamHopResult =
  | { kind: 'redirect'; nextUrl: string }
  | FetchImageStreamOkResult
  | { kind: 'bad_gateway' }
  | { kind: 'unsupported_media_type' };

function isImageContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().startsWith('image/') ?? false;
}

function buildFetchImageStreamOkResult(input: {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: ReadableStream<Uint8Array>;
}): FetchImageStreamOkResult {
  return {
    kind: 'ok',
    status: input.status,
    contentType: getHeaderValue(input.headers['content-type']),
    cacheControl: getHeaderValue(input.headers['cache-control']) ?? 'public, max-age=3600',
    contentEncoding: getHeaderValue(input.headers['content-encoding']),
    contentLength: getHeaderValue(input.headers['content-length']),
    etag: getHeaderValue(input.headers.etag),
    lastModified: getHeaderValue(input.headers['last-modified']),
    body: input.body,
  };
}

async function fetchImageStreamHop(
  url: string,
  options: { userAgent: string; timeoutMs: number },
): Promise<FetchImageStreamHopResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const sourceUrl = new URL(url);
    const req = client.stream(url, {
      method: 'GET',
      followRedirect: false,
      headers: {
        'user-agent': options.userAgent,
        accept: 'image/*,*/*;q=0.8',
        referer: `${sourceUrl.origin}/`,
      },
      decompress: false,
      signal: controller.signal,
    });

    return await new Promise<FetchImageStreamHopResult>((resolve) => {
      let settled = false;
      const cleanup = () => clearTimeout(timeout);
      const safeResolve = (value: FetchImageStreamHopResult) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      req.on('close', cleanup);
      req.on('error', () => {
        cleanup();
        safeResolve({ kind: 'bad_gateway' });
      });

      req.on('response', (res) => {
        const status = res.statusCode;

        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = getHeaderValue(res.headers.location);
          if (!location) {
            cleanup();
            safeResolve({ kind: 'bad_gateway' });
            req.destroy();
            return;
          }

          const nextUrl = new URL(location, url).toString();
          cleanup();
          safeResolve({ kind: 'redirect', nextUrl });
          req.destroy();
          return;
        }

        const contentType = getHeaderValue(res.headers['content-type']);
        if (status >= 200 && status < 300 && !isImageContentType(contentType)) {
          cleanup();
          safeResolve({ kind: 'unsupported_media_type' });
          req.destroy();
          return;
        }

        safeResolve(buildFetchImageStreamOkResult({
          status,
          headers: res.headers,
          body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
        }));
      });
    });
  } catch {
    clearTimeout(timeout);
    return { kind: 'bad_gateway' };
  }
}

export async function fetchImageStream(
  url: string,
  options: {
    maxRedirects: number;
    userAgent: string;
    timeoutMs?: number;
  },
): Promise<FetchImageStreamResult> {
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    if (!(await isSafeMediaUrl(currentUrl))) {
      return { kind: 'forbidden' };
    }

    const hop = await fetchImageStreamHop(currentUrl, {
      userAgent: options.userAgent,
      timeoutMs: options.timeoutMs ?? 10_000,
    });

    if (hop.kind === 'redirect') {
      if (redirects >= options.maxRedirects) {
        return { kind: 'too_many_redirects' };
      }

      redirects += 1;
      currentUrl = hop.nextUrl;
      continue;
    }

    if (hop.kind === 'ok') return hop;
    return hop;
  }
}

/**
 * OAuth 出网统一封装（见 docs/arch-oauth-hub.md §7.4 / 安全红线 6·7·3）。
 *
 * 所有 provider 适配器**必须**经由此文件出网，禁止裸 `fetch`：
 * - 复用 `fetchExternalJson` 的逐跳 SSRF 校验；
 * - 强制 `allowedHosts` 白名单（由 provider 常量派生，用户输入无法影响）；
 * - 强制 `redactResponseBody: true`，非 2xx 响应体绝不落进 `system_logs`；
 * - 携带 secret 的 POST 强制 `maxRedirects: 0`，杜绝跨站重定向泄漏。
 */

import { fetchExternalJson } from '@/server/infra/http/externalHttpClient';

import { OAuthError, normalizeOAuthError, type OAuthErrorKind } from './oauthErrors';
import type {
  OAuthProviderDefinition,
  OAuthTokenBundle,
  OAuthTokenRequest,
} from './oauthProviderTypes';

/** OAuth 出网超时。token 端点普遍很快，15s 足够且不至于拖死请求。 */
export const OAUTH_HTTP_TIMEOUT_MS = 15_000;

export const OAUTH_USER_AGENT = 'FeedFuse/0.4';

/** 响应体上限：token/profile 响应都很小，1MB 足够且能挡住异常大包。 */
const OAUTH_MAX_RESPONSE_BYTES = 1024 * 1024;

/** 请求用途，决定失败时归一到哪个错误类型。 */
export type OAuthRequestPurpose = 'token_exchange' | 'refresh' | 'profile';

const PURPOSE_FAILURE_KIND: Record<OAuthRequestPurpose, OAuthErrorKind> = {
  token_exchange: 'token_exchange_failed',
  refresh: 'refresh_failed',
  profile: 'provider_error',
};

/**
 * 把 `OAuthTokenRequest` 编译成 `fetchExternalJson` 的入参。
 * 三种 `bodyKind` 覆盖四家平台的全部编码差异。
 */
function compileTokenRequest(request: OAuthTokenRequest): {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  form?: Record<string, string>;
  body?: string;
} {
  if (request.bodyKind === 'query') {
    const url = new URL(request.url);
    for (const [key, value] of Object.entries(request.form)) {
      url.searchParams.set(key, value);
    }
    return { url: url.toString(), method: request.method, headers: request.headers };
  }

  if (request.bodyKind === 'json') {
    return {
      url: request.url,
      method: request.method,
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.form),
    };
  }

  return {
    url: request.url,
    method: request.method,
    headers: request.headers,
    form: request.form,
  };
}

export interface OAuthJsonRequestInput {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  form?: Record<string, string>;
  body?: string;
  allowedHosts: string[];
  purpose: OAuthRequestPurpose;
  provider: string;
}

/**
 * 发起一次 OAuth 出网 JSON 请求并返回已解析的响应体。
 *
 * @throws {OAuthError} 网络异常 → `network`；非 2xx / JSON 解析失败 → 按 `purpose` 归一。
 */
export async function requestOAuthJson<T = unknown>(input: OAuthJsonRequestInput): Promise<T> {
  const failureKind = PURPOSE_FAILURE_KIND[input.purpose];

  let result: Awaited<ReturnType<typeof fetchExternalJson<T>>>;
  try {
    result = await fetchExternalJson<T>(input.url, {
      timeoutMs: OAUTH_HTTP_TIMEOUT_MS,
      userAgent: OAUTH_USER_AGENT,
      accept: 'application/json',
      maxBytes: OAUTH_MAX_RESPONSE_BYTES,
      // 安全红线 7：携带 secret 的请求一律不跟随重定向。
      maxRedirects: 0,
      allowedHosts: input.allowedHosts,
      method: input.method,
      // 安全红线 3：响应体永不落日志。
      redactResponseBody: true,
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      ...(input.form === undefined ? {} : { form: input.form }),
      ...(input.body === undefined ? {} : { body: input.body }),
      logging: {
        source: `server/oauth/${input.purpose}`,
        requestLabel: `OAuth ${input.purpose}`,
        context: { provider: input.provider },
        redactResponseBody: true,
      },
    });
  } catch (err) {
    // 传输层失败（超时 / DNS / SSRF 拦截 / 重定向被拒）统一归一为 network。
    throw normalizeOAuthError(err, 'network');
  }

  if (result.status < 200 || result.status >= 300) {
    throw new OAuthError(failureKind, {
      provider: input.provider,
      // 只带状态码，绝不带响应体（可能含凭据）。
      debugHint: `HTTP ${result.status}`,
    });
  }

  if (result.json === null) {
    throw new OAuthError(failureKind, {
      provider: input.provider,
      debugHint: result.jsonParseError ?? 'empty response body',
    });
  }

  return result.json;
}

export interface RequestTokenInput {
  provider: OAuthProviderDefinition;
  request: OAuthTokenRequest;
  purpose: Extract<OAuthRequestPurpose, 'token_exchange' | 'refresh'>;
}

/**
 * 执行 token 交换 / 刷新，并交给适配器解析。
 *
 * 注意：`parseTokenResponse` 负责判定**平台业务错误**（HTTP 200 也可能是失败），
 * 因此解析步骤不能省略，也不能在本文件里用通用逻辑替代。
 */
export async function requestToken(input: RequestTokenInput): Promise<OAuthTokenBundle> {
  const compiled = compileTokenRequest(input.request);

  const raw = await requestOAuthJson<unknown>({
    url: compiled.url,
    method: compiled.method,
    headers: compiled.headers,
    ...(compiled.form === undefined ? {} : { form: compiled.form }),
    ...(compiled.body === undefined ? {} : { body: compiled.body }),
    allowedHosts: input.provider.allowedHosts,
    purpose: input.purpose,
    provider: input.provider.id,
  });

  try {
    return input.provider.parseTokenResponse(raw);
  } catch (err) {
    throw normalizeOAuthError(err, 'provider_error');
  }
}

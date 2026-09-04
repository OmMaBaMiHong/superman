/**
 * 抖音开放平台适配器。
 *
 * 依据：抖音开放平台《获取 access_token》《刷新 access_token》。
 *
 * 平台怪癖（AQ-4 已查证）：
 * 1. 参数名是 **`client_key`**，不是 `client_id`；
 * 2. 响应体是 `{ data: {...}, message }` 的**嵌套结构**；
 * 3. 以 **`data.error_code !== 0`** 判定失败，HTTP 200 不等于成功。
 *
 * `supportsPkce` 保守取 `false`：官方文档未给出 PKCE 参数说明。
 * 未来确认支持后**只改这一个布尔常量**，流程层代码不得改动（架构文档明确指令）。
 */

import { OAuthError } from '../oauthErrors';
import { requestOAuthJson } from '../oauthHttp';
import type {
  BuildAuthorizeUrlInput,
  BuildRefreshRequestInput,
  BuildTokenRequestInput,
  FetchProfileInput,
  OAuthProfile,
  OAuthProviderDefinition,
  OAuthTokenBundle,
  OAuthTokenRequest,
} from '../oauthProviderTypes';
import { joinScopes, readNumber, readObject, readString } from './providerUtils';

// ADR-07：端点为代码常量。
const AUTHORIZE_ENDPOINT = 'https://open.douyin.com/platform/oauth/connect/';
const TOKEN_ENDPOINT = 'https://open.douyin.com/oauth/access_token/';
const REFRESH_ENDPOINT = 'https://open.douyin.com/oauth/refresh_token/';
const USER_INFO_ENDPOINT = 'https://open.douyin.com/oauth/userinfo/';

const ALLOWED_HOSTS = ['open.douyin.com'];

/**
 * 解出 `data` 节点并校验 `error_code`。
 * 抖音成功时 `error_code` 为 0 或缺省。
 */
function unwrapDouyinData(raw: unknown, fallbackProvider: string): unknown {
  const data = readObject(raw, 'data');
  const payload = data ?? raw;

  const errorCode = readNumber(payload, 'error_code');
  if (errorCode !== null && errorCode !== 0) {
    throw new OAuthError('provider_error', {
      provider: fallbackProvider,
      debugHint:
        `error_code=${errorCode} description=${readString(payload, 'description') ?? ''}`.trim(),
    });
  }

  return payload;
}

export const douyinProvider: OAuthProviderDefinition = {
  id: 'douyin',
  displayName: '抖音',
  capabilities: {
    supportsPkce: false,
    supportsRefresh: true,
    supportsRemoteRevoke: false,
    requiresExactRedirectUri: false,
  },

  authorizeEndpoint: AUTHORIZE_ENDPOINT,
  tokenEndpoint: TOKEN_ENDPOINT,
  refreshEndpoint: REFRESH_ENDPOINT,
  userInfoEndpoint: USER_INFO_ENDPOINT,
  allowedHosts: ALLOWED_HOSTS,
  defaultScopes: ['user_info'],

  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    const url = new URL(AUTHORIZE_ENDPOINT);
    // 平台怪癖 1：client_key 而非 client_id。
    url.searchParams.set('client_key', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', joinScopes(input.scopes, ','));
    url.searchParams.set('state', input.state);
    return url.toString();
  },

  buildTokenRequest(input: BuildTokenRequestInput): OAuthTokenRequest {
    return {
      url: TOKEN_ENDPOINT,
      method: 'POST',
      headers: { accept: 'application/json' },
      form: {
        client_key: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        grant_type: 'authorization_code',
      },
      bodyKind: 'form-urlencoded',
    };
  },

  buildRefreshRequest(input: BuildRefreshRequestInput): OAuthTokenRequest {
    return {
      url: REFRESH_ENDPOINT,
      method: 'POST',
      headers: { accept: 'application/json' },
      form: {
        client_key: input.clientId,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      },
      bodyKind: 'form-urlencoded',
    };
  },

  parseTokenResponse(raw: unknown): OAuthTokenBundle {
    const data = unwrapDouyinData(raw, 'douyin');

    const accessToken = readString(data, 'access_token');
    if (accessToken === null) {
      throw new OAuthError('token_exchange_failed', {
        provider: 'douyin',
        debugHint: 'access_token missing in data node',
      });
    }

    return {
      accessToken,
      refreshToken: readString(data, 'refresh_token'),
      tokenType: 'Bearer',
      scope: readString(data, 'scope'),
      expiresIn: readNumber(data, 'expires_in'),
      refreshExpiresIn: readNumber(data, 'refresh_expires_in'),
      providerAccountId: readString(data, 'open_id'),
    };
  },

  async fetchProfile(input: FetchProfileInput): Promise<OAuthProfile | null> {
    if (input.providerAccountId === null) {
      return null;
    }

    const raw = await requestOAuthJson<unknown>({
      url: USER_INFO_ENDPOINT,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'access-token': input.accessToken,
      },
      form: {
        open_id: input.providerAccountId,
        access_token: input.accessToken,
      },
      allowedHosts: ALLOWED_HOSTS,
      purpose: 'profile',
      provider: 'douyin',
    });

    const data = unwrapDouyinData(raw, 'douyin');
    const providerAccountId =
      readString(data, 'union_id') ?? readString(data, 'open_id') ?? input.providerAccountId;

    return {
      providerAccountId,
      displayName: readString(data, 'nickname'),
      avatarUrl: readString(data, 'avatar'),
    };
  },
};

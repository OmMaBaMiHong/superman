/**
 * 小红书开放平台适配器（标准 OAuth 2.0 形态占位实现）。
 *
 * 现状（AQ-4 / §8 待明确事项 U-2）：小红书开放平台需企业资质，公开文档不可得。
 * 因此本适配器**按 OAuth 2.0 标准形态实现**，并把端点与参数名全部集中为文件顶部常量，
 * 待拿到正式文档后只需校准这些常量与 `parseTokenResponse` 的错误判定即可，
 * 无需改动流程层任何代码。
 *
 * 在拿到正式文档前，本机的默认表现是「未配置」引导态
 * （`clientId` 为空 → `OAuthError('not_configured')`），符合 AQ-3 验收口径。
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
import { joinScopes, readNumber, readString } from './providerUtils';

// ADR-07：端点为代码常量。以下为标准形态推定值，待正式文档校准（U-2）。
const AUTHORIZE_ENDPOINT = 'https://open.xiaohongshu.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://open.xiaohongshu.com/oauth/token';
const REFRESH_ENDPOINT = 'https://open.xiaohongshu.com/oauth/token';
const USER_INFO_ENDPOINT = 'https://open.xiaohongshu.com/oauth/userinfo';

const ALLOWED_HOSTS = ['open.xiaohongshu.com'];

/**
 * 兼容两种常见的国内平台错误约定：
 * - RFC 6749 标准的 `{error, error_description}`；
 * - 国内常见的 `{code, message}`（code 非 0 即失败）。
 */
function assertNoXiaohongshuError(raw: unknown): void {
  const error = readString(raw, 'error');
  if (error !== null) {
    throw new OAuthError('provider_error', {
      provider: 'xiaohongshu',
      debugHint: `${error}: ${readString(raw, 'error_description') ?? ''}`.trim(),
    });
  }

  const code = readNumber(raw, 'code');
  if (code !== null && code !== 0) {
    throw new OAuthError('provider_error', {
      provider: 'xiaohongshu',
      debugHint: `code=${code} message=${readString(raw, 'message') ?? ''}`.trim(),
    });
  }
}

export const xiaohongshuProvider: OAuthProviderDefinition = {
  id: 'xiaohongshu',
  displayName: '小红书',
  capabilities: {
    // 保守默认，待文档确认。
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
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', joinScopes(input.scopes));
    url.searchParams.set('state', input.state);
    return url.toString();
  },

  buildTokenRequest(input: BuildTokenRequestInput): OAuthTokenRequest {
    return {
      url: TOKEN_ENDPOINT,
      method: 'POST',
      headers: { accept: 'application/json' },
      form: {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
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
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      },
      bodyKind: 'form-urlencoded',
    };
  },

  parseTokenResponse(raw: unknown): OAuthTokenBundle {
    assertNoXiaohongshuError(raw);

    const accessToken = readString(raw, 'access_token');
    if (accessToken === null) {
      throw new OAuthError('token_exchange_failed', {
        provider: 'xiaohongshu',
        debugHint: 'access_token missing in response',
      });
    }

    return {
      accessToken,
      refreshToken: readString(raw, 'refresh_token'),
      tokenType: readString(raw, 'token_type') ?? 'Bearer',
      scope: readString(raw, 'scope'),
      expiresIn: readNumber(raw, 'expires_in'),
      refreshExpiresIn: readNumber(raw, 'refresh_token_expires_in'),
      providerAccountId: readString(raw, 'open_id') ?? readString(raw, 'user_id'),
    };
  },

  async fetchProfile(input: FetchProfileInput): Promise<OAuthProfile | null> {
    const raw = await requestOAuthJson<unknown>({
      url: USER_INFO_ENDPOINT,
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${input.accessToken}`,
      },
      allowedHosts: ALLOWED_HOSTS,
      purpose: 'profile',
      provider: 'xiaohongshu',
    });

    assertNoXiaohongshuError(raw);

    const providerAccountId =
      readString(raw, 'open_id') ?? readString(raw, 'user_id') ?? input.providerAccountId;
    if (providerAccountId === null) {
      return null;
    }

    return {
      providerAccountId,
      displayName: readString(raw, 'nickname') ?? readString(raw, 'name'),
      avatarUrl: readString(raw, 'avatar') ?? readString(raw, 'avatar_url'),
    };
  },
};

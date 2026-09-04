/**
 * GitHub OAuth 适配器。
 *
 * 依据：
 * - Authorizing OAuth apps（authorize / access_token 端点与参数名）
 * - Changelog《PKCE support for OAuth and GitHub App authentication》(2025-07-14)：
 *   `code_challenge` + `code_challenge_method`，**仅接受 S256**。
 *
 * 平台怪癖：
 * - `POST /login/oauth/access_token` 默认返回 `application/x-www-form-urlencoded`，
 *   必须显式 `Accept: application/json` 才给 JSON。
 * - 失败时可能返回 **HTTP 200 + `{error, error_description}`**，故 `parseTokenResponse` 必须判 `error`。
 */

import { OAuthError } from '../oauthErrors';
import { requestOAuthJson } from '../oauthHttp';
import type {
  BuildAuthorizeUrlInput,
  BuildTokenRequestInput,
  FetchProfileInput,
  OAuthProfile,
  OAuthProviderDefinition,
  OAuthTokenBundle,
  OAuthTokenRequest,
} from '../oauthProviderTypes';
import { joinScopes, readNumber, readString } from './providerUtils';

// ADR-07：端点为代码常量，不可由配置注入。
const AUTHORIZE_ENDPOINT = 'https://github.com/login/oauth/authorize';
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const USER_INFO_ENDPOINT = 'https://api.github.com/user';

const ALLOWED_HOSTS = ['github.com', 'api.github.com'];

function assertNoTokenError(raw: unknown): void {
  const error = readString(raw, 'error');
  if (error !== null) {
    throw new OAuthError('provider_error', {
      provider: 'github',
      // error_description 由 GitHub 生成、不含凭据，可作为排障线索。
      debugHint: `${error}: ${readString(raw, 'error_description') ?? ''}`.trim(),
    });
  }
}

export const githubProvider: OAuthProviderDefinition = {
  id: 'github',
  displayName: 'GitHub',
  capabilities: {
    supportsPkce: true,
    // OAuth App 的 access_token 不过期且不下发 refresh_token（GitHub App 才有）。
    supportsRefresh: false,
    supportsRemoteRevoke: false,
    requiresExactRedirectUri: false,
  },

  authorizeEndpoint: AUTHORIZE_ENDPOINT,
  tokenEndpoint: TOKEN_ENDPOINT,
  refreshEndpoint: null,
  userInfoEndpoint: USER_INFO_ENDPOINT,
  allowedHosts: ALLOWED_HOSTS,
  defaultScopes: ['read:user'],

  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', joinScopes(input.scopes));
    if (input.codeChallenge !== null) {
      url.searchParams.set('code_challenge', input.codeChallenge);
      // 安全红线 5：只允许 S256。
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  },

  buildTokenRequest(input: BuildTokenRequestInput): OAuthTokenRequest {
    const form: Record<string, string> = {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    };
    if (input.codeVerifier !== null) {
      form.code_verifier = input.codeVerifier;
    }

    return {
      url: TOKEN_ENDPOINT,
      method: 'POST',
      // 不加这个头 GitHub 会返回 form-urlencoded，JSON 解析必失败。
      headers: { accept: 'application/json' },
      form,
      bodyKind: 'form-urlencoded',
    };
  },

  buildRefreshRequest(): OAuthTokenRequest | null {
    // OAuth App token 不过期，无刷新流程。capabilities.supportsRefresh 已声明 false。
    return null;
  },

  parseTokenResponse(raw: unknown): OAuthTokenBundle {
    assertNoTokenError(raw);

    const accessToken = readString(raw, 'access_token');
    if (accessToken === null) {
      throw new OAuthError('token_exchange_failed', {
        provider: 'github',
        debugHint: 'access_token missing in response',
      });
    }

    return {
      accessToken,
      refreshToken: readString(raw, 'refresh_token'),
      tokenType: readString(raw, 'token_type'),
      scope: readString(raw, 'scope'),
      expiresIn: readNumber(raw, 'expires_in'),
      refreshExpiresIn: readNumber(raw, 'refresh_token_expires_in'),
      providerAccountId: null,
    };
  },

  async fetchProfile(input: FetchProfileInput): Promise<OAuthProfile | null> {
    const raw = await requestOAuthJson<unknown>({
      url: USER_INFO_ENDPOINT,
      method: 'GET',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      allowedHosts: ALLOWED_HOSTS,
      purpose: 'profile',
      provider: 'github',
    });

    const providerAccountId = readString(raw, 'id') ?? input.providerAccountId;
    if (providerAccountId === null) {
      return null;
    }

    return {
      providerAccountId,
      displayName: readString(raw, 'name') ?? readString(raw, 'login'),
      avatarUrl: readString(raw, 'avatar_url'),
    };
  },
};

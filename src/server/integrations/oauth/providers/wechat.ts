/**
 * 微信开放平台「网站应用」扫码登录适配器。
 *
 * 依据：微信开放平台《网站应用微信登录开发指南》。
 *
 * 三处必须特殊处理的平台怪癖（AQ-4 已查证）：
 * 1. token 交换是 **GET**：`GET /sns/oauth2/access_token?appid=&secret=&code=&grant_type=`；
 * 2. 参数名是 `appid` / `secret`，**不是** `client_id` / `client_secret`；
 * 3. 失败时返回 **HTTP 200 + `{errcode, errmsg}`**，必须在 `parseTokenResponse` 里判。
 *
 * 另：authorize URL 的 `#wechat_redirect` fragment 必须在**最末尾**，
 * 因此本适配器覆写 `buildAuthorizeUrl` 手工拼装，而非依赖通用逻辑。
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

// ADR-07：端点为代码常量。
const AUTHORIZE_ENDPOINT = 'https://open.weixin.qq.com/connect/qrconnect';
const TOKEN_ENDPOINT = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const REFRESH_ENDPOINT = 'https://api.weixin.qq.com/sns/oauth2/refresh_token';
const USER_INFO_ENDPOINT = 'https://api.weixin.qq.com/sns/userinfo';

/** authorize 是浏览器跳转，不入白名单；服务端只访问 api.weixin.qq.com。 */
const ALLOWED_HOSTS = ['api.weixin.qq.com'];

const WECHAT_REDIRECT_FRAGMENT = '#wechat_redirect';

/**
 * 微信把业务错误塞在 HTTP 200 里，`errcode` 非 0 即失败。
 * 成功响应通常**不含** `errcode` 字段。
 */
function assertNoWechatError(raw: unknown): void {
  const errcode = readNumber(raw, 'errcode');
  if (errcode !== null && errcode !== 0) {
    throw new OAuthError('provider_error', {
      provider: 'wechat',
      // errmsg 由微信生成，是错误描述而非凭据。
      debugHint: `errcode=${errcode} errmsg=${readString(raw, 'errmsg') ?? ''}`.trim(),
    });
  }
}

export const wechatProvider: OAuthProviderDefinition = {
  id: 'wechat',
  displayName: '微信',
  capabilities: {
    // 官方文档为传统授权码流程，无 PKCE 参数。
    supportsPkce: false,
    supportsRefresh: true,
    supportsRemoteRevoke: false,
    // 微信后台的「授权回调域」为逐字节严格匹配，UI 需强提示。
    requiresExactRedirectUri: true,
  },

  authorizeEndpoint: AUTHORIZE_ENDPOINT,
  tokenEndpoint: TOKEN_ENDPOINT,
  refreshEndpoint: REFRESH_ENDPOINT,
  userInfoEndpoint: USER_INFO_ENDPOINT,
  allowedHosts: ALLOWED_HOSTS,
  defaultScopes: ['snsapi_login'],

  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    const url = new URL(AUTHORIZE_ENDPOINT);
    // 参数名差异：appid 而非 client_id。
    url.searchParams.set('appid', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', joinScopes(input.scopes, ','));
    url.searchParams.set('state', input.state);
    // supportsPkce=false，忽略 codeChallenge（流程层已不会传入）。

    // fragment 必须在最末尾，且不能被 URL 序列化重排，故手工追加。
    return `${url.toString()}${WECHAT_REDIRECT_FRAGMENT}`;
  },

  buildTokenRequest(input: BuildTokenRequestInput): OAuthTokenRequest {
    return {
      url: TOKEN_ENDPOINT,
      // 平台怪癖 1：GET 而非 POST。
      method: 'GET',
      headers: { accept: 'application/json' },
      form: {
        // 平台怪癖 2：appid / secret。
        appid: input.clientId,
        secret: input.clientSecret,
        code: input.code,
        grant_type: 'authorization_code',
      },
      bodyKind: 'query',
    };
  },

  buildRefreshRequest(input: BuildRefreshRequestInput): OAuthTokenRequest {
    return {
      url: REFRESH_ENDPOINT,
      method: 'GET',
      headers: { accept: 'application/json' },
      form: {
        appid: input.clientId,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      },
      bodyKind: 'query',
    };
  },

  parseTokenResponse(raw: unknown): OAuthTokenBundle {
    assertNoWechatError(raw);

    const accessToken = readString(raw, 'access_token');
    if (accessToken === null) {
      throw new OAuthError('token_exchange_failed', {
        provider: 'wechat',
        debugHint: 'access_token missing in response',
      });
    }

    return {
      accessToken,
      refreshToken: readString(raw, 'refresh_token'),
      tokenType: 'Bearer',
      scope: readString(raw, 'scope'),
      expiresIn: readNumber(raw, 'expires_in'),
      // 微信 refresh_token 固定 30 天，响应体不含该字段，显式声明避免误判为永久。
      refreshExpiresIn: 30 * 24 * 60 * 60,
      // unionid 优先（跨应用唯一），无则回落 openid。
      providerAccountId: readString(raw, 'unionid') ?? readString(raw, 'openid'),
    };
  },

  async fetchProfile(input: FetchProfileInput): Promise<OAuthProfile | null> {
    // 微信 userinfo 需要 openid，若 token 响应里没拿到就无法拉取，直接降级。
    if (input.providerAccountId === null) {
      return null;
    }

    const url = new URL(USER_INFO_ENDPOINT);
    url.searchParams.set('access_token', input.accessToken);
    url.searchParams.set('openid', input.providerAccountId);

    const raw = await requestOAuthJson<unknown>({
      url: url.toString(),
      method: 'GET',
      headers: { accept: 'application/json' },
      allowedHosts: ALLOWED_HOSTS,
      purpose: 'profile',
      provider: 'wechat',
    });

    assertNoWechatError(raw);

    const providerAccountId =
      readString(raw, 'unionid') ?? readString(raw, 'openid') ?? input.providerAccountId;

    return {
      providerAccountId,
      displayName: readString(raw, 'nickname'),
      avatarUrl: readString(raw, 'headimgurl'),
    };
  },
};

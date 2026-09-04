/**
 * Provider 抽象层的类型契约（见 docs/arch-oauth-hub.md §3.2）。
 *
 * 分层红线：本目录只放**平台差异**，不碰数据库、不碰 session。
 * 核心流程（authorize / callback / refresh）只依赖此处的接口，
 * 四家平台在 HTTP 方法、参数命名、成功判定上的全部差异都下沉到适配器里。
 */

/** 四家平台标识。新增平台时同步扩这里 + registry + DB CHECK。 */
export const OAUTH_PROVIDER_IDS = ['github', 'wechat', 'douyin', 'xiaohongshu'] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export function isOAuthProviderId(value: unknown): value is OAuthProviderId {
  return (
    typeof value === 'string' &&
    (OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/** AQ-4：平台能力开关。新增平台差异时优先在此扩字段，而非在流程里写 if。 */
export interface OAuthProviderCapabilities {
  /** 是否支持 PKCE。仅 GitHub 为 true；抖音/小红书保守默认 false。 */
  supportsPkce: boolean;
  /** 是否支持 refresh_token 续期。 */
  supportsRefresh: boolean;
  /** 是否支持平台侧远程撤销（R23，P2）。MVP 四家均为 false。 */
  supportsRemoteRevoke: boolean;
  /** redirect_uri 是否要求逐字节严格匹配（微信为 true，影响 UI 提示强度）。 */
  requiresExactRedirectUri: boolean;
}

/** token 请求描述。四家在方法与编码上不一致，故抽象为数据而非硬编码。 */
export interface OAuthTokenRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  /** 参数集合；GET 时序列化进 query，POST 时按 bodyKind 编码。 */
  form: Record<string, string>;
  bodyKind: 'query' | 'form-urlencoded' | 'json';
}

export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  /** 平台侧账号唯一标识，部分平台随 token 一起返回（微信 unionid、抖音 open_id）。 */
  providerAccountId: string | null;
}

export interface OAuthProfile {
  providerAccountId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface BuildAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  codeChallenge: string | null;
}

export interface BuildTokenRequestInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string | null;
}

export interface BuildRefreshRequestInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface FetchProfileInput {
  accessToken: string;
  providerAccountId: string | null;
}

export interface OAuthProviderDefinition {
  id: OAuthProviderId;
  displayName: string;
  capabilities: OAuthProviderCapabilities;

  /** 端点一律代码常量，禁止从 DB / 用户输入读取（ADR-07）。 */
  authorizeEndpoint: string;
  tokenEndpoint: string;
  refreshEndpoint: string | null;
  userInfoEndpoint: string | null;
  /** 需要服务端出网访问的主机白名单（authorize 是浏览器跳转，不计入）。 */
  allowedHosts: string[];
  defaultScopes: string[];

  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string;

  buildTokenRequest(input: BuildTokenRequestInput): OAuthTokenRequest;

  buildRefreshRequest(input: BuildRefreshRequestInput): OAuthTokenRequest | null;

  /** 必须在此判定平台业务错误（微信 errcode / 抖音 data.error_code），HTTP 200 不等于成功。 */
  parseTokenResponse(raw: unknown): OAuthTokenBundle;

  fetchProfile(input: FetchProfileInput): Promise<OAuthProfile | null>;
}

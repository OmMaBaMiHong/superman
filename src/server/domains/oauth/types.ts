/**
 * OAuth 领域内部类型（见 docs/arch-oauth-hub.md §3.1 / §3.3）。
 *
 * 分层约定：
 * - `*Row` 为仓储层的行映射，**可以**含密文字段（`*Encrypted`）。
 * - `*View` / `*Status` 为对外 DTO，**绝不含**任何 token / secret 明文或密文。
 * 两类类型严禁互相 `as` 强转，跨层必须显式映射。
 */

import type { OAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';

/** state TTL：10 分钟（ADR-04）。 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** 连接状态机。 */
export const OAUTH_CONNECTION_STATUSES = ['active', 'expired', 'revoked'] as const;
export type OAuthConnectionStatus = (typeof OAUTH_CONNECTION_STATUSES)[number];

export function isOAuthConnectionStatus(value: unknown): value is OAuthConnectionStatus {
  return (
    typeof value === 'string' &&
    (OAUTH_CONNECTION_STATUSES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// 仓储层行类型（含密文，仅服务端内部流转）
// ---------------------------------------------------------------------------

/** `oauth_provider_configs` 行映射。 */
export interface OAuthProviderConfigRow {
  provider: OAuthProviderId;
  clientId: string;
  /**
   * secretBox 密文（`v1:iv:tag:ct`），永不出网、永不进日志。
   * DDL 为 `not null default ''`，空串表示「尚未配置 secret」。
   */
  clientSecretEncrypted: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 写入配置的入参；`clientSecret` 为 `undefined` 表示保留原值。 */
export interface UpsertOAuthProviderConfigInput {
  provider: OAuthProviderId;
  clientId: string;
  /** 明文 secret，仓储层负责 seal 后落库。`undefined` = 保留原值。 */
  clientSecret?: string | undefined;
  enabled?: boolean;
}

/** 解密后的可用凭据，仅在单次请求内存活。 */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** `oauth_connections` 行映射。 */
export interface OAuthConnectionRow {
  id: string;
  userId: string;
  provider: OAuthProviderId;
  providerAccountId: string;
  /** 由 `profile_snapshot->>'displayName'` 展平而来，快照中严禁出现凭据。 */
  displayName: string | null;
  /** 由 `profile_snapshot->>'avatarUrl'` 展平而来。 */
  avatarUrl: string | null;
  /** secretBox 密文。 */
  accessTokenEncrypted: string;
  /** secretBox 密文；平台不支持续期时为 null。 */
  refreshTokenEncrypted: string | null;
  tokenType: string | null;
  scope: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  status: OAuthConnectionStatus;
  authorizedAt: Date;
  lastRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 新建 / 覆盖连接的入参（明文 token，由仓储层负责加密）。 */
export interface UpsertOAuthConnectionInput {
  userId: string;
  provider: OAuthProviderId;
  providerAccountId: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

/** 刷新成功后的局部更新入参。 */
export interface UpdateOAuthConnectionTokensInput {
  id: string;
  userId: string;
  accessToken: string;
  /** `null` 表示平台本次未下发新 refresh_token，保留原值由服务层决定。 */
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

/** `oauth_auth_states` 行映射。 */
export interface OAuthAuthStateRow {
  state: string;
  userId: string;
  provider: OAuthProviderId;
  /** secretBox 密文；provider 不支持 PKCE 时为 null。 */
  codeVerifierEncrypted: string | null;
  redirectUri: string;
  /** DDL 允许为空；消费时由服务层回落到 `DEFAULT_RETURN_TO`。 */
  returnTo: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** 创建临时态入参（明文 verifier，由仓储层负责加密）。 */
export interface CreateOAuthAuthStateInput {
  state: string;
  userId: string;
  provider: OAuthProviderId;
  codeVerifier: string | null;
  redirectUri: string;
  returnTo: string;
  expiresAt: Date;
}

/** `DELETE ... RETURNING` 原子消费后的结果（已解密 verifier）。 */
export interface ConsumedOAuthAuthState {
  state: string;
  userId: string;
  provider: OAuthProviderId;
  codeVerifier: string | null;
  redirectUri: string;
  returnTo: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// 对外 DTO（绝不含凭据）
// ---------------------------------------------------------------------------

export interface OAuthProviderConfigStatus {
  provider: OAuthProviderId;
  displayName: string;
  configured: boolean;
  /** 公开值，明文返回。 */
  clientId: string;
  /** 形如 "abcd****wxyz"，永不返回明文。 */
  maskedClientSecret: string | null;
  enabled: boolean;
  /** 服务端推导，供用户复制到平台后台（ADR-05）。 */
  redirectUri: string;
  supportsPkce: boolean;
  requiresExactRedirectUri: boolean;
}

export interface OAuthConnectionView {
  id: string;
  provider: OAuthProviderId;
  status: OAuthConnectionStatus;
  displayName: string | null;
  avatarUrl: string | null;
  /** ISO 8601 UTC。 */
  authorizedAt: string;
  accessTokenExpiresAt: string | null;
  canRefresh: boolean;
}

export interface OAuthAuthorizeResult {
  authorizeUrl: string;
}

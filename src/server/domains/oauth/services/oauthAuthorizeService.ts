/**
 * 授权发起服务（R02，见 docs/arch-oauth-hub.md §4.1）。
 *
 * 流程顺序是有讲究的，不要重排：
 * 1. 先解析凭据 —— 未配置的平台不产生任何 state 记录（避免垃圾行）；
 * 2. 推导 `redirect_uri` 并**随 state 一起落库**（ADR-05 的落点：
 *    回调换 token 时原样回传，杜绝两侧推导不一致）；
 * 3. PKCE 分支由 `capabilities.supportsPkce` 决定 —— 这是流程中
 *    **唯一**的平台差异判断点。若你发现需要在这里加第二个 `if (provider.id === ...)`，
 *    说明该差异应下沉到适配器，请回到 T02 修抽象层。
 */

import type { Pool, PoolClient } from 'pg';

import { insertAuthState } from '@/server/domains/oauth/repositories/oauthAuthStatesRepo';
import type { HeaderReader } from '@/server/domains/oauth/redirectUri';
import {
  DEFAULT_RETURN_TO,
  buildRedirectUri,
  sanitizeReturnTo,
} from '@/server/domains/oauth/redirectUri';
import { OAUTH_STATE_TTL_MS, type OAuthAuthorizeResult } from '@/server/domains/oauth/types';
import { resolveClientCredentials } from '@/server/domains/oauth/services/oauthConfigService';
import { seal } from '@/server/infra/crypto/secretBox';
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider';
import { requireProvider } from '@/server/integrations/oauth/oauthProviderRegistry';
import type { OAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';
import { createPkcePair, createState } from '@/server/integrations/oauth/pkce';

type DbClient = Pool | PoolClient;

export interface StartAuthorizationInput {
  userId: string;
  provider: OAuthProviderId;
  /** 前端传入的站内回跳路径，会被 `sanitizeReturnTo` 清洗。 */
  returnTo?: string | null;
  headers?: HeaderReader | null;
}

/**
 * 发起授权：生成 state/PKCE、落库、拼装授权 URL。
 *
 * @returns `{ authorizeUrl }`，前端拿到后自行 `location.assign`。
 * @throws {OAuthError} `not_configured` —— 平台凭据缺失或被禁用。
 */
export async function startAuthorization(
  db: DbClient,
  input: StartAuthorizationInput,
): Promise<OAuthAuthorizeResult> {
  const provider = requireProvider(input.provider);

  // 1. 未配置的平台直接抛，不产生 state 记录。
  const credentials = await resolveClientCredentials(db, input.provider);

  // 2. redirect_uri 推导后立即随 state 落库（ADR-05）。
  const redirectUri = buildRedirectUri(input.provider, input.headers);
  const returnTo = sanitizeReturnTo(input.returnTo, DEFAULT_RETURN_TO);
  const state = createState();

  // 3. 唯一的平台差异判断点。
  const pkce = provider.capabilities.supportsPkce ? createPkcePair() : null;

  let codeVerifierEncrypted: string | null = null;
  if (pkce !== null) {
    // code_verifier 泄漏即 PKCE 失效，必须加密落库（安全红线 1）。
    const key = await resolveSecretKey(db);
    codeVerifierEncrypted = seal(pkce.codeVerifier, key);
  }

  await insertAuthState(db, {
    state,
    userId: input.userId,
    provider: input.provider,
    codeVerifier: pkce?.codeVerifier ?? null,
    codeVerifierEncrypted,
    redirectUri,
    returnTo,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });

  const authorizeUrl = provider.buildAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri,
    state,
    scopes: provider.defaultScopes,
    codeChallenge: pkce?.codeChallenge ?? null,
  });

  return { authorizeUrl };
}

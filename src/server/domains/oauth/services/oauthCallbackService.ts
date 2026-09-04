/**
 * 平台回调服务（R03 + R04，见 docs/arch-oauth-hub.md §4.2）。
 *
 * 关键顺序（不要重排）：
 * 1. 平台 `error` 参数**优先**处理 —— 用户点取消时不走后续任何逻辑；
 * 2. `consumeAuthState` **原子消费** —— 重放必然落空；
 * 3. 三重校验：存在性 → TTL → 归属用户。任一不过即拒绝，且**不写入任何数据**；
 * 4. `redirect_uri` **取自 state 表**，不重新推导（ADR-05）；
 * 5. `parseTokenResponse` 判定平台业务错误 —— HTTP 200 不等于成功；
 * 6. profile 拉取失败**不阻断主流程**，降级为空快照（R21 是 P2）。
 */

import type { Pool, PoolClient } from 'pg';

import { consumeAuthState } from '@/server/domains/oauth/repositories/oauthAuthStatesRepo';
import { upsertConnection } from '@/server/domains/oauth/repositories/oauthConnectionsRepo';
import { DEFAULT_RETURN_TO } from '@/server/domains/oauth/redirectUri';
import { resolveClientCredentials } from '@/server/domains/oauth/services/oauthConfigService';
import type { ConsumedOAuthAuthState } from '@/server/domains/oauth/types';
import { isSealed, open as openSealed, seal } from '@/server/infra/crypto/secretBox';
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider';
import {
  OAuthError,
  mapProviderCallbackError,
  normalizeOAuthError,
} from '@/server/integrations/oauth/oauthErrors';
import { requestToken } from '@/server/integrations/oauth/oauthHttp';
import { requireProvider } from '@/server/integrations/oauth/oauthProviderRegistry';
import type {
  OAuthProfile,
  OAuthProviderId,
} from '@/server/integrations/oauth/oauthProviderTypes';

type DbClient = Pool | PoolClient;

export interface HandleCallbackInput {
  userId: string;
  provider: OAuthProviderId;
  /** 平台回调 query 中的 `code`。 */
  code?: string | null;
  /** 平台回调 query 中的 `state`。 */
  state?: string | null;
  /** 平台回调 query 中的 `error`（用户取消或平台报错时出现）。 */
  error?: string | null;
}

export interface HandleCallbackResult {
  provider: OAuthProviderId;
  connectionId: string;
  /** 从 state 表取出的站内回跳路径。 */
  returnTo: string;
}

/** 把 `expires_in`（秒）换算成绝对过期时刻。 */
function toExpiresAt(expiresInSeconds: number | null): Date | null {
  if (expiresInSeconds === null || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    return null;
  }
  return new Date(Date.now() + expiresInSeconds * 1000);
}

/**
 * 三重校验后的 state。
 *
 * 注意：无论校验是否通过，state 都已经被 `consumeAuthState` 销毁了——
 * 这是刻意为之，攻击者拿到一个 state 后无论怎么试都只有一次机会。
 */
async function consumeAndValidateState(
  db: DbClient,
  input: HandleCallbackInput,
): Promise<ConsumedOAuthAuthState> {
  const rawState = typeof input.state === 'string' ? input.state.trim() : '';
  if (rawState === '') {
    throw new OAuthError('invalid_state', { provider: input.provider });
  }

  // 原子消费：并发/重放时只有第一个请求能拿到行。
  const row = await consumeAuthState(db, rawState);

  // ① 存在性
  if (row === null) {
    throw new OAuthError('invalid_state', {
      provider: input.provider,
      debugHint: 'state not found or already consumed',
    });
  }

  // ② TTL
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new OAuthError('state_expired', { provider: input.provider });
  }

  // ③ 归属用户 + 平台一致性
  if (row.userId !== input.userId) {
    throw new OAuthError('invalid_state', {
      provider: input.provider,
      debugHint: 'state owner mismatch',
    });
  }
  if (row.provider !== input.provider) {
    throw new OAuthError('invalid_state', {
      provider: input.provider,
      debugHint: 'state provider mismatch',
    });
  }

  let codeVerifier: string | null = null;
  if (row.codeVerifierEncrypted !== null && row.codeVerifierEncrypted.trim() !== '') {
    // 存了值却不是密文 = 数据被篡改或写入路径出过 bug，一律**失败关闭**。
    // 绝不能静默当作「无 PKCE」继续换 token——那等于把降级攻击面留给对手。
    if (!isSealed(row.codeVerifierEncrypted)) {
      throw new OAuthError('invalid_state', {
        provider: input.provider,
        debugHint: 'code_verifier is not a sealed value',
      });
    }

    try {
      const key = await resolveSecretKey(db);
      codeVerifier = openSealed(row.codeVerifierEncrypted, key);
    } catch {
      // 密钥轮换导致解密失败：PKCE 无法完成，等同 state 失效。
      throw new OAuthError('invalid_state', {
        provider: input.provider,
        debugHint: 'code_verifier could not be decrypted',
      });
    }
  }

  return {
    state: row.state,
    userId: row.userId,
    provider: row.provider,
    codeVerifier,
    redirectUri: row.redirectUri,
    returnTo: row.returnTo ?? DEFAULT_RETURN_TO,
    expiresAt: row.expiresAt,
  };
}

/**
 * 处理平台回调：校验 state → 换 token → 加密落库。
 *
 * @throws {OAuthError} 各阶段失败的归一错误；路由层负责转成 302 + `reason`。
 */
export async function handleCallback(
  db: DbClient,
  input: HandleCallbackInput,
): Promise<HandleCallbackResult> {
  // 1. 平台 error 优先，且必须先于 state 消费之外的任何逻辑。
  //    仍然要消费 state（清理垃圾行），但用户取消不算安全事件。
  if (typeof input.error === 'string' && input.error.trim() !== '') {
    if (typeof input.state === 'string' && input.state.trim() !== '') {
      await consumeAuthState(db, input.state.trim());
    }
    throw new OAuthError(mapProviderCallbackError(input.error), { provider: input.provider });
  }

  // 2 + 3. 原子消费 + 三重校验。
  const authState = await consumeAndValidateState(db, input);

  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (code === '') {
    throw new OAuthError('token_exchange_failed', {
      provider: input.provider,
      debugHint: 'authorization code missing',
    });
  }

  const provider = requireProvider(input.provider);
  const credentials = await resolveClientCredentials(db, input.provider);

  // 4. redirect_uri 取自 state 表，不重新推导。
  // 5. requestToken 内部会调 parseTokenResponse 判定平台业务错误。
  const bundle = await requestToken({
    provider,
    purpose: 'token_exchange',
    request: provider.buildTokenRequest({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      code,
      redirectUri: authState.redirectUri,
      codeVerifier: authState.codeVerifier,
    }),
  });

  // 6. profile 拉取失败不阻断主流程。
  let profile: OAuthProfile | null = null;
  try {
    profile = await provider.fetchProfile({
      accessToken: bundle.accessToken,
      providerAccountId: bundle.providerAccountId,
    });
  } catch {
    profile = null;
  }

  const providerAccountId =
    profile?.providerAccountId ?? bundle.providerAccountId ?? `unknown:${input.provider}`;

  // 7. token 加密后 upsert（同 userId+provider 先删后插，天然覆盖 R14 重新授权）。
  const key = await resolveSecretKey(db);
  const connection = await upsertConnection(db, {
    userId: input.userId,
    provider: input.provider,
    providerAccountId,
    displayName: profile?.displayName ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    accessTokenEncrypted: seal(bundle.accessToken, key),
    refreshTokenEncrypted:
      bundle.refreshToken === null ? null : seal(bundle.refreshToken, key),
    tokenType: bundle.tokenType,
    scope: bundle.scope,
    accessTokenExpiresAt: toExpiresAt(bundle.expiresIn),
    refreshTokenExpiresAt: toExpiresAt(bundle.refreshExpiresIn),
  });

  return {
    provider: input.provider,
    connectionId: connection.id,
    returnTo: authState.returnTo,
  };
}

/**
 * 读取回调应回跳的 `returnTo`，用于**失败分支**构造 302。
 *
 * 失败时 state 往往已被消费或本就不存在，拿不到 returnTo，
 * 此处统一回落默认路径，避免路由层散落三处兜底逻辑。
 */
export function resolveCallbackReturnTo(result: HandleCallbackResult | null): string {
  return result?.returnTo ?? DEFAULT_RETURN_TO;
}

/** 把任意异常归一为 `OAuthError`，供路由层取 `kind` 拼 `reason`。 */
export function normalizeCallbackError(error: unknown): OAuthError {
  return normalizeOAuthError(error, 'provider_error');
}

/**
 * Chaos 用户身份服务（双身份标准：产品 Key + Chaos User ID，对齐榜天下）。
 *
 * 流程（与 bangtianxia-web app/routes/auth.tsx 同协议）：
 *   ①POST /api/v1/auth/oauth/product/start（产品 Key）→ authorizationUrl → 引导用户
 *     到中台用户中心授权；②授权回来带 handoff code → POST /api/v1/auth/oauth/exchange
 *     （产品 Key）→ { accessToken, refreshToken }；③后续用户轴调用带 Bearer accessToken，
 *     过期用 POST /api/v1/auth/refresh（X-Consumer-Key + refreshToken）换新对。
 *
 * 令牌对加密落 users 表（chaos_tokens_encrypted，secretBox 与其它凭据同密钥体系）；
 * accessToken 是 JWT，payload.sub 即中台用户 ID，绑定到 chaos_user_id。
 * 本服务只做 Superman 本地用户 ↔ Chaos 用户的绑定与令牌管理；订阅数据仍在本地。
 */
import type { Queryable } from '@/plugin/host/db'
import { resolveSecretKey } from '@/server/infra/crypto/secretKeyProvider'
import { open as openBox, seal } from '@/server/infra/crypto/secretBox'
import { PlatformError, platform } from './client'

export interface ChaosLinkedUser {
  chaosUserId: string
  linkedAt: string | null
}

async function saveTokens(db: Queryable, localUserId: string, chaosUserId: string, accessToken: string, refreshToken: string): Promise<void> {
  const key = await resolveSecretKey(db as never)
  const sealed = seal(JSON.stringify({ accessToken, refreshToken }), key)
  await db.query(
    `update users set chaos_user_id = $2, chaos_tokens_encrypted = $3, chaos_linked_at = now() where id = $1`,
    [localUserId, chaosUserId, sealed],
  )
}

/** 发起授权：返回中台用户中心的 authorizationUrl（前端整页跳转）。 */
export async function startChaosAuthorization(
  db: Queryable,
  returnTo: string,
): Promise<string> {
  const result = await platform<{ authorizationUrl: string }>('/api/v1/auth/oauth/product/start', {
    open: true,
    method: 'POST',
    body: { returnTo },
  }, db)
  if (typeof result.authorizationUrl !== 'string' || !result.authorizationUrl) {
    throw new PlatformError(502, 'invalid_response', '中台授权地址返回异常')
  }
  return result.authorizationUrl
}

/** 授权交接：handoff code 换令牌对并绑定到当前本地用户。 */
export async function exchangeChaosHandoff(db: Queryable, localUserId: string, code: string): Promise<ChaosLinkedUser> {
  const pair = await platform<{ accessToken?: string; refreshToken?: string }>('/api/v1/auth/oauth/exchange', {
    open: true,
    method: 'POST',
    body: { code },
  }, db)
  const accessToken = typeof pair.accessToken === 'string' ? pair.accessToken : ''
  const refreshToken = typeof pair.refreshToken === 'string' ? pair.refreshToken : ''
  if (!accessToken || !refreshToken) throw new PlatformError(502, 'invalid_response', '授权交接返回异常')
  // accessToken 是 JWT：payload.sub = 中台用户 ID
  let chaosUserId = ''
  try {
    const payloadPart = accessToken.split('.')[1]
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { sub?: string }
    chaosUserId = typeof payload.sub === 'string' ? payload.sub : ''
  } catch {
    chaosUserId = ''
  }
  if (!chaosUserId) throw new PlatformError(502, 'invalid_response', '授权令牌缺少用户身份')
  await saveTokens(db, localUserId, chaosUserId, accessToken, refreshToken)
  const linked = await linkedChaosUser(db, localUserId)
  return linked ?? { chaosUserId, linkedAt: new Date().toISOString() }
}

/** 读已绑定关系。 */
export async function linkedChaosUser(db: Queryable, localUserId: string): Promise<ChaosLinkedUser | null> {
  const { rows } = await db.query(
    `select chaos_user_id, chaos_linked_at from users where id = $1 and chaos_user_id is not null limit 1`,
    [localUserId],
  )
  const row = rows[0] as { chaos_user_id: string; chaos_linked_at: string | Date | null } | undefined
  if (!row) return null
  return {
    chaosUserId: row.chaos_user_id,
    linkedAt: row.chaos_linked_at instanceof Date ? row.chaos_linked_at.toISOString() : row.chaos_linked_at ?? null,
  }
}

async function loadTokenPair(db: Queryable, localUserId: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const { rows } = await db.query(
    `select chaos_tokens_encrypted from users where id = $1 and chaos_tokens_encrypted is not null limit 1`,
    [localUserId],
  )
  const sealed = (rows[0] as { chaos_tokens_encrypted?: string } | undefined)?.chaos_tokens_encrypted
  if (!sealed) return null
  try {
    const key = await resolveSecretKey(db as never)
    const parsed = JSON.parse(openBox(sealed, key)) as { accessToken?: string; refreshToken?: string }
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
  } catch {
    return null
  }
}

async function saveRefreshedPair(db: Queryable, localUserId: string, accessToken: string, refreshToken: string): Promise<void> {
  const linked = await linkedChaosUser(db, localUserId)
  if (!linked) return
  await saveTokens(db, localUserId, linked.chaosUserId, accessToken, refreshToken)
}

/**
 * 取当前用户的中台会话（用户轴调用用）：优先现值；失效（401）时用
 * /api/v1/auth/refresh（X-Consumer-Key + refreshToken，产品授权不重放）换新对重试一次。
 * 未绑定返回 null；绑定后中台不可用抛 PlatformError。
 */
export async function withChaosUserToken<T>(
  db: Queryable,
  localUserId: string,
  call: (userToken: string) => Promise<T>,
): Promise<T | null> {
  const pair = await loadTokenPair(db, localUserId)
  if (!pair) return null
  try {
    return await call(pair.accessToken)
  } catch (error) {
    if (!(error instanceof PlatformError) || error.status !== 401) throw error
  }
  const refreshed = await platform<{ accessToken?: string; refreshToken?: string }>('/api/v1/auth/refresh', {
    consumer: true,
    method: 'POST',
    body: { refreshToken: pair.refreshToken },
  }, db)
  const accessToken = typeof refreshed.accessToken === 'string' ? refreshed.accessToken : ''
  const refreshToken = typeof refreshed.refreshToken === 'string' ? refreshed.refreshToken : ''
  if (!accessToken || !refreshToken) throw new PlatformError(401, 'session', '中台会话已过期，请重新授权')
  await saveRefreshedPair(db, localUserId, accessToken, refreshToken)
  return call(accessToken)
}

/** 当前绑定的中台用户资料（/api/v1/auth/me）。 */
export async function readChaosMe(db: Queryable, localUserId: string): Promise<Record<string, unknown> | null> {
  const me = await withChaosUserToken(db, localUserId, (token) =>
    platform<{ item?: Record<string, unknown> }>('/api/v1/auth/me', { token, anonymousFallback: false }, db))
  const item = me ? asRecordOrNothing((me as { item?: unknown }).item ?? me) : null
  return item && typeof item.id === 'string' ? item : null
}

function asRecordOrNothing(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** 解除绑定：本地清空关联；中台侧会话撤销走 /api/v1/auth/logout（失败不阻塞本地解绑）。 */
export async function unlinkChaosUser(db: Queryable, localUserId: string): Promise<void> {
  const pair = await loadTokenPair(db, localUserId)
  if (pair) {
    await platform('/api/v1/auth/logout', {
      consumer: true,
      method: 'POST',
      token: pair.accessToken,
      body: { refreshToken: pair.refreshToken },
    }, db).catch(() => undefined)
  }
  await db.query(
    `update users set chaos_user_id = null, chaos_tokens_encrypted = null, chaos_linked_at = null where id = $1`,
    [localUserId],
  )
}

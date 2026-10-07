/**
 * Superman DSH 插件 · session 鉴权（K2 版：接 core 用户表）。
 *
 * 与 Next.js 版共用同一套令牌格式（core/auth/sessionToken）与签名密钥
 * （app_settings.auth_session_secret），但插件用自己的 cookie 名
 * `superman_session`（Path=/s），两套会话互不顶替。
 *
 * 登录校验链：users 表口令（scrypt，core/auth/password）→ 初始管理员
 * 环境变量兜底（SUPERMAN_DEV_PASSWORD，仅 id=1 且 password_hash 为空时，
 * 验证通过即持久化 hash，语义同 Next.js 的 AUTH_INITIAL_PASSWORD）。
 * 数据库未连接时退化为 K1 的硬编码 dev 登录（admin / SUPERMAN_DEV_PASSWORD /
 * 'superman-dev'），保证骨架可用。
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { findUserByUsername, getUserById, persistInitialAdminPassword, ensureHostUser } from '@/core/auth/usersRepo'
import { hashPassword, verifyPassword, verifyPlainPassword } from '@/core/auth/password'
import {
  createSessionToken,
  verifySessionToken,
  type ApiSession,
} from '@/core/auth/sessionToken'
import type { Queryable } from './db.js'

export const SESSION_COOKIE = 'superman_session'
const DEFAULT_TTL_SECONDS = 30 * 24 * 3600

/**
 * 会话令牌的请求头通道。
 *
 * 为什么必须有它：DSH 桌面客户端把整个界面装在 `dsh-app://app` 自定义协议下，
 * 主进程转发本地请求时会删掉页面自带的 `cookie`、用宿主自己的 cookie 顶替，
 * 并把响应里的 `set-cookie` 从白名单外剥掉（见 Electron 主进程
 * forwardWebRequest / WITHHELD_RESPONSE_HEADERS）。于是 cookie 会话在那种壳里
 * 根本立不住：登录返回 200，登录态却存不下来。请求头不在剔除之列、原样透传，
 * 所以令牌走 `Authorization: Bearer <token>`，cookie 通道继续服务浏览器/Next.js。
 */
export const SESSION_HEADER = 'authorization'

export interface Session extends ApiSession {
  /** 兼容 K1 形状：username 仅供展示。 */
  username?: string
  /** 仅 dev（无数据库）模式持有的服务端 token。 */
  token?: string
}

export interface Auth {
  /** 校验用户名口令，成功签发 session；失败返回 null。 */
  login(username: string, password: string): Promise<Session | null>
  /**
   * DSH 宿主身份换会话（免登录通道）：按宿主账号 ID 自动建号/绑定 users 表后
   * 签发与口令登录完全同构的 session。无数据库或身份无效返回 null。
   * 身份识别只在 plugin/host 层做（hostIdentity.ts），这里只认不感知宿主的结构化入参。
   */
  loginWithHostIdentity(identity: { dshAccountId: string; displayName: string | null }): Promise<Session | null>
  /** 为 session 签出令牌（DB 模式是 HMAC 令牌，dev 模式是内存令牌）。 */
  mintToken(session: Session): string
  /** 从请求头（Bearer）或 cookie 解析并校验 session（含 users 表状态复核）；无效返回 null。 */
  authenticate(req: Pick<IncomingMessage, 'headers'>): Promise<Session | null>
  /** 直接校验一枚令牌（媒体流路由的 ?access_token= 通道用，见 api.ts MEDIA_TOKEN_ROUTES）。 */
  authenticateToken(token: string): Promise<Session | null>
  /** 种会话 cookie，并把同一枚令牌返回给调用方（供请求体回传给 dsh-app:// 壳用）。 */
  issueCookie(res: ServerResponse, session: Session): string
  clearCookie(res: ServerResponse): void
  /** 无状态令牌无需服务端注销；保留接口形状。 */
  revoke(token: string): void
}

export interface AuthOptions {
  /** 数据库句柄；null 时退化 dev 模式。 */
  db: Queryable | null
  /** HMAC 密钥（app_settings.auth_session_secret）。 */
  secret: string
  sessionTtlSeconds?: number
  now?: () => number
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

/** 取出请求里的会话令牌：优先 `Authorization: Bearer <token>`，回退 `superman_session` cookie。 */
export function readRequestToken(req: Pick<IncomingMessage, 'headers'>): string {
  const rawHeader = req.headers[SESSION_HEADER]
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
  if (headerValue) {
    const matched = /^Bearer\s+(.+)$/iu.exec(headerValue.trim())
    const token = matched?.[1]?.trim()
    if (token) return token
  }
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  return cookie ? decodeURIComponent(cookie) : ''
}

export function createAuth(options: AuthOptions): Auth {
  const ttlSeconds = options.sessionTtlSeconds ?? DEFAULT_TTL_SECONDS
  const now = options.now ?? (() => Date.now())
  // 内存 dev 会话只在无数据库模式使用（token → session）。
  const devSessions = new Map<string, Session>()

  function mintToken(session: Session): string {
    if (!options.db) return session.token ?? ''
    return createSessionToken({
      secret: options.secret,
      userId: session.userId,
      role: session.role,
      sessionVersion: session.sessionVersion,
      nowMs: now(),
      maxAgeSeconds: ttlSeconds,
    })
  }

  async function loginWithDb(username: string, password: string): Promise<Session | null> {
    const db = options.db
    if (!db) return null
    const user = await findUserByUsername(db as never, username)
    if (!user || user.status !== 'active') return null

    if (user.passwordHash.trim()) {
      if (!verifyPassword(password, user.passwordHash)) return null
    } else {
      // 初始管理员兜底：仅 id=1 且尚未设口令时走环境变量，验证通过即落 hash。
      if (user.id !== '1') return null
      const envPassword = process.env.SUPERMAN_DEV_PASSWORD?.trim()
      if (!envPassword || !verifyPlainPassword(password, envPassword)) return null
      await persistInitialAdminPassword(db as never, {
        userId: user.id,
        passwordHash: hashPassword(password),
      })
    }
    return { userId: user.id, role: user.role, sessionVersion: user.sessionVersion, username: user.username }
  }

  function loginDevFallback(username: string, password: string): Session | null {
    const devPassword = process.env.SUPERMAN_DEV_PASSWORD || 'superman-dev'
    if (username !== 'admin' || password !== devPassword) return null
    const token = `dev-${randomBytes(18).toString('base64url')}`
    const session: Session = { userId: '1', role: 'admin', sessionVersion: 1, username: 'admin', token }
    devSessions.set(token, session)
    return session
  }

  async function authenticateToken(token: string): Promise<Session | null> {
    if (!token) return null

    if (options.db) {
      if (!options.secret.trim()) return null
      const payload = verifySessionToken({ token, secret: options.secret, nowMs: now() })
      if (!payload) return null
      const user = await getUserById(options.db as never, payload.userId)
      if (
        !user
        || user.status !== 'active'
        || user.role !== payload.role
        || user.sessionVersion !== payload.sessionVersion
      ) {
        return null
      }
      return { userId: user.id, role: user.role, sessionVersion: user.sessionVersion, username: user.username }
    }

    return devSessions.get(token) ?? null
  }

  return {
    async login(username, password) {
      if (options.db) {
        return loginWithDb(username, password)
      }
      const dev = loginDevFallback(username, password)
      return dev
    },
    async loginWithHostIdentity(identity) {
      const db = options.db
      if (!db || !identity.dshAccountId.trim()) return null
      const user = await ensureHostUser(db as never, {
        dshAccountId: identity.dshAccountId,
        displayName: identity.displayName,
      })
      if (!user || user.status !== 'active') return null
      return { userId: user.id, role: user.role, sessionVersion: user.sessionVersion, username: user.username }
    },
    async authenticate(req) {
      const token = readRequestToken(req)
      if (!token) return null
      return authenticateToken(token)
    },
    authenticateToken,
    mintToken(session) {
      return mintToken(session)
    },
    issueCookie(res, session) {
      const token = mintToken(session)
      res.setHeader(
        'set-cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/s; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}`,
      )
      return token
    },
    clearCookie(res) {
      res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/s; HttpOnly; SameSite=Lax; Max-Age=0`)
    },
    revoke(token) {
      devSessions.delete(token)
    },
  }
}

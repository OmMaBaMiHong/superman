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
import { findUserByUsername, getUserById, persistInitialAdminPassword } from '@/core/auth/usersRepo'
import { hashPassword, verifyPassword, verifyPlainPassword } from '@/core/auth/password'
import {
  createSessionToken,
  verifySessionToken,
  type ApiSession,
} from '@/core/auth/sessionToken'
import type { Queryable } from './db.js'

export const SESSION_COOKIE = 'superman_session'
const DEFAULT_TTL_SECONDS = 30 * 24 * 3600

export interface Session extends ApiSession {
  /** 兼容 K1 形状：username 仅供展示。 */
  username?: string
  /** 仅 dev（无数据库）模式持有的服务端 token。 */
  token?: string
}

export interface Auth {
  /** 校验用户名口令，成功签发 session；失败返回 null。 */
  login(username: string, password: string): Promise<Session | null>
  /** 从请求 cookie 解析并校验 session（含 users 表状态复核）；无效返回 null。 */
  authenticate(req: Pick<IncomingMessage, 'headers'>): Promise<Session | null>
  issueCookie(res: ServerResponse, session: Session): void
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

export function createAuth(options: AuthOptions): Auth {
  const ttlSeconds = options.sessionTtlSeconds ?? DEFAULT_TTL_SECONDS
  const now = options.now ?? (() => Date.now())
  // 内存 dev 会话只在无数据库模式使用（token → session）。
  const devSessions = new Map<string, Session>()

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

  return {
    async login(username, password) {
      if (options.db) {
        return loginWithDb(username, password)
      }
      const dev = loginDevFallback(username, password)
      return dev
    },
    async authenticate(req) {
      const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE]
      if (!raw) return null
      const token = decodeURIComponent(raw)

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
    },
    issueCookie(res, session) {
      const token = options.db
        ? createSessionToken({
            secret: options.secret,
            userId: session.userId,
            role: session.role,
            sessionVersion: session.sessionVersion,
            nowMs: now(),
            maxAgeSeconds: ttlSeconds,
          })
        : session.token ?? ''
      res.setHeader(
        'set-cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/s; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}`,
      )
    },
    clearCookie(res) {
      res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/s; HttpOnly; SameSite=Lax; Max-Age=0`)
    },
    revoke(token) {
      devSessions.delete(token)
    },
  }
}

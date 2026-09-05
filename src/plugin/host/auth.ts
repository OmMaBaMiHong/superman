/**
 * Superman DSH 插件 · 自有 session 鉴权骨架。
 *
 * DSH 的 webserver 不管应用鉴权（浏览器 token 围栏只护 /api 桥与前端 dist），
 * /s/* 公开面由本模块自己守。K1 只做硬编码 dev 登录：
 *   用户名 admin，密码取环境变量 SUPERMAN_DEV_PASSWORD，缺省 'superman-dev'。
 * TODO(K2): 接 src/core 用户表（现 Next.js 侧 users 域）做真正的口令校验，
 *           session 持久化到 Postgres，并加限流。
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const SESSION_COOKIE = 'superman_session'
const DEFAULT_TTL_MS = 7 * 24 * 3600_000

export interface Session {
  token: string
  username: string
  createdAt: number
}

export interface Auth {
  /** 校验用户名口令，成功则签发 session 并返回 token；失败返回 null。 */
  login(username: string, password: string): Session | null
  /** 从请求 cookie 解析 session；无效或过期返回 null。 */
  authenticate(req: Pick<IncomingMessage, 'headers'>): Session | null
  /** 把 session 写进响应 cookie。 */
  issueCookie(res: ServerResponse, session: Session): void
  /** 清除 session cookie（登出）。 */
  clearCookie(res: ServerResponse): void
  /** 主动失效一个 token。 */
  revoke(token: string): void
}

export interface AuthOptions {
  /** dev 登录用户名，缺省 admin。 */
  username?: string
  /** dev 登录密码，缺省读 SUPERMAN_DEV_PASSWORD，再缺省 'superman-dev'。 */
  password?: string
  sessionTtlMs?: number
  /** 注入时钟便于测试。 */
  now?: () => number
  /** 注入随机源便于测试。 */
  randomToken?: () => string
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

export function createAuth(options: AuthOptions = {}): Auth {
  const username = options.username || 'admin'
  const password = options.password || process.env.SUPERMAN_DEV_PASSWORD || 'superman-dev'
  const ttl = options.sessionTtlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? (() => Date.now())
  const randomToken = options.randomToken ?? (() => randomBytes(24).toString('base64url'))
  const sessions = new Map<string, Session>()

  return {
    login(user, pass) {
      if (user !== username || pass !== password) return null
      const session: Session = { token: randomToken(), username: user, createdAt: now() }
      sessions.set(session.token, session)
      return session
    },
    authenticate(req) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
      if (!token) return null
      const session = sessions.get(token)
      if (!session) return null
      if (now() - session.createdAt > ttl) {
        sessions.delete(token)
        return null
      }
      return session
    },
    issueCookie(res, session) {
      res.setHeader(
        'set-cookie',
        `${SESSION_COOKIE}=${session.token}; Path=/s; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}`,
      )
    },
    clearCookie(res) {
      res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/s; HttpOnly; Max-Age=0`)
    },
    revoke(token) {
      sessions.delete(token)
    },
  }
}

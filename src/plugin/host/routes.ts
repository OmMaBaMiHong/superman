/**
 * Superman DSH 插件 · HTTP 路由。
 *
 * 路由面（webserver 命名前缀路由，先于 SPA fallback 匹配，不受 DSH 浏览器
 * token 围栏影响——应用鉴权由 auth.ts 自己守）：
 *   /s/api/health        GET  公开，{ ok: true, name: 'superman' }
 *   /s/api/auth/login    POST dev 登录，签发 session cookie
 *   /s/api/auth/host-session POST DSH 宿主身份换会话（免登录；宿主不可用时 404）
 *   /s/api/auth/logout   POST 登出
 *   /s/api/auth/session  GET  当前 session 状态
 *   /s/api/heartbeat     GET  最近心跳（需登录；K1 验收数据库链路用）
 *   /s/app/*             GET  伺服移动/桌面共用 H5 静态产物
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Auth } from './auth.js'
import type { Queryable } from './db.js'
import { handleBusinessApi } from './api.js'
import { isDshLlmAvailable } from '@/server/integrations/ai/dshLlmBridge'

export const PLUGIN_NAME = 'superman'

/** cordis ctx 的最小结构（只声明本插件用到的形状，不 import dsh 包）。 */
export interface MinimalContext {
  inject(deps: string[], cb: (scope: never) => void): unknown
}

export interface RoutesDeps {
  auth: Auth
  /** 数据库句柄；未连接时为 null（健康检查仍可用）。 */
  readonly db: Queryable | null
  /** H5 静态产物根目录（绝对路径）。 */
  staticRoot: string
  pluginName?: string
  /** 自检清单：已翻译的业务 API（health 端点与 H5 页展示）。 */
  apiList?: readonly string[]
  /** 内部端点共享密钥（= auth_session_secret）；独立 worker 复用 DSH 模型时校验。 */
  internalToken?: string
  /**
   * DSH 宿主身份直通（免登录通道）：进程内读 deepseekAccount → 账号 ID/昵称。
   * 浏览器/Web 宿主未注入该依赖（或返回 null）时，auth/host-session 回 404，
   * H5 据此回落口令登录页。
   */
  hostIdentity?: () => Promise<{ dshAccountId: string; displayName: string | null } | null>
  /** 调度器热切换（P2e-5 服务面板）：设置页开关即时生效，免重启。 */
  schedulerControl?: { isRunning(): boolean; setRunning(enabled: boolean): void }
  /** 中转站模型桥状态（health 上报用：路由预配 + 凭据关联）。 */
  relayLlmState?: () => { provision: string; error: string | null; credentialLinked: boolean; settingsServiceSeen: boolean }
  /** 存储形态（health 上报用：pg / pglite + 连接串掩码或数据目录）。 */
  storageInfo?: () => { mode: string; detail: string }

  /** 项目根（透传给业务 API 的 keeper 重启脚本用）。 */
  projectRoot?: string
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(data.length) })
  res.end(data)
}

/** 读取 POST body 为 JSON（失败返回 {}）。 */
export function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>)
      } catch {
        resolvePromise({})
      }
    })
    req.on('error', () => resolvePromise({}))
  })
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** /s/api/* 处理器（prefix 路由，req.url 含完整路径）。 */
export function createApiHandler(deps: RoutesDeps) {
  const pluginName = deps.pluginName ?? PLUGIN_NAME
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const op = url.pathname.replace(/^\/s\/api\/?/, '') || 'health'

      if (req.method === 'POST' && op === 'auth/login') {
        const body = await readJsonBody(req)
        const session = await deps.auth.login(String(body.username ?? ''), String(body.password ?? ''))
        if (!session) return json(res, 401, { ok: false, error: '用户名或密码错误' })
        // 同一枚令牌既进 cookie，也回给页面存起来：dsh-app:// 壳里 cookie 到不了浏览器，
        // H5 只能靠这个 token 走 Authorization 头（见 host/auth.ts 的 SESSION_HEADER）。
        const token = deps.auth.issueCookie(res, session)
        return json(res, 200, { ok: true, username: session.username ?? session.userId, token })
      }
      if (req.method === 'POST' && op === 'auth/logout') {
        const session = await deps.auth.authenticate(req)
        if (session?.token) deps.auth.revoke(session.token)
        deps.auth.clearCookie(res)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && op === 'auth/host-session') {
        // 免登录：DSH 宿主已登录 DeepSeek 时凭宿主身份换会话。webServer 只在本机
        // 回环伺服（DSH webserver 前缀路由），能打到这里的调用方即可信；身份本身
        // 由 hostIdentity 在进程内读取，HTTP 层不携带也无法伪造。
        if (!deps.hostIdentity) return json(res, 404, { ok: false, error: '宿主身份通道未启用' })
        const identity = await deps.hostIdentity()
        if (!identity) return json(res, 404, { ok: false, error: 'DSH 宿主不可用或 DeepSeek 未登录' })
        if (!deps.db) return json(res, 503, { ok: false, error: '数据库未连接' })
        const session = await deps.auth.loginWithHostIdentity(identity)
        if (!session) return json(res, 401, { ok: false, error: '宿主会话签发失败' })
        // 与口令登录同构：同一枚令牌进 cookie 并回传页面（dsh-app:// 壳里只有头通道能用）。
        const token = deps.auth.issueCookie(res, session)
        return json(res, 200, { ok: true, username: session.username ?? session.userId, token })
      }

      // 内部端点（独立 worker 进程复用 DSH 模型）：用共享密钥鉴权，不走 session。
      if (req.method === 'POST' && op === 'internal/llm-complete') {
        const token = String(req.headers['x-superman-internal-token'] ?? '')
        if (!deps.internalToken || token !== deps.internalToken) {
          return json(res, 401, { ok: false, error: '内部令牌无效' })
        }
        const { dshComplete } = await import('@/server/integrations/ai/dshLlmBridge')
        const body = await readJsonBody(req)
        try {
          const text = await dshComplete({
            ...(typeof body.system === 'string' ? { system: body.system } : {}),
            messages: Array.isArray(body.messages)
              ? (body.messages as Array<{ role: 'user' | 'assistant'; content: string }>)
              : [],
            ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
            ...(typeof body.maxTokens === 'number' ? { maxTokens: body.maxTokens } : {}),
            ...(typeof body.reasoningEffort === 'string' ? { reasoningEffort: body.reasoningEffort } : {}),
          })
          return json(res, 200, { ok: true, text })
        } catch (err) {
          return json(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }

      // 业务 API（治理/热点/洗稿/草稿，K2 批次 2）：全部要求 session，先于此处的方法门。
      if (await handleBusinessApi(req, res, deps)) return
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: '仅支持 GET/POST' })

      if (op === 'health') {
        return json(res, 200, {
          ok: true,
          name: pluginName,
          buildTag: 'relay-llm-v3',
          db: deps.db !== null,
          dshLlm: isDshLlmAvailable(),
          relayLlm: deps.relayLlmState?.() ?? null,
          storage: deps.storageInfo?.() ?? null,
          apis: deps.apiList ?? [],
        })
      }
      if (op === 'auth/session') {
        const session = await deps.auth.authenticate(req)
        return json(res, 200, { ok: true, authenticated: session !== null, username: session?.username ?? null })
      }
      if (op === 'heartbeat') {
        const session = await deps.auth.authenticate(req)
        if (!session) return json(res, 401, { ok: false, error: '未登录' })
        if (!deps.db) return json(res, 503, { ok: false, error: '数据库未连接' })
        const r = await deps.db.query(
          'SELECT id, plugin, created_at FROM plugin_heartbeats ORDER BY id DESC LIMIT 1',
        )
        return json(res, 200, { ok: true, latest: r.rows[0] ?? null })
      }
      // 业务 API（治理/热点/洗稿/草稿，K2 批次 2）：全部要求 session。
      if (await handleBusinessApi(req, res, deps)) return
      return json(res, 404, { ok: false, error: `未知端点 ${op}` })
    } catch (error) {
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** /s/app/* 静态伺服（prefix 路由；目录回退 index.html；防路径穿越）。 */
export function createStaticHandler(staticRoot: string) {
  const root = resolve(staticRoot)
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rel = normalize(decodeURIComponent(url.pathname.replace(/^\/s\/app\/?/, '')))
      let file = resolve(join(root, rel))
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403)
        res.end()
        return
      }
      if (!existsSync(file) || statSync(file).isDirectory()) {
        file = join(root, 'index.html')
      }
      if (!existsSync(file)) {
        res.writeHead(404)
        res.end('superman: H5 产物缺失，请先运行 pnpm build:plugin')
        return
      }
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': String(body.length),
        'cache-control': 'no-cache',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch (error) {
      res.writeHead(500)
      res.end(error instanceof Error ? error.message : String(error))
    }
  }
}

interface WebServerScope {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  effect(fn: () => () => void, reason?: string): unknown
}

/** 把 /s/api、/s/app 与 PWA 端点挂到 DSH webServer。webServer 只在 web profile 存在，故用 scoped inject。 */
export function registerRoutes(ctx: MinimalContext, deps: RoutesDeps): void {
  const tag = deps.pluginName ?? PLUGIN_NAME
  ctx.inject(['webServer'], (scope: WebServerScope) => {
    const api = createApiHandler(deps)
    scope.effect(
      () => scope.webServer.register({ kind: 'prefix', path: '/s/api', handler: api }),
      `${tag}: route /s/api`,
    )
    const app = createStaticHandler(deps.staticRoot)
    scope.effect(
      () => scope.webServer.register({ kind: 'prefix', path: '/s/app', handler: app }),
      `${tag}: route /s/app`,
    )

    // PWA：manifest + service worker 由插件吐出（图标在 /s/app/brand/ 静态目录）
    const pwaRoot = join(deps.staticRoot, '..', 'pwa')
    const manifestBody = Buffer.from(
      JSON.stringify({
        name: 'Superman 情报指挥中心',
        short_name: 'Superman',
        description: '个人创作指挥中心：RSS 阅读、AI 审批台、热点雷达、洗稿流水线',
        start_url: '/s/app/',
        scope: '/s/app/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f5f5f7',
        theme_color: '#f5f5f7',
        icons: [
          { src: '/s/app/brand/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/s/app/brand/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/s/app/brand/pwa-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }),
      'utf8',
    )
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: '/s/manifest.webmanifest',
          handler: (_req, res) => {
            res.writeHead(200, {
              'content-type': 'application/manifest+json',
              'content-length': String(manifestBody.length),
            })
            res.end(manifestBody)
          },
        }),
      `${tag}: route /s/manifest.webmanifest`,
    )
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: '/s/sw.js',
          handler: async (_req, res) => {
            const file = join(pwaRoot, 'sw.js')
            if (!existsSync(file)) {
              res.writeHead(404)
              res.end()
              return
            }
            const body = await readFile(file)
            res.writeHead(200, {
              'content-type': 'text/javascript; charset=utf-8',
              'content-length': String(body.length),
              // SW 更新必须每次拉新，禁缓存
              'cache-control': 'no-store',
            })
            res.end(body)
          },
        }),
      `${tag}: route /s/sw.js`,
    )
  })
}

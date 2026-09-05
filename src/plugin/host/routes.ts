/**
 * Superman DSH 插件 · HTTP 路由。
 *
 * 路由面（webserver 命名前缀路由，先于 SPA fallback 匹配，不受 DSH 浏览器
 * token 围栏影响——应用鉴权由 auth.ts 自己守）：
 *   /s/api/health        GET  公开，{ ok: true, name: 'superman' }
 *   /s/api/auth/login    POST dev 登录，签发 session cookie
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
        deps.auth.issueCookie(res, session)
        return json(res, 200, { ok: true, username: session.username ?? session.userId })
      }
      if (req.method === 'POST' && op === 'auth/logout') {
        const session = await deps.auth.authenticate(req)
        if (session?.token) deps.auth.revoke(session.token)
        deps.auth.clearCookie(res)
        return json(res, 200, { ok: true })
      }
      // 业务 API（治理/热点/洗稿/草稿，K2 批次 2）：全部要求 session，先于此处的方法门。
      if (await handleBusinessApi(req, res, deps)) return
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: '仅支持 GET/POST' })

      if (op === 'health') {
        return json(res, 200, { ok: true, name: pluginName, db: deps.db !== null, apis: deps.apiList ?? [] })
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

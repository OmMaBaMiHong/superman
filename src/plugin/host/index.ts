/**
 * Superman DSH 插件 · host 半入口（Cordis 插件）。
 *
 * 这是 Superman 的唯一运行时宿主（K1 骨架）：
 *   routes.ts    /s/api/* 应用 API · /s/app/* H5 静态产物
 *   auth.ts      自有 session 鉴权（dev 硬编码登录，K2 接 core 用户表）
 *   scheduler.ts 每分钟心跳写入 Postgres plugin_heartbeats
 *   tools.ts     agent 工具 superman.ping
 *
 * client 半由 package.json 的 dsh.client 声明（src/plugin/client），
 * 在桌面 DSH Web UI 侧栏挂 iframe 面板指向 /s/app。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createAuth } from './auth.js'
import { createPgPool, resolveDatabaseUrl, type PgPoolLike } from './db.js'
import { registerRoutes, type RoutesDeps } from './routes.js'
import { loadMigrations, runMigrations, startHeartbeat } from './scheduler.js'
import { registerTools } from './tools.js'

export const name = 'superman'
// webServer/tools 均为 scoped inject（见各模块），headless profile 下不会空等。
export const inject: string[] = []

export interface SupermanConfig {
  databaseUrl?: string
  /** 心跳间隔（毫秒），缺省 60000；设为 0 关闭心跳（测试用）。 */
  heartbeatIntervalMs?: number
}

interface PluginContext {
  inject(deps: string[], cb: (scope: never) => void): unknown
  effect(fn: () => void | (() => void), reason?: string): unknown
  on(event: 'dispose', cb: () => void): unknown
  logger?: {
    info?(msg: string): void
    warn?(msg: unknown): void
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))

export function apply(ctx: PluginContext, config: SupermanConfig = {}): void {
  const log = (msg: string) => ctx.logger?.info?.(`[superman] ${msg}`)
  const warn = (msg: unknown) => ctx.logger?.warn?.(msg)

  // 静态产物与迁移目录：编译后位于 dist/plugin/host，资源在 dist/plugin 下。
  const staticRoot = join(HERE, '..', 'public', 'app')
  const migrationsDir = join(HERE, 'migrations')

  const auth = createAuth()

  // 数据库是可选增强：连不上时插件照常提供路由与工具，心跳退化为关闭。
  let db: PgPoolLike | null = null
  let heartbeat: { stop(): void } | null = null
  const databaseUrl = resolveDatabaseUrl(config)
  const intervalMs = config.heartbeatIntervalMs ?? 60_000
  const dbReady = createPgPool(databaseUrl)
    .then(async (pool) => {
      db = pool
      const applied = await runMigrations(pool, loadMigrations(migrationsDir))
      if (applied.length > 0) log(`迁移已应用: ${applied.join(', ')}`)
      if (intervalMs > 0) {
        heartbeat = startHeartbeat(pool, name, { intervalMs, onError: warn })
        log(`心跳调度器已启动（间隔 ${intervalMs}ms → plugin_heartbeats）`)
      }
    })
    .catch((error: unknown) => {
      const redacted = databaseUrl.replace(/\/\/[^/@]*@/, '//***@')
      warn(`[superman] Postgres 不可用（${redacted}）：${error instanceof Error ? error.message : String(error)}；路由与工具继续可用，心跳关闭`)
    })

  const dispose = () => {
    heartbeat?.stop()
    void dbReady.finally(() => db?.end().catch(() => {}))
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'superman: db + heartbeat')
  else ctx.on?.('dispose', dispose)

  // 用 getter 延迟读取 db：路由/工具在连接建立前注册，建立后即见。
  const deps: RoutesDeps = {
    auth,
    get db() {
      return db
    },
    staticRoot,
  }
  registerRoutes(ctx, deps)
  registerTools(ctx, deps)

  log('host 半已挂载：/s/api（health/auth/heartbeat）+ /s/app（H5）+ 工具 superman.ping')
}

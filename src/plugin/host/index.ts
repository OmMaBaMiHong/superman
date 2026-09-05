/**
 * Superman DSH 插件 · host 半入口（Cordis 插件）。
 *
 * 这是 Superman 的唯一运行时宿主：
 *   routes.ts    /s/api/* 应用 API · /s/app/* H5 静态产物
 *   api.ts       业务 API（治理/热点/洗稿/草稿，K2 从 Next.js 路由翻译）
 *   auth.ts      session 鉴权（K2 起接 core 用户表 + 共享签名密钥）
 *   scheduler.ts 心跳 + 调度（K2 批次 3：trendradar 同步 / feed 抓取 / 洗稿执行）
 *   tools.ts     agent 工具 superman.ping
 *
 * client 半由 package.json 的 dsh.client 声明（src/plugin/client），
 * 在桌面 DSH Web UI 侧栏挂 iframe 面板指向 /s/app。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createAuth, type Auth } from './auth.js'
import { createPgPool, resolveDatabaseUrl, type PgPoolLike } from './db.js'
import { registerRoutes, type RoutesDeps } from './routes.js'
import { BUSINESS_API_LIST } from './api.js'
import { loadMigrations, runMigrations, startHeartbeat } from './scheduler.js'
import { registerTools } from './tools.js'
import { startPluginScheduler, type PluginSchedulerConfig } from './jobs/scheduler.js'
import { getAuthSettings } from '@/server/domains/settings/repositories/settingsRepo'

export const name = 'superman'
// webServer/tools 均为 scoped inject（见各模块），headless profile 下不会空等。
export const inject: string[] = []

export interface SupermanConfig extends PluginSchedulerConfig {
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

  // 鉴权：db 就绪前为 dev 兜底模式；就绪后切换到 users 表 + 共享签名密钥。
  let auth: Auth = createAuth({ db: null, secret: '' })
  let db: PgPoolLike | null = null
  let heartbeat: { stop(): void } | null = null
  let scheduler: { stop(): void } | null = null

  const databaseUrl = resolveDatabaseUrl(config)
  // core/infra 里的 pg-boss（pipeline 入队）等读 DATABASE_URL；与插件连接串对齐。
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl

  const intervalMs = config.heartbeatIntervalMs ?? 60_000
  const dbReady = createPgPool(databaseUrl)
    .then(async (pool) => {
      db = pool
      const applied = await runMigrations(pool, loadMigrations(migrationsDir))
      if (applied.length > 0) log(`迁移已应用: ${applied.join(', ')}`)

      const { authSessionSecret } = await getAuthSettings(pool as never)
      if (!authSessionSecret.trim()) {
        warn('[superman] app_settings.auth_session_secret 为空：请先用 Next.js 版登录一次以初始化密钥')
      }
      auth = createAuth({ db: pool, secret: authSessionSecret })
      log('鉴权已接入 users 表（session cookie: superman_session）')

      if (intervalMs > 0) {
        heartbeat = startHeartbeat(pool, name, { intervalMs, onError: warn })
        log(`心跳调度器已启动（间隔 ${intervalMs}ms → plugin_heartbeats）`)
      }

      scheduler = startPluginScheduler(pool, config, { log, warn })
    })
    .catch((error: unknown) => {
      const redacted = databaseUrl.replace(/\/\/[^/@]*@/, '//***@')
      warn(`[superman] Postgres 不可用（${redacted}）：${error instanceof Error ? error.message : String(error)}；路由与工具继续可用（dev 鉴权），心跳/调度关闭`)
    })

  const dispose = () => {
    scheduler?.stop()
    heartbeat?.stop()
    void dbReady.finally(() => db?.end().catch(() => {}))
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'superman: db + heartbeat + scheduler')
  else ctx.on?.('dispose', dispose)

  // getter 延迟读取：路由/工具在 db 就绪前注册，就绪后即见。
  const deps: RoutesDeps = {
    get auth() {
      return auth
    },
    get db() {
      return db
    },
    staticRoot,
    apiList: BUSINESS_API_LIST,
  }
  registerRoutes(ctx, deps)
  registerTools(ctx, deps)

  log(`host 半已挂载：/s/api（health/auth + ${BUSINESS_API_LIST.length} 条业务 API）+ /s/app（H5）+ 工具 superman.ping`)
}

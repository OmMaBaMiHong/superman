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
import { startPluginScheduler, fetchDueFeedsOnce, type PluginSchedulerConfig , type SchedulerHandle } from './jobs/scheduler.js'
import { runTrendRadarScheduleTick } from './servicesKeeper.js'
import { registerSkills } from './skills.js'
import { registerHostIdentityBridge, getHostIdentity } from './hostIdentity.js'
import { registerRelayHostBridge, relayBridgeApi, getRelayHostBridgeState } from './relayHostBridge.js'
import { writeBoardSlices } from './boardCache.js'
import { buildStudioBoardSlices } from './studioBoard.js'
import { listUsers } from '@/core/auth/usersRepo'
import { createQueryableStorage, resolveStorageMode, type StorageMode } from './pgliteAdapter.js'
import { createLocalQueueDriver, setQueueDriver } from '@/server/infra/queue/localDriver'
import { findServicesConfig, saveServicesConfig, getServicesConfig } from '@/core/services/serviceConfig'
import { getAuthSettings } from '@/server/domains/settings/repositories/settingsRepo'
import { registerDshLlm } from '@/server/integrations/ai/dshLlmBridge'

export const name = 'superman'
// webServer/tools 均为 scoped inject（见各模块），headless profile 下不会空等。
export const inject: string[] = []

export interface SupermanConfig extends PluginSchedulerConfig {
  databaseUrl?: string
  /** 存储形态：pg（配置连接串，云端/自建）| pglite（零配置本地库）| 缺省 auto（有连接串用 pg，否则 pglite） */
  storageMode?: string
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
// 写在 import 区之后也无妨，但保持依赖声明在顶部
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
/** 项目根（dist/plugin/host 上跳三级）：keeper 拉起 SAU 启动脚本用。 */
const PROJECT_ROOT = join(HERE, '..', '..', '..')

export function apply(ctx: PluginContext, config: SupermanConfig = {}): void {
  const log = (msg: string) => ctx.logger?.info?.(`[superman] ${msg}`)
  const warn = (msg: unknown) => ctx.logger?.warn?.(msg)

  // 接入 DSH 宿主模型服务（ctx.llm）：插件复用 DSH 模型配置，不另设 AI 配置。
  // 用 scoped inject：服务不可用时回调不执行，插件其余部分照常挂载。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['llm', 'agentDefaultModel'], ((scope: { llm?: unknown; agentDefaultModel?: unknown }) => {
      registerDshLlm({ llm: scope.llm, agentDefaultModel: scope.agentDefaultModel })
      log('已接入 DSH 模型服务（ctx.llm），AI 能力走宿主模型')
    }) as never)
  }

  // 中转站 ↔ DSH 模型体系桥（P2e-6 二期）：把 superman-relay 路由预配进宿主
  // llm-pi-ai 的 providers 字典——模型页出现「中转站」行与原生编辑器；
  // H5 授权登录后 Key 经 relayBridgeApi 同步进宿主凭据缝，模型即插即用。
  registerRelayHostBridge(ctx, { getDb: () => db })

  // 宿主身份直通（免登录）：桌面 profile 挂了 deepseekAccount 服务即可用，
  // headless/web profile 下 inject 不命中、整条通道静默降级，口令登录不受影响。
  const stopHostIdentity = registerHostIdentityBridge(ctx, { log, warn, getDb: () => db })

  // 静态产物与迁移目录：编译后位于 dist/plugin/host，资源在 dist/plugin 下。
  const staticRoot = join(HERE, '..', 'public', 'app')
  const migrationsDir = join(HERE, 'migrations')
  // 核心建表迁移（71 个，含 users/articles 等基础表）：必须先于插件附加迁移执行。
  // 开源/PGlite 形态从空库起步全靠它；旧 PG 库里这些早已应用，水位表幂等跳过。
  const coreMigrationsDir = join(HERE, 'migrations-core')

  // 鉴权：db 就绪前为 dev 兜底模式；就绪后切换到 users 表 + 共享签名密钥。
  let auth: Auth = createAuth({ db: null, secret: '' })
  let db: PgPoolLike | null = null
  let internalToken = ''
  let heartbeat: { stop(): void } | null = null
  let scheduler: SchedulerHandle | null = null
  let schedulerRunning = false

  const intervalMs = config.heartbeatIntervalMs ?? 60_000
  // 存储形态（Phase B）：pg（配置了连接串，云端/自建）| pglite（零配置开源形态，装完即用）
  const storageMode: StorageMode = resolveStorageMode(config)
  let storageSnapshot: { mode: string; detail: string } = { mode: storageMode, detail: 'init' }
  const dbReady = createQueryableStorage(config, createPgPool)
    .then(async ({ db: pool, mode, detail }) => {
      db = pool
      storageSnapshot = { mode, detail }
      if (mode === 'pg') {
        // core/infra 里的 pg-boss（pipeline 入队）等读 DATABASE_URL；与插件连接串对齐
        if (!process.env.DATABASE_URL) process.env.DATABASE_URL = resolveDatabaseUrl(config)
      } else {
        // pglite：pg-boss 需要真 PG 服务器，切本地队列驱动（流水线执行本就轮询 pipeline_jobs）
        process.env.SUPERMAN_STORAGE = 'pglite'
        // 嵌入 RSSHub 的配置校验要求 DATABASE_URL 是字符串（PGlite 形态本无 PG 连接）：
        // 给占位串过 zod 校验，并显式锁内存缓存——否则 RSSHub 见到 DATABASE_URL 会真连 PG。
        if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://pglite@127.0.0.1:5432/unused'
        process.env.CACHE_TYPE ??= 'memory'
        setQueueDriver(createLocalQueueDriver(pool))
      }
      log(`存储: ${mode}（${detail}）`)
      const coreApplied = await runMigrations(pool, loadMigrations(coreMigrationsDir))
      if (coreApplied.length > 0) log(`核心迁移已应用: ${coreApplied.length} 个`)
      const applied = await runMigrations(pool, loadMigrations(migrationsDir))
      if (applied.length > 0) log(`插件迁移已应用: ${applied.join(', ')}`)

      const { authSessionSecret } = await getAuthSettings(pool as never)
      if (!authSessionSecret.trim()) {
        warn('[superman] app_settings.auth_session_secret 为空：请先用 Next.js 版登录一次以初始化密钥')
      }
      auth = createAuth({ db: pool, secret: authSessionSecret })
      internalToken = authSessionSecret
      log('鉴权已接入 users 表（session cookie: superman_session）')

      if (intervalMs > 0) {
        heartbeat = startHeartbeat(pool, name, { intervalMs, onError: warn })
        log(`心跳调度器已启动（间隔 ${intervalMs}ms → plugin_heartbeats）`)
      }

      // 调度器开关优先级（P2e-5）：cordis config 显式值 > DB（设置页热切换）> env 兜底。
      // projectRoot 传给 keeper（SAU 启动脚本在 scripts/ 下）。
      const dbServices = await findServicesConfig(pool as never)
      const schedulerEnabled =
        typeof config.schedulerEnabled === 'boolean'
          ? config.schedulerEnabled
          : (dbServices?.schedulerEnabled ?? process.env.SUPERMAN_SCHEDULER_ENABLED === 'true')
      scheduler = startPluginScheduler(
        pool,
        { ...config, schedulerEnabled, projectRoot: PROJECT_ROOT },
        { log, warn },
      )
      schedulerRunning = schedulerEnabled
      log(schedulerEnabled ? '插件调度器已开启（采集/热点同步/评论/洗稿/追踪 + 服务 keeper）' : '插件调度器未开启（设置页可热切换）')

      // 看板缓存预热（服务启动即构建读模型进本地 SQLite）：面板首开直接吃缓存渲染，
      // 无需等源库查询；之后的刷新仍是面板打开时的后台整片重建
      void (async () => {
        const users = await listUsers(pool as never)
        for (const user of users.filter((u) => u.status === 'active')) {
          try {
            const slices = await buildStudioBoardSlices(pool as never, user.id)
            writeBoardSlices(slices as unknown as Record<string, unknown>)
          } catch (error) {
            warn(`[superman] 看板缓存预热失败 user=${user.id}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        log('看板读模型缓存已预热（按活跃用户）')
      })()
    })
    .catch((error: unknown) => {
      db = null // 迁移失败不给路由暴露未初始化的裸库（否则后续全是 relation 不存在类报错）
      const message = error instanceof Error ? error.message : String(error)
      try {
        mkdirSync(join(homedir(), '.dsh', 'superman'), { recursive: true })
        writeFileSync(join(homedir(), '.dsh', 'superman', 'init-error.log'), `${new Date().toISOString()} ${storageMode}: ${message}\n`, { flag: 'a' })
      } catch { /* 日志落盘失败不影响主流程 */ }
      warn(`[superman] 存储 ${storageMode} 初始化失败：${message}；路由与工具继续可用（dev 鉴权），心跳/调度关闭`)
    })

  // TrendRadar 每日定时任务：独立于全局调度器开关（schedulerEnabled 只管采集/同步等
  // 周期任务），由设置项 trendRadarRunMode/trendRadarRunTime 驱动：off=仅手动触发，
  // daily=每天到点自动跑一次（跑完自动补结构化同步）。手动「立即运行」与定时共用
  // 同一去重状态（service_config key=trendradar_run），一天至多一轮。
  let trendRadarTimer: ReturnType<typeof setInterval> | null = null
  let trendRadarTickBusy = false
  trendRadarTimer = setInterval(() => {
    if (!db || trendRadarTickBusy) return
    trendRadarTickBusy = true
    void runTrendRadarScheduleTick({ db: db as never })
      .then((result) => {
        if (result.action === 'ran') log(`trendradar.schedule: 已按设置拉起当日抓取（pid ${result.pid ?? '?'}）`)
        if (result.action === 'synced') log('trendradar.schedule: 当日抓取结束，结构化同步完成')
      })
      .catch((error: unknown) => warn(`[superman] trendradar.schedule: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { trendRadarTickBusy = false })
  }, 60_000)
  if (typeof trendRadarTimer.unref === 'function') trendRadarTimer.unref()

  const dispose = () => {
    stopHostIdentity()
    scheduler?.stop()
    heartbeat?.stop()
    if (trendRadarTimer) clearInterval(trendRadarTimer)
    void dbReady.finally(() => db?.end().catch(() => {}))
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'superman: db + heartbeat + scheduler + trendradar 定时')
  else ctx.on?.('dispose', dispose)

  // getter 延迟读取：路由/工具在 db 就绪前注册，就绪后即见。
  const deps: RoutesDeps = {
    get auth() {
      return auth
    },
    get db() {
      return db
    },
    get internalToken() {
      return internalToken
    },
    hostIdentity: () => getHostIdentity(),
    pipelineKick: () => scheduler?.kickPipeline(),
    schedulerControl: {
      isRunning: () => schedulerRunning,
      /** 热切换（P2e-5）：设置页开关即时生效，免重启。 */
      setRunning: (enabled: boolean) => {
        if (!db) return // 数据库未连接时无从调度（面板状态灯会如实显示）
        scheduler?.stop()
        scheduler = enabled
          ? startPluginScheduler(
              db,
              { ...config, schedulerEnabled: true, projectRoot: PROJECT_ROOT },
              { log, warn },
            )
          : { stop: () => {}, kickPipeline: () => {} }
        schedulerRunning = enabled
        log(`调度器已${enabled ? '开启' : '关闭'}（设置页热切换）`)
      },
    },
    staticRoot,
    apiList: BUSINESS_API_LIST,
    projectRoot: PROJECT_ROOT,
    relayLlmState: () => getRelayHostBridgeState(),
    storageInfo: () => storageSnapshot,
  }
  registerRoutes(ctx, deps)
  registerTools(ctx, {
    get db() {
      return db
    },
    fetchTrigger: () => {
      if (!db) return Promise.reject(new Error('数据库未连接'))
      return fetchDueFeedsOnce(db, { log, warn })
    },
  })
  registerSkills(ctx)

  log(`host 半已挂载：/s/api（health/auth + ${BUSINESS_API_LIST.length} 条业务 API）+ /s/app（H5）+ agent 工具集 + superman 技能`)
}

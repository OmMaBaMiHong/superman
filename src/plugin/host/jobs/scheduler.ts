/**
 * Superman DSH 插件 · 调度器（K2 批次 3：接管 Next.js worker 的定时职责）。
 *
 * 复用既有 handler 逻辑（不改语义）：
 *   - trendradar.sync：每 30 分钟读 TrendRadar 当日 SQLite 全量 upsert（core/trendradar/sync）
 *   - feed 抓取：每 60s 扫一轮到期订阅源，逐源 fetchAndIngestFeed（src/worker/index 导出，
 *     治理摄取在该 handler 内联执行；article filter 等后续 pg-boss 任务由 no-op boss 跳过，
 *     迁移期交由 Next.js worker 的队列侧继续消费）
 *   - pipeline.rewrite：每 15s 轮询 pipeline_jobs 里 queued 的 rewrite 任务，
 *     直接调 executeRewriteJob 执行（不经 pg-boss）
 *
 * 互斥（关键）：与 Next.js worker 同时跑会对同一数据库重复抓取/执行。
 * 本调度器默认关闭，需显式开启（cordis config.schedulerEnabled: true 或
 * 环境变量 SUPERMAN_SCHEDULER_ENABLED=true）。迁移期只开一边：
 *   - Next.js 版在跑 → 插件保持默认关闭
 *   - 切到插件调度 → 停 Next.js worker（pnpm worker:dev），再开本开关
 */
import type { PgBoss } from 'pg-boss'
import { listUsers } from '@/core/auth/usersRepo'
import { runTrendRadarSync } from '@/core/trendradar/sync'
import { executeRewriteJob } from '@/core/pipelines/services/rewriteService'
import { fetchAndIngestFeed } from '@/worker/index'
import { listEnabledFeedsForFetch } from '@/server/domains/feeds/repositories/feedsRepo'
import { selectFeedsForRefreshAll } from '@/worker/refreshAll'
import type { PgPoolLike } from '../db.js'

export interface PluginSchedulerConfig {
  /** 总开关，默认 false（互斥，见模块头注释）。 */
  schedulerEnabled?: boolean
  trendradarIntervalMs?: number
  feedRefreshIntervalMs?: number
  pipelinePollIntervalMs?: number
}

export interface SchedulerHandle {
  stop(): void
}

interface Logger {
  log(msg: string): void
  warn(msg: unknown): void
}

const TRENDRADAR_INTERVAL = 30 * 60_000
const FEED_TICK_INTERVAL = 60_000
const PIPELINE_POLL_INTERVAL = 15_000

/** 每条 tick 最多执行的洗稿任务数（防雪崩）。 */
const PIPELINE_BATCH_LIMIT = 10

/** fetchAndIngestFeed 只需要 boss.send 投递后续任务；插件侧不接管队列消费，投 no-op。 */
const noopBoss = { send: async () => null } as unknown as PgBoss

export function isSchedulerEnabled(config: PluginSchedulerConfig): boolean {
  if (typeof config.schedulerEnabled === 'boolean') return config.schedulerEnabled
  return process.env.SUPERMAN_SCHEDULER_ENABLED === 'true'
}

/**
 * 手动触发一轮到期订阅源抓取（agent 工具 superman_fetch_trigger 与调度 tick 共用）。
 * 只执行一轮，不改变 schedulerEnabled 开关；单用户内核固定扫初始管理员的源。
 */
export async function fetchDueFeedsOnce(
  pool: PgPoolLike,
  logger?: Logger,
): Promise<{ feeds: number; inserted: number }> {
  const users = await listUsers(pool as never)
  let feeds = 0
  let inserted = 0
  for (const user of users.filter((u) => u.status === 'active')) {
    const feedRows = await listEnabledFeedsForFetch(pool as never, user.id)
    const due = selectFeedsForRefreshAll(feedRows, new Date(), { force: false })
    for (const feed of due) {
      feeds += 1
      const result = await fetchAndIngestFeed(noopBoss, feed.id, {
        userId: feed.userId ?? user.id,
        deps: { getPool: () => pool as never },
      })
      inserted += result.inserted
      if (result.errorMessage) {
        logger?.warn(`[superman] feed.fetch: feed=${feed.id} ${result.errorMessage}`)
      }
    }
  }
  return { feeds, inserted }
}

export function startPluginScheduler(
  pool: PgPoolLike,
  config: PluginSchedulerConfig,
  logger: Logger,
): SchedulerHandle {
  if (!isSchedulerEnabled(config)) {
    logger.log('调度器未开启（默认关闭以避免与 Next.js worker 双跑；schedulerEnabled=true 开启）')
    return { stop: () => {} }
  }

  const timers: ReturnType<typeof setInterval>[] = []
  const inFlight = new Set<string>()

  /** 带 in-flight 互斥的周期任务：上一轮没跑完就跳过这一轮。 */
  function every(name: string, intervalMs: number, fn: () => Promise<void>): void {
    const timer = setInterval(() => {
      if (inFlight.has(name)) return
      inFlight.add(name)
      void fn()
        .catch((error) => logger.warn(`[superman] 调度 ${name} 失败: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => inFlight.delete(name))
    }, intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
    timers.push(timer)
  }

  every('trendradar.sync', config.trendradarIntervalMs ?? TRENDRADAR_INTERVAL, async () => {
    const users = await listUsers(pool as never)
    for (const user of users.filter((u) => u.status === 'active')) {
      const result = await runTrendRadarSync({ pool: pool as never, userId: user.id })
      if (result.status === 'ok') {
        logger.log(`trendradar.sync: user=${user.id} upserted=${result.upserted} platforms=${result.platforms}`)
      }
    }
  })

  every('feed.fetch', config.feedRefreshIntervalMs ?? FEED_TICK_INTERVAL, async () => {
    const result = await fetchDueFeedsOnce(pool, logger)
    if (result.inserted > 0) {
      logger.log(`feed.fetch: feeds=${result.feeds} inserted=${result.inserted}`)
    }
  })

  every('pipeline.rewrite', config.pipelinePollIntervalMs ?? PIPELINE_POLL_INTERVAL, async () => {
    const { rows } = await pool.query(
      `SELECT id, user_id AS "userId" FROM pipeline_jobs
       WHERE status = 'queued' AND kind = 'rewrite'
       ORDER BY created_at ASC LIMIT $1`,
      [PIPELINE_BATCH_LIMIT],
    )
    for (const row of rows as { id: string; userId: string | null }[]) {
      const result = await executeRewriteJob(pool as never, { jobId: row.id, userId: row.userId ?? undefined })
      if (result.status === 'failed') {
        logger.warn(`[superman] pipeline.rewrite: job=${row.id} failed: ${result.error}`)
      } else {
        logger.log(`pipeline.rewrite: job=${row.id} ${result.status}`)
      }
    }
  })

  logger.log('调度器已启动：trendradar.sync(30m) + feed.fetch(60s) + pipeline.rewrite(15s)')
  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer)
    },
  }
}

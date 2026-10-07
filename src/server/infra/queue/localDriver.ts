/**
 * 本地队列驱动（Phase B：pglite 存储形态的入队实现）。
 *
 * pg-boss 需要真 PostgreSQL 服务器的多连接 + SKIP LOCKED 轮询，嵌入式 PGlite
 * 上跑不了；而流水线的实际执行本就由插件调度器轮询 pipeline_jobs 驱动
 * （全代码库没有任何 pg-boss worker）。本地驱动因此只做两件事：
 * ①把入队事实落一张轻量事件表（排障/观测用）；②返回 enqueued 让编排层
 * 语义不变。pg 模式完全不受影响（driver 缺省仍是 pg-boss）。
 */
import { randomUUID } from 'node:crypto'
import type { Queryable } from '@/plugin/host/db'

export type LocalEnqueueResult = { status: 'enqueued'; jobId: string }

let ensureTable: Promise<void> | null = null

async function ensureEventsTable(db: Queryable): Promise<void> {
  if (!ensureTable) {
    ensureTable = db
      .query(`
        create table if not exists plugin_queue_events (
          id bigserial primary key,
          queue_name text not null,
          payload jsonb not null default '{}'::jsonb,
          options jsonb,
          job_ref text not null,
          created_at timestamptz not null default now()
        )
      `)
      .then(() => undefined)
  }
  return ensureTable
}

/** pglite 模式的队列驱动：入队落事件表，任务执行由 pipeline_jobs 轮询承担。 */
export function createLocalQueueDriver(db: Queryable): {
  enqueue(name: string, data: object | null, options?: unknown): Promise<LocalEnqueueResult>
} {
  return {
    async enqueue(name, data, options) {
      await ensureEventsTable(db)
      const jobRef = `local-${randomUUID()}`
      await db.query(
        'insert into plugin_queue_events(queue_name, payload, options, job_ref) values ($1, $2, $3, $4)',
        [name, JSON.stringify(data ?? {}), options ? JSON.stringify(options) : null, jobRef],
      )
      return { status: 'enqueued', jobId: jobRef }
    },
  }
}

/** 队列驱动可插拔缝：缺省 pg-boss（云端/服务端），插件在 pglite 模式下换本地驱动。 */
export type QueueDriver = (name: string, data: object | null, options?: unknown) => Promise<LocalEnqueueResult>

let driverOverride: QueueDriver | null = null

export function setQueueDriver(driver: QueueDriver): void {
  driverOverride = driver
}

export function getQueueDriver(): QueueDriver | null {
  return driverOverride
}

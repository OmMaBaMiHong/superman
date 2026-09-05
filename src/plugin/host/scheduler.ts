/**
 * Superman DSH 插件 · 调度器骨架。
 *
 * K1 只做一件事：每分钟往 Postgres 写一条 plugin_heartbeats 记录，证明
 * 插件进程持有可用的数据库链路。定时器随 cordis fiber dispose 清理。
 * K2 起这里扩展为采集/同步/配额调度（见 docs/plans/2026-09-05-dsh-kernel-topology.md）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Queryable } from './db.js'

export interface Migration {
  name: string
  sql: string
}

/** 从迁移目录读取 *.sql，按文件名排序。 */
export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

/** 顺序应用未执行过的迁移，记录进 plugin_schema_migrations。 */
export async function runMigrations(db: Queryable, migrations: readonly Migration[]): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS plugin_schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  )
  const applied: string[] = []
  for (const migration of migrations) {
    const seen = await db.query('SELECT 1 FROM plugin_schema_migrations WHERE name = $1', [migration.name])
    if (seen.rows.length > 0) continue
    await db.query(migration.sql)
    await db.query('INSERT INTO plugin_schema_migrations (name) VALUES ($1)', [migration.name])
    applied.push(migration.name)
  }
  return applied
}

/** 写一条心跳。 */
export async function writeHeartbeat(db: Queryable, pluginName: string, detail: Record<string, unknown> = {}): Promise<void> {
  await db.query('INSERT INTO plugin_heartbeats (plugin, detail) VALUES ($1, $2::jsonb)', [
    pluginName,
    JSON.stringify(detail),
  ])
}

/**
 * 幂等心跳：同一 intervalMs 窗口内已有一条就不重复写。
 * 背景：DSH 的 patchReload live 在 boot 后会再 apply 一次插件，beatOnStart
 * 导致 1 秒内两条心跳（K1 遗留问题）。写入前查最后一条的时间来兜底。
 */
export async function writeHeartbeatIfDue(
  db: Queryable,
  pluginName: string,
  intervalMs: number,
  detail: Record<string, unknown> = {},
): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT created_at FROM plugin_heartbeats WHERE plugin = $1 ORDER BY id DESC LIMIT 1",
    [pluginName],
  )
  const last = rows[0]?.created_at
  if (last instanceof Date || typeof last === 'string') {
    const elapsed = Date.now() - new Date(last).getTime()
    if (Number.isFinite(elapsed) && elapsed < intervalMs * 0.9) return false
  }
  await writeHeartbeat(db, pluginName, detail)
  return true
}

export interface HeartbeatHandle {
  /** 停止定时器（dispose 时调用）。 */
  stop(): void
  /** 手动触发一次心跳（测试与调试用）。 */
  beat(): Promise<void>
}

export interface HeartbeatOptions {
  intervalMs?: number
  /** 启动时是否立即写第一条（缺省 true，便于验收无需等待一分钟）。 */
  beatOnStart?: boolean
  onError?: (error: unknown) => void
}

/** 启动心跳定时器。 */
export function startHeartbeat(db: Queryable, pluginName: string, options: HeartbeatOptions = {}): HeartbeatHandle {
  const intervalMs = options.intervalMs ?? 60_000
  const onError = options.onError ?? ((error: unknown) => console.error('[superman] heartbeat 写入失败:', error))
  const beat = () => writeHeartbeatIfDue(db, pluginName, intervalMs, { pid: process.pid }).then(() => undefined).catch(onError)
  const timer = setInterval(beat, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  if (options.beatOnStart !== false) void beat()
  return { stop: () => clearInterval(timer), beat }
}

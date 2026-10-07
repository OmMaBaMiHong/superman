/**
 * Superman DSH 插件 · 看板读缓存（SQLite 本地盘，Phase A）。
 *
 * 为什么是 SQLite：开源插件不能要求用户装 PostgreSQL；DSH 宿主自带 Node 运行时
 * 内置 node:sqlite（零原生依赖、单文件落盘），本机读 <10ms——看板/列表这类
 * "一次查全量做分类"的面板先读缓存立即可渲染，再后台从源库刷新换入。
 *
 * 缓存的是面板读模型（每片一份 JSON 快照，带 fetchedAt）：刷新 = 按片从源库
 * 重建（用户的增删改天然反映），后续再演进为 updated_at 水位线的行级增量。
 *
 * 可用性：node:sqlite 不存在（旧 Node）时全部接口静默降级为不可用，调用方
 * 直接走原路径——缓存是加速器，不是正确性依赖。
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface BoardSlice<T = unknown> {
  payload: T
  fetchedAt: string
}

interface SqliteDatabaseSync {
  exec(sql: string): unknown
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
}

export function boardCacheFile(): string {
  return process.env.SUPERMAN_CACHE_DB?.trim() || join(homedir(), '.dsh', 'superman', 'board-cache.db')
}

let cachedDb: SqliteDatabaseSync | null = null
let probeDone = false

/** node:sqlite 解析（createRequire 对内置模块不依赖锚文件存在）；不可用返回 null。 */
function resolveSqlite(): (new (path: string) => SqliteDatabaseSync) | null {
  try {
    // node:sqlite 在 Node ≥22.5 需 flag、≥23.4 稳定；DSH 宿主（Electron 44 系）自带新内核
    const mod = createRequire(pathToFileURL(join(homedir(), '.dsh', 'package.json')))('node:sqlite') as {
      DatabaseSync?: new (path: string) => SqliteDatabaseSync
    }
    return mod.DatabaseSync ?? null
  } catch {
    return null
  }
}

function db(): SqliteDatabaseSync | null {
  if (probeDone) return cachedDb
  probeDone = true
  const path = boardCacheFile()
  try {
    mkdirSync(dirname(path), { recursive: true })
    const DatabaseSync = resolveSqlite()
    if (!DatabaseSync) return null
    const instance = new DatabaseSync(path)
    instance.exec(`
      pragma journal_mode = wal;
      create table if not exists board_slice (
        slice_key text primary key,
        payload text not null,
        fetched_at text not null
      );
    `)
    cachedDb = instance
    return cachedDb
  } catch {
    return null
  }
}

/** 缓存是否可用（不可用时调用方直接走源库路径，行为与改造前一致）。 */
export function isBoardCacheAvailable(): boolean {
  return db() !== null
}

export function readBoardSlices(keys: string[]): Record<string, BoardSlice> | null {
  const handle = db()
  if (!handle) return null
  try {
    const stmt = handle.prepare('select payload, fetched_at from board_slice where slice_key = ?')
    const out: Record<string, BoardSlice> = {}
    for (const key of keys) {
      const row = stmt.get(key) as { payload: string; fetched_at: string } | undefined
      if (!row) continue
      try {
        out[key] = { payload: JSON.parse(row.payload) as unknown, fetchedAt: row.fetched_at }
      } catch {
        // 单片损坏跳过，等刷新重建
      }
    }
    return out
  } catch {
    return null
  }
}

export function writeBoardSlices(entries: Record<string, unknown>): void {
  const handle = db()
  if (!handle) return
  try {
    const stmt = handle.prepare(`
      insert into board_slice(slice_key, payload, fetched_at) values (?, ?, ?)
      on conflict(slice_key) do update set payload = excluded.payload, fetched_at = excluded.fetched_at
    `)
    const now = new Date().toISOString()
    for (const [key, payload] of Object.entries(entries)) {
      stmt.run(key, JSON.stringify(payload), now)
    }
  } catch {
    // 缓存写失败不影响主流程
  }
}

/** 供健康检查上报。 */
export function boardCacheInfo(): { available: boolean; file: string } {
  return { available: isBoardCacheAvailable(), file: boardCacheFile() }
}

/**
 * Superman DSH 插件 · PGlite 存储适配器（Phase B：开源本地版脱 PG）。
 *
 * PGlite 是编译成 WASM 的真 PostgreSQL，随插件 npm 包分发（纯 WASM 零原生编译），
 * 数据落在本地目录（~/.dsh/superman/pgdata）——用户装完插件即有库，首启跑现有
 * PG 迁移建表，云端版与本插件共用同一套 core 仓储代码（PG 方言零改写）。
 *
 * 适配三个差异：
 * ①接口：PGlite 原生 query(sql, params) 与 Queryable 同形；无参数的多语句调用
 *   （迁移 DDL）走 exec 并按"多语句无行"语义返回空行集。
 * ②单连接：PGlite 内部按序执行并发查询；connect() 会话（begin/commit 事务，
 *   见 usersRepo）用互斥门实现——会话持锁期间普通 query 排队，release 放行，
 *   复刻 pg 单客户端独占语义。
 * ③enforceUnicode 无关；类型解析差异（timestamptz 等）由调用方兼容（既有代码
 *   已按 Date|string 双形态处理）。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PgPoolLike, Queryable } from './db.js'

export function pgliteDataDir(): string {
  return process.env.SUPERMAN_PGLITE_DIR?.trim() || join(homedir(), '.dsh', 'superman', 'pgdata')
}

type QueryResult = { rows: Record<string, unknown>[] }
type ClientLike = { query: Queryable['query']; release(): void }

interface PgliteDb {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  exec(sql: string): Promise<Array<{ rows?: Record<string, unknown>[] }>>
  close(): Promise<void>
}

export class PglitePool implements PgPoolLike {
  private readonly db: PgliteDb
  /** 互斥门：connect() 会话期间普通 query 在此排队（末位追加等待前驱完成）。 */
  private gate: Promise<void> = Promise.resolve()

  private constructor(db: PgliteDb) {
    this.db = db
  }

  static async open(dataDir = pgliteDataDir()): Promise<PglitePool> {
    let mod: { PGlite: new (dir: string, opts?: { extensions?: Record<string, unknown> }) => PgliteDb }
    try {
      mod = (await import('@electric-sql/pglite')) as never
    } catch (error) {
      throw new Error(
        `superman 插件 pglite 模式需要 @electric-sql/pglite 依赖（应随插件自动安装）：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    mkdirSync(dataDir, { recursive: true })
    // 迁移用到的扩展按需注册；缺包只降级该扩展，不阻断建库（注册失败会在
    // create extension 处报错，由调用方看到具体信息）
    const extensions: Record<string, unknown> = {}
    try {
      extensions.pgcrypto = (await import('@electric-sql/pglite/contrib/pgcrypto')).pgcrypto
    } catch { /* pgcrypto 不可用：gen_random_uuid 在 PG13+ 内置，多数场景无感 */ }
    try {
      extensions.vector = (await import('@electric-sql/pglite-pgvector')).vector
    } catch { /* pgvector 不可用：知识库向量检索本地版暂缓 */ }
    const db = Object.keys(extensions).length > 0 ? new mod.PGlite(dataDir, { extensions }) : new mod.PGlite(dataDir)
    return new PglitePool(db)
  }

  /** 单条查询；无参数调用放行多语句（迁移 DDL），行集取单结果、多语句返回空行。 */
  async query(text: string, params?: readonly unknown[]): Promise<QueryResult> {
    return this.run(() => this.raw(text, params))
  }

  /** 事务会话：持互斥门直到 release，期间普通 query 排队等待。 */
  async connect(): Promise<ClientLike> {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const prev = this.gate
    this.gate = gate
    await prev
    let released = false
    return {
      query: async (text, params) => {
        if (released) throw new Error('pglite: client 已 release，不能再执行查询')
        return this.raw(text, params)
      },
      release: () => {
        if (released) return
        released = true
        releaseGate()
      },
    }
  }

  async end(): Promise<void> {
    await this.gate
    await this.db.close()
  }

  /** 串行化执行入口：排在互斥门链尾，保证与会话互斥。 */
  private async run<T>(task: () => Promise<T>): Promise<T> {
    const prev = this.gate
    let release: () => void = () => {}
    this.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await prev
      return await task()
    } finally {
      release()
    }
  }

  private async raw(text: string, params?: readonly unknown[]): Promise<QueryResult> {
    if (params === undefined || params === null || params.length === 0) {
      const results = await this.db.exec(text)
      if (results.length === 1) return { rows: results[0]?.rows ?? [] }
      // 多语句（DDL/迁移）：无行集语义
      return { rows: [] }
    }
    const result = await this.db.query(text, params)
    return { rows: result.rows ?? [] }
  }
}

export type StorageMode = 'pg' | 'pglite'

/**
 * 存储形态解析：显式（config.storageMode / SUPERMAN_STORAGE）> auto。
 * auto 规则：真实配置了连接串（config/env）→ pg（云端与服务端形态，含本机自建）；
 * 完全没配 → pglite（开源零配置形态，装完即用）。
 */
export function resolveStorageMode(config: { storageMode?: string; databaseUrl?: string } = {}): StorageMode {
  const explicit = config.storageMode?.trim() || process.env.SUPERMAN_STORAGE?.trim()
  if (explicit === 'pglite' || explicit === 'pg') return explicit
  const hasUrl = Boolean(
    config.databaseUrl?.trim() || process.env.SUPERMAN_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim(),
  )
  return hasUrl ? 'pg' : 'pglite'
}

/** 启动时冷备份 PGlite 数据目录（滚动保留最近 BACKUP_KEEP 份）。
 * 2026-10-27 事故教训：WASM 崩溃后目录损坏不可恢复；有备份即可整目录回滚。
 * 备份失败不阻断启动。
 */
const BACKUP_KEEP = 5
function backupPgliteDataDir(dir: string): void {
  try {
    if (!existsSync(dir)) return
    const backupsRoot = join(dirname(dir), 'pgdata-backups')
    mkdirSync(backupsRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    cpSync(dir, join(backupsRoot, `pgdata-${stamp}`))
    const entries = readdirSync(backupsRoot).filter((n) => n.startsWith('pgdata-')).sort()
    while (entries.length > BACKUP_KEEP) {
      rmSync(join(backupsRoot, entries.shift() as string), { recursive: true, force: true })
    }
  } catch {
    // 备份失败不影响启动
  }
}

/** 存储工厂：按模式给 pg 连接池或 PGlite 适配器（两者同为 PgPoolLike）。 */
export async function createQueryableStorage(
  config: { storageMode?: string; databaseUrl?: string },
  createPgPool: (url: string) => Promise<PgPoolLike>,
): Promise<{ mode: StorageMode; db: PgPoolLike; detail: string }> {
  const mode = resolveStorageMode(config)
  if (mode === 'pglite') {
    const dir = pgliteDataDir()
    // 启动冷备份（打开库之前目录无人持有，拷贝一致）：坏了可整目录回滚，零丢失
    backupPgliteDataDir(dir)
    return { mode, db: await PglitePool.open(dir), detail: dir }
  }
  const url =
    config.databaseUrl?.trim()
    || process.env.SUPERMAN_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim()
    || ''
  if (!url) throw new Error('pg 模式需要 databaseUrl 配置或 SUPERMAN_DATABASE_URL/DATABASE_URL 环境变量')
  return { mode, db: await createPgPool(url), detail: url.replace(/\/\/[^/@]*@/, '//***@') }
}

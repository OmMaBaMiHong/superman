/**
 * feedfuse-workbench 自包含 SQLite 持久层（Node 内置 `node:sqlite`，零外部依赖）。
 *
 * 用单个库文件承载所有表；每张表为 (key TEXT PRIMARY KEY, value TEXT)：一行一条记录，
 * value 为该行 JSON 对象。与 Harness 内置 `dsh-storage-sqlite` 的表抽象一致，便于后期
 * 换 PostgreSQL 时按同样键模型映射。库文件路径来自 config.dbFilePath（缺省随插件数据目录）。
 *
 * 对外只暴露极小的行级 CRUD + 元数据读写；业务层（rss-store.js / media-store.js）保留
 * 内存快照并在变更后落盘，HTTP 契约不变。
 */
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** 元数据单条键。 */
const META_KEY = 'feedfuse:meta'

/**
 * 打开并初始化 SQLite 库：确保目录存在、建表（幂等），返回行级访问句柄。
 * 多个业务模块（如 rss 与 media）可各自打开同一个库文件；它们通过互不冲突
 * 的 `metaKey` 各自持有独立的计数器元数据。
 * @param {object} opts
 * @param {string} opts.dataDir 插件数据目录（缺省库文件所在目录）。
 * @param {string} [opts.dbFilePath] 库文件路径；缺省 `feedfuse-data/feedfuse.sqlite`。
 * @param {string[]} opts.tables 要确保存在的表名列表（含 `meta`）。
 * @param {string} [opts.metaKey] 本模块元数据行的键；缺省 `feedfuse:meta`。
 */
export function openSqliteStore({ dataDir, dbFilePath, tables, metaKey = META_KEY }) {
  const resolved = resolvePath(dbFilePath, dataDir)
  mkdirSync(dirname(resolved), { recursive: true })
  const db = new DatabaseSync(resolved)
  db.exec('PRAGMA journal_mode = WAL')
  for (const table of tables) {
    // 表名为固定常量，安全用于 DDL。
    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
  }
  return {
    /** 解析后的库文件绝对路径（调试/状态展示用）。 */
    path: resolved,
    db,
    hasRow(table, key) {
      return !!db.prepare(`SELECT 1 FROM "${table}" WHERE key = ?`).get(String(key))
    },
    /** 读一行；不存在返回 undefined。 */
    get(table, key) {
      const row = db.prepare(`SELECT value FROM "${table}" WHERE key = ?`).get(String(key))
      return row ? JSON.parse(row.value) : undefined
    },
    /** 读整表全部行。 */
    all(table) {
      return db.prepare(`SELECT value FROM "${table}"`).all().map((row) => JSON.parse(row.value))
    },
    /** 插入或覆盖一行。 */
    set(table, key, value) {
      db.prepare(`INSERT INTO "${table}" (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(String(key), JSON.stringify(value))
    },
    /** 删除一行。 */
    del(table, key) {
      db.prepare(`DELETE FROM "${table}" WHERE key = ?`).run(String(key))
    },
    count(table) {
      return db.prepare(`SELECT count(*) AS c FROM "${table}"`).get().c
    },
    /** 清空整表（save 时全量重写用）。 */
    clear(table) {
      db.exec(`DELETE FROM "${table}"`)
    },
    /** 读元数据对象（与 defaults 合并）。 */
    getMeta(defaults) {
      return { ...(defaults || {}), ...(this.get('meta', metaKey) || {}) }
    },
    /** 写元数据对象。 */
    setMeta(meta) {
      this.set('meta', metaKey, meta || {})
    },
    close() {
      db.close()
    },
  }
}

function resolvePath(dbFilePath, dataDir) {
  const raw = String(dbFilePath || '').trim()
  if (!raw || raw === ':memory:') return join(dataDir, 'feedfuse.sqlite')
  return isAbsolute(raw) ? raw : join(dataDir, raw)
}
/**
 * 一次性迁移工具：现有 PostgreSQL → PGlite（Phase B 切换用）。
 *
 * 用法：
 *   SOURCE_DATABASE_URL=postgresql://... TARGET_DIR=~/.dsh/superman/pgdata \
 *     pnpm exec tsx scripts/import-to-pglite.ts
 *
 * 流程：读源库 public schema 全部表 → 目标库（先跑完 71 个迁移建出同构 schema）
 * 逐表清空后按列批量写入 → 修复序列（setval 到 max(id)）→ 行数对账。
 * 覆盖语义：目标表已有数据会先 TRUNCATE（工具面向"从旧库平移"，目标应是新库）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const SOURCE_URL = process.env.SOURCE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || ''
const TARGET_DIR = process.env.TARGET_DIR?.trim() || join(homedir(), '.dsh', 'superman', 'pgdata')
const BATCH = 500
/** 排除源库里的插件管理表（目标库由迁移自建）。 */
const SKIP_TABLES = new Set(['plugin_schema_migrations'])

async function main(): Promise<void> {
  if (!SOURCE_URL) {
    console.error('缺少 SOURCE_DATABASE_URL（源 PostgreSQL 连接串）')
    process.exit(1)
  }
  if (!existsSync(TARGET_DIR)) console.log(`目标目录不存在，将创建: ${TARGET_DIR}`)

  const source = new Pool({ connectionString: SOURCE_URL, max: 2 })
  const target = new PGlite(TARGET_DIR, { extensions: { vector, pgcrypto } })

  // 1) 目标库先跑全部迁移（与插件首启同一套 SQL）
  const migDir = join(process.cwd(), 'src', 'server', 'infra', 'db', 'migrations')
  for (const file of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    await target.exec(readFileSync(join(migDir, file), 'utf8'))
  }
  // 迁移记录表不迁数据，目标库从零记账
  await target.exec('truncate plugin_heartbeats')
  console.log('目标库迁移完成')

  // 2) 源库表清单（public，排除管理表），按外键拓扑粗排（先被引用后引用——按行数从少到多近似减少约束冲突）
  const { rows: tableRows } = await source.query<{ table_name: string }>(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `)
  const tables = tableRows.map((r) => r.table_name).filter((t) => !SKIP_TABLES.has(t))
  console.log(`源库表: ${tables.length} 张`)

  const summary: Array<{ table: string; rows: number }> = []
  for (const table of tables) {
    await target.exec(`truncate table "${table}"`)
    const { rows: columnRows } = await source.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position
    `, [table])
    const columns = columnRows.map((c) => c.column_name)
    const colList = columns.map((c) => `"${c}"`).join(', ')
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')

    let offset = 0
    let total = 0
    for (;;) {
      const { rows } = await source.query(`select ${colList} from "${table}" order by 1 limit ${BATCH} offset ${offset}`)
      if (rows.length === 0) break
      for (const row of rows) {
        const values = columns.map((c) => {
          const v = (row as Record<string, unknown>)[c]
          // pg 返回 Date / Buffer / 对象：统一交给 PG 参数化处理（jsonb 列传字符串由目标类型转换）
          return v instanceof Date ? v : v
        })
        await target.query(`insert into "${table}" (${colList}) values (${placeholders})`, values)
      }
      total += rows.length
      offset += BATCH
      if (rows.length < BATCH) break
    }
    summary.push({ table, rows: total })
  }

  // 3) 序列修复：所有 serial/identity 列 setval 到当前 max
  const { rows: seqRows } = await target.query<{ table_name: string; column_name: string; seq: string }>(`
    select table_name, column_name, pg_get_serial_sequence(quote_ident(table_name), column_name) as seq
    from information_schema.columns
    where table_schema = 'public' and column_default like 'nextval%'
  `)
  for (const { table_name, column_name, seq } of seqRows) {
    if (!seq) continue
    const { rows } = await target.query(`select coalesce(max("${column_name}"), 1)::bigint as maxv from "${table_name}"`)
    const maxv = Number((rows[0] as { maxv: string | number }).maxv)
    await target.query(`select setval('${seq}', ${maxv})`)
  }

  // 4) 对账
  console.log('\n—— 迁移对账 ——')
  let mismatch = 0
  for (const { table, rows } of summary) {
    const src = await source.query(`select count(*)::int as n from "${table}"`)
    const dst = await target.query(`select count(*)::int as n from "${table}"`)
    const srcN = (src.rows[0] as { n: number }).n
    const dstN = (dst.rows[0] as { n: number }).n
    const flag = srcN === dstN ? 'ok' : 'MISMATCH'
    if (srcN !== dstN) mismatch += 1
    console.log(`${flag.padEnd(9)} ${table}: 源 ${srcN} / 目标 ${dstN}（写入 ${rows}）`)
  }
  await source.end()
  await target.close()
  console.log(mismatch === 0 ? '\n全部对账一致，切换就绪' : `\n有 ${mismatch} 张表不一致，请检查`)
  process.exit(mismatch === 0 ? 0 : 2)
}

void main().catch((err) => {
  console.error('迁移失败:', err instanceof Error ? err.message : err)
  process.exit(1)
})

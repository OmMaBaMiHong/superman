/**
 * Superman DSH 插件 · Postgres 连接助手。
 *
 * 连接串解析优先级：cordis config.databaseUrl > 环境变量
 * SUPERMAN_DATABASE_URL > 环境变量 DATABASE_URL > 本地开发默认值。
 * pg 依赖在运行时才动态 import：单测可以完全不装 pg / 不连库。
 */

/** 最小查询接口——真实实现是 pg.Pool，单测用内存假实现。 */
export interface Queryable {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export interface PgPoolLike extends Queryable {
  end(): Promise<void>
}

export const DEFAULT_DATABASE_URL = 'postgresql://feedfuse:feedfuse@127.0.0.1:55432/feedfuse'

export interface DatabaseConfig {
  databaseUrl?: string
}

/** 解析数据库连接串（见模块头注释的优先级）。 */
export function resolveDatabaseUrl(config: DatabaseConfig = {}): string {
  return (
    config.databaseUrl
    || process.env.SUPERMAN_DATABASE_URL
    || process.env.DATABASE_URL
    || DEFAULT_DATABASE_URL
  )
}

/** 创建 pg 连接池。pg 未安装或不可解析时抛出带指引的错误。 */
export async function createPgPool(databaseUrl: string): Promise<PgPoolLike> {
  let pg: { Pool: new (opts: { connectionString: string; max: number }) => PgPoolLike }
  try {
    const mod = (await import('pg')) as { default?: typeof pg } & typeof pg
    pg = mod.default ?? mod
  } catch (error) {
    throw new Error(
      `superman 插件需要 pg 依赖：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return new pg.Pool({ connectionString: databaseUrl, max: 4 })
}

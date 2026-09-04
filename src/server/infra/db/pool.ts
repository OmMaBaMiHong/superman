import { Pool } from 'pg';
import { getServerEnv } from '@/server/infra/env';

const POOL_CONFIG = {
  // 连接池上限，与 pgboss 的 worker 连接数保持合理间距
  max: 10,
  // 获取新连接的超时 —— 超过此时间还连不上就直接报错，不卡住请求
  connectionTimeoutMillis: 5_000,
  // 空闲连接存活时间 —— 超过此时间没有查询就自动关闭，释放资源
  idleTimeoutMillis: 30_000,
  // TCP 保活 —— 让操作系统层检测半开连接，默认 2h 太长了
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // 单条查询超时 —— 超过 15s 未返回结果，pg 驱动自动取消查询并释放连接
  query_timeout: 15_000,
  // PostgreSQL 侧的 statement 超时 —— 超过 15s 自动中断查询，防止死锁/Long-running query 占用连接
  statement_timeout: 15_000,
};

let pool: Pool | null = null;

function createPool(): Pool {
  const { DATABASE_URL } = getServerEnv();
  const p = new Pool({ connectionString: DATABASE_URL, ...POOL_CONFIG });

  // 静默吞掉池内连接级别的错误 —— 单个连接断开不应影响应用
  p.on('error', (err) => {
    console.error('[db] pool connection error:', err.message);
  });

  return p;
}

export function getPool(): Pool {
  if (pool) {
    // 快速检查池是否还活着：如果池已经结束，重新创建
    if (pool.ended) {
      pool = createPool();
    }
    return pool;
  }
  pool = createPool();
  return pool;
}

/**
 * 优雅关闭连接池，通常在应用退出时调用。
 */
export async function closePool(): Promise<void> {
  if (pool && !pool.ended) {
    await pool.end();
    pool = null;
  }
}

/**
 * 注册进程退出时的优雅关闭回调。
 *
 * 作为兜底安全网——当进程收到 SIGTERM/SIGINT 时自动释放连接池，
 * 防止数据库连接残留导致容器重启后出现半开连接。
 *
 * 每个模块生命周期内只注册一次，多次调用是安全的（no-op）。
 */
let shutdownRegistered = false;

export function registerPoolShutdown(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const handler = () => {
    void closePool().catch((err) => {
      console.error('[db] error during pool shutdown:', err);
    });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

// 模块加载时自动注册，确保任何入口（next server / worker）都能收到信号。
registerPoolShutdown();

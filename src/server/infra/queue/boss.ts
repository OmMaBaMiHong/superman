import { PgBoss } from 'pg-boss';
import { getServerEnv } from '@/server/infra/env';
import { attachBossObservers } from '@/server/infra/queue/observability';

/**
 * PgBoss 内部使用独立的 pg Pool，必须配置超时参数防止后台任务连接泄露。
 *
 * 这些参数与主连接池（pool.ts）保持一致：
 * - connectionTimeoutMillis: 5s 连不上直接报错
 * - idleTimeoutMillis: 30s 空闲连接自动关闭
 * - max: 5 个 worker 连接（排队任务不需要太多，多于主池的 10 个即可）
 * - statement_timeout: 15s 单条查询超时
 */
const BOSS_POOL_OPTIONS = {
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  max: 5,
  statement_timeout: 15_000,
};

let boss: PgBoss | null = null;
let startPromise: Promise<PgBoss> | null = null;

export function getBoss(): PgBoss {
  if (boss) return boss;
  const { DATABASE_URL } = getServerEnv();
  boss = new PgBoss({ connectionString: DATABASE_URL, ...BOSS_POOL_OPTIONS });
  attachBossObservers(boss);
  return boss;
}

export async function startBoss(): Promise<PgBoss> {
  if (startPromise) return startPromise;
  const instance = getBoss();
  startPromise = instance
    .start()
    .then(() => instance)
    .catch((err) => {
      startPromise = null;
      throw err;
    });
  return startPromise;
}

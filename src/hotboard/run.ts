/**
 * 热榜同步入口 —— 采集 → 入库（复用 core 的 trendradar 表与 upsert 契约）。
 *
 * 独立插件的调度器（host/jobs/scheduler，提取后接线）周期调用 runHotboardSync；
 * CLI 形态 `pnpm hotboard:sync` 也走这里，便于单独联调。
 *
 * 与旧链路的关系：替换 servicesKeeper.spawnTrendRadar + core sync 读外部
 * SQLite 的方案；trend_radar_items 表、看板、agent 工具（superman_*）全部
 * 零改动复用。
 */
import { collectHotboard } from './collector.js';
import { upsertTrendRadarItems } from '@/core/trendradar/repository';
import type { Queryable } from '../plugin/host/db.js';

/** 单用户内核：独立插件默认以初始管理员身份写入（与 tools.ts 的 AGENT_USER_ID 一致）。 */
const DEFAULT_USER_ID = '1';

export interface HotboardSyncOptions {
  /** pg Pool / PoolClient 或兼容 Queryable（PGlite 适配后同一形状） */
  db: Queryable;
  userId?: string;
  env?: NodeJS.ProcessEnv;
  /** 订阅制：只采集勾选的平台 key（空数组 = 未勾选 → 不采集） */
  platforms?: string[];
}

export interface HotboardSyncSummary {
  upserted: number;
  okChannels: string[];
  failedChannels: Array<{ id: string; error: string }>;
}

export async function runHotboardSync(options: HotboardSyncOptions): Promise<HotboardSyncSummary> {
  const result = await collectHotboard(options.env, { platforms: options.platforms });
  // repository 的 DbClient 是 pg 具体类型，但实现只依赖 db.query；
  // PGlite 适配层 query 形状一致，此处收窄断言以保持 core 零改动。
  const db = options.db as unknown as Parameters<typeof upsertTrendRadarItems>[0];
  const upsert = await upsertTrendRadarItems(db, result.items, options.userId ?? DEFAULT_USER_ID);

  return {
    upserted: upsert.upserted,
    okChannels: result.channels.filter((c) => c.ok).map((c) => c.channelId),
    failedChannels: result.channels
      .filter((c) => !c.ok && c.error)
      .map((c) => ({ id: c.channelId, error: c.error ?? 'unknown' })),
  };
}

/** CLI：`pnpm hotboard:sync` —— 配了连接串走 Postgres；零配置走 PGlite（自动跑迁移）。 */
async function cliMain(): Promise<void> {
  const dbmod = await import('../plugin/host/db.js');
  const hasExplicitUrl = Boolean(
    process.env.SUPERMAN_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim(),
  );
  let pool: Awaited<ReturnType<typeof dbmod.createPgPool>>;
  if (hasExplicitUrl) {
    pool = await dbmod.createPgPool(dbmod.resolveDatabaseUrl());
  } else {
    // PGlite 零配置：与插件运行时同一份本地库（~/.dsh/superman-plugin/pgdata），
    // 先补迁移再同步，DSH 装载后看板直接有数据。
    // 防双开护栏：PGlite 单实例，DSH 宿主在跑时直连会崩库（2026-10-27 事故）
    const { spawnSync } = await import('node:child_process');
    const dshRunning = spawnSync('pgrep', ['-f', 'dsh-desktop-host'], { encoding: 'utf8' });
    if ((dshRunning.status ?? 1) === 0) {
      console.error('[hotboard] DSH 宿主正在运行（PGlite 单实例）。请先退出 DeepSeek Harness 再执行本命令。');
      process.exitCode = 1;
      return;
    }
    const { createQueryableStorage } = await import('../plugin/host/pgliteAdapter.js');
    const { loadMigrations, runMigrations } = await import('../plugin/host/scheduler.js');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const storage = await createQueryableStorage({ storageMode: 'pglite' }, dbmod.createPgPool);
    pool = storage.db;
    // src 布局路径（tsx 直跑）；dist 形态走插件运行时，不经此 CLI 分支
    await runMigrations(pool, loadMigrations(join(here, '../../kernel/server/infra/db/migrations')));
    await runMigrations(pool, loadMigrations(join(here, '../plugin/host/migrations')));
    console.log(`[hotboard] PGlite（${storage.detail}）迁移就绪`);
  }
  try {
    const summary = await runHotboardSync({ db: pool });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await (pool as { end?: () => Promise<void> }).end?.().catch(() => {});
  }
}

const isCli = process.argv[1]?.includes('hotboard');
if (isCli) {
  cliMain().catch((err) => {
    console.error('[hotboard] sync failed:', err);
    process.exitCode = 1;
  });
}

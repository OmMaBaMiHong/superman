/**
 * pg-boss 定时 job `trendradar.sync`（热点雷达主链路）：
 * 每 30 分钟读 TrendRadar 的 output/news/YYYY-MM-DD.db（当天 SQLite），
 * 全量 upsert 进 trend_radar_items。文件不存在说明 TrendRadar 今天还没跑，
 * 跳过不报错。upsert 幂等——同一 SQLite 反复同步不产生重复行。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { getServerEnv } from '@/server/infra/env';
import { upsertTrendRadarItems } from '@/core/trendradar/repository';
import {
  readTrendRadarSqliteItems,
  type TrendRadarSqliteItem,
} from '@/core/trendradar/sqlite';

const DEFAULT_TRENDRADAR_HOME = '/Users/wade/work-space/pa-chong-cai-ji/TrendRadar';

export function resolveTrendRadarDbPath(home: string, date: string): string {
  return path.join(home, 'output', 'news', `${date}.db`);
}

export interface TrendRadarSyncResult {
  status: 'ok' | 'skipped_no_db';
  dbPath: string;
  upserted: number;
  platforms: number;
}

export async function runTrendRadarSync(input: {
  pool: Pool;
  userId: string;
  /** YYYY-MM-DD；缺省今天（本地时区，与 TrendRadar 的文件命名一致）。 */
  date?: string;
  /** 测试注入：覆盖 TrendRadar 根目录与读取器。 */
  trendRadarHome?: string;
  readItems?: (dbPath: string) => Promise<TrendRadarSqliteItem[]>;
}): Promise<TrendRadarSyncResult> {
  const home =
    input.trendRadarHome ?? getServerEnv().TRENDRADAR_HOME ?? DEFAULT_TRENDRADAR_HOME;
  const date =
    input.date ??
    (() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    })();
  const dbPath = resolveTrendRadarDbPath(home, date);

  if (!existsSync(dbPath)) {
    return { status: 'skipped_no_db', dbPath, upserted: 0, platforms: 0 };
  }

  const readItems =
    input.readItems ??
    ((target: string) =>
      readTrendRadarSqliteItems(target, {
        pythonBin: process.env.TRENDRADAR_PYTHON,
      }));
  const items = await readItems(dbPath);

  const result = await upsertTrendRadarItems(
    input.pool,
    items.map((item) => ({
      platform: item.platform,
      platformName: item.platformName,
      title: item.title,
      url: item.url,
      rank: item.rank,
      sourceDate: date,
      firstSeenAt: item.firstCrawlTime,
      lastSeenAt: item.lastCrawlTime,
      payload: {
        via: 'sqlite_sync',
        mobileUrl: item.mobileUrl,
        previousRank: item.previousRank,
        crawlCount: item.crawlCount,
      },
    })),
    input.userId,
  );

  return {
    status: 'ok',
    dbPath,
    upserted: result.upserted,
    platforms: new Set(items.map((item) => item.platform)).size,
  };
}

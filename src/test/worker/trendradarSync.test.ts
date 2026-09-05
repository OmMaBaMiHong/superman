import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import Database from 'better-sqlite3';
import {
  resolveTrendRadarDbPath,
  runTrendRadarSync,
} from '@/worker/trendradarSync';

const DATE = '2026-09-05';

function seedTrendRadarDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    create table platforms (id text primary key, name text not null);
    create table news_items (
      id integer primary key autoincrement,
      title text not null,
      platform_id text not null,
      rank integer not null,
      url text default '',
      mobile_url text default '',
      first_crawl_time text not null,
      last_crawl_time text not null,
      crawl_count integer default 1
    );
    create table rank_history (
      id integer primary key autoincrement,
      news_item_id integer not null,
      rank integer not null,
      crawl_time text not null
    );
  `);
  db.prepare('insert into platforms(id, name) values (?, ?)').run('weibo', '微博');
  db.prepare('insert into platforms(id, name) values (?, ?)').run('zhihu', '知乎');
  const insertItem = db.prepare(
    `insert into news_items(title, platform_id, rank, url, first_crawl_time, last_crawl_time, crawl_count)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertItem.run('手机涨价', 'weibo', 2, 'https://s.weibo.com/a', '2026-09-05 09:00:00', '2026-09-05 10:00:00', 2);
  insertItem.run('知乎热题', 'zhihu', 1, 'https://www.zhihu.com/q/1', '2026-09-05 09:00:00', '2026-09-05 10:00:00', 1);
  const insertRank = db.prepare(
    'insert into rank_history(news_item_id, rank, crawl_time) values (?, ?, ?)',
  );
  // 微博条目：上次第 5 → 这次第 2（上升）
  insertRank.run(1, 5, '2026-09-05 09:00:00');
  insertRank.run(1, 2, '2026-09-05 10:00:00');
  insertRank.run(2, 1, '2026-09-05 10:00:00');
  db.close();
}

describe('worker trendradarSync', () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('当天 SQLite 不存在 → skipped_no_db，不写库不报错', async () => {
    home = mkdtempSync(path.join(tmpdir(), 'trendradar-empty-'));
    const pool = { query: vi.fn() } as unknown as Pool;

    const result = await runTrendRadarSync({
      pool,
      userId: '1',
      date: DATE,
      trendRadarHome: home,
    });

    expect(result.status).toBe('skipped_no_db');
    expect(result.upserted).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('读真实 SQLite 并 upsert；同一文件跑两遍幂等（同键 on conflict 合并）', async () => {
    home = mkdtempSync(path.join(tmpdir(), 'trendradar-seed-'));
    mkdirSync(path.join(home, 'output', 'news'), { recursive: true });
    const dbPath = resolveTrendRadarDbPath(home, DATE);
    seedTrendRadarDb(dbPath);

    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;

    const first = await runTrendRadarSync({
      pool,
      userId: '1',
      date: DATE,
      trendRadarHome: home,
    });
    expect(first.status).toBe('ok');
    expect(first.upserted).toBe(2);
    expect(first.platforms).toBe(2);

    const query = pool.query as ReturnType<typeof vi.fn>;
    const firstRunParams = query.mock.calls.map((call) => call[1]);
    // upsert 语句带唯一键冲突合并，重复跑不产生重复行
    expect(String(query.mock.calls[0][0])).toContain(
      'on conflict (user_id, platform, url, source_date) do update',
    );
    // user 隔离 + 平台名 + 排名
    expect(firstRunParams[0][0]).toBe('1');
    expect(firstRunParams[0][1]).toBe('weibo');
    expect(firstRunParams[0][2]).toBe('微博');
    expect(firstRunParams[0][5]).toBe(2);
    // previousRank 进 payload_json
    const payload = JSON.parse(String(firstRunParams[0][9]));
    expect(payload.previousRank).toBe(5);
    expect(payload.via).toBe('sqlite_sync');

    // 第二遍：完全相同的写入参数（幂等），行数不变
    const second = await runTrendRadarSync({
      pool,
      userId: '1',
      date: DATE,
      trendRadarHome: home,
    });
    expect(second.upserted).toBe(2);
    const secondRunParams = query.mock.calls.slice(2).map((call) => call[1]);
    expect(secondRunParams).toEqual(firstRunParams);
  });

  it('better-sqlite3 不可用时回落 python（注入 readItems 模拟）', async () => {
    home = mkdtempSync(path.join(tmpdir(), 'trendradar-fallback-'));
    mkdirSync(path.join(home, 'output', 'news'), { recursive: true });
    seedTrendRadarDb(resolveTrendRadarDbPath(home, DATE));
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;

    const result = await runTrendRadarSync({
      pool,
      userId: '1',
      date: DATE,
      trendRadarHome: home,
      readItems: async () => [
        {
          platform: 'weibo',
          platformName: '微博',
          title: '回落条目',
          url: 'https://s.weibo.com/x',
          mobileUrl: null,
          rank: 1,
          previousRank: null,
          crawlCount: 1,
          firstCrawlTime: null,
          lastCrawlTime: null,
        },
      ],
    });

    expect(result.status).toBe('ok');
    expect(result.upserted).toBe(1);
    expect(String((pool.query as ReturnType<typeof vi.fn>).mock.calls[0][1][3])).toContain(
      '回落条目',
    );
  });
});

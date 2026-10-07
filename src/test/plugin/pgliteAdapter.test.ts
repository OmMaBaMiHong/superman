import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PglitePool, resolveStorageMode } from '../../plugin/host/pgliteAdapter';
import { loadMigrations, runMigrations } from '../../plugin/host/scheduler';
import { createLocalQueueDriver } from '../../server/infra/queue/localDriver';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ffw-pglite-'));
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('plugin/host/pgliteAdapter · 存储形态解析', () => {
  it('显式配置优先；auto 规则：真实连接串 → pg，未配置 → pglite', () => {
    expect(resolveStorageMode({ storageMode: 'pglite' })).toBe('pglite');
    expect(resolveStorageMode({ storageMode: 'pg', databaseUrl: undefined })).toBe('pg');
    expect(resolveStorageMode({ databaseUrl: 'postgresql://x' })).toBe('pg');
    delete process.env.SUPERMAN_DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(resolveStorageMode({})).toBe('pglite');
    process.env.DATABASE_URL = 'postgresql://y';
    expect(resolveStorageMode({})).toBe('pg');
    delete process.env.DATABASE_URL;
  });
});

describe('plugin/host/pgliteAdapter · 真库行为', () => {
  it('参数查询、多语句、connect 事务互斥', async () => {
    const pool = await PglitePool.open(dir);
    try {
      await pool.query('create table t(id int primary key, v text)');
      await pool.query('insert into t values (1, $1), (2, $2)', ['a', 'b']);
      expect((await pool.query('select count(*)::int as n from t')).rows[0].n).toBe(2);

      // 无参数多语句（迁移 DDL 形态）：执行成功，行集按"多语句无行"返回
      expect((await pool.query('create table t2(id int); insert into t2 values (7);')).rows).toEqual([]);

      // connect 事务：会话期间普通 query 排队（互斥），begin/commit 语义成立
      const client = await pool.connect();
      const probe = pool.query('select 1::int as one');
      await client.query('begin');
      await client.query('insert into t values (3, $1)', ['c']);
      const insideTx = await client.query('select count(*)::int as n from t');
      expect(insideTx.rows[0].n).toBe(3);
      await client.query('commit');
      client.release();
      const after = await pool.query('select count(*)::int as n from t');
      expect(after.rows[0].n).toBe(3);
      await probe; // release 后普通查询应恢复执行
    } finally {
      await pool.end();
    }
  });

  it('现有 71 个 PG 迁移在 PGlite 上全部通过（扩展注册含 vector/pgcrypto）', async () => {
    const pool = await PglitePool.open(dir);
    try {
      const migDir = join(process.cwd(), 'src', 'server', 'infra', 'db', 'migrations');
      const applied = await runMigrations(pool, loadMigrations(migDir));
      const expected = readdirSync(migDir).filter((f) => f.endsWith('.sql')).length;
      expect(applied.length).toBe(expected);
      const tables = await pool.query(
        "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
      );
      expect((tables.rows[0] as { n: number }).n).toBeGreaterThan(40);
    } finally {
      await pool.end();
    }
  });

  it('本地队列驱动：入队落 plugin_queue_events，pg-boss 不被触碰', async () => {
    const pool = await PglitePool.open(dir);
    try {
      await pool.query(`create table plugin_queue_events (
        id bigserial primary key, queue_name text not null,
        payload jsonb not null default '{}'::jsonb, options jsonb,
        job_ref text not null, created_at timestamptz not null default now())`);
      const driver = createLocalQueueDriver(pool);
      const result = await driver.enqueue('pipeline.rewrite', { jobId: 'j1', userId: 'u1' }, { retryLimit: 3 });
      expect(result.status).toBe('enqueued');
      const rows = await pool.query('select queue_name, job_ref from plugin_queue_events');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].queue_name).toBe('pipeline.rewrite');
    } finally {
      await pool.end();
    }
  });
});

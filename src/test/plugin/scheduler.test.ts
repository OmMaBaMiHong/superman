import { describe, expect, it, vi } from 'vitest';
import { loadMigrations, runMigrations, startHeartbeat, writeHeartbeat } from '@/plugin/host/scheduler';
import type { Queryable } from '@/plugin/host/db';

/** 内存假库：记录所有 SQL，按名称假装迁移已应用。 */
function makeFakeDb(appliedNames: string[] = []) {
  const calls: { text: string; params?: readonly unknown[] }[] = [];
  const db: Queryable = {
    async query(text: string, params?: readonly unknown[]) {
      calls.push({ text, params });
      if (text.startsWith('SELECT 1 FROM plugin_schema_migrations')) {
        return { rows: appliedNames.includes(String(params?.[0])) ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    },
  };
  return { db, calls };
}

describe('plugin/host/scheduler', () => {
  it('loadMigrations 读取并排序 SQL 文件', () => {
    const migrations = loadMigrations('src/plugin/host/migrations');
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]!.name).toBe('0001_plugin_heartbeat.sql');
    expect(migrations[0]!.sql).toContain('plugin_heartbeats');
  });

  it('runMigrations 只应用未执行过的迁移并登记', async () => {
    const { db, calls } = makeFakeDb(['0001_plugin_heartbeat.sql']);
    const applied = await runMigrations(db, [
      { name: '0001_plugin_heartbeat.sql', sql: 'CREATE TABLE x' },
      { name: '0002_next.sql', sql: 'CREATE TABLE y' },
    ]);
    expect(applied).toEqual(['0002_next.sql']);
    expect(calls.some((c) => c.text === 'CREATE TABLE x')).toBe(false);
    expect(calls.some((c) => c.text === 'CREATE TABLE y')).toBe(true);
  });

  it('writeHeartbeat 写入 plugin_heartbeats', async () => {
    const { db, calls } = makeFakeDb();
    await writeHeartbeat(db, 'superman', { pid: 1 });
    const insert = calls.find((c) => c.text.includes('INSERT INTO plugin_heartbeats'));
    expect(insert).toBeDefined();
    expect(insert!.params?.[0]).toBe('superman');
  });

  it('startHeartbeat 启动即写一条，stop 后不再写', async () => {
    vi.useFakeTimers();
    try {
      const { db, calls } = makeFakeDb();
      const handle = startHeartbeat(db, 'superman', { intervalMs: 60_000 });
      await vi.advanceTimersByTimeAsync(0);
      const beats = () => calls.filter((c) => c.text.includes('INSERT INTO plugin_heartbeats')).length;
      expect(beats()).toBe(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(beats()).toBe(2);
      handle.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(beats()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('beatOnStart: false 时启动不写，到点才写', async () => {
    vi.useFakeTimers();
    try {
      const { db, calls } = makeFakeDb();
      const handle = startHeartbeat(db, 'superman', { intervalMs: 1000, beatOnStart: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.filter((c) => c.text.includes('INSERT INTO plugin_heartbeats')).length).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls.filter((c) => c.text.includes('INSERT INTO plugin_heartbeats')).length).toBe(1);
      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('plugin/host/scheduler · 心跳幂等（K1 遗留修复）', () => {
  it('窗口内已有心跳则跳过写入（双 apply 不双写）', async () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    const calls: { text: string; params?: readonly unknown[] }[] = [];
    const db = {
      async query(text: string, params?: readonly unknown[]) {
        calls.push({ text, params });
        if (text.includes('SELECT created_at FROM plugin_heartbeats')) {
          return { rows: [{ created_at: recent }] };
        }
        return { rows: [] };
      },
    };
    const { writeHeartbeatIfDue } = await import('@/plugin/host/scheduler');
    const wrote = await writeHeartbeatIfDue(db, 'superman', 60_000);
    expect(wrote).toBe(false);
    expect(calls.some((c) => c.text.includes('INSERT INTO plugin_heartbeats'))).toBe(false);
  });

  it('超过窗口才重新写入', async () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    const calls: { text: string }[] = [];
    const db = {
      async query(text: string) {
        calls.push({ text });
        if (text.includes('SELECT created_at FROM plugin_heartbeats')) {
          return { rows: [{ created_at: old }] };
        }
        return { rows: [] };
      },
    };
    const { writeHeartbeatIfDue } = await import('@/plugin/host/scheduler');
    const wrote = await writeHeartbeatIfDue(db, 'superman', 60_000);
    expect(wrote).toBe(true);
    expect(calls.some((c) => c.text.includes('INSERT INTO plugin_heartbeats'))).toBe(true);
  });
});

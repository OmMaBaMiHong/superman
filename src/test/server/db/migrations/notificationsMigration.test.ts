import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('db migrations / 0054_notifications', () => {
  const migrationPath = 'src/server/infra/db/migrations/0054_notifications.sql';

  it('创建 notifications 表（全字段 + kind check 约束）', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists notifications');
    for (const column of ['user_id', 'kind', 'title', 'body', 'link', 'read_at', 'created_at']) {
      expect(sql).toContain(column);
    }
    for (const kind of ['fetch_failed', 'pending_backlog', 'pipeline_done', 'redraft_done', 'system']) {
      expect(sql).toContain(`'${kind}'`);
    }
  });

  it('幂等：全部 if not exists，可重复执行', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('create table if not exists');
    expect(sql).not.toMatch(/create table(?! if not exists)/);
    expect(sql).not.toMatch(/create (unique )?index(?! if not exists)/);
  });

  it('插件侧镜像存在且同表结构', () => {
    const mirrorPath = 'src/plugin/host/migrations/0002_notifications.sql';
    expect(existsSync(mirrorPath)).toBe(true);
    const sql = readFileSync(mirrorPath, 'utf8');
    expect(sql).toContain('create table if not exists notifications');
    expect(sql).toContain('idx_notifications_user_read');
  });
});

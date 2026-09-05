import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('db migrations / 0052_trend_radar', () => {
  const migrationPath = 'src/server/infra/db/migrations/0052_trend_radar.sql';

  it('创建 trend_radar_items 表（全字段）', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists trend_radar_items');
    for (const column of [
      'user_id',
      'platform',
      'title',
      'url',
      'rank',
      'hot_value',
      'first_seen_at',
      'last_seen_at',
      'payload_json',
      'source_date',
      'promoted_at',
      'promoted_article_id',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('幂等：全部语句 if not exists / drop if exists，可重复执行', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('create table if not exists');
    expect(sql).toContain('create unique index if not exists');
    expect(sql).toContain('drop constraint if exists feeds_kind_check');
    // 不允许出现不带 if not exists 的 create table/index
    expect(sql).not.toMatch(/create table(?! if not exists)/);
    expect(sql).not.toMatch(/create (unique )?index(?! if not exists)/);
  });

  it('唯一约束覆盖 user_id + platform + url + source_date', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain(
      'on trend_radar_items (user_id, platform, url, source_date)',
    );
  });

  it('放宽 feeds.kind 约束以容纳 trend_radar 合成 feed', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("'trend_radar'");
    expect(sql).toContain('feeds_kind_check');
  });
});

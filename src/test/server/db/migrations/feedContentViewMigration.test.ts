import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('db migrations', () => {
  it('adds content view to feeds', () => {
    const migrationPath = 'src/server/infra/db/migrations/0038_feed_content_view.sql';
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('alter table feeds');
    expect(sql).toContain('add column if not exists view');
    expect(sql).toContain('feeds_view_check');
    expect(sql).toContain("'article'");
    expect(sql).toContain("'video'");
    expect(sql).toContain("'social'");
    expect(sql).toContain("rsshub://youtube/%");
    expect(sql).toContain("youtube.com/%");
    expect(sql).toContain("set view = 'video'");
  });
});

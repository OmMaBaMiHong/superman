import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'src/server/infra/db/migrations/0045_github_module.sql';

describe('db migrations', () => {
  it('adds the github module schema', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists github_repo_subscriptions');
    expect(sql).toContain('feed_id                   bigint primary key references feeds(id) on delete cascade');
    expect(sql).toContain('content_types             text[] not null');
    expect(sql).toContain('create table if not exists github_article_items');
    expect(sql).toContain('article_id     bigint primary key references articles(id) on delete cascade');
    expect(sql).toContain('github_repo_subscriptions_user_repo_unique');
    expect(sql).toContain('github_article_items_feed_type_ghid_unique');
    expect(sql).toContain('add column if not exists github_token_encrypted');
    expect(sql).toContain('add column if not exists secret_encryption_key');
  });

  it('widens feeds kind/view checks by dropping them first (existing-database safety)', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    // 存量库里两个 constraint 已存在，必须先 drop 再重建，否则迁移直接失败。
    expect(sql).toContain('alter table feeds drop constraint if exists feeds_kind_check');
    expect(sql).toContain("check (kind in ('rss', 'ai_digest', 'github'))");
    expect(sql).toContain('alter table feeds drop constraint if exists feeds_view_check');
    expect(sql).toContain(
      "check (view in ('article', 'picture', 'video', 'social', 'digest', 'github'))",
    );
  });

  it('keeps every create statement idempotent', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    const createTables = sql.match(/create\s+table\s+(?!if not exists)/gi) ?? [];
    const createIndexes = sql.match(/create\s+(unique\s+)?index\s+(?!if not exists)/gi) ?? [];
    const addColumns = sql.match(/add\s+column\s+(?!if not exists)/gi) ?? [];

    expect(createTables).toHaveLength(0);
    expect(createIndexes).toHaveLength(0);
    expect(addColumns).toHaveLength(0);
  });

  it('pre-lands all four github content types for zero-migration P1 expansion', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("array['release', 'issue', 'pr', 'commit']::text[]");
    expect(sql).toContain("check (gh_type in ('release', 'issue', 'pr', 'commit'))");
  });
});

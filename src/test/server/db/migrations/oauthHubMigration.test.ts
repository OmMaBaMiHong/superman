import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'src/server/infra/db/migrations/0046_oauth_hub.sql';

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('0046_oauth_hub migration', () => {
  it('creates the three oauth hub tables', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readMigration();

    expect(sql).toContain('create table if not exists oauth_provider_configs');
    expect(sql).toContain('create table if not exists oauth_connections');
    expect(sql).toContain('create table if not exists oauth_auth_states');
  });

  it('keeps every create statement idempotent so re-running is safe', () => {
    const sql = readMigration();

    const createTables = sql.match(/create\s+table\s+(?!if not exists)/gi) ?? [];
    const createIndexes = sql.match(/create\s+(unique\s+)?index\s+(?!if not exists)/gi) ?? [];
    const addColumns = sql.match(/add\s+column\s+(?!if not exists)/gi) ?? [];

    expect(createTables).toHaveLength(0);
    expect(createIndexes).toHaveLength(0);
    expect(addColumns).toHaveLength(0);
  });

  it('constrains provider to the four supported platforms', () => {
    const sql = readMigration();

    const providerChecks =
      sql.match(/check\s*\(\s*provider\s+in\s*\('github',\s*'wechat',\s*'douyin',\s*'xiaohongshu'\)\s*\)/gi) ??
      [];

    // provider_configs / connections / auth_states 三张表都要约束。
    expect(providerChecks.length).toBeGreaterThanOrEqual(3);
  });

  it('stores credentials in encrypted columns only', () => {
    const sql = readMigration();

    expect(sql).toContain('client_secret_encrypted');
    expect(sql).toContain('access_token_encrypted');
    expect(sql).toContain('refresh_token_encrypted');
    expect(sql).toContain('code_verifier_encrypted');

    // 绝不允许出现明文列名。
    expect(sql).not.toMatch(/\bclient_secret\s+text/i);
    expect(sql).not.toMatch(/\baccess_token\s+text/i);
    expect(sql).not.toMatch(/\brefresh_token\s+text/i);
    expect(sql).not.toMatch(/\bcode_verifier\s+text/i);
  });

  it('scopes connections to a user and enforces per-account uniqueness', () => {
    const sql = readMigration();

    expect(sql).toContain('references users(id) on delete cascade');
    expect(sql).toContain('idx_oauth_connections_user_provider_account');
    expect(sql).toContain('idx_oauth_connections_user_id');
  });

  it('indexes auth state expiry for lazy cleanup', () => {
    const sql = readMigration();

    expect(sql).toContain('idx_oauth_auth_states_expires_at');
    expect(sql).toContain('expires_at');
  });

  it('constrains connection status to the documented state machine', () => {
    const sql = readMigration();

    expect(sql).toMatch(/check\s*\(\s*status\s+in\s*\('active',\s*'expired',\s*'revoked'\)\s*\)/i);
  });
});

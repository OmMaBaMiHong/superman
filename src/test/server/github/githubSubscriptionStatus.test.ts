import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

import { resolveGithubSyncStatus } from '@/server/domains/github/repositories/githubSubscriptionsRepo';
import { normalizeContentTypes } from '@/server/domains/github/types';

const NOW = new Date('2025-06-01T12:00:00.000Z');

function iso(offsetMinutes: number): string {
  return new Date(NOW.getTime() + offsetMinutes * 60_000).toISOString();
}

describe('resolveGithubSyncStatus', () => {
  it('从未同步过且无错误时为 idle', () => {
    expect(
      resolveGithubSyncStatus(
        {
          lastSyncAttemptAt: null,
          lastSyncedAt: null,
          lastErrorCode: null,
          rateLimitedUntil: null,
        },
        NOW,
      ),
    ).toBe('idle');
  });

  it('最近一次尝试已成功时为 idle', () => {
    expect(
      resolveGithubSyncStatus(
        {
          lastSyncAttemptAt: iso(-10),
          lastSyncedAt: iso(-10),
          lastErrorCode: null,
          rateLimitedUntil: null,
        },
        NOW,
      ),
    ).toBe('idle');
  });

  it('尝试时间晚于成功时间且无错误码时为 syncing', () => {
    expect(
      resolveGithubSyncStatus(
        {
          lastSyncAttemptAt: iso(-1),
          lastSyncedAt: iso(-30),
          lastErrorCode: null,
          rateLimitedUntil: null,
        },
        NOW,
      ),
    ).toBe('syncing');
  });

  it('存在未清除的错误码时为 error', () => {
    expect(
      resolveGithubSyncStatus(
        {
          lastSyncAttemptAt: iso(-1),
          lastSyncedAt: iso(-30),
          lastErrorCode: 'not_found',
          rateLimitedUntil: null,
        },
        NOW,
      ),
    ).toBe('error');
  });

  it('限流未到期时优先返回 rate_limited', () => {
    expect(
      resolveGithubSyncStatus(
        {
          lastSyncAttemptAt: iso(-1),
          lastSyncedAt: iso(-30),
          lastErrorCode: 'rate_limited',
          rateLimitedUntil: iso(30),
        },
        NOW,
      ),
    ).toBe('rate_limited');
  });

  it('限流已过期则回落到 error/idle 判定', () => {
    expect(
      resolveGithubSyncStatus(
        {
          lastSyncAttemptAt: iso(-40),
          lastSyncedAt: iso(-40),
          lastErrorCode: null,
          rateLimitedUntil: iso(-5),
        },
        NOW,
      ),
    ).toBe('idle');
  });
});

describe('normalizeContentTypes', () => {
  it('空值回退到 release', () => {
    expect(normalizeContentTypes(null)).toEqual(['release']);
    expect(normalizeContentTypes([])).toEqual(['release']);
    expect(normalizeContentTypes(undefined)).toEqual(['release']);
  });

  it('过滤未知类型并保留 release', () => {
    expect(normalizeContentTypes(['release', 'bogus'])).toEqual(['release']);
  });

  it('去重', () => {
    expect(normalizeContentTypes(['release', 'release'])).toEqual(['release']);
  });
});

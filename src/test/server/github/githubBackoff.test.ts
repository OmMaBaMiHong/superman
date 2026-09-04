import { describe, expect, it } from 'vitest';
import {
  computeNextSyncAt,
  GITHUB_ANONYMOUS_MIN_INTERVAL_MINUTES,
  GITHUB_RATE_LIMIT_MIN_COOLDOWN_MINUTES,
} from '@/server/domains/github/tasks/githubBackoff';

const NOW = new Date('2025-01-01T00:00:00.000Z');
const MINUTE_MS = 60_000;

function minutesFromNow(result: Date): number {
  return Math.round((result.getTime() - NOW.getTime()) / MINUTE_MS);
}

describe('computeNextSyncAt', () => {
  it('配置 Token 时按用户设置的间隔推进', () => {
    const next = computeNextSyncAt({ intervalMinutes: 15, hasToken: true, now: NOW });
    expect(minutesFromNow(next)).toBe(15);
  });

  it('未配置 Token 时把间隔强制抬到 60 分钟下限', () => {
    const next = computeNextSyncAt({ intervalMinutes: 15, hasToken: false, now: NOW });
    expect(minutesFromNow(next)).toBe(GITHUB_ANONYMOUS_MIN_INTERVAL_MINUTES);
  });

  it('未配置 Token 但间隔已高于下限时保持原值', () => {
    const next = computeNextSyncAt({ intervalMinutes: 180, hasToken: false, now: NOW });
    expect(minutesFromNow(next)).toBe(180);
  });

  it('连续失败按 2^n 指数退避', () => {
    expect(
      minutesFromNow(
        computeNextSyncAt({ intervalMinutes: 30, hasToken: true, consecutiveFailures: 1, now: NOW }),
      ),
    ).toBe(60);
    expect(
      minutesFromNow(
        computeNextSyncAt({ intervalMinutes: 30, hasToken: true, consecutiveFailures: 3, now: NOW }),
      ),
    ).toBe(240);
  });

  it('指数退避封顶 24 小时', () => {
    const next = computeNextSyncAt({
      intervalMinutes: 600,
      hasToken: true,
      consecutiveFailures: 10,
      now: NOW,
    });
    expect(minutesFromNow(next)).toBe(24 * 60);
  });

  it('限流熔断优先于指数退避，且不早于 5 分钟冷却下限', () => {
    const next = computeNextSyncAt({
      intervalMinutes: 30,
      hasToken: true,
      consecutiveFailures: 3,
      // 已过期的 rate limit reset：必须被抬到 now + 5min
      rateLimitedUntil: new Date(NOW.getTime() - 10 * MINUTE_MS).toISOString(),
      now: NOW,
    });
    expect(minutesFromNow(next)).toBe(GITHUB_RATE_LIMIT_MIN_COOLDOWN_MINUTES);
  });

  it('限流熔断时间在未来则原样采信', () => {
    const until = new Date(NOW.getTime() + 42 * MINUTE_MS);
    const next = computeNextSyncAt({
      intervalMinutes: 30,
      hasToken: true,
      rateLimitedUntil: until,
      now: NOW,
    });
    expect(next.toISOString()).toBe(until.toISOString());
  });

  it('非法的 rateLimitedUntil 被忽略并回退到正常间隔', () => {
    const next = computeNextSyncAt({
      intervalMinutes: 20,
      hasToken: true,
      rateLimitedUntil: 'not-a-date',
      now: NOW,
    });
    expect(minutesFromNow(next)).toBe(20);
  });

  it('非法间隔回退到匿名下限', () => {
    expect(
      minutesFromNow(computeNextSyncAt({ intervalMinutes: 0, hasToken: true, now: NOW })),
    ).toBe(GITHUB_ANONYMOUS_MIN_INTERVAL_MINUTES);
    expect(
      minutesFromNow(computeNextSyncAt({ intervalMinutes: Number.NaN, hasToken: true, now: NOW })),
    ).toBe(GITHUB_ANONYMOUS_MIN_INTERVAL_MINUTES);
  });
});

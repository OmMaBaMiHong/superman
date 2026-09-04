import {
  ANONYMOUS_MIN_INTERVAL_MINUTES,
  RATE_LIMIT_MIN_COOLDOWN_MINUTES,
  resolveEffectiveIntervalMinutes,
} from '@/server/integrations/github/githubRateLimit';

/**
 * 计算下一次同步计划时间（三态退避）。
 *
 * 1. 限流熔断：`rate_limited_until`（至少叠加 5 分钟冷却）
 * 2. 失败指数退避：区间 = 生效间隔 × 2^min(连续失败数, 4)，封顶 24 小时
 * 3. 正常：now + 生效间隔（匿名用户强制 ≥ 60 分钟）
 */
const MAX_BACKOFF_MINUTES = 24 * 60;
const MAX_FAILURE_EXPONENT = 4;
const MINUTE_MS = 60_000;

export interface ComputeNextSyncAtInput {
  intervalMinutes: number;
  hasToken: boolean;
  consecutiveFailures?: number;
  rateLimitedUntil?: string | Date | null;
  now?: Date;
}

export function computeNextSyncAt(input: ComputeNextSyncAtInput): Date {
  const now = input.now ?? new Date();
  const effectiveInterval = resolveEffectiveIntervalMinutes({
    intervalMinutes: input.intervalMinutes,
    hasToken: input.hasToken,
  });

  // 1) 限流熔断优先
  if (input.rateLimitedUntil) {
    const untilMs = new Date(input.rateLimitedUntil).getTime();
    if (!Number.isNaN(untilMs)) {
      const floor = now.getTime() + RATE_LIMIT_MIN_COOLDOWN_MINUTES * MINUTE_MS;
      return new Date(Math.max(untilMs, floor));
    }
  }

  // 2) 失败指数退避
  const failures = Math.max(0, Math.floor(input.consecutiveFailures ?? 0));
  if (failures > 0) {
    const factor = 2 ** Math.min(failures, MAX_FAILURE_EXPONENT);
    const backoffMinutes = Math.min(effectiveInterval * factor, MAX_BACKOFF_MINUTES);
    return new Date(now.getTime() + backoffMinutes * MINUTE_MS);
  }

  // 3) 正常间隔
  return new Date(now.getTime() + effectiveInterval * MINUTE_MS);
}

/** 供测试断言匿名下限。 */
export const GITHUB_ANONYMOUS_MIN_INTERVAL_MINUTES = ANONYMOUS_MIN_INTERVAL_MINUTES;
/** 供测试断言冷却下限。 */
export const GITHUB_RATE_LIMIT_MIN_COOLDOWN_MINUTES = RATE_LIMIT_MIN_COOLDOWN_MINUTES;

/**
 * GitHub 速率限制解析与熔断计算。
 *
 * 三条硬约束（arch §1.1 D1）：
 * 1. `x-ratelimit-remaining` 归零或 429 → 立即熔断，写 `rate_limited_until`；
 * 2. 熔断到期时间取 `max(x-ratelimit-reset, now + 5min)`，避免时钟漂移导致空转重试；
 * 3. 未配置 Token 时刷新间隔强制 ≥ 60 分钟（匿名配额 60 req/h，按 IP 计）。
 */

export interface GithubRateLimitSnapshot {
  /** 配额上限（匿名 60 / Token 5000），header 缺失时为 null */
  limit: number | null;
  /** 剩余配额，header 缺失时为 null */
  remaining: number | null;
  /** 配额重置时间（由 `x-ratelimit-reset` 的 Unix 秒推导） */
  resetAt: Date | null;
  /** `retry-after` 秒数（二级限流场景），header 缺失时为 null */
  retryAfterSeconds: number | null;
}

/** 无任何速率头时的空快照，避免调用方到处判 null。 */
export const EMPTY_RATE_LIMIT_SNAPSHOT: GithubRateLimitSnapshot = Object.freeze({
  limit: null,
  remaining: null,
  resetAt: null,
  retryAfterSeconds: null,
});

/** 限流熔断的最短冷却时间（分钟）。即便 GitHub 说立刻可重试，也至少等这么久。 */
export const RATE_LIMIT_MIN_COOLDOWN_MINUTES = 5;

/** 未配置 Token 时的最小刷新间隔（分钟）。匿名配额只有 60 req/h。 */
export const ANONYMOUS_MIN_INTERVAL_MINUTES = 60;

const MINUTE_MS = 60_000;

type HeaderBag = Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderBag | undefined | null, name: string): string | null {
  if (!headers) {
    return null;
  }

  // got 返回的 header 键已是小写，但手写测试夹具可能带大小写，这里统一兜底。
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseIntegerHeader(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }

  if (!/^-?\d+$/.test(raw)) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResetHeader(raw: string | null): Date | null {
  const seconds = parseIntegerHeader(raw);
  if (seconds === null || seconds <= 0) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `retry-after` 允许两种形态：`delta-seconds` 或 HTTP-date（RFC 7231）。
 * HTTP-date 形态换算成相对秒数，负数归零。
 */
function parseRetryAfterHeader(raw: string | null, now: Date): number | null {
  if (raw === null) {
    return null;
  }

  const seconds = parseIntegerHeader(raw);
  if (seconds !== null) {
    return Math.max(0, seconds);
  }

  const asDate = new Date(raw);
  if (Number.isNaN(asDate.getTime())) {
    return null;
  }

  return Math.max(0, Math.ceil((asDate.getTime() - now.getTime()) / 1000));
}

/** 从响应头解析速率快照。任何 header 缺失都不抛错，只置 null。 */
export function parseRateLimitHeaders(
  headers: HeaderBag | undefined | null,
  now: Date = new Date(),
): GithubRateLimitSnapshot {
  return {
    limit: parseIntegerHeader(readHeader(headers, 'x-ratelimit-limit')),
    remaining: parseIntegerHeader(readHeader(headers, 'x-ratelimit-remaining')),
    resetAt: parseResetHeader(readHeader(headers, 'x-ratelimit-reset')),
    retryAfterSeconds: parseRetryAfterHeader(readHeader(headers, 'retry-after'), now),
  };
}

/**
 * 判定是否命中限流。
 *
 * GitHub 有两套限流：
 * - 主配额耗尽：403 + `x-ratelimit-remaining: 0`
 * - 二级限流（abuse detection）：403/429 + `retry-after`
 */
export function isRateLimited(status: number, snapshot: GithubRateLimitSnapshot): boolean {
  if (status === 429) {
    return true;
  }

  if (status !== 403) {
    return false;
  }

  if (snapshot.remaining !== null && snapshot.remaining <= 0) {
    return true;
  }

  return snapshot.retryAfterSeconds !== null && snapshot.retryAfterSeconds > 0;
}

/**
 * 计算限流熔断到期时间：`max(resetAt, now + retryAfter, now + 5min)`。
 *
 * 下限 5 分钟是防御性设计——GitHub 偶发返回过期的 reset 时间，
 * 若直接采信会导致 worker 每分钟空转重试，反而加速击穿配额。
 */
export function resolveRateLimitedUntil(
  snapshot: GithubRateLimitSnapshot,
  now: Date = new Date(),
): Date {
  const candidates: number[] = [now.getTime() + RATE_LIMIT_MIN_COOLDOWN_MINUTES * MINUTE_MS];

  if (snapshot.resetAt) {
    candidates.push(snapshot.resetAt.getTime());
  }

  if (snapshot.retryAfterSeconds !== null && snapshot.retryAfterSeconds > 0) {
    candidates.push(now.getTime() + snapshot.retryAfterSeconds * 1000);
  }

  return new Date(Math.max(...candidates));
}

/**
 * 计算生效的刷新间隔。
 *
 * 未配置 Token 时强制抬到 60 分钟（arch OQ-6）：匿名配额按 IP 计，
 * 多用户实例会互相挤占，间隔低于 60min 会直接击穿。
 */
export function resolveEffectiveIntervalMinutes(input: {
  intervalMinutes: number;
  hasToken: boolean;
}): number {
  const base =
    Number.isFinite(input.intervalMinutes) && input.intervalMinutes > 0
      ? Math.floor(input.intervalMinutes)
      : ANONYMOUS_MIN_INTERVAL_MINUTES;

  return input.hasToken ? base : Math.max(base, ANONYMOUS_MIN_INTERVAL_MINUTES);
}

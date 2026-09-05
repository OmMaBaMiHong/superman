/**
 * 治理配额（纯函数）。
 *
 * 每分类每日上限 daily_limit（默认 3），focus_ratio（默认 60）把配额拆成
 * 「聚焦桶 / 常驻桶」：聚焦桶给当前聚焦分类，其余进常驻桶。
 * 各桶按 qualityScore 降序截取；任一桶没装满时，余量回填给另一桶
 * （与三省六部 scheduler.ts 的分桶逻辑一致）。
 */
export const DEFAULT_DAILY_LIMIT = 3;
export const DEFAULT_FOCUS_RATIO = 60;

export function clampDailyLimit(value: number | undefined | null): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return DEFAULT_DAILY_LIMIT;
  }
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function clampFocusRatio(value: number | undefined | null): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return DEFAULT_FOCUS_RATIO;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export interface QuotaBuckets {
  focusQuota: number;
  residentQuota: number;
}

export function splitQuota(dailyLimit: number, focusRatio: number): QuotaBuckets {
  const limit = clampDailyLimit(dailyLimit);
  const focusQuota = Math.round((limit * clampFocusRatio(focusRatio)) / 100);
  return { focusQuota, residentQuota: limit - focusQuota };
}

export interface QuotaItem {
  qualityScore: number;
}

/**
 * 聚焦桶 + 常驻桶按质量分降序截取，余量互相回填，总量不超过 dailyLimit。
 * 返回被选中的元素（保持原对象引用）。
 */
export function selectQuotaItems<T extends QuotaItem>(input: {
  focusItems: readonly T[];
  residentItems: readonly T[];
  dailyLimit: number;
  focusRatio: number;
}): T[] {
  const limit = clampDailyLimit(input.dailyLimit);
  const { focusQuota, residentQuota } = splitQuota(limit, input.focusRatio);

  const byScoreDesc = (a: T, b: T) => b.qualityScore - a.qualityScore;
  const focusSorted = [...input.focusItems].sort(byScoreDesc);
  const residentSorted = [...input.residentItems].sort(byScoreDesc);

  const focusTaken = focusSorted.slice(0, focusQuota);
  const residentTaken = residentSorted.slice(0, residentQuota);
  const selected = [...focusTaken, ...residentTaken];

  let remaining = limit - selected.length;
  if (remaining > 0) {
    const focusRest = focusSorted.slice(focusTaken.length, focusTaken.length + remaining);
    selected.push(...focusRest);
    remaining = limit - selected.length;
    if (remaining > 0) {
      selected.push(...residentSorted.slice(residentTaken.length, residentTaken.length + remaining));
    }
  }
  return selected;
}

/** autoApproveThreshold > 0 且质量分达标时直接归档。 */
export function shouldAutoApprove(qualityScore: number, autoApproveThreshold: number): boolean {
  return autoApproveThreshold > 0 && qualityScore >= autoApproveThreshold;
}

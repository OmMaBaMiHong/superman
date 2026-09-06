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

// ============================================================
// 方向配额（治理 v2 / P2c）
//
// 与分类 focusRatio 的叠加规则：
//   第一层（分类桶）：先按 focusRatio 把每日配额拆成聚焦/常驻桶
//     （selectQuotaItems，现状不变——per-feed 摄取时常驻桶恒为空，余量回填聚焦桶）；
//   第二层（方向配额）：桶内再按启用模板的 quota_weight 归一化分配
//     （本节的 allocateDirectionQuotas + selectWithDirectionQuotas）。
//
// 权重语义：
//   - 权重和为 0 → 退回均分（未配置权重时各方向机会均等）；
//   - 权重 0 的方向（如兜底 general）不主动分配配额，也不参与余量顺延，
//     只能经 autoApproveThreshold 高分直通（被动收纳不阻塞高质量内容）；
//   - 某方向当日候选不足时，未用配额顺延给其他有候选的权重方向，不浪费。
// ============================================================

export interface DirectionWeightInput {
  key: string;
  quotaWeight: number;
}

/**
 * 按权重归一化分配 total 个配额（最大余数法）。
 * 返回 Map：方向 key → 配额数（权重 0 的方向恒为 0；权重和 0 时均分给全部方向）。
 */
export function allocateDirectionQuotas(
  weights: readonly DirectionWeightInput[],
  total: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (weights.length === 0 || total <= 0) {
    for (const w of weights) result.set(w.key, 0);
    return result;
  }

  const weightSum = weights.reduce((sum, w) => sum + w.quotaWeight, 0);
  if (weightSum <= 0) {
    // 权重和 0 → 均分（最大余数法处理除不尽）。
    const base = Math.floor(total / weights.length);
    let remainder = total - base * weights.length;
    for (const w of weights) {
      result.set(w.key, base + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder -= 1;
    }
    return result;
  }

  const exact = weights.map((w) => ({
    key: w.key,
    weight: w.quotaWeight,
    exact: (total * w.quotaWeight) / weightSum,
  }));
  let assigned = 0;
  for (const entry of exact) {
    const floor = Math.floor(entry.exact);
    result.set(entry.key, entry.weight > 0 ? floor : 0);
    assigned += entry.weight > 0 ? floor : 0;
  }
  // 余数按小数部分从大到小补给权重 > 0 的方向。
  let remainder = total - assigned;
  const byFractionDesc = exact
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  for (const entry of byFractionDesc) {
    if (remainder <= 0) break;
    result.set(entry.key, (result.get(entry.key) ?? 0) + 1);
    remainder -= 1;
  }
  return result;
}

export interface DirectionQuotaItem extends QuotaItem {
  directionKey: string | null;
}

/**
 * 方向配额截取（纯函数）：
 *   1. 各方向按质量分降序取满自己的配额；
 *   2. 没用满的配额汇总成余量，按质量分顺延给「有权重」方向的剩余候选
 *     （权重 0 / 未知方向的候选不参与顺延——与 allocateDirectionQuotas 语义一致）。
 * 返回被选中的元素（保持原对象引用）。
 */
export function selectWithDirectionQuotas<T extends DirectionQuotaItem>(input: {
  items: readonly T[];
  quotas: ReadonlyMap<string, number>;
  /** 权重表（判断顺延资格：quotaWeight > 0 才可顺延）。 */
  weights: readonly DirectionWeightInput[];
  total: number;
}): T[] {
  if (input.total <= 0 || input.items.length === 0) return [];
  const byScoreDesc = (a: T, b: T) => b.qualityScore - a.qualityScore;

  const byDirection = new Map<string, T[]>();
  for (const item of input.items) {
    const key = item.directionKey ?? '';
    const list = byDirection.get(key) ?? [];
    list.push(item);
    byDirection.set(key, list);
  }

  const selected: T[] = [];
  const leftovers: T[] = [];
  for (const [key, list] of byDirection) {
    const quota = input.quotas.get(key) ?? 0;
    const sorted = [...list].sort(byScoreDesc);
    selected.push(...sorted.slice(0, quota));
    leftovers.push(...sorted.slice(quota));
  }

  // 顺延：余量只给权重 > 0 的方向。
  const activeKeys = new Set(
    input.weights.filter((w) => w.quotaWeight > 0).map((w) => w.key),
  );
  const remaining = input.total - selected.length;
  if (remaining > 0) {
    const eligible = leftovers
      .filter((item) => item.directionKey !== null && activeKeys.has(item.directionKey))
      .sort(byScoreDesc);
    selected.push(...eligible.slice(0, remaining));
  }
  return selected;
}

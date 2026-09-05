/**
 * 治理去重（纯函数部分）。
 *
 * 三层去重（v2 升级，概念移植自三省六部 scheduler.ts + hotspot 归一化）：
 *   1. URL 精确去重（先经 normalize.ts 剥追踪参数；含 7 天驳回记忆）——DB 查询在 repository.ts。
 *   2. 归一化标题精确匹配（NFKC/全半角/表情差异清理后相同即同一事件，跨平台合并语义）。
 *   3. 标题 bigram（Dice 系数）相似度 >= 0.78 模糊去重。
 */
import { normalizeHeadline } from '@/core/governance/normalize';

export const TITLE_SIMILARITY_THRESHOLD = 0.78;
export const REJECT_MEMORY_DAYS = 7;

/**
 * 去重用标题归一化（v2 起委托 normalizeHeadline：NFKC 全半角统一 +
 * 去空白 + 去标点/符号/emoji）。保留导出名以兼容既有调用方与测试。
 */
export function normalizeTitle(title: string): string {
  return normalizeHeadline(title);
}

function bigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) {
    set.add(value.slice(i, i + 2));
  }
  return set;
}

/** Dice 系数：2 * |交集| / (|A| + |B|)，空串视为 0。 */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let intersection = 0;
  for (const gram of ga) {
    if (gb.has(gram)) intersection++;
  }
  return (2 * intersection) / (ga.size + gb.size || 1);
}

/** 与候选标题集合中的任一条相似度达到阈值即视为重复。 */
export function isDuplicateTitle(
  title: string,
  candidates: readonly string[],
  threshold: number = TITLE_SIMILARITY_THRESHOLD,
): boolean {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  return candidates.some(
    (candidate) => titleSimilarity(normalized, normalizeTitle(candidate)) >= threshold,
  );
}

export interface ExcludeKeywordMatch {
  excluded: boolean;
  matchedKeyword: string | null;
}

/** 排除关键词：标题 / 摘要 / 正文任一命中（大小写不敏感）即排除。 */
export function matchExcludeKeyword(
  input: { title: string; summary?: string | null; contentText?: string | null },
  keywords: readonly string[],
): ExcludeKeywordMatch {
  const haystack = [input.title, input.summary ?? '', input.contentText ?? '']
    .join(' ')
    .toLowerCase();
  for (const raw of keywords) {
    const keyword = raw.trim().toLowerCase();
    if (keyword && haystack.includes(keyword)) {
      return { excluded: true, matchedKeyword: raw.trim() };
    }
  }
  return { excluded: false, matchedKeyword: null };
}

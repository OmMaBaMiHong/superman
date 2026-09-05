/**
 * 治理去重（纯函数部分）。
 *
 * 两层去重（概念移植自三省六部 scheduler.ts）：
 *   1. URL 精确去重（含 7 天内驳回记忆的 source_url）——DB 查询在 repository.ts。
 *   2. 标题 bigram（Dice 系数）相似度 >= 0.78 视为重复。
 */
export const TITLE_SIMILARITY_THRESHOLD = 0.78;
export const REJECT_MEMORY_DAYS = 7;

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
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

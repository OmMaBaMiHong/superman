/**
 * 原创度分档（纯函数）。与原文的 bigram 相似度（0-1）：
 *   > 0.5   → 先自动带「降重」指令重写一次；最终仍 > 0.5 → needs_review（人工处理）
 *   0.35-0.5 → rewritten
 *   < 0.35  → ok
 * 这是法律与平台风控红线：needs_review 的草稿必须人工终审后才允许发布。
 */
export const SIMILARITY_REWRITE_THRESHOLD = 0.5;
export const SIMILARITY_OK_THRESHOLD = 0.35;

export type OriginalityFlag = 'ok' | 'rewritten' | 'needs_review';

export function classifyOriginality(similarityScore: number): OriginalityFlag {
  if (similarityScore > SIMILARITY_REWRITE_THRESHOLD) return 'needs_review';
  if (similarityScore >= SIMILARITY_OK_THRESHOLD) return 'rewritten';
  return 'ok';
}

/** 第一轮相似度是否需要触发自动降重重写。 */
export function needsReduceSimilarityPass(similarityScore: number): boolean {
  return similarityScore > SIMILARITY_REWRITE_THRESHOLD;
}

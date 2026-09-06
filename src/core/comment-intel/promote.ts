/**
 * 评论选题晋升（P3a）：同 trendradar/promote 的幂等模式。
 * Task 6 实现（TDD）；当前仅为 service 依赖提供模块边界。
 */
import type { Pool, PoolClient } from 'pg';
import type { PublishedPostRow } from '@/core/publish-tracking/repository';
import type { CommentAnalysis } from '@/core/comment-intel/analyze';

type DbClient = Pool | PoolClient;

export interface PromoteCommentDeps {
  notifyFn?: unknown;
}

export type PromoteCommentResult =
  | { promoted: true; articleId: string }
  | { promoted: false; articleId: null; reason: 'cooldown' | 'duplicate' };

export async function promoteCommentCandidate(
  _db: DbClient,
  _input: { post: PublishedPostRow; analysis: CommentAnalysis; userId?: string },
  _deps?: PromoteCommentDeps,
): Promise<PromoteCommentResult> {
  throw new Error('promoteCommentCandidate 尚未实现（Task 6）');
}

/**
 * 评论粗分析（P3a）：高赞评论 → 选题候选的「标题/摘要/理由」。
 * Task 6 实现（TDD）；当前仅为 service 依赖提供模块边界。
 */
import type { PublishedPostRow } from '@/core/publish-tracking/repository';
import type { PostCommentRow } from '@/core/comment-intel/repository';
import type { AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';

export interface CommentAnalysis {
  title: string;
  summary: string;
  aiReason: string;
  usedFallback: boolean;
}

export async function analyzeComments(_input: {
  post: PublishedPostRow;
  comments: PostCommentRow[];
  aiConfig: AiRuntimeConfig | null;
  userId: string;
}): Promise<CommentAnalysis> {
  throw new Error('analyzeComments 尚未实现（Task 6）');
}

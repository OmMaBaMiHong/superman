/**
 * 评论反哺选题服务（P3a）：对已发布作品拉取评论 → 落库 → 有新评论时粗分析 → 晋升选题候选。
 * 容错：单帖失败不打断其他帖（对齐 runPublishTrackingTick）；AI 配置加载失败按未配置处理（回退）。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { notify } from '@/core/notify/service';
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import { resolveSharedAiConfig, type AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { createCrawlerClient, type CrawlerClient } from '@/core/crawlerClient';
import type { PublishedPostRow } from '@/core/publish-tracking/repository';
import {
  listDueCommentPosts,
  listTopComments,
  markCommentIntelAt,
  markCommentsSynced,
  upsertPostComments,
} from '@/core/comment-intel/repository';
import { analyzeComments } from '@/core/comment-intel/analyze';
import { promoteCommentCandidate } from '@/core/comment-intel/promote';

type DbClient = Pool | PoolClient;

export interface CommentIntelDeps {
  client?: CrawlerClient;
  analyzeFn?: typeof analyzeComments;
  promoteFn?: typeof promoteCommentCandidate;
  notifyFn?: typeof notify;
  /** 测试注入；缺省按用户从 settings 加载（失败按 null＝未配置处理）。 */
  aiConfig?: AiRuntimeConfig | null;
}

async function loadAiConfig(db: DbClient, userId: string): Promise<AiRuntimeConfig | null> {
  try {
    const uiSettings = normalizePersistedSettings(await getUiSettings(db, userId));
    const aiApiKey = await getAiApiKey(db, userId);
    return resolveSharedAiConfig({ settings: { ai: uiSettings.ai }, aiApiKey });
  } catch {
    return null;
  }
}

export interface SyncCommentsResult {
  synced: boolean;
  newCount: number;
  error?: string;
}

/** 拉取单帖评论（crawler 服务接受完整 URL，服务端自行解析作品 id）→ upsert → 推进游标。 */
export async function syncPostComments(
  db: DbClient,
  post: PublishedPostRow,
  deps?: CommentIntelDeps,
): Promise<SyncCommentsResult> {
  const client = deps?.client ?? createCrawlerClient();
  try {
    const result = await client.fetchComments({
      platform: post.platform,
      postId: post.postUrl,
      max: 50,
    });
    const newCount = await upsertPostComments(db, post.id, result.items);
    await markCommentsSynced(db, post.id);
    return { synced: true, newCount };
  } catch (err) {
    return { synced: false, newCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CommentIntelTickResult {
  due: number;
  synced: number;
  failed: number;
  analyzed: number;
  promoted: number;
}

export async function runCommentIntelTick(
  db: DbClient,
  input?: { userId?: string; limit?: number },
  deps?: CommentIntelDeps,
): Promise<CommentIntelTickResult> {
  const scopedUserId = normalizeUserId(input?.userId);
  const duePosts = await listDueCommentPosts(db, { userId: scopedUserId, limit: input?.limit });
  const result: CommentIntelTickResult = { due: duePosts.length, synced: 0, failed: 0, analyzed: 0, promoted: 0 };
  if (duePosts.length === 0) return result;

  const aiConfig = deps?.aiConfig !== undefined ? deps.aiConfig : await loadAiConfig(db, scopedUserId);

  for (const post of duePosts) {
    const sync = await syncPostComments(db, post, deps);
    if (!sync.synced) {
      result.failed += 1;
      continue;
    }
    result.synced += 1;
    // 只有本轮拉到新评论才值得重新分析（无新评论/零评论都跳过）。
    if (sync.newCount === 0) continue;
    const comments = await listTopComments(db, { postId: post.id, limit: 50 });
    if (comments.length === 0) continue;
    const analysis = await (deps?.analyzeFn ?? analyzeComments)(
      { post, comments, aiConfig, userId: scopedUserId },
    );
    const promote = await (deps?.promoteFn ?? promoteCommentCandidate)(
      db,
      { post, analysis, userId: scopedUserId },
      deps?.notifyFn ? { notifyFn: deps.notifyFn } : undefined,
    );
    await markCommentIntelAt(db, post.id);
    result.analyzed += 1;
    if (promote.promoted) result.promoted += 1;
  }
  return result;
}

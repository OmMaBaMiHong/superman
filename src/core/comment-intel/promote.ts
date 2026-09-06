/**
 * 评论选题晋升（P3a）：同 trendradar/promote 的幂等模式——
 * 直接插 articles（governance_status='candidate'），不走配额管线（体量极小：
 * 每帖 72h 最多一条）；合成 feed（kind='comment_intel'）+
 * dedupe_key（comment-intel:{postId}:{内容 hash}）防重复插入。
 * 72h 冷却：同一作品三天内只反哺一次，防刷屏审批台。
 */
import type { Pool, PoolClient } from 'pg';
import { notify } from '@/core/notify/service';
import { insertArticleIgnoreDuplicate } from '@/server/domains/articles/repositories/articlesRepo';
import {
  classifyByKeywords,
  FALLBACK_DIRECTION_KEY,
  listDirectionStrategies,
} from '@/core/governance/directions';
import type { PublishedPostRow } from '@/core/publish-tracking/repository';
import type { CommentAnalysis } from '@/core/comment-intel/analyze';

type DbClient = Pool | PoolClient;

const COMMENT_INTEL_FEED_URL = 'comment-intel://topics';
const COMMENT_INTEL_FEED_TITLE = '评论选题';
export const PROMOTE_COOLDOWN_HOURS = 72;

function hash8(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function commentIntelDedupeKey(postId: string, analysis: CommentAnalysis): string {
  return `comment-intel:${postId}:${hash8(`${analysis.title}|${analysis.summary}`)}`;
}

async function hasRecentCandidate(
  db: DbClient,
  input: { userId: string; postId: string },
): Promise<boolean> {
  const { rows } = await db.query(
    `
      select 1 from articles
      where user_id = $1
        and dedupe_key like 'comment-intel:' || $2 || ':%'
        and created_at > now() - interval '72 hours'
      limit 1
    `,
    [input.userId, input.postId],
  );
  return rows.length > 0;
}

/** 每用户一条的合成 feed；feeds_user_url_unique 保证幂等（同 trend_radar 模式）。 */
async function ensureCommentIntelFeed(db: DbClient, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `
      insert into feeds(user_id, kind, title, url, view, enabled)
      values ($1, 'comment_intel', $2, $3, 'article', false)
      on conflict (user_id, url) where provider = 'local_rss'
      do update set title = excluded.title
      returning id::text as id
    `,
    [userId, COMMENT_INTEL_FEED_TITLE, COMMENT_INTEL_FEED_URL],
  );
  return rows[0].id;
}

export interface PromoteCommentDeps {
  notifyFn?: typeof notify;
}

export type PromoteCommentResult =
  | { promoted: true; articleId: string }
  | { promoted: false; articleId: null; reason: 'cooldown' | 'duplicate' };

export async function promoteCommentCandidate(
  db: DbClient,
  input: { post: PublishedPostRow; analysis: CommentAnalysis; userId?: string },
  deps?: PromoteCommentDeps,
): Promise<PromoteCommentResult> {
  const userId = input.userId || input.post.userId;
  if (await hasRecentCandidate(db, { userId, postId: input.post.id })) {
    return { promoted: false, articleId: null, reason: 'cooldown' };
  }
  const feedId = await ensureCommentIntelFeed(db, userId);
  const dedupeKey = commentIntelDedupeKey(input.post.id, input.analysis);

  // 方向分类走关键词派（与热点雷达转选题同款）；未命中兜底 general。
  const strategies = await listDirectionStrategies(db, { userId, enabledOnly: true });
  const classified = classifyByKeywords(`${input.analysis.title} ${input.analysis.summary}`, '', strategies);

  const article = await insertArticleIgnoreDuplicate(db, {
    feedId,
    dedupeKey,
    title: input.analysis.title,
    link: input.post.postUrl,
    publishedAt: new Date().toISOString(),
    summary: input.analysis.summary,
    governance: {
      status: 'candidate',
      qualityScore: null,
      aiReason: `${input.analysis.aiReason}（评论反哺自《${input.post.title || input.post.postUrl}》）`,
      directionKey: classified?.directionKey ?? FALLBACK_DIRECTION_KEY,
      directionReason: classified
        ? `命中关键词「${classified.matchedKeyword ?? ''}」（评论反哺）`
        : '未命中方向关键词，归入「其他」（评论反哺）',
    },
    userId,
  });
  if (!article?.id) {
    // 并发重复：撞 dedupe 冲突返回 null，视为重复不通知。
    return { promoted: false, articleId: null, reason: 'duplicate' };
  }

  const notifyFn = deps?.notifyFn ?? notify;
  await notifyFn(db, {
    userId,
    kind: 'comment_intel',
    title: `「${input.analysis.title}」评论反哺出新选题`,
    body: input.analysis.summary.slice(0, 200),
    link: '/studio?tab=queue',
  }).catch(() => {});

  return { promoted: true, articleId: article.id };
}

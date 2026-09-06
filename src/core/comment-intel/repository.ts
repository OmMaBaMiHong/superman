/**
 * 评论反哺选题（P3a）仓储：评论快照 upsert、TopN 读取、同步/分析游标。
 * 依赖 published_posts.comments_synced_at / comment_intel_at（迁移 0058）。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import type { PublishedPostRow } from '@/core/publish-tracking/repository';
import { postSelectSql } from '@/core/publish-tracking/repository';
import type { CrawlerComment } from '@/core/crawlerClient';

type DbClient = Pool | PoolClient;

/** 秒级/毫秒级 unix 字符串 → ISO；非法输入返回 null。 */
export function parseCommentTime(raw: string): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface PostCommentRow {
  id: string;
  postId: string;
  commentId: string;
  author: string;
  content: string;
  likes: number;
  replyCount: number;
  ipLocation: string | null;
  commentedAt: string | null;
  fetchedAt: string;
}

/** 批量 upsert；返回「新插入」条数（on conflict 刷新 likes 不计新）。 */
export async function upsertPostComments(
  db: DbClient,
  postId: string,
  items: CrawlerComment[],
): Promise<number> {
  if (items.length === 0) return 0;
  const values: unknown[] = [];
  const tuples = items.map((c, i) => {
    const b = i * 9;
    values.push(
      postId,
      c.cid,
      c.user,
      c.text,
      c.likes,
      c.replyCount,
      c.ipLocation,
      parseCommentTime(c.time),
      JSON.stringify({}),
    );
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::jsonb)`;
  });
  const { rows } = await db.query<{ inserted: boolean }>(
    `
      insert into post_comments(post_id, comment_id, author, content, likes, reply_count, ip_location, commented_at, raw_json)
      values ${tuples.join(',')}
      on conflict (post_id, comment_id) do update
        set likes = excluded.likes,
            reply_count = excluded.reply_count,
            fetched_at = now()
      returning (xmax = 0) as inserted
    `,
    values,
  );
  return rows.filter((r) => r.inserted).length;
}

export async function listTopComments(
  db: DbClient,
  input: { postId: string; limit?: number },
): Promise<PostCommentRow[]> {
  const limit = Math.max(1, Math.min(100, Math.round(input.limit ?? 50)));
  const { rows } = await db.query<PostCommentRow>(
    `
      select id::text as id,
             post_id::text as "postId",
             comment_id as "commentId",
             author,
             content,
             likes,
             reply_count as "replyCount",
             ip_location as "ipLocation",
             commented_at as "commentedAt",
             fetched_at as "fetchedAt"
      from post_comments
      where post_id = $1
      order by likes desc nulls last, fetched_at desc, id desc
      limit $2
    `,
    [input.postId, limit],
  );
  return rows;
}

/** 到期评论同步：tracking_enabled 且 24h 未同步（评论不需要快照级高频）。 */
export async function listDueCommentPosts(
  db: DbClient,
  input?: { userId?: string; limit?: number },
): Promise<PublishedPostRow[]> {
  const limit = Math.max(1, Math.min(200, Math.round(input?.limit ?? 50)));
  const { rows } = await db.query<PublishedPostRow>(
    `
      select ${postSelectSql}
      from published_posts
      where user_id = $1
        and tracking_enabled = true
        and platform in ('bilibili', 'douyin', 'xhs')
        and (comments_synced_at is null or comments_synced_at <= now() - interval '24 hours')
      order by comments_synced_at asc nulls first, id asc
      limit $2
    `,
    [normalizeUserId(input?.userId), limit],
  );
  return rows;
}

export async function markCommentsSynced(db: DbClient, postId: string): Promise<void> {
  await db.query(
    'update published_posts set comments_synced_at = now(), updated_at = now() where id = $1',
    [postId],
  );
}

export async function markCommentIntelAt(db: DbClient, postId: string): Promise<void> {
  await db.query(
    'update published_posts set comment_intel_at = now(), updated_at = now() where id = $1',
    [postId],
  );
}

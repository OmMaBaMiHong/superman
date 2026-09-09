import type { Pool, PoolClient } from 'pg';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { listArticleMediaAttachments } from '@/server/domains/articles/repositories/articlesRepo';
import type { SubscriptionFeed, SubscriptionWork, SubscriptionWorkDetail, SubscriptionWorkFilter, SubscriptionWorkPage } from '@/types/subscriptionReader';

type Db = Pool | PoolClient;

// One expression for filtering and display, including feeds with video enclosures.
const videoSql = `(f.view = 'video'
  or coalesce(a.link, '') ~* '(bilibili\\.com|b23\\.tv|douyin\\.com|iesdouyin\\.com|youtube\\.com|youtu\\.be|kuaishou\\.com|ixigua\\.com)'
  or exists (select 1 from article_media_attachments m where m.article_id=a.id and m.user_id=a.user_id and m.mime_type like 'video/%'))`;
const orderDateSql = "coalesce(a.published_at, a.fetched_at, 'epoch'::timestamptz)";
const workColumns = `a.id::text, a.feed_id::text as "feedId", f.title as "feedTitle",
  coalesce(a.title_original, a.title) as title, a.summary, a.author, a.link as "sourceUrl",
  a.preview_image_url as "previewImage", a.published_at as "publishedAt", a.is_read as "isRead",
  a.governance_status as "governanceStatus",
  coalesce(a.governance_status in ('archived','used'),false) as "inCandidatePool",
  case when ${videoSql} then 'video' when a.preview_image_url is not null then 'image' else 'text' end as "contentType"`;

/** All subscribed sources, including sources without any works. */
export async function listSubscriptionFeeds(db: Db, userId: string): Promise<SubscriptionFeed[]> {
  const { rows } = await db.query<SubscriptionFeed>(`
    select f.id::text, f.title, f.url, f.site_url as "siteUrl", f.icon_url as "iconUrl", f.enabled,
      f.last_fetch_status as "lastFetchStatus", f.last_fetch_error as "lastFetchError", f.last_fetched_at as "lastFetchedAt",
      stats.total as "articleCount", stats.unread as "unreadCount", stats.newest::text as "newestId",
      latest.title as "latestTitle", latest.published_at as "latestPublishedAt"
    from feeds f
    left join lateral (
      select count(*)::int as total, count(*) filter(where not a.is_read)::int as unread, max(a.id) as newest
      from articles a where a.feed_id=f.id and a.user_id=f.user_id
    ) stats on true
    left join lateral (
      select coalesce(a.title_original,a.title) as title, a.published_at
      from articles a where a.feed_id=f.id and a.user_id=f.user_id
      order by ${orderDateSql} desc, a.id desc limit 1
    ) latest on true
    where f.user_id=$1
    order by latest.published_at desc nulls last, f.id desc
  `, [userId]);
  return rows;
}

/** Cursor is the last displayed row, so equal timestamps cannot skip works. */
export async function listSubscriptionWorks(db: Db, input: {
  userId: string; feedId?: string; type?: SubscriptionWorkFilter; cursor?: string; limit?: number;
}): Promise<SubscriptionWorkPage> {
  const params: unknown[] = [input.userId];
  const where = ['a.user_id=$1'];
  if (input.feedId) { params.push(input.feedId); where.push(`a.feed_id=$${params.length}`); }
  if (input.type === 'video') where.push(videoSql);
  if (input.type === 'article') where.push(`not ${videoSql}`);
  if (input.cursor) {
    let cursor: { date: string; id: string };
    try {
      cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      if (!cursor || typeof cursor.date !== 'string' || !Number.isFinite(Date.parse(cursor.date)) ||
        typeof cursor.id !== 'string' || !/^\d+$/.test(cursor.id)) throw new Error('Invalid cursor');
    } catch { throw new ValidationError('分页游标无效', { cursor: '请刷新作品列表' }); }
    params.push(cursor.date, cursor.id);
    where.push(`(${orderDateSql},a.id) < ($${params.length - 1}::timestamptz,$${params.length}::bigint)`);
  }
  const limit = Math.max(1, Math.min(100, input.limit ?? 30));
  params.push(limit + 1);
  const { rows } = await db.query<SubscriptionWork & { sortDate: string }>(`
    select ${workColumns}, (${orderDateSql})::text as "sortDate"
    from articles a join feeds f on f.id=a.feed_id and f.user_id=a.user_id
    where ${where.join(' and ')} order by ${orderDateSql} desc,a.id desc limit $${params.length}
  `, params);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ sortDate, ...item }) => { void sortDate; return item; }),
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ date: last.sortDate, id: last.id })).toString('base64url') : null,
  };
}

/** Read details without requiring prior governance approval. */
export async function getSubscriptionWork(db: Db, userId: string, id: string): Promise<SubscriptionWorkDetail> {
  const { rows } = await db.query<SubscriptionWorkDetail>(`
    select ${workColumns}, coalesce(nullif(a.content_full_html,''),a.content_html) as content
    from articles a join feeds f on f.id=a.feed_id and f.user_id=a.user_id
    where a.user_id=$1 and a.id=$2
  `, [userId, id]);
  if (!rows[0]) throw new NotFoundError('作品不存在');
  const mediaAttachments = await listArticleMediaAttachments(db, id, userId);
  return { ...rows[0], mediaAttachments };
}

/** Read state is independent of candidate membership. */
export async function markSubscriptionWorkRead(db: Db, userId: string, id: string): Promise<void> {
  const { rows } = await db.query('update articles set is_read=true where user_id=$1 and id=$2 returning id', [userId, id]);
  if (!rows[0]) throw new NotFoundError('作品不存在');
}

/** Explicit user selection enters the existing archived topic pool; used works remain used. */
export async function addSubscriptionCandidate(db: Db, userId: string, id: string): Promise<void> {
  const { rows } = await db.query(`
    update articles set
      governance_status=case when governance_status='used' then 'used' else 'archived' end,
      governance_updated_at=case when governance_status in ('archived','used') then governance_updated_at else now() end
    where user_id=$1 and id=$2 returning id
  `, [userId, id]);
  if (!rows[0]) throw new NotFoundError('作品不存在');
}

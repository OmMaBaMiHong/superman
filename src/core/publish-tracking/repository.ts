import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import type { PostMetrics } from '@/core/publish-tracking/metricsProvider';
import type { PublishPlatform } from '@/core/publish-tracking/platform';

type DbClient = Pool | PoolClient;

export interface PublishedPostRow {
  id: string;
  userId: string;
  draftId: string | null;
  articleId: string | null;
  platform: PublishPlatform;
  accountName: string;
  postUrl: string;
  title: string;
  publishedAt: string | null;
  trackingEnabled: boolean;
  lastFetchedAt: string | null;
  fetchFailCount: number;
  lastError: string | null;
  lastHotNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const postSelectSql = `
  id,
  user_id::text as "userId",
  draft_id as "draftId",
  article_id as "articleId",
  platform,
  account_name as "accountName",
  post_url as "postUrl",
  title,
  published_at as "publishedAt",
  tracking_enabled as "trackingEnabled",
  last_fetched_at as "lastFetchedAt",
  fetch_fail_count as "fetchFailCount",
  last_error as "lastError",
  last_hot_notified_at as "lastHotNotifiedAt",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

export async function insertPublishedPost(
  db: DbClient,
  input: {
    draftId?: string | null;
    articleId?: string | null;
    platform: PublishPlatform;
    accountName?: string;
    postUrl: string;
    title?: string;
    publishedAt?: string | null;
    userId?: string;
  },
): Promise<PublishedPostRow> {
  const { rows } = await db.query<PublishedPostRow>(
    `
      insert into published_posts(
        user_id, draft_id, article_id, platform, account_name, post_url, title, published_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning ${postSelectSql}
    `,
    [
      normalizeUserId(input.userId),
      input.draftId ?? null,
      input.articleId ?? null,
      input.platform,
      input.accountName ?? '',
      input.postUrl,
      input.title ?? '',
      input.publishedAt ?? null,
    ],
  );
  return rows[0];
}

export async function getPublishedPost(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<PublishedPostRow | null> {
  const { rows } = await db.query<PublishedPostRow>(
    `select ${postSelectSql} from published_posts where id = $1 and user_id = $2 limit 1`,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

export async function deletePublishedPost(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<boolean> {
  const res = await db.query('delete from published_posts where id = $1 and user_id = $2', [
    id,
    normalizeUserId(userId),
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function setPublishedPostTracking(
  db: DbClient,
  input: { id: string; trackingEnabled: boolean; userId?: string },
): Promise<PublishedPostRow | null> {
  const { rows } = await db.query<PublishedPostRow>(
    `
      update published_posts
      set tracking_enabled = $3, updated_at = now()
      where id = $1 and user_id = $2
      returning ${postSelectSql}
    `,
    [input.id, normalizeUserId(input.userId), input.trackingEnabled],
  );
  return rows[0] ?? null;
}

/** 抓取成功：写 last_fetched_at、清零失败计数、清空错误。 */
export async function markPostFetchSucceeded(db: DbClient, id: string): Promise<void> {
  await db.query(
    `
      update published_posts
      set last_fetched_at = now(), fetch_fail_count = 0, last_error = null, updated_at = now()
      where id = $1
    `,
    [id],
  );
}

/** 抓取失败：累加失败计数并记录错误（连续 3 次即视为抓取异常）。 */
export async function markPostFetchFailed(db: DbClient, id: string, error: string): Promise<void> {
  await db.query(
    `
      update published_posts
      set fetch_fail_count = fetch_fail_count + 1,
          last_error = $2,
          last_fetched_at = now(),
          updated_at = now()
      where id = $1
    `,
    [id, error.slice(0, 1000)],
  );
}

export async function markPostHotNotified(db: DbClient, id: string): Promise<void> {
  await db.query(
    'update published_posts set last_hot_notified_at = now(), updated_at = now() where id = $1',
    [id],
  );
}

// ============================================================
// 到期抓取窗口：发布 72h 内每小时一抓，之后每天一抓
// ============================================================

export const TRACKING_HOURLY_WINDOW_HOURS = 72;
const HOURLY_INTERVAL_SQL = `interval '1 hour'`;
const DAILY_INTERVAL_SQL = `interval '1 day'`;

/** 到期待抓的帖子（tracking_enabled 且按 72h 内/外频率到期）。 */
export async function listDueTrackingPosts(
  db: DbClient,
  input?: { userId?: string; limit?: number },
): Promise<PublishedPostRow[]> {
  const limit = Math.max(1, Math.min(500, Math.round(input?.limit ?? 100)));
  const { rows } = await db.query<PublishedPostRow>(
    `
      select ${postSelectSql}
      from published_posts
      where user_id = $1
        and tracking_enabled = true
        and platform = 'bilibili'
        and (
          last_fetched_at is null
          or (
            coalesce(published_at, created_at) >= now() - interval '72 hours'
            and last_fetched_at <= now() - ${HOURLY_INTERVAL_SQL}
          )
          or (
            coalesce(published_at, created_at) < now() - interval '72 hours'
            and last_fetched_at <= now() - ${DAILY_INTERVAL_SQL}
          )
        )
      order by last_fetched_at asc nulls first, id asc
      limit $2
    `,
    [normalizeUserId(input?.userId), limit],
  );
  return rows;
}

// ============================================================
// 快照（只追加）
// ============================================================

export interface PostMetricsSnapshotRow {
  id: string;
  postId: string;
  fetchedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  favorites: number | null;
  coins: number | null;
  followersDelta: number | null;
  rawJson: Record<string, unknown> | null;
}

const snapshotSelectSql = `
  id,
  post_id as "postId",
  fetched_at as "fetchedAt",
  views,
  likes,
  comments,
  shares,
  favorites,
  coins,
  followers_delta as "followersDelta",
  raw_json as "rawJson"
`;

export async function insertMetricsSnapshot(
  db: DbClient,
  input: { postId: string; metrics: PostMetrics },
): Promise<PostMetricsSnapshotRow> {
  const { rows } = await db.query<PostMetricsSnapshotRow>(
    `
      insert into post_metrics_snapshots(
        post_id, views, likes, comments, shares, favorites, coins, followers_delta, raw_json
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      returning ${snapshotSelectSql}
    `,
    [
      input.postId,
      input.metrics.views,
      input.metrics.likes,
      input.metrics.comments,
      input.metrics.shares,
      input.metrics.favorites,
      input.metrics.coins,
      input.metrics.followersDelta,
      JSON.stringify(input.metrics.rawJson),
    ],
  );
  return rows[0];
}

/** 最近 N 条快照（时间倒序）。 */
export async function listRecentSnapshots(
  db: DbClient,
  input: { postId: string; limit?: number },
): Promise<PostMetricsSnapshotRow[]> {
  const limit = Math.max(1, Math.min(500, Math.round(input.limit ?? 30)));
  const { rows } = await db.query<PostMetricsSnapshotRow>(
    `
      select ${snapshotSelectSql}
      from post_metrics_snapshots
      where post_id = $1
      order by fetched_at desc, id desc
      limit $2
    `,
    [input.postId, limit],
  );
  return rows;
}

/** 最近 7 天快照序列（时间正序，详情页曲线用）。 */
export async function listSnapshotsSince(
  db: DbClient,
  input: { postId: string; days?: number },
): Promise<PostMetricsSnapshotRow[]> {
  const days = Math.max(1, Math.min(90, Math.round(input.days ?? 7)));
  const { rows } = await db.query<PostMetricsSnapshotRow>(
    `
      select ${snapshotSelectSql}
      from post_metrics_snapshots
      where post_id = $1
        and fetched_at >= now() - ($2::int * interval '1 day')
      order by fetched_at asc, id asc
    `,
    [input.postId, days],
  );
  return rows;
}

// ============================================================
// 列表页：每帖带最新快照 + 24h 前基线快照（增量与 hot 由 JS 侧计算）
// ============================================================

export interface PublishedPostListRow extends PublishedPostRow {
  latestSnapshot: PostMetricsSnapshotRow | null;
  baselineSnapshot: PostMetricsSnapshotRow | null;
}

export async function listPublishedPostsWithMetrics(
  db: DbClient,
  input?: { userId?: string; limit?: number },
): Promise<PublishedPostListRow[]> {
  const limit = Math.max(1, Math.min(200, Math.round(input?.limit ?? 100)));
  const { rows } = await db.query(
    `
      select
        p.*,
        to_jsonb(s) as "latestSnapshot",
        to_jsonb(b) as "baselineSnapshot"
      from published_posts p
      left join lateral (
        select * from post_metrics_snapshots s
        where s.post_id = p.id
        order by s.fetched_at desc, s.id desc
        limit 1
      ) s on true
      left join lateral (
        select * from post_metrics_snapshots b
        where b.post_id = p.id
          and b.fetched_at <= now() - interval '20 hours'
        order by b.fetched_at desc, b.id desc
        limit 1
      ) b on true
      where p.user_id = $1
      order by p.created_at desc, p.id desc
      limit $2
    `,
    [normalizeUserId(input?.userId), limit],
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    ...mapPostRow(row),
    latestSnapshot: row.latestSnapshot
      ? mapSnapshotRow(row.latestSnapshot as Record<string, unknown>)
      : null,
    baselineSnapshot: row.baselineSnapshot
      ? mapSnapshotRow(row.baselineSnapshot as Record<string, unknown>)
      : null,
  }));
}

function mapPostRow(row: Record<string, unknown>): PublishedPostRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    draftId: row.draft_id === null ? null : String(row.draft_id),
    articleId: row.article_id === null ? null : String(row.article_id),
    platform: row.platform as PublishPlatform,
    accountName: String(row.account_name ?? ''),
    postUrl: String(row.post_url),
    title: String(row.title ?? ''),
    publishedAt: row.published_at ? String(row.published_at) : null,
    trackingEnabled: Boolean(row.tracking_enabled),
    lastFetchedAt: row.last_fetched_at ? String(row.last_fetched_at) : null,
    fetchFailCount: Number(row.fetch_fail_count ?? 0),
    lastError: (row.last_error as string | null) ?? null,
    lastHotNotifiedAt: row.last_hot_notified_at ? String(row.last_hot_notified_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSnapshotRow(row: Record<string, unknown>): PostMetricsSnapshotRow {
  return {
    id: String(row.id),
    postId: String(row.post_id),
    fetchedAt: String(row.fetched_at),
    views: row.views === null ? null : Number(row.views),
    likes: row.likes === null ? null : Number(row.likes),
    comments: row.comments === null ? null : Number(row.comments),
    shares: row.shares === null ? null : Number(row.shares),
    favorites: row.favorites === null ? null : Number(row.favorites),
    coins: row.coins === null ? null : Number(row.coins),
    followersDelta: row.followers_delta === null ? null : Number(row.followers_delta),
    rawJson: (row.raw_json as Record<string, unknown> | null) ?? null,
  };
}

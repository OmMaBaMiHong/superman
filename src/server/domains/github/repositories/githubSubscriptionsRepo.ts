import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { GITHUB_ICON_URL } from '@/lib/feeds/feedIcons';
import type {
  CreateGithubSubscriptionInput,
  GithubRepoSubscription,
  GithubSubscriptionRow,
  GithubSyncStatus,
  UpdateGithubSubscriptionInput,
} from '@/server/domains/github/types';
import { normalizeContentTypes } from '@/server/domains/github/types';

type DbClient = Pool | PoolClient;

const SUBSCRIPTION_SELECT_SQL = `
  g.feed_id               as "feedId",
  g.user_id               as "userId",
  g.owner,
  g.repo,
  g.repo_html_url         as "repoHtmlUrl",
  g.content_types         as "contentTypes",
  g.include_prerelease    as "includePrerelease",
  g.repo_description      as "repoDescription",
  g.repo_language         as "repoLanguage",
  g.repo_stargazers       as "repoStargazers",
  g.repo_avatar_url       as "repoAvatarUrl",
  g.releases_etag         as "releasesEtag",
  g.last_release_published_at as "lastReleasePublishedAt",
  g.last_synced_at        as "lastSyncedAt",
  g.last_sync_attempt_at  as "lastSyncAttemptAt",
  g.next_sync_at          as "nextSyncAt",
  g.consecutive_failures  as "consecutiveFailures",
  g.rate_limited_until    as "rateLimitedUntil",
  g.rate_limit_remaining  as "rateLimitRemaining",
  g.last_error_code       as "lastErrorCode",
  g.last_error            as "lastError",
  f.title,
  f.url,
  f.icon_url              as "iconUrl",
  f.enabled,
  f.fetch_interval_minutes as "fetchIntervalMinutes",
  f.category_id           as "categoryId",
  coalesce(uc.unread_count, 0) as "unreadCount"
`;

const UNREAD_COUNT_LATERAL = `
  left join lateral (
    select count(*)::int as unread_count
    from articles a
    where a.feed_id = g.feed_id
      and a.user_id = g.user_id
      and a.is_read = false
      and a.filter_status = any('{passed,error}'::text[])
  ) uc on true
`;

/**
 * 计算订阅健康状态（R05 四态）。
 *
 * 优先级：限流 → 失败 → 同步中 → 空闲。
 * - 限流：存在未来的 `rate_limited_until`
 * - 失败：上次尝试失败（attempt > synced，且有错误码）
 * - 同步中：最近一次尝试尚未产生成功记录
 * - 空闲：其余
 */
export function resolveGithubSyncStatus(
  row: Pick<
    GithubSubscriptionRow,
    'lastSyncAttemptAt' | 'lastSyncedAt' | 'lastErrorCode' | 'rateLimitedUntil'
  >,
  now: Date,
): GithubSyncStatus {
  const rateLimitedUntil = row.rateLimitedUntil ? new Date(row.rateLimitedUntil).getTime() : null;
  if (rateLimitedUntil !== null && rateLimitedUntil > now.getTime()) {
    return 'rate_limited';
  }

  const attemptAt = row.lastSyncAttemptAt ? new Date(row.lastSyncAttemptAt).getTime() : null;
  const syncedAt = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : null;

  if (row.lastErrorCode && (attemptAt === null || syncedAt === null || attemptAt > syncedAt)) {
    return 'error';
  }

  if (attemptAt !== null && (syncedAt === null || attemptAt > syncedAt)) {
    return 'syncing';
  }

  return 'idle';
}

function mapRowToSubscription(
  row: GithubSubscriptionRow & {
    title: string;
    url: string;
    iconUrl: string | null;
    enabled: boolean;
    fetchIntervalMinutes: number;
    categoryId: string | null;
    unreadCount: number;
  },
  now: Date,
): GithubRepoSubscription {
  const fullName = `${row.owner}/${row.repo}`;
  return {
    id: row.feedId,
    feedId: row.feedId,
    owner: row.owner,
    repo: row.repo,
    fullName,
    title: row.title,
    htmlUrl: row.repoHtmlUrl,
    avatarUrl: row.repoAvatarUrl ?? row.iconUrl ?? GITHUB_ICON_URL,
    description: row.repoDescription,
    language: row.repoLanguage,
    stargazers: row.repoStargazers,
    contentTypes: normalizeContentTypes(row.contentTypes),
    includePrerelease: row.includePrerelease,
    enabled: row.enabled,
    fetchIntervalMinutes: row.fetchIntervalMinutes,
    categoryId: row.categoryId,
    unreadCount: row.unreadCount,
    status: resolveGithubSyncStatus(row, now),
    lastSyncedAt: row.lastSyncedAt,
    nextSyncAt: row.nextSyncAt,
    rateLimitedUntil: row.rateLimitedUntil,
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
  };
}

function mapRows(rows: Array<Record<string, unknown>>, now: Date): GithubRepoSubscription[] {
  return rows.map((row) => mapRowToSubscription(row as never, now));
}

export async function createGithubSubscription(
  db: DbClient,
  input: CreateGithubSubscriptionInput & { feedId: string },
): Promise<void> {
  const scopedUserId = normalizeUserId(input.userId);
  const contentTypes = normalizeContentTypes(input.contentTypes);
  await db.query(
    `
      insert into github_repo_subscriptions(
        feed_id,
        user_id,
        owner,
        repo,
        repo_html_url,
        content_types,
        include_prerelease,
        repo_description,
        repo_language,
        repo_stargazers,
        repo_avatar_url,
        next_sync_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (feed_id) do nothing
    `,
    [
      input.feedId,
      scopedUserId,
      input.owner,
      input.repo,
      input.htmlUrl,
      contentTypes,
      input.includePrerelease ?? false,
      input.description ?? null,
      input.language ?? null,
      input.stargazers ?? null,
      input.avatarUrl ?? null,
    ],
  );
}

export async function listGithubSubscriptions(
  db: DbClient,
  userId?: string,
  now: Date = new Date(),
): Promise<GithubRepoSubscription[]> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<Record<string, unknown>>(
    `
      select ${SUBSCRIPTION_SELECT_SQL}
      from github_repo_subscriptions g
      inner join feeds f on f.id = g.feed_id and f.user_id = g.user_id
      ${UNREAD_COUNT_LATERAL}
      where g.user_id = $1
      order by f.title asc, g.feed_id asc
    `,
    [scopedUserId],
  );
  return mapRows(rows, now);
}

export async function getGithubSubscription(
  db: DbClient,
  feedId: string,
  userId?: string,
  now: Date = new Date(),
): Promise<GithubRepoSubscription | null> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<Record<string, unknown>>(
    `
      select ${SUBSCRIPTION_SELECT_SQL}
      from github_repo_subscriptions g
      inner join feeds f on f.id = g.feed_id and f.user_id = g.user_id
      ${UNREAD_COUNT_LATERAL}
      where g.feed_id = $1 and g.user_id = $2
      limit 1
    `,
    [feedId, scopedUserId],
  );
  if (rows.length === 0) return null;
  return mapRows(rows, now)[0];
}

export async function updateGithubSubscription(
  db: DbClient,
  feedId: string,
  input: UpdateGithubSubscriptionInput,
): Promise<GithubRepoSubscription | null> {
  const scopedUserId = normalizeUserId(input.userId);
  const fields: string[] = [];
  const values: Array<string | boolean | number | string[] | null> = [];
  let paramIndex = 1;

  if (typeof input.contentTypes !== 'undefined') {
    fields.push(`content_types = $${paramIndex++}`);
    values.push(normalizeContentTypes(input.contentTypes));
  }
  if (typeof input.includePrerelease !== 'undefined') {
    fields.push(`include_prerelease = $${paramIndex++}`);
    values.push(Boolean(input.includePrerelease));
  }

  // 以下字段同时作用于 feeds 表，交由调用方（lifecycle service）更新；本表只管 GitHub 专属字段。
  if (fields.length === 0) {
    return getGithubSubscription(db, feedId, scopedUserId);
  }

  fields.push(`updated_at = now()`);
  values.push(feedId);
  values.push(scopedUserId);

  await db.query(
    `
      update github_repo_subscriptions
      set ${fields.join(', ')}
      where feed_id = $${paramIndex} and user_id = $${paramIndex + 1}
    `,
    values,
  );
  return getGithubSubscription(db, feedId, scopedUserId);
}

export async function deleteGithubSubscription(
  db: DbClient,
  feedId: string,
  userId?: string,
): Promise<boolean> {
  const scopedUserId = normalizeUserId(userId);
  // github_repo_subscriptions 随 feeds 级联删除（on delete cascade）。
  const res = await db.query(
    'delete from feeds where id = $1 and user_id = $2 and kind = $3',
    [feedId, scopedUserId, 'github'],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 列出某用户所有「启用中」的 GitHub 订阅 feedId，供「刷新全部」批量投递。 */
export async function listGithubSubscriptionFeedIds(
  db: DbClient,
  userId?: string,
): Promise<string[]> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<{ feedId: string }>(
    `
      select g.feed_id as "feedId"
      from github_repo_subscriptions g
      inner join feeds f on f.id = g.feed_id and f.user_id = g.user_id
      where f.enabled = true and g.user_id = $1
    `,
    [scopedUserId],
  );
  return rows.map((row) => row.feedId);
}

export async function getGithubSubscriptionRow(
  db: DbClient,
  feedId: string,
  userId?: string,
): Promise<GithubSubscriptionRow | null> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<GithubSubscriptionRow>(
    `
      select
        feed_id as "feedId",
        user_id as "userId",
        owner,
        repo,
        repo_html_url as "repoHtmlUrl",
        content_types as "contentTypes",
        include_prerelease as "includePrerelease",
        repo_description as "repoDescription",
        repo_language as "repoLanguage",
        repo_stargazers as "repoStargazers",
        repo_avatar_url as "repoAvatarUrl",
        releases_etag as "releasesEtag",
        last_release_published_at as "lastReleasePublishedAt",
        last_synced_at as "lastSyncedAt",
        last_sync_attempt_at as "lastSyncAttemptAt",
        next_sync_at as "nextSyncAt",
        consecutive_failures as "consecutiveFailures",
        rate_limited_until as "rateLimitedUntil",
        rate_limit_remaining as "rateLimitRemaining",
        last_error_code as "lastErrorCode",
        last_error as "lastError"
      from github_repo_subscriptions
      where feed_id = $1 and user_id = $2
      limit 1
    `,
    [feedId, scopedUserId],
  );
  return rows[0] ?? null;
}

/**
 * 扫描到期订阅：enabled 且 `next_sync_at <= now()`。
 *
 * 不在此处推进 `next_sync_at` —— 真正的退避由同步 worker 落库，
 * 重复投递由 pg-boss 的 singletonKey 自然去重。
 */
export async function listDueSubscriptions(
  db: DbClient,
  now: Date,
  userId?: string,
): Promise<Array<{ feedId: string; userId: string }>> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<{ feedId: string; userId: string }>(
    `
      select g.feed_id as "feedId", g.user_id as "userId"
      from github_repo_subscriptions g
      inner join feeds f on f.id = g.feed_id and f.user_id = g.user_id
      where f.enabled = true
        and g.user_id = $1
        and (g.next_sync_at is null or g.next_sync_at <= $2)
        and (g.rate_limited_until is null or g.rate_limited_until <= $2)
      order by coalesce(g.next_sync_at, 'epoch'::timestamptz) asc, g.feed_id asc
    `,
    [scopedUserId, now.toISOString()],
  );
  return rows;
}

export interface RecordGithubSyncResultInput {
  feedId: string;
  userId?: string;
  status: number | null;
  etag?: string | null;
  lastReleasePublishedAt?: string | null;
  nextSyncAt: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  rawErrorMessage?: string | null;
  rateLimitRemaining?: number | null;
  /** 是否成功（true 时清空连续失败计数与错误） */
  succeeded: boolean;
}

export async function recordGithubSyncResult(
  db: DbClient,
  input: RecordGithubSyncResultInput,
): Promise<void> {
  const scopedUserId = normalizeUserId(input.userId);
  await db.query(
    `
      update github_repo_subscriptions
      set
        last_sync_attempt_at = now(),
        last_synced_at = case when $3 then now() else last_synced_at end,
        releases_etag = coalesce($4, releases_etag),
        last_release_published_at = coalesce($5, last_release_published_at),
        next_sync_at = $6,
        consecutive_failures = case when $3 then 0 else consecutive_failures + 1 end,
        last_error_code = case when $3 then null else $7 end,
        last_error = case when $3 then null else $8 end,
        last_raw_error = case when $3 then null else $9 end,
        rate_limit_remaining = $10,
        updated_at = now()
      where feed_id = $1 and user_id = $2
    `,
    [
      input.feedId,
      scopedUserId,
      input.succeeded,
      input.etag ?? null,
      input.lastReleasePublishedAt ?? null,
      input.nextSyncAt,
      input.succeeded ? null : (input.errorCode ?? null),
      input.succeeded ? null : (input.errorMessage ?? null),
      input.succeeded ? null : (input.rawErrorMessage ?? null),
      input.rateLimitRemaining ?? null,
    ],
  );
}

export async function recordGithubRateLimit(
  db: DbClient,
  input: { feedId: string; userId?: string; rateLimitedUntil: string; rateLimitRemaining?: number | null },
): Promise<void> {
  const scopedUserId = normalizeUserId(input.userId);
  await db.query(
    `
      update github_repo_subscriptions
      set
        rate_limited_until = $3,
        rate_limit_remaining = $4,
        updated_at = now()
      where feed_id = $1 and user_id = $2
    `,
    [input.feedId, scopedUserId, input.rateLimitedUntil, input.rateLimitRemaining ?? null],
  );
}

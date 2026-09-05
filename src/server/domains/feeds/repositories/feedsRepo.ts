import type { Pool, PoolClient } from 'pg';
import type { FeedContentView } from '@/types';
import { normalizeUserId } from '@/server/domains/users/userScope';

type DbClient = Pool | PoolClient;

export type FeedKind = 'rss' | 'ai_digest' | 'github';
export type FeedProvider = 'local_rss' | 'fever';

export interface FeedRow {
  id: string;
  userId: string;
  kind: FeedKind;
  provider: FeedProvider;
  title: string;
  url: string;
  siteUrl: string | null;
  iconUrl: string | null;
  enabled: boolean;
  fullTextOnOpenEnabled: boolean;
  fullTextOnFetchEnabled: boolean;
  aiSummaryOnOpenEnabled: boolean;
  aiSummaryOnFetchEnabled: boolean;
  bodyTranslateOnFetchEnabled: boolean;
  bodyTranslateOnOpenEnabled: boolean;
  titleTranslateEnabled: boolean;
  bodyTranslateEnabled: boolean;
  articleListDisplayMode: 'card' | 'list';
  view: FeedContentView;
  categoryId: string | null;
  fetchIntervalMinutes: number;
  lastFetchStatus: number | null;
  lastFetchError: string | null;
  lastFetchRawError: string | null;
  isPodcast: boolean;
}

const feedRowSelectSql = `
        id,
        user_id::text as "userId",
        kind,
        provider,
        title,
        url,
        site_url as "siteUrl",
        icon_url as "iconUrl",
        enabled,
        full_text_on_open_enabled as "fullTextOnOpenEnabled",
        full_text_on_fetch_enabled as "fullTextOnFetchEnabled",
        ai_summary_on_open_enabled as "aiSummaryOnOpenEnabled",
        ai_summary_on_fetch_enabled as "aiSummaryOnFetchEnabled",
        body_translate_on_fetch_enabled as "bodyTranslateOnFetchEnabled",
        body_translate_on_open_enabled as "bodyTranslateOnOpenEnabled",
        title_translate_enabled as "titleTranslateEnabled",
        body_translate_enabled as "bodyTranslateEnabled",
        article_list_display_mode as "articleListDisplayMode",
        view,
        category_id as "categoryId",
        fetch_interval_minutes as "fetchIntervalMinutes",
        last_fetch_status as "lastFetchStatus",
        last_fetch_error as "lastFetchError",
        last_fetch_raw_error as "lastFetchRawError"
`;

export interface FeedRefreshDispatchRow {
  id: string;
  userId: string;
  kind: FeedKind;
  provider: FeedProvider;
  enabled: boolean;
}

export async function listFeeds(db: DbClient, userId?: string): Promise<FeedRow[]> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<FeedRow>(`
    -- 返回 provider，供上层区分本地源和 Fever 托管源。
    select
      id,
      kind,
      provider,
      title,
      url,
      site_url as "siteUrl",
      icon_url as "iconUrl",
      enabled,
      full_text_on_open_enabled as "fullTextOnOpenEnabled",
      full_text_on_fetch_enabled as "fullTextOnFetchEnabled",
      ai_summary_on_open_enabled as "aiSummaryOnOpenEnabled",
      ai_summary_on_fetch_enabled as "aiSummaryOnFetchEnabled",
      body_translate_on_fetch_enabled as "bodyTranslateOnFetchEnabled",
      body_translate_on_open_enabled as "bodyTranslateOnOpenEnabled",
      title_translate_enabled as "titleTranslateEnabled",
      body_translate_enabled as "bodyTranslateEnabled",
      article_list_display_mode as "articleListDisplayMode",
      view,
      category_id as "categoryId",
      fetch_interval_minutes as "fetchIntervalMinutes",
      last_fetch_status as "lastFetchStatus",
      last_fetch_error as "lastFetchError",
      last_fetch_raw_error as "lastFetchRawError",
      exists (
        select 1
        from articles
        join article_media_attachments on article_media_attachments.article_id = articles.id
        where articles.feed_id = feeds.id
          and articles.user_id = feeds.user_id
          and article_media_attachments.user_id = feeds.user_id
        limit 1
      ) as "isPodcast"
    from feeds
    where feeds.user_id = $1
      and (
      feeds.provider <> 'fever'
      or exists (
        select 1
        from fever_feed_mappings ffm
        join fever_accounts fa on fa.id = ffm.fever_account_id
        where ffm.local_feed_id = feeds.id
          and ffm.user_id = feeds.user_id
          and fa.user_id = feeds.user_id
          and ffm.is_active = true
          -- 账号停用后，关联的 Fever 投影源也必须从左栏隐藏。
          and fa.enabled = true
      )
    )
    order by created_at asc, id asc
  `, [scopedUserId]);
  return rows;
}

export async function createFeed(
  db: DbClient,
  input: {
    title: string;
    url: string;
    provider?: FeedProvider;
    siteUrl?: string | null;
    iconUrl?: string | null;
    enabled?: boolean;
    fullTextOnOpenEnabled?: boolean;
    fullTextOnFetchEnabled?: boolean;
    aiSummaryOnOpenEnabled?: boolean;
    aiSummaryOnFetchEnabled?: boolean;
    bodyTranslateOnFetchEnabled?: boolean;
    bodyTranslateOnOpenEnabled?: boolean;
    titleTranslateEnabled?: boolean;
    bodyTranslateEnabled?: boolean;
    articleListDisplayMode?: 'card' | 'list';
    view?: FeedContentView;
    categoryId?: string | null;
    fetchIntervalMinutes?: number;
    userId?: string;
  },
): Promise<FeedRow> {
  const scopedUserId = normalizeUserId(input.userId);
  const { rows } = await db.query<FeedRow>(
    `
      insert into feeds(
        user_id,
        title,
        url,
        provider,
        site_url,
        icon_url,
        enabled,
        full_text_on_open_enabled,
        full_text_on_fetch_enabled,
        ai_summary_on_open_enabled,
        ai_summary_on_fetch_enabled,
        body_translate_on_fetch_enabled,
        body_translate_on_open_enabled,
        title_translate_enabled,
        body_translate_enabled,
        article_list_display_mode,
        view,
        category_id,
        fetch_interval_minutes
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      returning
        ${feedRowSelectSql},
        false as "isPodcast"
    `,
    [
      scopedUserId,
      input.title,
      input.url,
      input.provider ?? 'local_rss',
      input.siteUrl ?? null,
      input.iconUrl ?? null,
      input.enabled ?? true,
      input.fullTextOnOpenEnabled ?? false,
      input.fullTextOnFetchEnabled ?? false,
      input.aiSummaryOnOpenEnabled ?? false,
      input.aiSummaryOnFetchEnabled ?? false,
      input.bodyTranslateOnFetchEnabled ?? false,
      input.bodyTranslateOnOpenEnabled ?? false,
      input.titleTranslateEnabled ?? false,
      input.bodyTranslateEnabled ?? false,
      input.articleListDisplayMode ?? 'card',
      input.view ?? 'article',
      input.categoryId ?? null,
      input.fetchIntervalMinutes ?? 30,
    ],
  );
  return rows[0];
}

/**
 * 创建 GitHub 仓库订阅对应的 feed。
 *
 * 与 `createAiDigestFeed` 同构：kind='github'、view='github'，其余字段复用本地 RSS feed
 * 的存储结构。匿名用户刷新间隔会被同步引擎强制抬到 60 分钟（见 githubBackoff）。
 */
export async function createGithubFeed(
  db: DbClient,
  input: {
    title: string;
    url: string;
    siteUrl?: string | null;
    iconUrl?: string | null;
    categoryId?: string | null;
    fetchIntervalMinutes?: number;
    userId?: string;
  },
): Promise<FeedRow> {
  const scopedUserId = normalizeUserId(input.userId);
  const { rows } = await db.query<FeedRow>(
    `
      insert into feeds(
        user_id,
        kind,
        title,
        url,
        site_url,
        icon_url,
        enabled,
        view,
        category_id,
        fetch_interval_minutes
      )
      values ($1, 'github', $2, $3, $4, $5, true, 'github', $6, $7)
      returning
        ${feedRowSelectSql},
        false as "isPodcast"
    `,
    [
      scopedUserId,
      input.title,
      input.url,
      input.siteUrl ?? null,
      input.iconUrl ?? null,
      input.categoryId ?? null,
      input.fetchIntervalMinutes ?? 60,
    ],
  );
  return rows[0];
}

export async function getFeedByUrl(
  db: DbClient,
  url: string,
  userId?: string,
): Promise<FeedRow | null> {
  const { rows } = await db.query<FeedRow>(
    `
      select
        ${feedRowSelectSql},
        false as "isPodcast"
      from feeds
      where user_id = $1
        and url = $2
      limit 1
    `,
    [normalizeUserId(userId), url],
  );
  return rows[0] ?? null;
}

export async function getFeedById(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<FeedRow | null> {
  const { rows } = await db.query<FeedRow>(
    `
      select
        ${feedRowSelectSql},
        false as "isPodcast"
      from feeds
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

export async function listFeedsByIds(
  db: DbClient,
  ids: string[],
  userId?: string,
): Promise<FeedRow[]> {
  if (ids.length === 0) return [];

  const { rows } = await db.query<FeedRow>(
    `
      select
        ${feedRowSelectSql},
        false as "isPodcast"
      from feeds
      where user_id = $1
        and id = any($2::bigint[])
    `,
    [normalizeUserId(userId), ids],
  );
  return rows;
}

export async function getFeedRefreshDispatchRow(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<FeedRefreshDispatchRow | null> {
  const { rows } = await db.query<FeedRefreshDispatchRow>(
    `
      select
        id,
        user_id as "userId",
        kind,
        provider,
        enabled
      from feeds
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

export async function updateFeed(
  db: DbClient,
  id: string,
  input: {
    title?: string;
    url?: string;
    siteUrl?: string | null;
    iconUrl?: string | null;
    enabled?: boolean;
    fullTextOnOpenEnabled?: boolean;
    fullTextOnFetchEnabled?: boolean;
    aiSummaryOnOpenEnabled?: boolean;
    aiSummaryOnFetchEnabled?: boolean;
    bodyTranslateOnFetchEnabled?: boolean;
    bodyTranslateOnOpenEnabled?: boolean;
    titleTranslateEnabled?: boolean;
    bodyTranslateEnabled?: boolean;
    articleListDisplayMode?: 'card' | 'list';
    view?: FeedContentView;
    categoryId?: string | null;
    fetchIntervalMinutes?: number;
    userId?: string;
  },
): Promise<FeedRow | null> {
  const scopedUserId = normalizeUserId(input.userId);
  const fields: string[] = [];
  const values: Array<string | boolean | number | null> = [];
  let paramIndex = 1;

  if (typeof input.title !== 'undefined') {
    fields.push(`title = $${paramIndex++}`);
    values.push(input.title);
  }
  if (typeof input.url !== 'undefined') {
    fields.push(`url = $${paramIndex++}`);
    values.push(input.url);
  }
  if (typeof input.siteUrl !== 'undefined') {
    fields.push(`site_url = $${paramIndex++}`);
    values.push(input.siteUrl);
  }
  if (typeof input.iconUrl !== 'undefined') {
    fields.push(`icon_url = $${paramIndex++}`);
    values.push(input.iconUrl);
  }
  if (typeof input.enabled !== 'undefined') {
    fields.push(`enabled = $${paramIndex++}`);
    values.push(input.enabled);
  }
  if (typeof input.fullTextOnOpenEnabled !== 'undefined') {
    fields.push(`full_text_on_open_enabled = $${paramIndex++}`);
    values.push(Boolean(input.fullTextOnOpenEnabled));
  }
  if (typeof input.fullTextOnFetchEnabled !== 'undefined') {
    fields.push(`full_text_on_fetch_enabled = $${paramIndex++}`);
    values.push(Boolean(input.fullTextOnFetchEnabled));
  }
  if (typeof input.aiSummaryOnOpenEnabled !== 'undefined') {
    fields.push(`ai_summary_on_open_enabled = $${paramIndex++}`);
    values.push(Boolean(input.aiSummaryOnOpenEnabled));
  }
  if (typeof input.aiSummaryOnFetchEnabled !== 'undefined') {
    fields.push(`ai_summary_on_fetch_enabled = $${paramIndex++}`);
    values.push(Boolean(input.aiSummaryOnFetchEnabled));
  }
  if (typeof input.bodyTranslateOnFetchEnabled !== 'undefined') {
    fields.push(`body_translate_on_fetch_enabled = $${paramIndex++}`);
    values.push(Boolean(input.bodyTranslateOnFetchEnabled));
  }
  if (typeof input.bodyTranslateOnOpenEnabled !== 'undefined') {
    fields.push(`body_translate_on_open_enabled = $${paramIndex++}`);
    values.push(Boolean(input.bodyTranslateOnOpenEnabled));
  }
  if (typeof input.titleTranslateEnabled !== 'undefined') {
    fields.push(`title_translate_enabled = $${paramIndex++}`);
    values.push(Boolean(input.titleTranslateEnabled));
  }
  if (typeof input.bodyTranslateEnabled !== 'undefined') {
    fields.push(`body_translate_enabled = $${paramIndex++}`);
    values.push(Boolean(input.bodyTranslateEnabled));
  }
  if (typeof input.articleListDisplayMode !== 'undefined') {
    fields.push(`article_list_display_mode = $${paramIndex++}`);
    values.push(input.articleListDisplayMode);
  }
  if (typeof input.view !== 'undefined') {
    fields.push(`view = $${paramIndex++}`);
    values.push(input.view);
  }
  if (typeof input.categoryId !== 'undefined') {
    fields.push(`category_id = $${paramIndex++}`);
    values.push(input.categoryId);
  }
  if (typeof input.fetchIntervalMinutes !== 'undefined') {
    fields.push(`fetch_interval_minutes = $${paramIndex++}`);
    values.push(input.fetchIntervalMinutes);
  }
  if (fields.length === 0) return null;

  fields.push('updated_at = now()');
  values.push(id);
  values.push(scopedUserId);

  const { rows } = await db.query<FeedRow>(
    `
      update feeds
      set ${fields.join(', ')}
      where id = $${paramIndex}
        and user_id = $${paramIndex + 1}
      returning
        ${feedRowSelectSql},
        false as "isPodcast"
    `,
    values,
  );
  return rows[0] ?? null;
}

export async function deleteFeed(db: DbClient, id: string, userId?: string): Promise<boolean> {
  const res = await db.query('delete from feeds where id = $1 and user_id = $2', [
    id,
    normalizeUserId(userId),
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function getFeedCategoryAssignment(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<{ id: string; categoryId: string | null; siteUrl: string | null } | null> {
  const { rows } = await db.query<{ id: string; categoryId: string | null; siteUrl: string | null }>(
    `
      select
        id,
        category_id as "categoryId",
        site_url as "siteUrl"
      from feeds
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

export async function getFeedFaviconTarget(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<{ id: string; kind: FeedKind; siteUrl: string | null; iconUrl: string | null } | null> {
  const { rows } = await db.query<{
    id: string;
    kind: FeedKind;
    siteUrl: string | null;
    iconUrl: string | null;
  }>(
    `
      select
        id,
        kind,
        site_url as "siteUrl",
        icon_url as "iconUrl"
      from feeds
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );

  return rows[0] ?? null;
}

export async function countFeedsByCategoryId(
  db: DbClient,
  categoryId: string,
  userId?: string,
): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `
      select count(*)::int as count
      from feeds
      where category_id = $1
        and user_id = $2
    `,
    [categoryId, normalizeUserId(userId)],
  );
  return rows[0]?.count ?? 0;
}

export async function getFeedFullTextOnOpenEnabled(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<boolean | null> {
  const { rows } = await db.query<{ fullTextOnOpenEnabled: boolean }>(
    `
      select full_text_on_open_enabled as "fullTextOnOpenEnabled"
      from feeds
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return typeof rows[0]?.fullTextOnOpenEnabled === 'boolean'
    ? rows[0].fullTextOnOpenEnabled
    : null;
}

export async function getFeedBodyTranslateEnabled(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<boolean | null> {
  const { rows } = await db.query<{ bodyTranslateEnabled: boolean }>(
    `
      select body_translate_enabled as "bodyTranslateEnabled"
      from feeds
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return typeof rows[0]?.bodyTranslateEnabled === 'boolean'
    ? rows[0].bodyTranslateEnabled
    : null;
}

export interface FeedFetchRow {
  id: string;
  userId: string;
  title: string;
  url: string;
  enabled: boolean;
  categoryId: string | null;
  fullTextOnFetchEnabled: boolean;
  titleTranslateEnabled: boolean;
  aiSummaryOnFetchEnabled: boolean;
  bodyTranslateOnFetchEnabled: boolean;
  etag: string | null;
  lastModified: string | null;
  fetchIntervalMinutes: number;
  lastFetchedAt: string | null;
}

export async function listEnabledFeedsForFetch(db: DbClient, userId?: string): Promise<FeedFetchRow[]> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<FeedFetchRow>(`
    -- 仅让本地 RSS 进入抓取队列，Fever 源走独立同步链路。
    select
      id,
      user_id as "userId",
      title,
      url,
      enabled,
      category_id as "categoryId",
      full_text_on_fetch_enabled as "fullTextOnFetchEnabled",
      title_translate_enabled as "titleTranslateEnabled",
      ai_summary_on_fetch_enabled as "aiSummaryOnFetchEnabled",
      body_translate_on_fetch_enabled as "bodyTranslateOnFetchEnabled",
      etag,
      last_modified as "lastModified",
      fetch_interval_minutes as "fetchIntervalMinutes",
      last_fetched_at as "lastFetchedAt"
    from feeds
    where enabled = true
      and kind = 'rss'
      and provider = 'local_rss'
      and user_id = $1
    order by created_at asc, id asc
  `, [scopedUserId]);
  return rows;
}

export async function getFeedForFetch(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<FeedFetchRow | null> {
  const { rows } = await db.query<FeedFetchRow>(
    `
      select
        id,
        user_id as "userId",
        title,
        url,
        enabled,
        category_id as "categoryId",
        full_text_on_fetch_enabled as "fullTextOnFetchEnabled",
        title_translate_enabled as "titleTranslateEnabled",
        ai_summary_on_fetch_enabled as "aiSummaryOnFetchEnabled",
        body_translate_on_fetch_enabled as "bodyTranslateOnFetchEnabled",
      etag,
      last_modified as "lastModified",
      fetch_interval_minutes as "fetchIntervalMinutes",
      last_fetched_at as "lastFetchedAt"
      from feeds
      where id = $1
        and user_id = $2
        and kind = 'rss'
        and provider = 'local_rss'
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

export async function recordFeedFetchResult(
  db: DbClient,
  id: string,
  input: {
    status: number | null;
    etag?: string | null;
    lastModified?: string | null;
    error?: string | null;
    rawError?: string | null;
    userId?: string;
  },
): Promise<void> {
  await db.query(
    `
      update feeds
      set
        etag = coalesce($2, etag),
        last_modified = coalesce($3, last_modified),
        last_fetched_at = now(),
        last_fetch_status = $4,
        last_fetch_error = $5,
        last_fetch_raw_error = $6,
        updated_at = now()
      where id = $1
        and user_id = $7
    `,
    [
      id,
      input.etag ?? null,
      input.lastModified ?? null,
      input.status,
      input.error ?? null,
      input.rawError ?? null,
      normalizeUserId(input.userId),
    ],
  );
}

export async function updateAllFeedsFetchIntervalMinutes(
  db: DbClient,
  minutes: number,
  userId?: string,
): Promise<{ updatedCount: number }> {
  const res = await db.query(
    `
      update feeds
      set
        fetch_interval_minutes = $1,
        updated_at = now()
      where kind = 'rss'
        and user_id = $2
    `,
    [minutes, normalizeUserId(userId)],
  );

  return { updatedCount: res.rowCount ?? 0 };
}

export async function createAiDigestFeed(
  db: DbClient,
  input: { title: string; categoryId: string | null; userId?: string },
): Promise<FeedRow> {
  const scopedUserId = normalizeUserId(input.userId);
  // Use one sequence-derived id for both PK and deterministic ai_digest URL suffix.
  const { rows } = await db.query<FeedRow>(
    `
      with next_feed as (
        select nextval(pg_get_serial_sequence('feeds', 'id'))::bigint as id
      )
      insert into feeds(id, user_id, kind, title, url, view, category_id)
      select
        next_feed.id,
        $1,
        'ai_digest',
        $2,
        'http://localhost/__feedfuse_ai_digest__/' || next_feed.id::text,
        'digest',
        $3
      from next_feed
      returning
        ${feedRowSelectSql},
        false as "isPodcast"
    `,
    [scopedUserId, input.title, input.categoryId],
  );
  return rows[0];
}

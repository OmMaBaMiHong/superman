import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import {
  canTransition,
  isGovernanceStatus,
  type GovernanceStatus,
} from '@/server/domains/governance/stateMachine';
import { REJECT_MEMORY_DAYS } from '@/server/domains/governance/dedup';

type DbClient = Pool | PoolClient;

// ============================================================
// 治理偏好（user_id + category_id 维度）
// ============================================================

export interface GovernancePreferenceRow {
  id: string;
  userId: string;
  categoryId: string;
  dailyLimit: number;
  focusRatio: number;
  autoApproveThreshold: number;
  excludeKeywords: string[];
}

function parseExcludeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map((item) => String(item).trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

const preferenceRowSelectSql = `
  id,
  user_id::text as "userId",
  category_id as "categoryId",
  daily_limit as "dailyLimit",
  focus_ratio as "focusRatio",
  auto_approve_threshold as "autoApproveThreshold",
  exclude_keywords as "excludeKeywords"
`;

function mapPreferenceRow(row: Omit<GovernancePreferenceRow, 'excludeKeywords'> & {
  excludeKeywords: unknown;
}): GovernancePreferenceRow {
  return { ...row, excludeKeywords: parseExcludeKeywords(row.excludeKeywords) };
}

export async function getGovernancePreference(
  db: DbClient,
  categoryId: string,
  userId?: string,
): Promise<GovernancePreferenceRow | null> {
  const { rows } = await db.query(
    `
      select ${preferenceRowSelectSql}
      from governance_preferences
      where user_id = $1
        and category_id = $2
      limit 1
    `,
    [normalizeUserId(userId), categoryId],
  );
  return rows[0] ? mapPreferenceRow(rows[0]) : null;
}

export async function upsertGovernancePreference(
  db: DbClient,
  input: {
    categoryId: string;
    dailyLimit?: number;
    focusRatio?: number;
    autoApproveThreshold?: number;
    excludeKeywords?: string[];
    userId?: string;
  },
): Promise<GovernancePreferenceRow> {
  const scopedUserId = normalizeUserId(input.userId);
  const { rows } = await db.query(
    `
      insert into governance_preferences(
        user_id, category_id, daily_limit, focus_ratio, auto_approve_threshold, exclude_keywords
      )
      values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (user_id, category_id) do update set
        daily_limit = excluded.daily_limit,
        focus_ratio = excluded.focus_ratio,
        auto_approve_threshold = excluded.auto_approve_threshold,
        exclude_keywords = excluded.exclude_keywords,
        updated_at = now()
      returning ${preferenceRowSelectSql}
    `,
    [
      scopedUserId,
      input.categoryId,
      input.dailyLimit ?? 3,
      input.focusRatio ?? 60,
      input.autoApproveThreshold ?? 0,
      JSON.stringify(input.excludeKeywords ?? []),
    ],
  );
  return mapPreferenceRow(rows[0]);
}

// ============================================================
// 去重数据查询（URL 精确 + 标题相似候选集，含 7 天驳回记忆）
// ============================================================

/** 在给定链接集合中，已存在于 articles 的链接（精确匹配）。 */
export async function listExistingArticleLinks(
  db: DbClient,
  links: string[],
  userId?: string,
): Promise<string[]> {
  if (links.length === 0) return [];
  const { rows } = await db.query<{ link: string }>(
    `
      select link
      from articles
      where user_id = $1
        and link = any($2::text[])
    `,
    [normalizeUserId(userId), links],
  );
  return rows.map((row) => row.link);
}

/** 近期文章标题（标题相似度去重的候选集），默认取最近 30 天、上限 1000 条。 */
export async function listRecentArticleTitles(
  db: DbClient,
  input?: { userId?: string; days?: number; limit?: number },
): Promise<string[]> {
  const days = Math.max(1, Math.min(90, Math.round(input?.days ?? 30)));
  const limit = Math.max(1, Math.min(5000, Math.round(input?.limit ?? 1000)));
  const { rows } = await db.query<{ title: string }>(
    `
      select title
      from articles
      where user_id = $1
        and title <> ''
        and fetched_at >= now() - ($2::int * interval '1 day')
      order by fetched_at desc
      limit $3
    `,
    [normalizeUserId(input?.userId), days, limit],
  );
  return rows.map((row) => row.title);
}

export interface RejectMemoryRow {
  title: string;
  sourceUrl: string | null;
}

/** 7 天内的驳回记忆（标题 + 来源 URL 都参与去重）。 */
export async function listRecentRejectMemory(
  db: DbClient,
  input?: { userId?: string; days?: number },
): Promise<RejectMemoryRow[]> {
  const days = Math.max(1, Math.min(90, Math.round(input?.days ?? REJECT_MEMORY_DAYS)));
  const { rows } = await db.query<{ title: string; sourceUrl: string | null }>(
    `
      select
        title,
        source_url as "sourceUrl"
      from reject_logs
      where user_id = $1
        and created_at >= now() - ($2::int * interval '1 day')
      order by created_at desc
      limit 1000
    `,
    [normalizeUserId(input?.userId), days],
  );
  return rows;
}

export async function insertRejectLog(
  db: DbClient,
  input: {
    articleId: string | null;
    reason: string;
    title: string;
    sourceUrl: string | null;
    userId?: string;
  },
): Promise<void> {
  await db.query(
    `
      insert into reject_logs(user_id, article_id, reason, title, source_url)
      values ($1, $2, $3, $4, $5)
    `,
    [
      normalizeUserId(input.userId),
      input.articleId,
      input.reason,
      input.title,
      input.sourceUrl,
    ],
  );
}

// ============================================================
// 配额
// ============================================================

/**
 * 今日该分类已占用配额的文章数（驳回不占配额）。
 * categoryId 为 null 时统计未分类文章。
 */
export async function countTodayGovernedByCategory(
  db: DbClient,
  input: { categoryId: string | null; userId?: string },
): Promise<number> {
  const scopedUserId = normalizeUserId(input.userId);
  const { rows } = await db.query<{ count: number }>(
    `
      select count(*)::int as count
      from articles
      join feeds on feeds.id = articles.feed_id and feeds.user_id = articles.user_id
      where articles.user_id = $1
        and articles.governance_status <> 'rejected'
        and articles.fetched_at::date = current_date
        and ($2::bigint is null and feeds.category_id is null
          or feeds.category_id = $2::bigint)
    `,
    [scopedUserId, input.categoryId],
  );
  return rows[0]?.count ?? 0;
}

// ============================================================
// 治理条目读写
// ============================================================

export interface GovernanceItemRow {
  id: string;
  feedId: string;
  categoryId: string | null;
  title: string;
  titleOriginal: string | null;
  summary: string | null;
  contentHtml: string | null;
  link: string | null;
  governanceStatus: GovernanceStatus;
  qualityScore: number | null;
  aiReason: string | null;
  redraftCount: number;
}

export async function getGovernanceItem(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<GovernanceItemRow | null> {
  const { rows } = await db.query(
    `
      select
        a.id,
        a.feed_id as "feedId",
        f.category_id as "categoryId",
        a.title,
        a.title_original as "titleOriginal",
        a.summary,
        a.content_html as "contentHtml",
        a.link,
        a.governance_status as "governanceStatus",
        a.quality_score as "qualityScore",
        a.ai_reason as "aiReason",
        a.redraft_count as "redraftCount"
      from articles a
      join feeds f on f.id = a.feed_id and f.user_id = a.user_id
      where a.id = $1
        and a.user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  const row = rows[0];
  if (!row || !isGovernanceStatus(row.governanceStatus)) return null;
  return row as GovernanceItemRow;
}

export type GovernanceTransitionResult =
  | { ok: true; item: GovernanceItemRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'illegal_transition'; currentStatus: GovernanceStatus };

/**
 * 状态迁移：先读当前状态并用纯函数 canTransition 校验，合法才落库。
 * 返回判别联合，由上层（API）翻译成 404 / 409。
 */
export async function transitionGovernanceStatus(
  db: DbClient,
  input: {
    id: string;
    to: GovernanceStatus;
    userId?: string;
    /** 迁移时顺带更新的拟折字段（redraft 用）。 */
    patch?: {
      title?: string;
      summary?: string;
      aiReason?: string;
      qualityScore?: number;
      incrementRedraftCount?: boolean;
    };
  },
): Promise<GovernanceTransitionResult> {
  const scopedUserId = normalizeUserId(input.userId);
  const current = await getGovernanceItem(db, input.id, scopedUserId);
  if (!current) return { ok: false, reason: 'not_found' };
  // 同状态迁移视为幂等 no-op（redraft 在 pending 上重拟时只更新拟折字段）。
  if (
    current.governanceStatus !== input.to &&
    !canTransition(current.governanceStatus, input.to)
  ) {
    return {
      ok: false,
      reason: 'illegal_transition',
      currentStatus: current.governanceStatus,
    };
  }

  const fields = ['governance_status = $3', 'governance_updated_at = now()'];
  const values: Array<string | number | null> = [input.id, scopedUserId, input.to];
  let paramIndex = 4;

  if (typeof input.patch?.title !== 'undefined') {
    fields.push(`title = $${paramIndex++}`);
    values.push(input.patch.title);
  }
  if (typeof input.patch?.summary !== 'undefined') {
    fields.push(`summary = $${paramIndex++}`);
    values.push(input.patch.summary);
  }
  if (typeof input.patch?.aiReason !== 'undefined') {
    fields.push(`ai_reason = $${paramIndex++}`);
    values.push(input.patch.aiReason);
  }
  if (typeof input.patch?.qualityScore !== 'undefined') {
    fields.push(`quality_score = $${paramIndex++}`);
    values.push(input.patch.qualityScore);
  }
  if (input.patch?.incrementRedraftCount) {
    fields.push('redraft_count = redraft_count + 1');
  }

  await db.query(
    `
      update articles
      set ${fields.join(', ')}
      where id = $1
        and user_id = $2
    `,
    values,
  );

  return { ok: true, item: { ...current, governanceStatus: input.to } };
}

// ============================================================
// 待批队列与统计
// ============================================================

export interface GovernanceQueueItemRow {
  id: string;
  title: string;
  summary: string | null;
  aiReason: string | null;
  qualityScore: number | null;
  feedId: string;
  feedTitle: string;
  categoryId: string | null;
  categoryTitle: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  governanceStatus: GovernanceStatus;
  redraftCount: number;
}

export async function listGovernanceQueue(
  db: DbClient,
  input: {
    /** 状态过滤；缺省返回 candidate + pending（待批队列）。 */
    statuses?: GovernanceStatus[];
    categoryId?: string;
    page?: number;
    pageSize?: number;
    userId?: string;
  },
): Promise<{ items: GovernanceQueueItemRow[]; total: number }> {
  const scopedUserId = normalizeUserId(input.userId);
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.round(input.pageSize ?? 20)));

  const conditions = ['a.user_id = $1'];
  const values: Array<string | number | string[]> = [scopedUserId];
  let paramIndex = 2;

  const statuses = input.statuses ?? ['candidate', 'pending'];
  conditions.push(`a.governance_status = any($${paramIndex++}::text[])`);
  values.push(statuses);
  if (input.categoryId) {
    conditions.push(`f.category_id = $${paramIndex++}`);
    values.push(input.categoryId);
  }
  const whereSql = conditions.join(' and ');

  const { rows: countRows } = await db.query<{ count: number }>(
    `
      select count(*)::int as count
      from articles a
      join feeds f on f.id = a.feed_id and f.user_id = a.user_id
      where ${whereSql}
    `,
    values,
  );

  const { rows } = await db.query(
    `
      select
        a.id,
        a.title,
        a.summary,
        a.ai_reason as "aiReason",
        a.quality_score as "qualityScore",
        a.feed_id as "feedId",
        f.title as "feedTitle",
        f.category_id as "categoryId",
        c.name as "categoryTitle",
        a.published_at as "publishedAt",
        a.link as "sourceUrl",
        a.governance_status as "governanceStatus",
        a.redraft_count as "redraftCount"
      from articles a
      join feeds f on f.id = a.feed_id and f.user_id = a.user_id
      left join categories c
        on c.id = f.category_id and c.user_id = a.user_id
      where ${whereSql}
      order by a.quality_score desc nulls last, a.published_at desc nulls last, a.id desc
      limit $${paramIndex++} offset $${paramIndex++}
    `,
    [...values, pageSize, (page - 1) * pageSize],
  );

  return {
    items: rows as GovernanceQueueItemRow[],
    total: countRows[0]?.count ?? 0,
  };
}

export interface GovernanceStatsRow {
  /** 今日新入待批（candidate/pending 且今日抓取）。 */
  todayPending: number;
  /** 今日归档（archived 且今日治理更新）。 */
  todayArchived: number;
  /** 今日采集成功 feed 数。 */
  todayFetchSucceeded: number;
  /** 今日采集失败 feed 数。 */
  todayFetchFailed: number;
  /** 当前待批总量（candidate + pending）。 */
  queueSize: number;
}

export async function getGovernanceStats(
  db: DbClient,
  userId?: string,
): Promise<GovernanceStatsRow> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<{
    todayPending: number;
    todayArchived: number;
    queueSize: number;
  }>(
    `
      select
        count(*) filter (
          where governance_status in ('candidate', 'pending')
            and fetched_at::date = current_date
        )::int as "todayPending",
        count(*) filter (
          where governance_status = 'archived'
            and governance_updated_at::date = current_date
        )::int as "todayArchived",
        count(*) filter (
          where governance_status in ('candidate', 'pending')
        )::int as "queueSize"
      from articles
      where user_id = $1
    `,
    [scopedUserId],
  );

  const { rows: fetchRows } = await db.query<{
    succeeded: number;
    failed: number;
  }>(
    `
      select
        count(*) filter (where status = 'succeeded')::int as succeeded,
        count(*) filter (where status = 'failed')::int as failed
      from feed_refresh_run_items
      where user_id = $1
        and created_at::date = current_date
    `,
    [scopedUserId],
  );

  return {
    todayPending: rows[0]?.todayPending ?? 0,
    todayArchived: rows[0]?.todayArchived ?? 0,
    todayFetchSucceeded: fetchRows[0]?.succeeded ?? 0,
    todayFetchFailed: fetchRows[0]?.failed ?? 0,
    queueSize: rows[0]?.queueSize ?? 0,
  };
}

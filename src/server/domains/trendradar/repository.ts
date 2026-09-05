/**
 * 热点雷达（TrendRadar）条目仓储。
 *
 * 数据来源两条链路，写同一张 trend_radar_items：
 *   1. 主链路：pg-boss job `trendradar.sync` 读 TrendRadar 当天 SQLite 全量 upsert；
 *   2. 实时链路：POST /api/ingest/trendradar 接收 generic_webhook 渲染文本，容错解析后 upsert。
 *
 * 幂等键：user_id + platform + url + source_date。
 * webhook 条目可能没有 URL，此时用标题哈希合成占位 URL 保住唯一约束。
 */
import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import {
  inferTrendContentType,
  type ContentType,
} from '@/server/lib/contentType';

type DbClient = Pool | PoolClient;

export interface TrendRadarUpsertItem {
  platform: string;
  platformName?: string;
  title: string;
  url?: string | null;
  rank?: number | null;
  hotValue?: string | null;
  payload?: Record<string, unknown>;
  /** YYYY-MM-DD；缺省为当天（数据库时区）。 */
  sourceDate?: string;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

export interface TrendRadarItemRow {
  id: string;
  platform: string;
  platformName: string;
  title: string;
  url: string;
  rank: number | null;
  previousRank: number | null;
  hotValue: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceDate: string;
  promotedAt: string | null;
  promotedArticleId: string | null;
  contentType: ContentType;
  payload: Record<string, unknown>;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * 唯一约束要求 url 非空可区分；无 URL 的条目（webhook 渲染文本常无链接）
 * 用标题哈希合成占位 URL，保证同一天同平台同标题只留一行。
 */
export function resolveTrendRadarItemUrl(item: {
  platform: string;
  title: string;
  url?: string | null;
  sourceDate: string;
}): string {
  const url = item.url?.trim();
  if (url) return url;
  return `trendradar://no-url/${sha256(`${item.platform}|${item.title}|${item.sourceDate}`)}`;
}

function normalizeRank(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 批量 upsert。逐条单语句执行（单日 11 平台量级仅数百行，无需多值拼接），
 * 重复跑同一数据源不产生重复行（唯一约束 + on conflict do update）。
 */
export async function upsertTrendRadarItems(
  db: DbClient,
  items: TrendRadarUpsertItem[],
  userId?: string,
): Promise<{ upserted: number }> {
  const scopedUserId = normalizeUserId(userId);
  let upserted = 0;

  for (const item of items) {
    const title = item.title.trim();
    const platform = item.platform.trim();
    if (!title || !platform) continue;

    const sourceDate = item.sourceDate ?? new Date().toISOString().slice(0, 10);
    const url = resolveTrendRadarItemUrl({
      platform,
      title,
      url: item.url,
      sourceDate,
    });
    const payload = item.payload ?? {};

    await db.query(
      `
        insert into trend_radar_items(
          user_id, platform, platform_name, title, url, rank, hot_value,
          first_seen_at, last_seen_at, payload_json, source_date
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          coalesce($8::timestamptz, now()),
          coalesce($9::timestamptz, now()),
          $10::jsonb, $11::date
        )
        on conflict (user_id, platform, url, source_date) do update set
          title = excluded.title,
          platform_name = case
            when excluded.platform_name <> '' then excluded.platform_name
            else trend_radar_items.platform_name
          end,
          rank = coalesce(excluded.rank, trend_radar_items.rank),
          hot_value = case
            when excluded.hot_value <> '' then excluded.hot_value
            else trend_radar_items.hot_value
          end,
          first_seen_at = least(trend_radar_items.first_seen_at, excluded.first_seen_at),
          last_seen_at = greatest(trend_radar_items.last_seen_at, excluded.last_seen_at),
          payload_json = excluded.payload_json,
          updated_at = now()
      `,
      [
        scopedUserId,
        platform,
        item.platformName?.trim() ?? '',
        title,
        url,
        normalizeRank(item.rank),
        item.hotValue?.trim() ?? '',
        item.firstSeenAt ?? null,
        item.lastSeenAt ?? null,
        JSON.stringify(payload),
        sourceDate,
      ],
    );
    upserted += 1;
  }

  return { upserted };
}

interface RawTrendRadarRow {
  id: string;
  platform: string;
  platformName: string;
  title: string;
  url: string;
  rank: number | null;
  hotValue: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceDate: string;
  promotedAt: string | null;
  promotedArticleId: string | null;
  payload: unknown;
}

function mapRow(row: RawTrendRadarRow): TrendRadarItemRow {
  const payload =
    typeof row.payload === 'object' && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : {};
  const previousRank = normalizeRank(payload.previousRank);
  return {
    ...row,
    previousRank,
    contentType: inferTrendContentType({ platform: row.platform, url: row.url, payload }),
    payload,
  };
}

const trendRadarRowSelectSql = `
  id::text as "id",
  platform as "platform",
  platform_name as "platformName",
  title as "title",
  url as "url",
  rank as "rank",
  hot_value as "hotValue",
  first_seen_at as "firstSeenAt",
  last_seen_at as "lastSeenAt",
  source_date::text as "sourceDate",
  promoted_at as "promotedAt",
  promoted_article_id::text as "promotedArticleId",
  payload_json as "payload"
`;

/** 某日（缺省今天）的热榜条目，按平台 + 排名排序，user_id 严格隔离。 */
export async function listTrendRadarItemsByDate(
  db: DbClient,
  input: { date?: string; userId?: string },
): Promise<TrendRadarItemRow[]> {
  const { rows } = await db.query<RawTrendRadarRow>(
    `
      select ${trendRadarRowSelectSql}
      from trend_radar_items
      where user_id = $1
        and source_date = coalesce($2::date, current_date)
      order by platform asc, rank asc nulls last, id asc
    `,
    [normalizeUserId(input.userId), input.date ?? null],
  );
  return rows.map(mapRow);
}

export async function getTrendRadarItem(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<TrendRadarItemRow | null> {
  const { rows } = await db.query<RawTrendRadarRow>(
    `
      select ${trendRadarRowSelectSql}
      from trend_radar_items
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** 标记「已转选题」，回链 articles.id。 */
export async function markTrendRadarItemPromoted(
  db: DbClient,
  input: { id: string; articleId: string; userId?: string },
): Promise<void> {
  await db.query(
    `
      update trend_radar_items
      set promoted_at = now(),
          promoted_article_id = $3,
          updated_at = now()
      where id = $1
        and user_id = $2
    `,
    [input.id, normalizeUserId(input.userId), input.articleId],
  );
}

/**
 * webhook 写入的归属用户：单用户语义下取第一个 active 管理员。
 * 找不到（极端情况：库还没初始化用户）返回 null，由上层报 503。
 */
export async function resolveTrendRadarOwnerUserId(db: DbClient): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `
      select id::text as id
      from users
      where role = 'admin'
        and status = 'active'
      order by id asc
      limit 1
    `,
  );
  return rows[0]?.id ?? null;
}

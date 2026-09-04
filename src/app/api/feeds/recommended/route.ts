import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface RecommendedFeedItem {
  id: string;
  title: string;
  url: string;
  siteUrl: string | null;
  iconUrl: string | null;
  description: string | null;
  subscriberCount: number;
  source: 'builtin' | 'aggregated';
}

export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const pool = getPool();

    // 1. 从内置推荐表获取推荐源
    const { rows: builtinRows } = await pool.query<{
      id: string;
      title: string;
      url: string;
      siteUrl: string | null;
      iconUrl: string | null;
      description: string | null;
    }>(`
      select
        id::text,
        title,
        url,
        site_url as "siteUrl",
        icon_url as "iconUrl",
        description
      from recommended_feeds
      order by position asc, id asc
    `);

    // 2. 从所有用户订阅中聚合去重排序（排除已在内置表中的 URL）
    const builtinUrls = builtinRows.map((r) => r.url);
    const { rows: aggregatedRows } = await pool.query<{
      url: string;
      title: string;
      siteUrl: string | null;
      iconUrl: string | null;
      subscriberCount: number;
    }>(`
      select
        url,
        title,
        site_url as "siteUrl",
        icon_url as "iconUrl",
        count(distinct user_id)::int as "subscriberCount"
      from feeds
      where provider = 'local_rss'
        and kind = 'rss'
      group by url, title, site_url, icon_url
      order by "subscriberCount" desc, url asc
    `);

    // 合并结果：内置表优先，聚合数据补充（去重）
    const seenUrls = new Set(builtinUrls);
    const result: RecommendedFeedItem[] = [
      ...builtinRows.map((row) => ({
        id: `builtin-${row.id}`,
        title: row.title,
        url: row.url,
        siteUrl: row.siteUrl,
        iconUrl: row.iconUrl,
        description: row.description,
        subscriberCount: 0,
        source: 'builtin' as const,
      })),
      ...aggregatedRows
        .filter((row) => !seenUrls.has(row.url))
        .map((row) => {
          seenUrls.add(row.url);
          return {
            id: `agg-${row.url}`,
            title: row.title,
            url: row.url,
            siteUrl: row.siteUrl,
            iconUrl: row.iconUrl,
            description: null,
            subscriberCount: row.subscriberCount,
            source: 'aggregated' as const,
          };
        }),
    ];

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
/**
 * GET /api/trend-radar/today —— 当日热榜，按平台分组返回。
 *
 * 查询参数：
 *   date=YYYY-MM-DD（可选，缺省今天，便于回看某天）
 *
 * 返回 { date, platforms: [{ platform, platformName, items: [...] }] }，
 * 条目含排名与上一次排名（previousRank，供前端渲染升降）。
 */
import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import {
  listTrendRadarItemsByDate,
  type TrendRadarItemRow,
} from '@/server/domains/trendradar/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface TrendRadarPlatformGroup {
  platform: string;
  platformName: string;
  items: TrendRadarItemRow[];
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const dateParam = new URL(request.url).searchParams.get('date')?.trim();
    if (dateParam && !DATE_PATTERN.test(dateParam)) {
      throw new ValidationError('date 取值非法', { date: '需要 YYYY-MM-DD' });
    }

    const items = await listTrendRadarItemsByDate(getPool(), {
      userId: session.userId,
      date: dateParam || undefined,
    });

    const groups: TrendRadarPlatformGroup[] = [];
    const byPlatform = new Map<string, TrendRadarPlatformGroup>();
    for (const item of items) {
      let group = byPlatform.get(item.platform);
      if (!group) {
        group = {
          platform: item.platform,
          platformName: item.platformName || item.platform,
          items: [],
        };
        byPlatform.set(item.platform, group);
        groups.push(group);
      }
      group.items.push(item);
    }

    return ok({
      date: dateParam || items[0]?.sourceDate || new Date().toISOString().slice(0, 10),
      total: items.length,
      platforms: groups,
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * 热点雷达「转为选题」：把热榜条目转成治理 candidate 进审批台。
 *
 * 实现选择：直接插入 articles（governance_status='candidate'），不走
 * evaluateGovernanceBatch——promote 是用户显式动作，不应再被配额/去重拦截；
 * 去重由 dedupe_key（trendradar:{itemId}）+ promoted_article_id 回链保证幂等。
 *
 * 条目挂在一个每用户一条的合成 feed（kind='trend_radar'，enabled=false，
 * 不参与 RSS 抓取）下，复用审批台的 feed/category 展示链路。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { insertArticleIgnoreDuplicate } from '@/server/domains/articles/repositories/articlesRepo';
import {
  getTrendRadarItem,
  markTrendRadarItemPromoted,
} from '@/core/trendradar/repository';

type DbClient = Pool | PoolClient;

const TREND_RADAR_FEED_URL = 'trendradar://hot-radar';
const TREND_RADAR_FEED_TITLE = '热点雷达';

/** 每用户一条的合成 feed；feeds_user_url_unique 保证幂等。 */
async function ensureTrendRadarFeed(db: DbClient, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `
      insert into feeds(user_id, kind, title, url, view, enabled)
      values ($1, 'trend_radar', $2, $3, 'article', false)
      on conflict (user_id, url) where provider = 'local_rss'
      do update set title = excluded.title
      returning id::text as id
    `,
    [userId, TREND_RADAR_FEED_TITLE, TREND_RADAR_FEED_URL],
  );
  return rows[0].id;
}

async function findPromotedArticleId(
  db: DbClient,
  input: { feedId: string; dedupeKey: string; userId: string },
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `
      select id::text as id
      from articles
      where user_id = $1
        and feed_id = $2
        and dedupe_key = $3
      limit 1
    `,
    [input.userId, input.feedId, input.dedupeKey],
  );
  return rows[0]?.id ?? null;
}

export type PromoteTrendRadarResult =
  | { ok: true; articleId: string; alreadyPromoted: boolean }
  | { ok: false; reason: 'not_found' };

export async function promoteTrendRadarItem(
  db: DbClient,
  input: { id: string; userId?: string },
): Promise<PromoteTrendRadarResult> {
  const scopedUserId = normalizeUserId(input.userId);
  const item = await getTrendRadarItem(db, input.id, scopedUserId);
  if (!item) return { ok: false, reason: 'not_found' };

  // 幂等：已转过的直接返回原 article，不重复插入。
  if (item.promotedArticleId) {
    return { ok: true, articleId: item.promotedArticleId, alreadyPromoted: true };
  }

  const feedId = await ensureTrendRadarFeed(db, scopedUserId);
  const dedupeKey = `trendradar:${item.id}`;
  const platformLabel = item.platformName || item.platform;
  const link = /^https?:\/\//.test(item.url) ? item.url : null;

  const article = await insertArticleIgnoreDuplicate(db, {
    feedId,
    dedupeKey,
    title: item.title,
    link,
    publishedAt: item.lastSeenAt,
    summary: [
      `${platformLabel} 热榜${item.rank ? `第 ${item.rank} 名` : ''}`,
      item.hotValue ? `热度 ${item.hotValue}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    governance: {
      status: 'candidate',
      qualityScore: null,
      aiReason: `手动转自热点雷达（${platformLabel}，${item.sourceDate}）`,
    },
    userId: scopedUserId,
  });

  // 并发重复 promote：insert 撞 dedupe 冲突返回 null，查回已存在的那条。
  const articleId =
    article?.id ??
    (await findPromotedArticleId(db, { feedId, dedupeKey, userId: scopedUserId }));
  if (!articleId) {
    // 理论上不会发生（insert 不冲突必返回行），兜底按未找到处理。
    return { ok: false, reason: 'not_found' };
  }

  await markTrendRadarItemPromoted(db, {
    id: item.id,
    articleId,
    userId: scopedUserId,
  });

  return { ok: true, articleId, alreadyPromoted: article == null };
}

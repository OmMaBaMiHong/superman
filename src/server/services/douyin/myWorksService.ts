/**
 * 抖音工作台 · 我的作品（从 RSSHub 订阅 articles 读取）
 *
 * 之前的「我的作品」依赖 douyin-cli 的油猴脚本 + Bridge Server，
 * 现在改为用户通过 RSSHub 订阅自己的抖音主页，
 * 数据自动落入 feed 的 articles 表，通过解析 content_html 中的
 * data-douyin-stats 属性获取统计字段（播放/点赞/评论/分享/收藏）。
 *
 * 不依赖浏览器/油猴脚本，只需 RSSHub 订阅配置好即可。
 */

import { getPool } from '@/server/infra/db/pool';
import { enqueueWithResult } from '@/server/infra/queue/queue';
import { JOB_FEED_FETCH } from '@/server/infra/queue/jobs';
import { parseDouyinStatsFromHtml } from '@/lib/douyin/stats';

/** 从 data-douyin-stats 解析出的单个作品统计 */
export interface MyWorkItem {
  articleId: string;
  awemeId: string;
  title: string;
  /** 发布时间（秒） */
  time: number;
  /** 时长（毫秒） */
  duration: number;
  cover: string;
  stats: {
    plays: number;
    likes: number;
    comments: number;
    shares: number;
    collects: number;
  };
}

export interface MyWorksSummary {
  total: number;
  totalPlays: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalCollects: number;
}

/** 从 content_html 中提取第一张图片作为封面 */
function extractCoverImage(html: string): string {
  // <img src="..." 或 <img src='...'
  const m = html.match(/<img\s+[^>]*src="([^"]+)"[^>]*\/?>/i);
  return m?.[1] ?? '';
}

/** 将 articles 行解析为 MyWorkItem */
function rowToWorkItem(row: {
  id: string;
  title: string;
  published_at: Date | string | null;
  content_html: string | null;
  preview_image_url: string | null;
}): MyWorkItem | null {
  const html = row.content_html ?? '';
  const parsed = parseDouyinStatsFromHtml(html);
  if (!parsed) return null;

  const { awemeId, createTime, duration, stats } = parsed;

  const cover = row.preview_image_url || extractCoverImage(html);

  return {
    articleId: row.id,
    awemeId,
    title: row.title || `视频 ${awemeId}`,
    time: createTime,
    duration,
    cover,
    stats,
  };
}

/** 查找当前用户的「我的作品」feed（douyin/user 订阅，标题含"我的作品"） */
async function findMyWorkFeedId(userId: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM feeds
     WHERE user_id = $1
       AND url LIKE 'rsshub://douyin/user/%'
       AND enabled = true
       AND kind = 'rss'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0]?.id ?? null;
}

/**
 * 获取我的作品列表（从 RSSHub 订阅读取）。
 * 如果没有找到订阅，返回 null。
 */
export async function listMyWorks(userId: string): Promise<{
  feedId: string | null;
  items: MyWorkItem[];
  summary: MyWorksSummary | null;
}> {
  const feedId = await findMyWorkFeedId(userId);
  if (!feedId) {
    return { feedId: null, items: [], summary: null };
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id::text, title, published_at, content_html, preview_image_url
     FROM articles
     WHERE feed_id = $1 AND user_id = $2
     ORDER BY published_at DESC NULLS LAST, id DESC
     LIMIT 200`,
    [feedId, userId],
  );

  const items: MyWorkItem[] = [];
  for (const row of rows) {
    const item = rowToWorkItem(row);
    if (item) items.push(item);
  }

  const summary: MyWorksSummary | null = items.length > 0
    ? {
        total: items.length,
        totalPlays: items.reduce((s, v) => s + v.stats.plays, 0),
        totalLikes: items.reduce((s, v) => s + v.stats.likes, 0),
        totalComments: items.reduce((s, v) => s + v.stats.comments, 0),
        totalShares: items.reduce((s, v) => s + v.stats.shares, 0),
        totalCollects: items.reduce((s, v) => s + v.stats.collects, 0),
      }
    : null;

  return { feedId, items, summary };
}

/**
 * 强制刷新「我的作品」订阅。
 * 需先调用 listMyWorks 获取 feedId。
 */
export async function refreshMyWorks(feedId: string, userId: string): Promise<{ jobId: string }> {
  const result = await enqueueWithResult(JOB_FEED_FETCH, {
    feedId,
    userId,
    force: true,
  });
  if (result.status !== 'enqueued') {
    throw new Error('刷新任务已在队列中，请稍后查看');
  }
  return { jobId: result.jobId };
}
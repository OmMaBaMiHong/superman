import { isDshLlmAvailable, dshComplete } from '@/server/integrations/ai/dshLlmBridge';

/**
 * 我的数据 —— 创作者自己的作品数据分析。
 * 数据源：published_posts（按平台登记的发布）+ post_metrics_snapshots（每次抓取的
 * 播放/点赞/评论/分享快照，时序）+ post_comments（受众评论与 IP 属地）。
 * AI 建议走 DSH 宿主模型（dshComplete），把聚合结果压缩成摘要让模型给运营建议。
 */

export interface QueryRunner {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: any[] }>;
}

export interface PlatformTotals {
  platform: string;
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface SeriesPoint {
  day: string; // yyyy-MM-dd
  views: number;
  likes: number;
  comments: number;
}

export interface WorkRow {
  postId: number;
  platform: string;
  title: string;
  postUrl: string;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  fetchedAt: string | null;
}

export interface AudienceData {
  totalComments: number;
  topCommenters: Array<{ author: string; cnt: number; likes: number; ipLocation: string | null }>;
  ipLocations: Array<{ loc: string; cnt: number }>;
}

export interface MyDataOverview {
  totals: { posts: number; views: number; likes: number; comments: number; shares: number };
  platforms: PlatformTotals[];
  series: SeriesPoint[];
  works: WorkRow[];
  audience: AudienceData;
}

interface LatestSnapRow {
  post_id: number | string;
  platform: string;
  title: string;
  post_url: string;
  published_at: string | Date | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  fetched_at: string | Date | null;
}

const SERIES_DAYS = 14;

function isoDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 最近 N 天（含今天）的日期键，升序。 */
function lastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    days.push(isoDay(new Date(Date.now() - i * 24 * 3600 * 1000)));
  }
  return days;
}

/** 概览聚合：平台合计 + 14 天趋势（快照按天进位）+ 作品列表 + 受众。全部单表查询走 user_id。 */
export async function getMyDataOverview(db: QueryRunner, userId: number | string): Promise<MyDataOverview> {
  // 每个作品最新一次快照（totals / 平台分组 / 作品列表共用）
  const latestRes = await db.query(
    `select distinct on (s.post_id)
       s.post_id, p.platform, p.title, p.post_url, p.published_at,
       s.views, s.likes, s.comments, s.shares, s.fetched_at
     from post_metrics_snapshots s
     join published_posts p on p.id = s.post_id
     where p.user_id = $1
     order by s.post_id, s.fetched_at desc`,
    [userId],
  );
  const latest = latestRes.rows as LatestSnapRow[];

  // 14 天内全部快照（量小：作品数 × 每天抓取次数），按天进位在 JS 里聚合
  const seriesRes = await db.query(
    `select s.post_id, s.fetched_at, s.views, s.likes, s.comments
     from post_metrics_snapshots s
     join published_posts p on p.id = s.post_id
     where p.user_id = $1 and s.fetched_at >= now() - ($2 || ' days')::interval
     order by s.fetched_at asc`,
    [userId, String(SERIES_DAYS)],
  );

  // 受众：评论者 Top + IP 属地分布 + 评论总数
  const commentersRes = await db.query(
    `select c.author, count(*)::int as cnt, coalesce(sum(c.likes), 0)::int as likes,
            (array_agg(c.ip_location order by c.commented_at desc nulls last))[1] as ip_location
     from post_comments c
     join published_posts p on p.id = c.post_id
     where p.user_id = $1 and c.author <> ''
     group by c.author order by cnt desc, likes desc limit 10`,
    [userId],
  );
  const ipRes = await db.query(
    `select c.ip_location as loc, count(*)::int as cnt
     from post_comments c
     join published_posts p on p.id = c.post_id
     where p.user_id = $1 and coalesce(c.ip_location, '') <> ''
     group by c.ip_location order by cnt desc limit 8`,
    [userId],
  );
  const totalCommentsRes = await db.query(
    `select count(*)::int as cnt
     from post_comments c
     join published_posts p on p.id = c.post_id
     where p.user_id = $1`,
    [userId],
  );

  const works: WorkRow[] = latest.map((r) => ({
    postId: Number(r.post_id),
    platform: r.platform,
    title: r.title || '未命名作品',
    postUrl: r.post_url,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    fetchedAt: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
  }));

  const platformMap = new Map<string, PlatformTotals>();
  const totals = { posts: latest.length, views: 0, likes: 0, comments: 0, shares: 0 };
  for (const r of latest) {
    const bucket = platformMap.get(r.platform) ?? {
      platform: r.platform, posts: 0, views: 0, likes: 0, comments: 0, shares: 0,
    };
    bucket.posts += 1;
    bucket.views += Number(r.views ?? 0);
    bucket.likes += Number(r.likes ?? 0);
    bucket.comments += Number(r.comments ?? 0);
    bucket.shares += Number(r.shares ?? 0);
    platformMap.set(r.platform, bucket);
    totals.views += Number(r.views ?? 0);
    totals.likes += Number(r.likes ?? 0);
    totals.comments += Number(r.comments ?? 0);
    totals.shares += Number(r.shares ?? 0);
  }

  // 趋势：每天取每作品当天最后一帧（无则进位上一帧），求和
  const days = lastNDays(SERIES_DAYS);
  const dayStart = new Map<string, number>(days.map((d) => [d, new Date(`${d}T00:00:00`).getTime()]));
  const byPost = new Map<number, Array<{ t: number; views: number; likes: number; comments: number }>>();
  for (const raw of seriesRes.rows) {
    const postId = Number(raw.post_id);
    const list = byPost.get(postId) ?? [];
    list.push({
      t: new Date(raw.fetched_at).getTime(),
      views: Number(raw.views ?? 0),
      likes: Number(raw.likes ?? 0),
      comments: Number(raw.comments ?? 0),
    });
    byPost.set(postId, list);
  }
  const series: SeriesPoint[] = days.map((day) => {
    const end = dayStart.get(day)! + 24 * 3600 * 1000;
    let views = 0;
    let likes = 0;
    let comments = 0;
    for (const snapshots of byPost.values()) {
      let last: { views: number; likes: number; comments: number } | null = null;
      for (const snap of snapshots) {
        if (snap.t > end) break;
        last = snap;
      }
      if (last) {
        views += last.views;
        likes += last.likes;
        comments += last.comments;
      }
    }
    return { day, views, likes, comments };
  });

  return {
    totals,
    platforms: [...platformMap.values()].sort((a, b) => b.views - a.views),
    series,
    works: works.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)),
    audience: {
      totalComments: totalCommentsRes.rows[0]?.cnt ?? 0,
      topCommenters: commentersRes.rows,
      ipLocations: ipRes.rows,
    },
  };
}

/**
 * AI 运营建议：聚合数据压缩成 JSON 摘要 → DSH 宿主模型。
 * 显式动作接口（用户点按钮触发），耗时数秒可接受。
 */
export async function generateMyDataAdvice(db: QueryRunner, userId: number | string): Promise<string> {
  if (!isDshLlmAvailable()) {
    throw new Error('DSH AI 不可用，请检查宿主模型配置');
  }
  const overview = await getMyDataOverview(db, userId);
  if (overview.totals.posts === 0) {
    throw new Error('还没有已登记的作品，先去创作台发布/登记链接');
  }

  const topCommentsRes = await db.query(
    `select c.content, c.likes
     from post_comments c
     join published_posts p on p.id = c.post_id
     where p.user_id = $1 and c.content <> ''
     order by coalesce(c.likes, 0) desc limit 10`,
    [userId],
  );

  const summary = {
    总量: overview.totals,
    平台分布: overview.platforms,
    近14天趋势: overview.series,
    作品Top10: overview.works.slice(0, 10).map((w) => ({
      标题: w.title, 平台: w.platform, 播放: w.views, 点赞: w.likes, 评论: w.comments, 发布: w.publishedAt?.slice(0, 10),
    })),
    受众: {
      评论总数: overview.audience.totalComments,
      活跃评论者: overview.audience.topCommenters.slice(0, 5),
      IP属地Top: overview.audience.ipLocations,
    },
    高赞评论样本: topCommentsRes.rows.map((r) => ({ 内容: String(r.content ?? '').slice(0, 80), 赞: r.likes })),
  };

  const advice = await dshComplete({
    system:
      '你是资深短视频/图文内容运营数据分析顾问。基于用户的作品数据（多平台），输出简体中文运营建议。' +
      '要求：直接输出，不要寒暄；用以下小节：## 流量表现、## 受众画像、## 选题建议、## 下一步动作。' +
      '每节 2-4 条要点，结论必须引用数据（如播放、互动率=点赞/播放）；建议要具体可执行，结合高赞评论给出选题方向。',
    messages: [{ role: 'user', content: `这是我的作品数据：\n${JSON.stringify(summary)}` }],
    temperature: 0.5,
    maxTokens: 1600,
  });
  return advice.trim();
}

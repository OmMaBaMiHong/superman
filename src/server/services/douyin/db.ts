/**
 * 抖音数据服务 · 读库统计（读 douyin schema）
 *
 * douyin-cli 与 FeedFuse 共用同一个 PostgreSQL，抖音数据统一落在独立 schema `douyin`。
 * FeedFuse 的 pool 默认 search_path 是 public，这里一律用显式 `douyin.` 前缀访问，
 * 避免与 FeedFuse 存量表（如 users）冲突。
 *
 * 时间戳约定：comments.created_at 为秒（抖音 API 原始值，可能为 0）；
 * first_seen / last_seen 为毫秒（落库时间）。趋势与「今日新增」以 first_seen 为准，
 * 评论时间展示用 created_at。
 */

import { existsSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import { getPool } from '@/server/infra/db/pool';
import { AppError } from '@/server/infra/http/errors';

const SCHEMA = 'douyin';

export interface DouyinOverview {
  total: number;
  replied: number;
  pending: number;
  todayNew: number;
  sentiment: { sentiment: string | null; count: number }[];
  trend: { day: string; count: number }[];
  days: number;
}

export interface DouyinVideo {
  awemeId: string;
  title: string | null;
  isMine: boolean;
  commentCount: number;
  pendingCount: number;
  repliedCount: number;
  lastGetTs: number | null;
  lastPostTs: number | null;
  authorNickname: string | null;
  playCount: number;
  diggCount: number;
  shareCount: number;
  collectCount: number;
  createTime: number | null; // 秒
  duration: number | null; // 毫秒
}

export interface DouyinComment {
  cid: string;
  awemeId: string;
  uid: string | null;
  nickname: string | null;
  text: string | null;
  digg: number | null;
  createdAt: number | null; // 秒
  firstSeen: number | null; // 毫秒
  sentiment: string | null;
  priority: number | null;
  replied: boolean;
  replyCid: string | null;
  parentCid: string | null;
}

/** 今日 0 点（毫秒） */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** pg 对 bigint 返回字符串，统一转 number；空值返回 null */
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 统计总览：评论总数 / 已回复 / 待回复 / 今日新增 / 情感分布 / 最近 N 天趋势 */
export async function getOverview(days = 14): Promise<DouyinOverview> {
  const pool = getPool();
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const todayMs = startOfToday();

  const [summary, sentiment, trend] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT count(*) FROM ${SCHEMA}.comments)::int AS total,
         (SELECT count(*) FROM ${SCHEMA}.comments WHERE replied = 1)::int AS replied,
         (SELECT count(*) FROM ${SCHEMA}.comments WHERE replied = 0)::int AS pending,
         (SELECT count(*) FROM ${SCHEMA}.comments WHERE first_seen >= $1)::int AS today_new
       `,
      [todayMs],
    ),
    pool.query(
      `SELECT sentiment, count(*)::int AS count
       FROM ${SCHEMA}.comments
       WHERE sentiment IS NOT NULL AND sentiment <> ''
       GROUP BY sentiment
       ORDER BY count DESC`,
    ),
    pool.query(
      `SELECT to_char(to_timestamp(first_seen / 1000.0), 'YYYY-MM-DD') AS day, count(*)::int AS count
       FROM ${SCHEMA}.comments
       WHERE first_seen >= $1
       GROUP BY 1
       ORDER BY 1`,
      [sinceMs],
    ),
  ]);

  // 补齐最近 N 天的空档，保证趋势图连续
  const trendMap = new Map(trend.rows.map((r) => [r.day, r.count]));
  const filled: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    filled.push({ day: key, count: trendMap.get(key) ?? 0 });
  }

  const s = summary.rows[0];
  return {
    total: s?.total ?? 0,
    replied: s?.replied ?? 0,
    pending: s?.pending ?? 0,
    todayNew: s?.today_new ?? 0,
    sentiment: sentiment.rows.map((r) => ({ sentiment: r.sentiment, count: r.count })),
    trend: filled,
    days,
  };
}

/** 视频列表（含每视频评论统计与作品统计），按最近抓取/回复时间倒序 */
export async function listVideos(): Promise<DouyinVideo[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT v.aweme_id,
            v.title,
            v.is_mine,
            v.last_get_ts,
            v.last_post_ts,
            v.author_nickname,
            v.play_count,
            v.digg_count,
            v.share_count,
            v.collect_count,
            v.create_time,
            v.duration,
            (SELECT count(*) FROM ${SCHEMA}.comments c WHERE c.aweme_id = v.aweme_id)::int AS comment_count,
            (SELECT count(*) FROM ${SCHEMA}.comments c WHERE c.aweme_id = v.aweme_id AND c.replied = 0)::int AS pending_count,
            (SELECT count(*) FROM ${SCHEMA}.comments c WHERE c.aweme_id = v.aweme_id AND c.replied = 1)::int AS replied_count
     FROM ${SCHEMA}.videos v
     ORDER BY COALESCE(v.create_time, v.last_get_ts, v.last_post_ts, 0) DESC
     LIMIT 500`,
  );
  return rows.map((r) => ({
    awemeId: r.aweme_id,
    title: r.title,
    isMine: !!r.is_mine,
    commentCount: Number(r.comment_count) || 0,
    pendingCount: Number(r.pending_count) || 0,
    repliedCount: Number(r.replied_count) || 0,
    lastGetTs: toNum(r.last_get_ts),
    lastPostTs: toNum(r.last_post_ts),
    authorNickname: r.author_nickname,
    playCount: Number(r.play_count) || 0,
    diggCount: Number(r.digg_count) || 0,
    shareCount: Number(r.share_count) || 0,
    collectCount: Number(r.collect_count) || 0,
    createTime: toNum(r.create_time),
    duration: toNum(r.duration),
  }));
}

/** 评论列表（可筛选视频 / 回复状态，仅顶层评论，分页） */
export async function listComments(opts: {
  awemeId?: string;
  replied?: boolean;
  page?: number;
  limit?: number;
}): Promise<{ items: DouyinComment[]; total: number }> {
  const pool = getPool();
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const params: unknown[] = [];
  const push = (cond: string, val: unknown) => {
    params.push(val);
    conds.push(cond.replace('?', `$${params.length}`));
  };

  if (opts.awemeId) push('c.aweme_id = ?', opts.awemeId);
  if (opts.replied != null) push('c.replied = ?', opts.replied ? 1 : 0);

  const base = `FROM ${SCHEMA}.comments c
                LEFT JOIN ${SCHEMA}.users u ON u.uid = c.uid AND u.platform = c.platform`;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n ${base} ${where}`, params),
    pool.query(
      `SELECT c.cid, c.aweme_id, c.uid, c.text, c.digg, c.created_at, c.sentiment,
              c.priority, c.replied, c.reply_cid, c.parent_cid, c.first_seen,
              u.nickname
       ${base}
       ${where}
       ORDER BY COALESCE(c.first_seen, c.created_at * 1000) DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
  ]);

  return {
    items: rows.map((r) => ({
      cid: r.cid,
      awemeId: r.aweme_id,
      uid: r.uid,
      nickname: r.nickname,
      text: r.text,
      digg: toNum(r.digg),
      createdAt: toNum(r.created_at),
      firstSeen: toNum(r.first_seen),
      sentiment: r.sentiment,
      priority: toNum(r.priority),
      replied: !!r.replied,
      replyCid: r.reply_cid,
      parentCid: r.parent_cid,
    })),
    total: countRows[0]?.n ?? 0,
  };
}

/* ──────────── 自动回帖活动 · 直连读库 ──────────── */
// 活动配置与任务本就落在 douyin schema，这里直接读库返回；
// daemon 是否存活通过 douyin-cli 写的 pid 文件判断，无需 spawn 子进程。

const DOUYIN_CLI_DIR = process.env.DOUYIN_CLI_DIR || '/Users/wade/.openclaw/douyin-cli';

export interface DouyinCampaign {
  id: number;
  platform: string;
  name: string;
  goal: string | null;
  template: unknown;
  videos: string[];
  filters: { minPriority?: number } | null;
  dailyQuota: number;
  perUserQuota: number;
  status: 'draft' | 'running' | 'paused' | 'done';
  startedAt: number | null;
  stats: Record<string, unknown> | null;
}

export interface DouyinCampaignStatus {
  campaign: DouyinCampaign;
  tasks: { pending: number; posted: number; failed: number; skipped: number; total: number };
  daemon: { running: boolean; pid: number | null };
}

function safeParseJson<T>(s: unknown): T | null {
  if (s == null || s === '') return null;
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return null;
  }
}

function campaignPidFile(id: number): string {
  return path.join(DOUYIN_CLI_DIR, 'storage', `campaign-${id}.pid`);
}

/** daemon 是否存活（读 douyin-cli 写的 pid 文件）；返回 pid 或 null，并清理失效文件 */
function daemonAlive(id: number): number | null {
  const pidFile = campaignPidFile(id);
  if (!existsSync(pidFile)) return null;
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    return null;
  }
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    try {
      unlinkSync(pidFile);
    } catch {
      // 忽略清理失败
    }
    return null;
  }
}

function rowToCampaign(r: Record<string, unknown>): DouyinCampaign {
  return {
    id: Number(r.id),
    platform: String(r.platform ?? 'douyin'),
    name: String(r.name ?? ''),
    goal: r.goal == null ? null : String(r.goal),
    template: safeParseJson(r.template_json),
    videos: safeParseJson<string[]>(r.videos_json) ?? [],
    filters: safeParseJson<{ minPriority?: number }>(r.filters_json),
    dailyQuota: Number(r.daily_quota ?? 50),
    perUserQuota: Number(r.per_user_quota ?? 1),
    status: String(r.status ?? 'draft') as DouyinCampaign['status'],
    startedAt: toNum(r.started_at),
    stats: safeParseJson<Record<string, unknown>>(r.stats_json),
  };
}

/** 自动回帖活动列表（直读 douyin.campaigns，毫秒级返回） */
export async function listCampaigns(): Promise<DouyinCampaign[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, platform, name, goal, template_json, videos_json, filters_json,
            daily_quota, per_user_quota, status, started_at, stats_json
     FROM ${SCHEMA}.campaigns
     WHERE platform = 'douyin'
     ORDER BY id DESC`,
  );
  return rows.map(rowToCampaign);
}

/** 单个活动状态（活动 + 任务计数 + daemon 存活），直读库 */
export async function getCampaignStatus(id: number): Promise<DouyinCampaignStatus> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, platform, name, goal, template_json, videos_json, filters_json,
            daily_quota, per_user_quota, status, started_at, stats_json
     FROM ${SCHEMA}.campaigns
     WHERE id = $1 AND platform = 'douyin'`,
    [id],
  );
  if (rows.length === 0) {
    throw new AppError(`活动 ${id} 不存在`, 'campaign_not_found', 404);
  }
  const campaign = rowToCampaign(rows[0]);
  const { rows: taskRows } = await pool.query(
    `SELECT outcome, count(*)::int AS n
     FROM ${SCHEMA}.campaign_tasks
     WHERE campaign_id = $1
     GROUP BY outcome`,
    [id],
  );
  const tasks: DouyinCampaignStatus['tasks'] = { pending: 0, posted: 0, failed: 0, skipped: 0, total: 0 };
  for (const r of taskRows) {
    if (r.outcome in tasks) {
      tasks[r.outcome as 'pending' | 'posted' | 'failed' | 'skipped'] = Number(r.n) || 0;
    }
  }
  tasks.total = tasks.pending + tasks.posted + tasks.failed + tasks.skipped;
  const pid = daemonAlive(id);
  return { campaign, tasks, daemon: { running: !!pid, pid } };
}

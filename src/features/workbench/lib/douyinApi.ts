/**
 * 工作台 · 抖音数据 —— 前端 API 封装。
 *
 * 仪表盘读库（快）走 GET；「一键刷新」抓评论与「在线回复」会通过 douyin-cli
 * 的油猴脚本 + Bridge Server 在浏览器执行，需要浏览器保持在线。
 */

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
  createTime: number | null;
  duration: number | null;
}

/** douyin-cli my/user 返回的单个作品（含统计） */
export interface DouyinWork {
  awemeId: string;
  title: string;
  time: number;
  duration: number;
  stats: {
    plays: number;
    likes: number;
    comments: number;
    shares: number;
    collects: number;
  };
  cover: string;
}

export interface DouyinAuthor {
  uid: string;
  secUid: string;
  nickname: string;
}

export interface DouyinBridgeStatus {
  connected: boolean;
  connections: number;
  error?: string;
}

export interface DouyinComment {
  cid: string;
  awemeId: string;
  uid: string | null;
  nickname: string | null;
  text: string | null;
  digg: number | null;
  createdAt: number | null;
  firstSeen: number | null;
  sentiment: string | null;
  priority: number | null;
  replied: boolean;
  replyCid: string | null;
  parentCid: string | null;
}

export interface DouyinCommentPage {
  items: DouyinComment[];
  total: number;
}

async function readOk<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => null)) as {
    ok: boolean;
    data?: T;
    error?: { message?: string };
  } | null;
  if (!payload || !payload.ok) {
    throw new Error(payload?.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return payload.data as T;
}

export async function fetchDouyinOverview(): Promise<DouyinOverview> {
  const res = await fetch('/api/workspace/douyin/overview', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<DouyinOverview>(res);
}

export async function fetchDouyinVideos(): Promise<DouyinVideo[]> {
  const res = await fetch('/api/workspace/douyin/videos', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<DouyinVideo[]>(res);
}

export async function fetchDouyinComments(params: {
  awemeId?: string;
  replied?: boolean;
  page?: number;
  limit?: number;
}): Promise<DouyinCommentPage> {
  const q = new URLSearchParams();
  if (params.awemeId) q.set('awemeId', params.awemeId);
  if (params.replied != null) q.set('replied', params.replied ? '1' : '0');
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const res = await fetch(`/api/workspace/douyin/comments?${q.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<DouyinCommentPage>(res);
}

/** 一键刷新：抓取指定视频的最新评论，返回本次抓到的条数 */
export async function refreshDouyinVideo(awemeId: string): Promise<{ count: number }> {
  const res = await fetch(`/api/workspace/douyin/videos/${awemeId}/refresh`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  return readOk<{ count: number }>(res);
}

/** 在线回复一条评论 */
export async function replyDouyinComment(
  cid: string,
  awemeId: string,
  text: string,
): Promise<{ cid: string; text: string }> {
  const res = await fetch(`/api/workspace/douyin/comments/${cid}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ awemeId, text }),
  });
  return readOk<{ cid: string; text: string }>(res);
}

/** 查询抖音 Bridge 连接状态（浏览器油猴脚本是否在线） */
export async function fetchDouyinStatus(): Promise<DouyinBridgeStatus> {
  const res = await fetch('/api/workspace/douyin/status', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<DouyinBridgeStatus>(res);
}

/** 我的作品汇总（从 RSSHub 订阅读取） */
export interface MyWorksSummary {
  total: number;
  totalPlays: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalCollects: number;
}

/** 我的作品（来自 RSSHub 订阅的 articles，无需浏览器/油猴脚本） */
export interface MyWorks {
  feedId: string | null;
  items: DouyinWork[];
  summary: MyWorksSummary | null;
}

/** 读取「我的作品」（RSSHub 订阅 articles） */
export async function fetchMyWorks(): Promise<MyWorks> {
  const res = await fetch('/api/workspace/douyin/my-works', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<MyWorks>(res);
}

/** 强制刷新「我的作品」订阅（enqueue feed.fetch） */
export async function refreshMyWorks(): Promise<{ refreshed: boolean; jobId: string | null; reason?: string }> {
  const res = await fetch('/api/workspace/douyin/my-works', {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  return readOk<{ refreshed: boolean; jobId: string | null; reason?: string }>(res);
}

/** 拉取指定用户的作品列表（支持 sec_user_id 或用户主页 URL） */
export async function fetchUserDouyinVideos(
  target: string,
  count = 18,
): Promise<{ user: DouyinAuthor; items: DouyinWork[] }> {
  const res = await fetch('/api/workspace/douyin/videos/user', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ target, count }),
  });
  return readOk<{ user: DouyinAuthor; items: DouyinWork[] }>(res);
}

/* ──────────── 自动回帖（campaign） ──────────── */

export type DouyinCampaignStatusValue = 'draft' | 'running' | 'paused' | 'done';

export interface DouyinCampaign {
  id: number;
  platform: string;
  name: string;
  goal: string | null;
  videos: string[];
  filters: { minPriority?: number } | null;
  dailyQuota: number;
  perUserQuota: number;
  status: DouyinCampaignStatusValue;
  startedAt: number | null;
  stats: Record<string, unknown> | null;
}

export interface DouyinCampaignStatus {
  campaign: DouyinCampaign;
  tasks: {
    pending: number;
    posted: number;
    failed: number;
    skipped: number;
    total: number;
  };
  daemon: { running: boolean; pid: number | null };
}

export interface DouyinCampaignCreateInput {
  name: string;
  goal?: string | null;
  videos?: string[];
  dailyQuota?: number;
  minPriority?: number;
}

/** 自动回帖活动列表 */
export async function fetchCampaigns(): Promise<DouyinCampaign[]> {
  const res = await fetch('/api/workspace/douyin/campaigns', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<DouyinCampaign[]>(res);
}

/** 创建自动回帖活动 */
export async function createDouyinCampaign(input: DouyinCampaignCreateInput): Promise<DouyinCampaign> {
  const res = await fetch('/api/workspace/douyin/campaigns', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readOk<DouyinCampaign>(res);
}

/** 查询单个活动状态 */
export async function fetchCampaignStatus(id: number): Promise<DouyinCampaignStatus> {
  const res = await fetch(`/api/workspace/douyin/campaigns/${id}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<DouyinCampaignStatus>(res);
}

/** 对活动执行操作：plan(预生成回复)/run(启动自动回帖)/stop(停止)/pause(暂停)/resume(恢复) */
export async function runCampaignAction(
  id: number,
  action: 'plan' | 'run' | 'stop' | 'pause' | 'resume',
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/workspace/douyin/campaigns/${id}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ action }),
  });
  return readOk<Record<string, unknown>>(res);
}

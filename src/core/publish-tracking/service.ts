/**
 * 发布后表现追踪服务（P2d）。
 *
 * 闭环：登记（手动填链接先行）→ 快照抓取（72h 内每小时、之后每天）
 * → 火了检测（对比 24h 前基线快照）→ 通知 + 原选题 requeue 回审批台
 * （「火了提示出续集」）→ 表现反哺选题。
 *
 * 容错：单帖失败不打断其他帖；连续失败计数落 post.fetch_fail_count/last_error，
 * 错误不进消息中心（不刷屏）。
 */
import type { Pool, PoolClient } from 'pg';
import { ConflictError, ValidationError } from '@/server/infra/http/errors';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { notify } from '@/core/notify/service';
import { requeueGovernanceItem } from '@/core/governance/services/governanceActionsService';
import {
  getMetricsProvider,
  type MetricsProvider,
} from '@/core/publish-tracking/metricsProvider';
import { inferPlatformFromUrl, isPublishPlatform } from '@/core/publish-tracking/platform';
import {
  getPublishedPost,
  insertMetricsSnapshot,
  insertPublishedPost,
  listDueTrackingPosts,
  listRecentSnapshots,
  markPostFetchFailed,
  markPostFetchSucceeded,
  markPostHotNotified,
  type PublishedPostRow,
  type PostMetricsSnapshotRow,
} from '@/core/publish-tracking/repository';

type DbClient = Pool | PoolClient;

// ============================================================
// 火了检测（纯函数）
// ============================================================

export interface HotMetricValues {
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export const HOT_VIEWS_RATIO = 0.5;
export const HOT_VIEWS_MIN_DELTA = 1000;
export const HOT_LIKES_MIN_DELTA = 100;
export const HOT_COMMENTS_MIN_DELTA = 50;
/** 基线快照选取窗口：取 latest 20-36h 之前最接近的一条。 */
const HOT_BASELINE_MIN_HOURS = 20;
const HOT_BASELINE_MAX_HOURS = 36;
export const HOT_NOTIFY_WINDOW_MS = 24 * 3600 * 1000;

export interface HotEvaluation {
  hot: boolean;
  reasons: string[];
}

/** 三阈值任一命中即 hot（增量为负/基线缺失的维度直接跳过）。 */
export function evaluateHot(prev: HotMetricValues, latest: HotMetricValues): HotEvaluation {
  const reasons: string[] = [];
  if (prev.views !== null && latest.views !== null && prev.views > 0) {
    const delta = latest.views - prev.views;
    if (delta >= HOT_VIEWS_MIN_DELTA && delta / prev.views >= HOT_VIEWS_RATIO) {
      reasons.push(`播放 24h 涨 ${delta}（+${Math.round((delta / prev.views) * 100)}%）`);
    }
  }
  if (prev.likes !== null && latest.likes !== null) {
    const delta = latest.likes - prev.likes;
    if (delta >= HOT_LIKES_MIN_DELTA) reasons.push(`点赞 24h +${delta}`);
  }
  if (prev.comments !== null && latest.comments !== null) {
    const delta = latest.comments - prev.comments;
    if (delta >= HOT_COMMENTS_MIN_DELTA) reasons.push(`评论 24h +${delta}`);
  }
  return { hot: reasons.length > 0, reasons };
}

/**
 * 选取火了检测基线：latest 之前 20-36h 窗口内最接近 24h 的一条；
 * 窗口内没有则退回最近的上一条；再没有返回 null（无法判定）。
 */
export function pickHotBaseline(
  snapshotsDesc: readonly PostMetricsSnapshotRow[],
): { latest: PostMetricsSnapshotRow; baseline: PostMetricsSnapshotRow | null } | null {
  if (snapshotsDesc.length === 0) return null;
  const latest = snapshotsDesc[0];
  const latestMs = new Date(latest.fetchedAt).getTime();
  let baseline: PostMetricsSnapshotRow | null = null;
  for (const snap of snapshotsDesc.slice(1)) {
    const ageHours = (latestMs - new Date(snap.fetchedAt).getTime()) / 3600_000;
    if (ageHours >= HOT_BASELINE_MIN_HOURS && ageHours <= HOT_BASELINE_MAX_HOURS) {
      baseline = snap;
      break;
    }
  }
  // 窗口内没有基线（如抓取间隔很密）时退回最近的上一条。
  if (!baseline && snapshotsDesc.length > 1) {
    baseline = snapshotsDesc[1];
  }
  return { latest, baseline };
}

// ============================================================
// 依赖注入（测试用）
// ============================================================

export interface PublishTrackingDeps {
  providerFactory?: (platform: PublishedPostRow['platform']) => MetricsProvider;
  notifyFn?: typeof notify;
  requeueFn?: typeof requeueGovernanceItem;
  now?: () => number;
}

// ============================================================
// 登记
// ============================================================

export async function registerPublishedPost(
  db: DbClient,
  input: {
    postUrl: string;
    title?: string;
    platform?: string;
    accountName?: string;
    draftId?: string | null;
    articleId?: string | null;
    publishedAt?: string | null;
    userId?: string;
  },
  deps?: PublishTrackingDeps,
): Promise<PublishedPostRow> {
  const scopedUserId = normalizeUserId(input.userId);
  const postUrl = input.postUrl.trim();
  if (!/^https?:\/\//i.test(postUrl)) {
    throw new ValidationError('postUrl 非法', { postUrl: '链接必须以 http(s):// 开头' });
  }

  const platform = input.platform?.trim() || inferPlatformFromUrl(postUrl);
  if (!isPublishPlatform(platform)) {
    throw new ValidationError('platform 非法', { platform: '仅支持 bilibili/douyin/xhs/wechat/other' });
  }

  // B站未填标题时从公开 API 自动补全（失败不阻塞登记，留空可后补）。
  let title = input.title?.trim() ?? '';
  if (!title && platform === 'bilibili') {
    const provider = (deps?.providerFactory ?? getMetricsProvider)(platform);
    const info = await provider.fetchMetrics(postUrl).catch(() => null);
    if (info?.ok && info.title) title = info.title;
  }

  try {
    return await insertPublishedPost(db, {
      userId: scopedUserId,
      draftId: input.draftId ?? null,
      articleId: input.articleId ?? null,
      platform,
      accountName: input.accountName ?? '',
      postUrl,
      title,
      publishedAt: input.publishedAt ?? null,
    });
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
      throw new ConflictError('该链接已登记', { postUrl: '重复登记' });
    }
    throw err;
  }
}

// ============================================================
// 抓取与火了联动
// ============================================================

export interface RefreshPostResult {
  ok: boolean;
  error?: string;
  snapshotId?: string;
  hot?: boolean;
  hotReasons?: string[];
  hotNotified?: boolean;
}

async function maybeNotifyHot(
  db: DbClient,
  post: PublishedPostRow,
  deps?: PublishTrackingDeps,
): Promise<{ hot: boolean; reasons: string[]; notified: boolean }> {
  const nowMs = deps?.now?.() ?? Date.now();
  const snapshots = await listRecentSnapshots(db, { postId: post.id, limit: 40 });
  const picked = pickHotBaseline(snapshots);
  if (!picked?.baseline) return { hot: false, reasons: [], notified: false };

  const evaluation = evaluateHot(picked.baseline, picked.latest);
  if (!evaluation.hot) return { hot: false, reasons: [], notified: false };

  // 24h 同一帖只提示一次。
  const lastNotifiedMs = post.lastHotNotifiedAt ? new Date(post.lastHotNotifiedAt).getTime() : 0;
  if (nowMs - lastNotifiedMs < HOT_NOTIFY_WINDOW_MS) {
    return { hot: true, reasons: evaluation.reasons, notified: false };
  }

  const notifyFn = deps?.notifyFn ?? notify;
  await notifyFn(db, {
    userId: post.userId,
    kind: 'performance_hot',
    title: `🔥 《${post.title || post.postUrl}》数据起飞`,
    body: evaluation.reasons.join('；'),
    link: '/#/studio?tab=performance',
  }).catch(() => {});

  // 火了提示出续集：有关联选题文章时自动 requeue 回审批台。
  if (post.articleId) {
    const requeueFn = deps?.requeueFn ?? requeueGovernanceItem;
    await requeueFn(db, { id: post.articleId, userId: post.userId }).catch(() => {
      // 非 archived（已 candidate/used）等状态不允许迁移，静默跳过。
    });
  }

  await markPostHotNotified(db, post.id);
  return { hot: true, reasons: evaluation.reasons, notified: true };
}

export async function refreshPublishedPost(
  db: DbClient,
  input: { postId: string; userId?: string },
  deps?: PublishTrackingDeps,
): Promise<RefreshPostResult> {
  const scopedUserId = normalizeUserId(input.userId);
  const post = await getPublishedPost(db, input.postId, scopedUserId);
  if (!post) return { ok: false, error: '帖子不存在或不属于当前用户' };
  return refreshOnePost(db, post, deps);
}

async function refreshOnePost(
  db: DbClient,
  post: PublishedPostRow,
  deps?: PublishTrackingDeps,
): Promise<RefreshPostResult> {
  const provider = (deps?.providerFactory ?? getMetricsProvider)(post.platform);
  try {
    const result = await provider.fetchMetrics(post.postUrl);
    if (!result.ok) {
      await markPostFetchFailed(db, post.id, result.reason);
      return { ok: false, error: result.reason };
    }
    const snapshot = await insertMetricsSnapshot(db, { postId: post.id, metrics: result.metrics });
    await markPostFetchSucceeded(db, post.id);
    const hot = await maybeNotifyHot(db, post, deps);
    return {
      ok: true,
      snapshotId: snapshot.id,
      hot: hot.hot,
      hotReasons: hot.reasons,
      hotNotified: hot.notified,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markPostFetchFailed(db, post.id, message);
    return { ok: false, error: message };
  }
}

// ============================================================
// 批量快照（调度 tick）
// ============================================================

export interface PublishTrackingTickResult {
  due: number;
  fetched: number;
  failed: number;
  hot: number;
}

export async function runPublishTrackingTick(
  db: DbClient,
  input?: { userId?: string; limit?: number },
  deps?: PublishTrackingDeps,
): Promise<PublishTrackingTickResult> {
  const scopedUserId = normalizeUserId(input?.userId);
  const duePosts = await listDueTrackingPosts(db, { userId: scopedUserId, limit: input?.limit });
  const result: PublishTrackingTickResult = { due: duePosts.length, fetched: 0, failed: 0, hot: 0 };
  for (const post of duePosts) {
    // 单帖失败不打断其他帖（refreshOnePost 内部已容错，这里再兜底一层）。
    const refresh = await refreshOnePost(db, post, deps).catch(() => ({ ok: false }) as RefreshPostResult);
    if (refresh.ok) {
      result.fetched += 1;
      if (refresh.hotNotified) result.hot += 1;
    } else {
      result.failed += 1;
    }
  }
  return result;
}

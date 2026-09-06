/**
 * SAU 平台视频发布服务（P2e-3 泛化自 P2e-2 抖音版，新增小红书风控限频）。
 *
 * 视频来源（参数化，不接自动生成视频——那是 M4）：
 *   - videoPath：vendor 侧 videoFile 里的文件名（已上传）或本机绝对路径（先经 /upload 上送）；
 *   - videoUrl：http(s) 视频地址（先下载再 /upload 上送，160MB 上限与 vendor 一致）。
 *
 * 风控红线（小红书，调研报告：风控最激进）：
 *   - 同账号发布间隔 ≥ 30 分钟（违反 → 429 带 retryAfterSeconds）；
 *   - 同账号每日上限 5 条（违反 → 429）；
 *   计数存 platform_accounts.meta_json（lastPublishAt / publishCountDate / publishCountToday）。
 * 抖音不限频（风控等级低）；两平台都不批量、不并发。
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { getDraftDetail } from '@/core/pipelines/repository';
import { insertPublishedPost } from '@/core/publish-tracking/repository';
import {
  getPlatformAccount,
  updatePlatformAccountMeta,
} from '@/core/platform-accounts/repository';
import {
  resolveSauConfig,
  SAU_PLATFORM_TYPE,
  type SauConfig,
  type SauFetcher,
  type SauPlatform,
} from '@/core/platform-accounts/sau/sauProvider';

type DbClient = Pool | PoolClient;

const MAX_VIDEO_BYTES = 160 * 1024 * 1024;

export const XHS_MIN_PUBLISH_INTERVAL_SECONDS = 30 * 60;
export const XHS_DAILY_PUBLISH_LIMIT = 5;

export interface SauVideoPublishInput {
  platform: SauPlatform;
  draftId: string;
  accountId: string;
  videoPath?: string;
  videoUrl?: string;
  /** 覆盖草稿标题（缺省用草稿标题）。 */
  title?: string;
  tags?: string[];
  userId?: string;
}

export interface SauVideoPublishResult {
  vendorFilename: string;
  publishedPostId: string;
  postUrl: string;
}

export interface SauVideoPublishDeps {
  config?: SauConfig;
  fetcher?: SauFetcher;
  readFileFn?: (path: string) => Promise<Buffer>;
  now?: () => number;
}

// ============================================================
// 小红书限频（meta_json 计数，读-判-写）
// ============================================================

function todayStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** 限频检查：通过返回 null；拦截抛 429（带 retryAfterSeconds）。 */
export function assertXhsPublishAllowed(
  metaJson: Record<string, unknown> | null,
  nowMs: number,
): void {
  const meta = metaJson ?? {};
  const lastPublishAt = typeof meta.lastPublishAt === 'string' ? meta.lastPublishAt : null;
  if (lastPublishAt) {
    const elapsedSeconds = (nowMs - new Date(lastPublishAt).getTime()) / 1000;
    if (elapsedSeconds < XHS_MIN_PUBLISH_INTERVAL_SECONDS) {
      const retryAfterSeconds = Math.ceil(XHS_MIN_PUBLISH_INTERVAL_SECONDS - elapsedSeconds);
      throw new AppError(
        `小红书风控限频：同账号发布间隔需 ≥30 分钟，请 ${Math.ceil(retryAfterSeconds / 60)} 分钟后再试`,
        'rate_limited',
        429,
        { retryAfterSeconds: String(retryAfterSeconds) },
      );
    }
  }

  const countDate = typeof meta.publishCountDate === 'string' ? meta.publishCountDate : null;
  const countToday = typeof meta.publishCountToday === 'number' ? meta.publishCountToday : 0;
  if (countDate === todayStamp(nowMs) && countToday >= XHS_DAILY_PUBLISH_LIMIT) {
    throw new AppError(
      `小红书风控限频：同账号每日最多发布 ${XHS_DAILY_PUBLISH_LIMIT} 条，明天再来`,
      'rate_limited',
      429,
      { retryAfterSeconds: '0' },
    );
  }
}

function buildXhsPublishMeta(
  metaJson: Record<string, unknown> | null,
  nowMs: number,
): Record<string, unknown> {
  const meta = { ...(metaJson ?? {}) };
  const stamp = todayStamp(nowMs);
  meta.publishCountToday = meta.publishCountDate === stamp
    ? (typeof meta.publishCountToday === 'number' ? meta.publishCountToday : 0) + 1
    : 1;
  meta.publishCountDate = stamp;
  meta.lastPublishAt = new Date(nowMs).toISOString();
  return meta;
}

// ============================================================
// 视频来源解析与发布
// ============================================================

async function uploadVideoToVendor(
  config: SauConfig,
  content: Buffer,
  filename: string,
  fetcher: SauFetcher,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(content)]), filename);
  const headers: Record<string, string> = {};
  if (config.token) headers['x-sau-token'] = config.token;
  const res = await fetcher(`${config.baseUrl}/upload`, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const saved = typeof json?.data === 'string' ? json.data : null;
  if (res.status !== 200 || !saved) {
    const msg = typeof json?.msg === 'string' ? json.msg : `HTTP ${res.status}`;
    throw new ConflictError(`视频上送执行器失败：${msg}`);
  }
  return saved;
}

/** 解析视频来源为 vendor 侧文件名。 */
async function resolveVendorFilename(
  input: { videoPath?: string; videoUrl?: string },
  config: SauConfig,
  fetcher: SauFetcher,
  readFileFn: (path: string) => Promise<Buffer>,
): Promise<string> {
  if (input.videoPath && !input.videoUrl) {
    const videoPath = input.videoPath.trim();
    // 无路径分隔符 → 视为 vendor videoFile 里已有文件，直接用。
    if (!videoPath.includes('/') && !videoPath.includes('\\')) {
      return videoPath;
    }
    const content = await readFileFn(videoPath);
    if (content.byteLength > MAX_VIDEO_BYTES) {
      throw new ValidationError('视频文件过大', { videoPath: '超过 160MB 上限' });
    }
    return uploadVideoToVendor(config, content, basename(videoPath), fetcher);
  }

  if (input.videoUrl) {
    const res = await fetcher(input.videoUrl.trim(), { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) {
      throw new ValidationError('视频下载失败', { videoUrl: `HTTP ${res.status}` });
    }
    const content = Buffer.from(await res.arrayBuffer());
    if (content.byteLength > MAX_VIDEO_BYTES) {
      throw new ValidationError('视频文件过大', { videoUrl: '超过 160MB 上限' });
    }
    const filename = basename(new URL(input.videoUrl.trim()).pathname) || 'video.mp4';
    return uploadVideoToVendor(config, content, filename, fetcher);
  }

  throw new ValidationError('缺少视频来源', { videoPath: 'videoPath 与 videoUrl 至少提供一个' });
}

const PLATFORM_NAME: Record<SauPlatform, string> = { douyin: '抖音', xhs: '小红书' };

export async function publishDraftVideoToSau(
  db: DbClient,
  input: SauVideoPublishInput,
  deps?: SauVideoPublishDeps,
): Promise<SauVideoPublishResult> {
  const scopedUserId = normalizeUserId(input.userId);
  const nowMs = deps?.now?.() ?? Date.now();

  const draft = await getDraftDetail(db, input.draftId, scopedUserId);
  if (!draft) throw new NotFoundError('草稿不存在');
  if (draft.status !== 'accepted') {
    throw new ConflictError(`只有已确认（accepted）的草稿可以发布，当前状态：${draft.status}`);
  }

  const account = await getPlatformAccount(db, input.accountId, scopedUserId);
  if (!account) throw new NotFoundError('平台账号不存在');
  if (account.platform !== input.platform || account.credKind !== 'cookie') {
    throw new ValidationError('账号类型不匹配', {
      accountId: `需要${PLATFORM_NAME[input.platform]}（${input.platform} / cookie）账号`,
    });
  }
  const vendorUserName =
    typeof account.metaJson?.vendorUserName === 'string' ? account.metaJson.vendorUserName : null;
  if (!vendorUserName) {
    throw new ConflictError(`${PLATFORM_NAME[input.platform]}账号缺少执行器对账信息，请重新扫码授权`);
  }

  // 小红书风控限频（先于任何执行器调用）。
  if (input.platform === 'xhs') {
    assertXhsPublishAllowed(account.metaJson, nowMs);
  }

  const config = deps?.config ?? resolveSauConfig();
  const fetcher = deps?.fetcher ?? fetch;
  const readFileFn = deps?.readFileFn ?? readFile;
  const vendorFilename = await resolveVendorFilename(input, config, fetcher, readFileFn);

  const title = (input.title?.trim() || draft.title).slice(0, 55);
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 5);

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.token) headers['x-sau-token'] = config.token;
  const res = await fetcher(`${config.baseUrl}/postVideo`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileList: [vendorFilename],
      accountList: [vendorUserName],
      type: SAU_PLATFORM_TYPE[input.platform],
      title,
      tags,
      category: 0,
      enableTimer: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status !== 200 || (typeof json?.code === 'number' && json.code !== 200)) {
    const msg = typeof json?.msg === 'string' ? json.msg : `HTTP ${res.status}`;
    throw new ConflictError(`${PLATFORM_NAME[input.platform]}发布失败：${msg}`);
  }

  // 发布成功后才计限频（失败不占额度）。
  if (input.platform === 'xhs') {
    await updatePlatformAccountMeta(db, {
      id: account.id,
      metaJson: buildXhsPublishMeta(account.metaJson, nowMs),
      userId: scopedUserId,
    });
  }

  // 自动登记表现追踪（P2d 联动）：发布后才有真实 URL（执行器不回传），
  // 用合成 URL 占位，用户可后续补登真实链接。
  const postUrl = input.videoUrl?.trim() || `${input.platform}-video://${vendorFilename}`;
  const post = await insertPublishedPost(db, {
    userId: scopedUserId,
    draftId: draft.id,
    articleId: draft.articleId,
    platform: input.platform,
    accountName: account.accountName,
    postUrl,
    title,
    publishedAt: new Date(nowMs).toISOString(),
  });

  return { vendorFilename, publishedPostId: post.id, postUrl };
}

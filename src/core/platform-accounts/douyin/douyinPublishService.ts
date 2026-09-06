/**
 * 抖音发布服务（P2e-2）：accepted 草稿 + 用户提供的视频文件 → vendor postVideo。
 *
 * 视频来源（参数化，不接自动生成视频——那是 M4）：
 *   - videoPath：vendor 侧 videoFile 里的文件名（已上传）或本机绝对路径（先经 /upload 上送）；
 *   - videoUrl：http(s) 视频地址（先下载再 /upload 上送，160MB 上限与 vendor 一致）。
 * 注意：抖音 uploader 没有草稿模式（isDraft 仅视频号支持），
 * postVideo 走的是创作者中心真实发布流程。
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { getDraftDetail } from '@/core/pipelines/repository';
import { insertPublishedPost } from '@/core/publish-tracking/repository';
import { getPlatformAccount } from '@/core/platform-accounts/repository';
import {
  resolveSauConfig,
  type SauConfig,
  type SauFetcher,
} from '@/core/platform-accounts/douyin/douyinProvider';

type DbClient = Pool | PoolClient;

const MAX_VIDEO_BYTES = 160 * 1024 * 1024;

export interface DouyinPublishInput {
  draftId: string;
  accountId: string;
  videoPath?: string;
  videoUrl?: string;
  /** 覆盖草稿标题（缺省用草稿标题）。 */
  title?: string;
  tags?: string[];
  userId?: string;
}

export interface DouyinPublishResult {
  vendorFilename: string;
  publishedPostId: string;
  postUrl: string;
}

export interface DouyinPublishDeps {
  config?: SauConfig;
  fetcher?: SauFetcher;
  readFileFn?: (path: string) => Promise<Buffer>;
}

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

export async function publishDraftToDouyin(
  db: DbClient,
  input: DouyinPublishInput,
  deps?: DouyinPublishDeps,
): Promise<DouyinPublishResult> {
  const scopedUserId = normalizeUserId(input.userId);

  const draft = await getDraftDetail(db, input.draftId, scopedUserId);
  if (!draft) throw new NotFoundError('草稿不存在');
  if (draft.status !== 'accepted') {
    throw new ConflictError(`只有已确认（accepted）的草稿可以发布，当前状态：${draft.status}`);
  }

  const account = await getPlatformAccount(db, input.accountId, scopedUserId);
  if (!account) throw new NotFoundError('平台账号不存在');
  if (account.platform !== 'douyin' || account.credKind !== 'cookie') {
    throw new ValidationError('账号类型不匹配', { accountId: '需要抖音（douyin / cookie）账号' });
  }
  const vendorUserName =
    typeof account.metaJson?.vendorUserName === 'string' ? account.metaJson.vendorUserName : null;
  if (!vendorUserName) {
    throw new ConflictError('抖音账号缺少执行器对账信息，请重新扫码授权');
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
      type: 3,
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
    throw new ConflictError(`抖音发布失败：${msg}`);
  }

  // 自动登记表现追踪（P2d 联动）：抖音发布后才有真实 URL（执行器不回传），
  // 用合成 URL 占位，用户可后续补登真实链接。
  const postUrl = input.videoUrl?.trim() || `douyin-video://${vendorFilename}`;
  const post = await insertPublishedPost(db, {
    userId: scopedUserId,
    draftId: draft.id,
    articleId: draft.articleId,
    platform: 'douyin',
    accountName: account.accountName,
    postUrl,
    title,
    publishedAt: new Date().toISOString(),
  });

  return { vendorFilename, publishedPostId: post.id, postUrl };
}

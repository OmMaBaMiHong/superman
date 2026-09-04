/**
 * 发布中心 —— 前端 API 封装。
 *
 * 所有请求都打到 FeedFuse 的 `/api/publish/{platform}/*`，由后端转发到随附的
 * Python 发布服务。Python 服务返回 `{ code, msg, data }` 信封，这里统一解析。
 */

import type { PublishPlatformKey } from '@/lib/publish/platforms';

export interface PublishEnvelope<T = unknown> {
  code: number;
  msg: string | null;
  data: T;
}

export interface PublishAccount {
  id: number;
  type: number;
  filePath: string;
  userName: string;
  status: number;
}

export interface PublishVideoInput {
  /** 已上传视频在 Python 服务侧的文件名 */
  file: string;
  title: string;
  tags: string[];
  description?: string;
  /** 目标账号的 cookie 文件名（账号列表里的 filePath） */
  account: string;
}

async function readEnvelope<T>(res: Response): Promise<PublishEnvelope<T>> {
  const payload = (await res.json().catch(() => null)) as PublishEnvelope<T> | null;
  if (!payload || typeof payload.code !== 'number') {
    throw new Error(`发布接口返回异常（HTTP ${res.status}）`);
  }
  return payload;
}

/** 获取指定平台的账号列表（Python /getAccounts 返回全部，按 type 在调用侧过滤）。 */
export async function listPlatformAccounts(
  platform: PublishPlatformKey,
): Promise<PublishAccount[]> {
  const res = await fetch(`/api/publish/${platform}/accounts`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const payload = await readEnvelope<PublishAccount[]>(res);
  if (payload.code !== 200) {
    throw new Error(payload.msg ?? '获取账号失败');
  }
  return payload.data ?? [];
}

/** 上传待发布视频，返回 Python 服务侧的文件名（各平台通用）。 */
export async function uploadPublishVideo(
  platform: PublishPlatformKey,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/publish/${platform}/upload`, {
    method: 'POST',
    body: form,
  });
  const payload = await readEnvelope<string>(res);
  if (payload.code !== 200) {
    throw new Error(payload.msg ?? '上传视频失败');
  }
  if (typeof payload.data !== 'string' || payload.data.length === 0) {
    throw new Error('上传视频失败：服务未返回文件名');
  }
  return payload.data;
}

/** 发布视频到指定平台。 */
export async function publishVideo(
  platform: PublishPlatformKey,
  input: PublishVideoInput,
): Promise<void> {
  const res = await fetch(`/api/publish/${platform}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await readEnvelope<unknown>(res);
  if (payload.code !== 200) {
    throw new Error(payload.msg ?? '发布失败');
  }
}

/**
 * 建立平台扫码登录的 SSE 连接。
 *
 * Python 端推送的事件数据可能为：
 * - 图片地址（可能为 data URL 或 http 地址）——用于展示二维码
 * - `"200"` —— 登录成功
 * - `"500"` —— 登录失败/超时
 * - JSON 字符串（含 image_data_url 字段）——兼容新版登录回调
 */
export function createPlatformLoginEventSource(
  platform: PublishPlatformKey,
  account: string,
): EventSource {
  const params = new URLSearchParams({ account });
  return new EventSource(`/api/publish/${platform}/login?${params.toString()}`);
}

export type PublishLoginEvent =
  | { kind: 'qrcode'; image: string }
  | { kind: 'success' }
  | { kind: 'failed'; message?: string };

export function parsePublishLoginData(raw: string): PublishLoginEvent | null {
  const data = raw.trim();
  if (!data) return null;

  if (data === '200') return { kind: 'success' };
  if (data === '500') return { kind: 'failed' };

  // 兼容新版回调：JSON 含 image_data_url
  if (data.startsWith('{')) {
    try {
      const parsed = JSON.parse(data) as { image_data_url?: string; image_path?: string };
      if (typeof parsed.image_data_url === 'string' && parsed.image_data_url.length > 0) {
        return { kind: 'qrcode', image: parsed.image_data_url };
      }
    } catch {
      // 忽略无法解析的 JSON
    }
  }

  // 直接是图片地址（data URL 或 http 地址）
  if (data.startsWith('data:image') || data.startsWith('http')) {
    return { kind: 'qrcode', image: data };
  }

  return null;
}

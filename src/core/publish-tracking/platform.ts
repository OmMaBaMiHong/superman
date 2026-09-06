/**
 * 平台识别与 B站 BV 号解析（纯函数）。
 */

export type PublishPlatform = 'bilibili' | 'douyin' | 'xhs' | 'wechat' | 'other';

export const PUBLISH_PLATFORMS: readonly PublishPlatform[] = [
  'bilibili',
  'douyin',
  'xhs',
  'wechat',
  'other',
];

export function isPublishPlatform(value: unknown): value is PublishPlatform {
  return typeof value === 'string' && (PUBLISH_PLATFORMS as readonly string[]).includes(value);
}

/** 从 URL 推断平台；无法识别返回 'other'（非法 URL 也归 other，由调用方另行校验）。 */
export function inferPlatformFromUrl(rawUrl: string): PublishPlatform {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host === 'b23.tv' || host.endsWith('.bilibili.com') || host === 'bilibili.com') return 'bilibili';
  if (host.endsWith('.douyin.com') || host === 'douyin.com') return 'douyin';
  if (host.endsWith('.xiaohongshu.com') || host === 'xiaohongshu.com' || host === 'xhslink.com') return 'xhs';
  if (host === 'mp.weixin.qq.com') return 'wechat';
  return 'other';
}

const BVID_PATTERN = /BV[0-9A-Za-z]{10}/;

/**
 * 从 B站 URL 解析 bvid。支持形态：
 *   https://www.bilibili.com/video/BV1xx411c7mD
 *   https://b23.tv/BV1xx411c7mD（BV 形态短链；非 BV 短码不解析，交由授权中心/重定向二期）
 *   带参数/分 P（?p=2）/ 嵌入链接均可。
 * 解析失败返回 null。
 */
export function extractBvid(rawUrl: string): string | null {
  const match = BVID_PATTERN.exec(rawUrl);
  return match ? match[0] : null;
}

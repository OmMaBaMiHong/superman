/**
 * 发布中心 —— 支持的发布平台定义。
 *
 * `type` 与随附 Python 发布服务（social-auto-upload 的 Web 后端）约定一致：
 *   1 = 小红书, 2 = 视频号, 3 = 抖音, 4 = 快手
 * 平台 key 用于前端路由 / API 路径标识。
 */
export const PUBLISH_PLATFORMS = {
  xiaohongshu: { type: 1, name: '小红书', short: '小红书' },
  shipinhao: { type: 2, name: '视频号', short: '视频号' },
  douyin: { type: 3, name: '抖音', short: '抖音' },
  kuaishou: { type: 4, name: '快手', short: '快手' },
} as const;

export type PublishPlatformKey = keyof typeof PUBLISH_PLATFORMS;

export const PUBLISH_PLATFORM_KEYS = Object.keys(PUBLISH_PLATFORMS) as PublishPlatformKey[];

export function isPublishPlatform(value: unknown): value is PublishPlatformKey {
  return typeof value === 'string' && value in PUBLISH_PLATFORMS;
}

export function getPlatformType(platform: PublishPlatformKey): number {
  return PUBLISH_PLATFORMS[platform].type;
}

export function getPlatformName(platform: PublishPlatformKey): string {
  return PUBLISH_PLATFORMS[platform].name;
}

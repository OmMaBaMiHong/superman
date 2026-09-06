import type { AccountPlatform } from '@/lib/api/apiClient';

/** 授权平台展示元数据（图标 + 名称 + 状态文案）。 */
export const ACCOUNT_PLATFORM_META: Record<
  AccountPlatform,
  { name: string; icon: string; supported: boolean }
> = {
  wechat: { name: '公众号', icon: '💬', supported: true },
  douyin: { name: '抖音', icon: '🎵', supported: true },
  xhs: { name: '小红书', icon: '📕', supported: false },
  bilibili: { name: 'B站', icon: '📺', supported: false },
  channels: { name: '视频号', icon: '🎬', supported: false },
};

/** 相对时间（验证时间显示用）。 */
export function formatRelativeTime(value: string | null): string {
  if (!value) return '从未验证';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return '刚刚验证';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前验证`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前验证`;
  return `${Math.floor(seconds / 86400)} 天前验证`;
}

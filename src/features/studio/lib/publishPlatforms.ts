import type { PublishPlatform } from '@/lib/api/apiClient';

/** 发布平台展示元数据（识别色从现有色板派生）。 */
export const PLATFORM_META: Record<
  PublishPlatform,
  { name: string; badgeClass: string; realData: boolean }
> = {
  bilibili: {
    name: 'B站',
    badgeClass: 'border-primary/40 bg-primary/10 text-primary',
    realData: true,
  },
  douyin: {
    name: '抖音',
    badgeClass: 'border-warning/40 bg-warning/10 text-warning',
    realData: false,
  },
  xhs: {
    name: '小红书',
    badgeClass: 'border-error/40 bg-error/10 text-error',
    realData: false,
  },
  wechat: {
    name: '公众号',
    badgeClass: 'border-success/40 bg-success/10 text-success',
    realData: false,
  },
  other: {
    name: '其他',
    badgeClass: 'border-border bg-secondary text-secondary-foreground',
    realData: false,
  },
};

/** 指标大数字紧凑格式：>=1e8 → x.x 亿，>=1e4 → x.x 万。 */
export function formatMetric(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return String(value);
}

/** 增量格式：涨 ↑n / 跌 ↓n / 0 → ·0。 */
export function formatDelta(value: number | null): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (value === null) return { text: '—', tone: 'flat' };
  if (value > 0) return { text: `↑${formatMetric(value)}`, tone: 'up' };
  if (value < 0) return { text: `↓${formatMetric(-value)}`, tone: 'down' };
  return { text: '·0', tone: 'flat' };
}

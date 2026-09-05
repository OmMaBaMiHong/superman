import type { OriginalityFlag, RewritePlatform } from '@/lib/api/apiClient';

/** 洗稿平台展示元数据（识别色从现有色板派生：primary/success/warning，不发明新色系）。 */
export const PLATFORM_META: Record<
  RewritePlatform,
  { name: string; desc: string; estimate: string; badgeClass: string }
> = {
  wechat: {
    name: '公众号深度文',
    desc: '1500-2500 字观点深度文，小标题分段，开头有钩子',
    estimate: '约 2000 字',
    badgeClass: 'border-primary/40 bg-primary/10 text-primary',
  },
  xhs: {
    name: '小红书种草',
    desc: '≤800 字短段口语化，第一人称 + emoji + 话题标签',
    estimate: '约 600 字',
    badgeClass: 'border-warning/40 bg-warning/10 text-warning',
  },
  novel: {
    name: '小说化改写',
    desc: '约 1500 字故事化叙事，场景与对话驱动',
    estimate: '约 1500 字',
    badgeClass: 'border-success/40 bg-success/10 text-success',
  },
};

export const REWRITE_PLATFORM_IDS: readonly RewritePlatform[] = ['wechat', 'xhs', 'novel'];

export function platformName(platform: string): string {
  return PLATFORM_META[platform as RewritePlatform]?.name ?? platform;
}

export function platformBadgeClass(platform: string): string {
  return (
    PLATFORM_META[platform as RewritePlatform]?.badgeClass ??
    'border-border bg-secondary text-secondary-foreground'
  );
}

/** 原创度徽章：ok=绿「原创达标」/ rewritten=琥珀「已降重」/ needs_review=红「需人工终审」。 */
export const ORIGINALITY_META: Record<
  OriginalityFlag,
  { label: string; badgeClass: string }
> = {
  ok: { label: '原创达标', badgeClass: 'border-success/40 bg-success/10 text-success' },
  rewritten: { label: '已降重', badgeClass: 'border-warning/40 bg-warning/10 text-warning' },
  needs_review: { label: '需人工终审', badgeClass: 'border-error/40 bg-error/10 text-error' },
};

/** 相似度（0-1）→ 百分比展示文本。 */
export function formatSimilarity(score: number | null): string {
  if (score === null) return '—';
  return `${Math.round(score * 100)}%`;
}

/** 相似度分档色（与原创度阈值一致：<35% 绿 / 35-50% 琥珀 / >50% 红）。 */
export function similarityToneClass(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score > 0.5) return 'text-error';
  if (score >= 0.35) return 'text-warning';
  return 'text-success';
}

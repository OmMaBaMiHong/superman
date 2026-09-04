'use client';

import { cn } from '@/lib/utils';
import { OAUTH_CONNECTION_STATUS_META } from '../utils/oauthProviderMeta';
import type { OAuthConnectionStatus } from '@/types';

interface OAuthConnectionBadgeProps {
  /** `null` 表示该平台尚无任何连接记录。 */
  status: OAuthConnectionStatus | null;
  className?: string;
}

/**
 * 连接状态 badge：已连接 / 已过期 / 已撤销 / 未连接。
 * 只用语义 token（success / warning / muted），不写死颜色值，深浅色主题自动适配。
 */
export default function OAuthConnectionBadge({ status, className }: OAuthConnectionBadgeProps) {
  const meta =
    status === null
      ? { label: '未连接', toneClassName: 'border-border/70 bg-muted text-muted-foreground' }
      : OAUTH_CONNECTION_STATUS_META[status];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        meta.toneClassName,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

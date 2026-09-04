import type { GithubSyncStatus } from '@/types';
import { cn } from '@/lib/utils';

const STATUS_META: Record<GithubSyncStatus, { label: string; className: string }> = {
  idle: {
    label: '空闲',
    className: 'border-border/70 bg-muted text-muted-foreground',
  },
  syncing: {
    label: '同步中',
    className: 'border-primary/20 bg-primary/10 text-primary',
  },
  rate_limited: {
    label: '限流中',
    className: 'border-warning/25 bg-warning/10 text-warning',
  },
  error: {
    label: '失败',
    className: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
};

interface GithubStatusBadgeProps {
  status: GithubSyncStatus;
  className?: string;
}

/**
 * 仓库同步健康状态 badge（R05 四态）。
 * 只使用语义 token，不写死任何 hex / rgb 色值。
 */
export default function GithubStatusBadge({ status, className }: GithubStatusBadgeProps) {
  const meta = STATUS_META[status] ?? STATUS_META.idle;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

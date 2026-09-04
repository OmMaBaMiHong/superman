import type { GithubContentType } from '@/types';
import { cn } from '@/lib/utils';

// MVP 仅放开 release；Issue/PR/Commit 在 P1 打开，这里提前按四值落地样式。
const TYPE_META: Record<GithubContentType, { label: string; className: string }> = {
  release: {
    label: 'Release',
    className: 'border-border/70 bg-muted text-muted-foreground',
  },
  issue: {
    label: 'Issue',
    className: 'border-border/70 bg-muted text-muted-foreground',
  },
  pr: {
    label: 'PR',
    className: 'border-border/70 bg-muted text-muted-foreground',
  },
  commit: {
    label: 'Commit',
    className: 'border-border/70 bg-muted text-muted-foreground',
  },
};

interface GithubTypeBadgeProps {
  type: GithubContentType;
  className?: string;
}

/**
 * 中栏条目类型 badge，如 `[Release]`、`[Issue]`。
 * 只使用语义 token（bg-muted / text-muted-foreground），禁止硬编码色值。
 */
export default function GithubTypeBadge({ type, className }: GithubTypeBadgeProps) {
  const meta = TYPE_META[type] ?? TYPE_META.release;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        meta.className,
        className,
      )}
    >
      [{meta.label}]
    </span>
  );
}

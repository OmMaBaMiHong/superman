import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** 下方操作区（按钮 / 链接等）。 */
  action?: ReactNode;
  className?: string;
}

/**
 * 空状态占位。
 *
 * 图标方块沿用 StatCard 的语义 token（`bg-primary/10 text-primary`），仅尺寸放大一档。
 * 刻意不套 `.glass-surface`：本组件总是落在已经是玻璃面板的父容器内，
 * 每个容器最多 1 层 backdrop-filter（见 globals.css 玻璃语义类注释）。
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

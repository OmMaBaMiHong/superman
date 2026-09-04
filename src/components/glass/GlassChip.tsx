import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GlassChipProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * 玻璃筛选 chip。
 *
 * 默认态用 `.glass-surface-light`（通透玻璃，仅容器 1 层 blur），
 * 选中态用语义 token：`bg-primary/15 text-primary border-primary/30`。
 */
export default function GlassChip({
  children,
  active = false,
  onClick,
  className,
  ...rest
}: GlassChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-all',
        active
          ? 'border border-primary/30 bg-primary/15 text-primary'
          : 'glass-surface-light border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

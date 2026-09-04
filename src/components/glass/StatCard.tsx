import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import GlassCard from './GlassCard';

interface StatCardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'className'> {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: ReactNode;
  className?: string;
}

/**
 * 统计卡片（GlassCard 变体）。
 *
 * 图标方块用语义 token（`bg-primary/10 text-primary`），
 * 数字用 `font-mono` + `tabular-nums` 保证对齐（见 ui-style-guide §1.6）。
 */
export default function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  className,
  ...rest
}: StatCardProps) {
  return (
    <GlassCard className={cn('rounded-xl', className)} {...rest}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {value}
          </p>
          {trend ? (
            <div className="mt-1 text-xs text-muted-foreground">{trend}</div>
          ) : null}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </div>
      </div>
    </GlassCard>
  );
}

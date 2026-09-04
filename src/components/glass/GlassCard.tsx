import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'className'> {
  children: ReactNode;
  className?: string;
  /** 可交互卡片：hover 上浮 + 边框提亮（仅容器层，不叠加逐项 blur）。 */
  interactive?: boolean;
  /** 默认带 p-4 内边距。 */
  padded?: boolean;
}

/**
 * 玻璃卡片基件。
 *
 * 消费 `globals.css` 的 `.glass-surface` 语义类（半透明白 + backdrop blur + 内顶高光），
 * 颜色一律来自 token；组件内不硬编码 hex/rgb/hsl。
 */
export default function GlassCard({
  children,
  className,
  interactive = false,
  padded = true,
  ...rest
}: GlassCardProps) {
  return (
    <div
      className={cn(
        'glass-surface',
        padded && 'p-4',
        interactive &&
          'transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-glass-hover)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

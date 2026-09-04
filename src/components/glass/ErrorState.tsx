import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * 错误状态占位（与 EmptyState 同构）。
 *
 * 图标方块改用错误语义 token（`bg-error/10 text-error`），颜色全部来自 globals.css。
 * 同样不套 `.glass-surface`，避免与外层玻璃面板叠加 blur。
 */
export default function ErrorState({
  title = '加载失败',
  description,
  onRetry,
  retryLabel = '重试',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
        <AlertTriangle aria-hidden="true" className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>
      ) : null}
      {onRetry ? (
        <Button className="mt-4" onClick={onRetry} size="sm" type="button" variant="outline">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

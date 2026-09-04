import { cn } from '@/lib/utils';

interface GlassSkeletonProps {
  className?: string;
}

interface GlassSkeletonListProps {
  /** 骨架条目数量，默认 3。 */
  count?: number;
  className?: string;
}

/**
 * 单条骨架。
 *
 * 底色用语义 token `bg-muted/60`；`animate-pulse` 在 `prefers-reduced-motion`
 * 下由 globals.css 的全局媒体查询自动降级，组件内无需处理。
 * 本身 `aria-hidden`，骨架不进入读屏。
 */
export default function GlassSkeleton({ className }: GlassSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-4 w-full animate-pulse rounded-md bg-muted/60', className)}
    />
  );
}

/**
 * 卡片列表骨架。
 *
 * 每条含 1 根标题条 + 2 根短正文条，条目间距 gap-3。
 * 外层用 `role="status"` + sr-only 文案告知读屏「加载中」，视觉部分整体 `aria-hidden`。
 */
export function GlassSkeletonList({ count = 3, className }: GlassSkeletonListProps) {
  return (
    <div aria-label="加载中" className={cn('flex flex-col gap-3', className)} role="status">
      <span className="sr-only">加载中</span>
      {Array.from({ length: count }, (_, index) => (
        <div
          aria-hidden="true"
          className="flex flex-col gap-2 rounded-xl border border-border/60 p-4"
          key={index}
        >
          <GlassSkeleton className="h-4 w-2/5" />
          <GlassSkeleton className="h-3 w-4/5" />
          <GlassSkeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

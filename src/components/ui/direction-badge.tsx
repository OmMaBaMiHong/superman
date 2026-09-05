'use client';

import { useDirectionTemplates } from '@/features/governance/hooks/useDirectionTemplates';
import { cn } from '@/lib/utils';

interface DirectionBadgeProps {
  /** 治理方向 key；null = 存量未分类。 */
  directionKey: string | null;
  /** 分类理由（hover tooltip）。 */
  reason?: string | null;
  className?: string;
}

/**
 * 方向徽章（P2b）：模板色直接来自 /s/api/directions 返回值（不做主题映射）。
 * 存量 directionKey 为 null 时显示灰色「未分类」。
 */
export default function DirectionBadge({ directionKey, reason, className }: DirectionBadgeProps) {
  const templates = useDirectionTemplates();
  const template = directionKey ? templates.get(directionKey) : undefined;

  if (!directionKey) {
    return (
      <span
        data-testid="direction-badge"
        title={reason ?? '存量内容未跑方向分类'}
        className={cn(
          'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground',
          className,
        )}
      >
        未分类
      </span>
    );
  }

  // 模板表未加载或 key 已被删：灰底兜底显示 raw key
  const color = template?.color ?? '#6b7280';
  const label = template ? `${template.icon} ${template.name}` : directionKey;

  return (
    <span
      data-testid="direction-badge"
      data-direction={directionKey}
      title={reason ?? template?.aiHint ?? undefined}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium',
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 10%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

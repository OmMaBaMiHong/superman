'use client';

import { CircleDot, GitCommitHorizontal, GitPullRequest, History, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import EmptyState from '@/components/glass/EmptyState';
import { GlassSkeletonList } from '@/components/glass/GlassSkeleton';
import type { GithubContentType } from '@/types';
import { cn } from '@/lib/utils';

/**
 * 时间轴条目。
 *
 * 字段全部取自既有数据结构（`github_article_items` 行 + `GithubArticleMeta`），
 * 不额外发明后端没有的字段。
 */
export interface GithubTimelineItem {
  id: string;
  type: GithubContentType;
  title: string;
  htmlUrl: string;
  /** ISO 时间串；缺失时不渲染时间。 */
  publishedAt: string | null;
  tagName?: string | null;
  isPrerelease?: boolean;
}

const TYPE_META: Record<GithubContentType, { label: string; icon: LucideIcon; tone: string }> = {
  release: { label: 'Release', icon: Tag, tone: 'text-primary' },
  pr: { label: 'Pull Request', icon: GitPullRequest, tone: 'text-info' },
  issue: { label: 'Issue', icon: CircleDot, tone: 'text-warning' },
  commit: { label: 'Commit', icon: GitCommitHorizontal, tone: 'text-muted-foreground' },
};

function formatEventTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface GithubActivityTimelineProps {
  items: GithubTimelineItem[];
  loading?: boolean;
  /** 数据源尚未接入时展示的说明文案。 */
  emptyDescription?: string;
  className?: string;
}

/**
 * Release / PR / Issue / Commit 活动时间轴。
 *
 * 竖线 + 节点圆点布局：竖线是 `<li>` 内的绝对定位分隔条，最后一条自动截断。
 * 四类事件用不同 lucide 图标 + 不同语义色区分，图标一律 `aria-hidden`，
 * 类型语义通过节点文本（`Release` / `Issue` …）暴露给读屏。
 * 纯展示组件：不取数、不叠加 backdrop-filter。
 */
export default function GithubActivityTimeline({
  items,
  loading = false,
  emptyDescription,
  className,
}: GithubActivityTimelineProps) {
  if (loading) {
    return <GlassSkeletonList className={className} count={4} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        className={className}
        description={emptyDescription ?? '该仓库还没有可展示的动态。'}
        icon={History}
        title="暂无动态"
      />
    );
  }

  return (
    <ol className={cn('relative flex flex-col', className)}>
      {items.map((item, index) => {
        const meta = TYPE_META[item.type] ?? TYPE_META.release;
        const Icon = meta.icon;
        const time = formatEventTime(item.publishedAt);
        const isLast = index === items.length - 1;

        return (
          <li className="relative flex gap-3 pb-5 last:pb-0" key={item.id}>
            {/* 竖线：贴着节点圆点中心，最后一条不再向下延伸。 */}
            {!isLast ? (
              <span
                aria-hidden="true"
                className="absolute left-3.5 top-8 h-[calc(100%-2rem)] w-px bg-border"
              />
            ) : null}

            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card',
                meta.tone,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn('text-[11px] font-semibold uppercase tracking-wide', meta.tone)}>
                  {meta.label}
                </span>
                {item.tagName ? (
                  <span className="rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {item.tagName}
                  </span>
                ) : null}
                {item.isPrerelease ? (
                  <span className="rounded-md border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    预发布
                  </span>
                ) : null}
              </div>

              <a
                className="mt-1 block text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                href={item.htmlUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {item.title}
              </a>

              {time ? (
                <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {time}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

'use client';

import { FileText, PenLine } from 'lucide-react';
import type { GovernanceQueueItem, PipelineJobItem } from '@/lib/api/apiClient';
import ContentTypeBadge from '@/components/ui/content-type-badge';
import QualityScore from '@/features/governance/components/QualityScore';
import { formatPublishedAt } from '@/features/governance/components/GovernanceQueueCard';
import { cn } from '@/lib/utils';

interface TopicPoolCardProps {
  item: GovernanceQueueItem;
  /** 该选题正在进行中的改写任务（活跃 job）。 */
  activeJobs: PipelineJobItem[];
  onGenerate: (item: GovernanceQueueItem) => void;
  /** 打开详情（查看正文/视频文案）。 */
  onOpenDetail: (item: GovernanceQueueItem) => void;
}

/** 选题卡：液态玻璃卡片 + 形态徽章 + 质量分 + 「生成稿件」。 */
export default function TopicPoolCard({ item, activeJobs, onGenerate, onOpenDetail }: TopicPoolCardProps) {
  const generating = activeJobs.length > 0;

  return (
    <article
      data-testid="topic-card"
      data-item-id={item.id}
      className="gov-card flex flex-col p-4 [--gov-accent:var(--color-success)]"
    >
      <div className="flex items-center gap-1.5">
        <ContentTypeBadge type={item.contentType} />
        <span className="ml-auto">
          <QualityScore score={item.qualityScore} />
        </span>
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail(item)}
        className="mt-2.5 text-left"
      >
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
          {item.title}
        </h3>
        {item.summary ? (
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-secondary-foreground">
            {item.summary}
          </p>
        ) : null}
      </button>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="max-w-[10rem] truncate">{item.feedTitle}</span>
        {item.categoryTitle ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{item.categoryTitle}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <time dateTime={item.publishedAt ?? undefined} className="font-mono tabular-nums">
          {formatPublishedAt(item.publishedAt)}
        </time>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => onOpenDetail(item)}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 sm:h-8',
            'text-xs font-medium text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <FileText aria-hidden="true" className="h-3.5 w-3.5" />
          详情
        </button>
        <button
          type="button"
          disabled={generating}
          onClick={() => onGenerate(item)}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 sm:h-8',
            'text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-60',
          )}
        >
          <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
          {generating ? '生成中' : '生成稿件'}
        </button>
      </div>
    </article>
  );
}

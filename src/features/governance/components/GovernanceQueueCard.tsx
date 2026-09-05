'use client';

import { Check, ExternalLink, RotateCcw, X } from 'lucide-react';
import type { GovernanceQueueItem } from '@/lib/api/apiClient';
import ContentTypeBadge from '@/components/ui/content-type-badge';
import { cn } from '@/lib/utils';
import { useCardSwipe } from '../hooks/useCardSwipe';
import QualityScore from './QualityScore';
import ReasonInput from './ReasonInput';

export type CardExitKind = 'approve' | 'reject';

export function formatPublishedAt(value: string | null): string {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface GovernanceQueueCardProps {
  item: GovernanceQueueItem;
  selected: boolean;
  exiting: CardExitKind | null;
  pendingAction: 'approve' | 'reject' | 'redraft' | null;
  reasonOpen: 'reject' | 'redraft' | null;
  onSelect: () => void;
  onOpenDetail: () => void;
  onApprove: () => void;
  onOpenReason: (kind: 'reject' | 'redraft') => void;
  onCancelReason: () => void;
  onSubmitReason: (kind: 'reject' | 'redraft', reason: string) => void;
}

/** 审批台信息流卡片：液态玻璃 + 形态徽章 + 小号质量分 + 底部玻璃 pill 操作行。 */
export default function GovernanceQueueCard({
  item,
  selected,
  exiting,
  pendingAction,
  reasonOpen,
  onSelect,
  onOpenDetail,
  onApprove,
  onOpenReason,
  onCancelReason,
  onSubmitReason,
}: GovernanceQueueCardProps) {
  const isPending = item.governanceStatus === 'pending';
  const busy = pendingAction !== null || exiting !== null;

  // 移动端手势：右滑准奏 / 左滑驳回（打开理由输入）；reduced-motion 时按钮-only
  const { dragX, shouldSuppressClick, swipeHandlers } = useCardSwipe({
    disabled: busy,
    onApprove,
    onOpenRejectReason: () => onOpenReason('reject'),
  });

  return (
    <div className="relative break-inside-avoid">
      {/* 手势背景提示层：卡片滑开时露出语义色动作区 */}
      {dragX > 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-start gap-1.5 rounded-[1.25rem] bg-success/15 pl-5 text-xs font-medium text-success"
          style={{ opacity: Math.min(1, dragX / 96) }}
        >
          <Check className="h-4 w-4" />
          准奏
        </div>
      ) : null}
      {dragX < 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-[1.25rem] bg-error/15 pr-5 text-xs font-medium text-error"
          style={{ opacity: Math.min(1, -dragX / 96) }}
        >
          驳回
          <X className="h-4 w-4" />
        </div>
      ) : null}

      <article
        data-testid="gov-card"
        data-item-id={item.id}
        aria-selected={selected}
        onClick={() => {
          if (shouldSuppressClick()) return;
          onSelect();
          onOpenDetail();
        }}
        {...swipeHandlers}
        style={{
          transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
          transition: dragX === 0 ? 'transform 0.42s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          touchAction: 'pan-y',
        }}
        className={cn(
          'gov-card cursor-pointer p-4',
          isPending && '[--gov-accent:var(--color-primary)]',
          selected && 'gov-card-selected',
          exiting === 'approve' && 'gov-card-exit-approve',
          exiting === 'reject' && 'gov-card-exit-reject',
        )}
      >
        {/* 徽标行：形态 + 状态 + 重拟计数 + 质量分 */}
        <div className="flex items-center gap-1.5">
          <ContentTypeBadge type={item.contentType} />
          <span
            aria-hidden="true"
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              isPending ? 'gov-pulse-dot bg-primary' : 'bg-warning',
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            {isPending ? '重拟中' : '候选'}
          </span>
          {item.redraftCount > 0 ? (
            <span
              key={item.redraftCount}
              className="gov-badge-pop rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px font-mono text-[10px] tabular-nums text-primary"
            >
              ×{item.redraftCount}
            </span>
          ) : null}
          <span className="ml-auto">
            <QualityScore score={item.qualityScore} />
          </span>
        </div>

        <h3 className="mt-2.5 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
          {item.title}
        </h3>

        {item.summary ? (
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-secondary-foreground">
            {item.summary}
          </p>
        ) : null}

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
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-0.5 text-primary transition-colors duration-150 hover:opacity-80"
              aria-label="打开原文链接"
            >
              原文
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
          ) : null}
        </div>

        <div onClick={(event) => event.stopPropagation()}>
          <ReasonInput
            open={reasonOpen === 'reject'}
            kind="reject"
            submitting={pendingAction === 'reject'}
            onSubmit={(reason) => onSubmitReason('reject', reason)}
            onCancel={onCancelReason}
          />
          <ReasonInput
            open={reasonOpen === 'redraft'}
            kind="redraft"
            submitting={pendingAction === 'redraft'}
            onSubmit={(reason) => onSubmitReason('redraft', reason)}
            onCancel={onCancelReason}
          />
        </div>

        {/* 操作行：玻璃 pill icon 按钮（触控 ≥44px，桌面紧凑） */}
        <div
          className="mt-3 flex items-center justify-end gap-2 border-t border-border/60 pt-3"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            aria-label="准奏"
            title="准奏（A）"
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-4 sm:h-8 sm:px-3',
              'text-xs font-medium text-success transition-all duration-150',
              'hover:bg-success/20 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <Check aria-hidden="true" className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            准奏
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenReason('reject')}
            aria-label="驳回"
            title="驳回（R）"
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-error/30 px-4 sm:h-8 sm:px-3',
              'text-xs font-medium text-error transition-all duration-150',
              'hover:bg-error/10 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <X aria-hidden="true" className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            驳回
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenReason('redraft')}
            aria-label="重拟"
            title="打回重拟"
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-warning/30 px-4 sm:h-8 sm:px-3',
              'text-xs font-medium text-warning transition-all duration-150',
              'hover:bg-warning/10 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            重拟
          </button>
        </div>
      </article>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Check, ChevronDown, ExternalLink, RotateCcw, X } from 'lucide-react';
import type { GovernanceQueueItem } from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import { useCardSwipe } from '../hooks/useCardSwipe';
import QualityScore from './QualityScore';
import ReasonInput from './ReasonInput';

export type CardExitKind = 'approve' | 'reject';

interface GovernanceQueueCardProps {
  item: GovernanceQueueItem;
  selected: boolean;
  exiting: CardExitKind | null;
  pendingAction: 'approve' | 'reject' | 'redraft' | null;
  reasonOpen: 'reject' | 'redraft' | null;
  onSelect: () => void;
  onApprove: () => void;
  onOpenReason: (kind: 'reject' | 'redraft') => void;
  onCancelReason: () => void;
  onSubmitReason: (kind: 'reject' | 'redraft', reason: string) => void;
}

function formatPublishedAt(value: string | null): string {
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

/** 待批队列卡片：左侧 3px 语义色 accent border（amber=候选，cyan=重拟中）。 */
export default function GovernanceQueueCard({
  item,
  selected,
  exiting,
  pendingAction,
  reasonOpen,
  onSelect,
  onApprove,
  onOpenReason,
  onCancelReason,
  onSubmitReason,
}: GovernanceQueueCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isPending = item.governanceStatus === 'pending';
  const busy = pendingAction !== null || exiting !== null;

  // 移动端手势：右滑准奏 / 左滑驳回（打开理由输入）；reduced-motion 时按钮-only
  const { dragX, shouldSuppressClick, swipeHandlers } = useCardSwipe({
    disabled: busy,
    onApprove,
    onOpenRejectReason: () => onOpenReason('reject'),
  });

  return (
    <div className="relative">
      {/* 手势背景提示层：卡片滑开时露出语义色动作区 */}
      {dragX > 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-start gap-1.5 rounded-lg bg-success/15 pl-5 font-mono text-xs font-medium text-success"
          style={{ opacity: Math.min(1, dragX / 96) }}
        >
          <Check className="h-4 w-4" />
          准奏
        </div>
      ) : null}
      {dragX < 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-lg bg-error/15 pr-5 font-mono text-xs font-medium text-error"
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
        }}
        {...swipeHandlers}
        style={{
          transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
          transition: dragX === 0 ? 'transform 0.42s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          touchAction: 'pan-y',
        }}
        className={cn(
          'gov-card p-4 sm:p-5',
          isPending && '[--gov-accent:var(--color-primary)]',
          selected && 'gov-card-selected',
          exiting === 'approve' && 'gov-card-exit-approve',
          exiting === 'reject' && 'gov-card-exit-reject',
        )}
      >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                isPending ? 'gov-pulse-dot bg-primary' : 'bg-warning',
              )}
            />
            <span className="gov-label">
              {isPending ? 'Redrafting' : 'Candidate'}
            </span>
            {item.redraftCount > 0 ? (
              <span
                key={item.redraftCount}
                className="gov-badge-pop rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px font-mono text-[10px] tabular-nums text-primary"
              >
                重拟 ×{item.redraftCount}
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 text-[15px] font-semibold leading-snug text-foreground sm:text-base">
            {item.title}
          </h3>
        </div>
        <QualityScore score={item.qualityScore} />
      </div>

      {item.summary ? (
        <p
          className={cn(
            'mt-2 text-sm leading-relaxed text-secondary-foreground',
            !expanded && 'line-clamp-2',
          )}
        >
          {item.summary}
        </p>
      ) : null}

      {item.aiReason ? (
        <blockquote className="mt-3 border-l-2 border-primary/40 bg-primary/[0.04] py-2 pl-3 pr-2">
          <div className="gov-label">收录理由 · Rationale</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.aiReason}</p>
        </blockquote>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span className="truncate">{item.feedTitle}</span>
        {item.categoryTitle ? (
          <>
            <span aria-hidden="true" className="text-border">/</span>
            <span>{item.categoryTitle}</span>
          </>
        ) : null}
        <span aria-hidden="true" className="text-border">/</span>
        <time dateTime={item.publishedAt ?? undefined} className="tabular-nums">
          {formatPublishedAt(item.publishedAt)}
        </time>
        {item.sourceUrl ? (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 text-primary/80 transition-colors duration-150 hover:text-primary"
          >
            原文
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
          </a>
        ) : null}
      </div>

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

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          aria-expanded={expanded}
          className="inline-flex min-h-[44px] items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground sm:min-h-0"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('h-3.5 w-3.5 transition-transform duration-150', expanded && 'rotate-180')}
          />
          {expanded ? '收起预览' : '展开预览'}
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onApprove();
            }}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-3 sm:h-8',
              'font-mono text-xs font-medium text-success transition-all duration-150',
              'hover:bg-success/20 hover:shadow-[0_0_12px_rgb(52_211_153/0.25)]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
            准奏
            <kbd className="hidden rounded border border-success/30 px-1 text-[9px] text-success/70 sm:inline">A</kbd>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onOpenReason('reject');
            }}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-md border border-error/30 px-3 sm:h-8',
              'font-mono text-xs font-medium text-error/90 transition-all duration-150',
              'hover:bg-error/10 hover:text-error',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            驳回
            <kbd className="hidden rounded border border-error/20 px-1 text-[9px] text-error/60 sm:inline">R</kbd>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onOpenReason('redraft');
            }}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-md border border-warning/30 px-3 sm:h-8',
              'font-mono text-xs font-medium text-warning/90 transition-all duration-150',
              'hover:bg-warning/10 hover:text-warning',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            重拟
          </button>
        </div>
      </div>

      <div className={cn('gov-collapse', expanded && 'gov-collapse-open')}>
        <div>
          <div className="pt-3 text-sm leading-relaxed text-secondary-foreground">
            {item.summary ?? '暂无摘要。'}
            {item.sourceUrl ? (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="ml-2 inline-flex items-center gap-1 font-mono text-xs text-primary/80 hover:text-primary"
              >
                阅读原文
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
      </article>
    </div>
  );
}

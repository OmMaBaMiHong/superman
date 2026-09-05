'use client';

import { Check, ExternalLink, RotateCcw, X } from 'lucide-react';
import type { GovernanceItemDetail } from '@/lib/api/apiClient';
import ContentTypeBadge from '@/components/ui/content-type-badge';
import VideoEmbed from '@/components/ui/video-embed';
import { cn } from '@/lib/utils';
import { formatPublishedAt } from './GovernanceQueueCard';
import QualityScore from './QualityScore';
import ReasonInput from './ReasonInput';

interface GovernanceItemDetailViewProps {
  detail: GovernanceItemDetail;
  pendingAction: 'approve' | 'reject' | 'redraft' | null;
  reasonOpen: 'reject' | 'redraft' | null;
  onApprove: () => void;
  onOpenReason: (kind: 'reject' | 'redraft') => void;
  onCancelReason: () => void;
  onSubmitReason: (kind: 'reject' | 'redraft', reason: string) => void;
}

/** 审批详情内容：全文渲染 + AI 理由 + 质量分 + 三键操作（看完详情直接批）。 */
export default function GovernanceItemDetailView({
  detail,
  pendingAction,
  reasonOpen,
  onApprove,
  onOpenReason,
  onCancelReason,
  onSubmitReason,
}: GovernanceItemDetailViewProps) {
  const busy = pendingAction !== null;

  return (
    <div className="px-5 pb-6 pt-1 sm:px-7">
      {/* 徽标行 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ContentTypeBadge type={detail.contentType} />
        <QualityScore score={detail.qualityScore} />
        {detail.redraftCount > 0 ? (
          <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px font-mono text-[10px] tabular-nums text-primary">
            重拟 ×{detail.redraftCount}
          </span>
        ) : null}
      </div>

      <h2 className="mt-3 text-xl font-semibold leading-snug text-foreground">
        {detail.title}
      </h2>
      {detail.titleOriginal && detail.titleOriginal !== detail.title ? (
        <p className="mt-1 text-[13px] text-muted-foreground">原标题：{detail.titleOriginal}</p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
        <span>{detail.feedTitle}</span>
        {detail.categoryTitle ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{detail.categoryTitle}</span>
          </>
        ) : null}
        {detail.author ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{detail.author}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <time dateTime={detail.publishedAt ?? undefined} className="font-mono tabular-nums">
          {formatPublishedAt(detail.publishedAt)}
        </time>
        {detail.sourceUrl ? (
          <a
            href={detail.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary transition-colors duration-150 hover:opacity-80"
          >
            阅读原文
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      {detail.aiReason ? (
        <blockquote className="mt-4 rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3">
          <div className="gov-label">收录理由</div>
          <p className="mt-1 text-[13px] leading-relaxed text-secondary-foreground">
            {detail.aiReason}
          </p>
        </blockquote>
      ) : null}

      {detail.previewImage ? (
        <img
          src={detail.previewImage}
          alt=""
          loading="lazy"
          className="mt-4 max-h-64 w-full rounded-2xl border border-border/60 object-cover"
        />
      ) : null}

      {/* 视频条目：嵌入播放器（B站 iframe / 抖音封面+外链） */}
      {detail.contentType === 'video' ? (
        <VideoEmbed sourceUrl={detail.sourceUrl} previewImage={detail.previewImage} title={detail.title} />
      ) : null}

      {/* 全文（入库时已服务端消毒） */}
      {detail.content ? (
        <div
          data-testid="gov-detail-content"
          className="prose mt-4 max-w-none text-[15px] prose-p:leading-relaxed prose-headings:text-foreground prose-p:text-foreground/85 prose-a:text-primary prose-img:rounded-2xl dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: detail.content }}
        />
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-secondary-foreground">
          {detail.summary ?? '暂无正文，可打开原文链接查看。'}
        </p>
      )}

      {/* 理由输入（驳回/重拟，详情内与卡片内同语义） */}
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

      {/* 操作行 */}
      <div className="sticky bottom-0 -mx-1 mt-5 flex items-center justify-end gap-2 border-t border-border/60 px-1 pb-1 pt-3">
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-5',
            'text-sm font-medium text-success transition-all duration-150 hover:bg-success/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          准奏
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onOpenReason('reject')}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-error/30 px-5',
            'text-sm font-medium text-error transition-all duration-150 hover:bg-error/10 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <X aria-hidden="true" className="h-4 w-4" />
          驳回
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onOpenReason('redraft')}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-warning/30 px-5',
            'text-sm font-medium text-warning transition-all duration-150 hover:bg-warning/10 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          重拟
        </button>
      </div>
    </div>
  );
}

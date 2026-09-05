'use client';

import { useMemo, useState } from 'react';
import { Check, Download, ExternalLink, TriangleAlert } from 'lucide-react';
import type { DraftDetail } from '@/lib/api/apiClient';
import { renderMarkdownToSafeHtml } from '@/lib/markdown/renderMarkdown';
import { cn } from '@/lib/utils';
import {
  formatSimilarity,
  ORIGINALITY_META,
  platformBadgeClass,
  platformName,
  similarityToneClass,
} from '../lib/platforms';

type ComparePane = 'original' | 'draft';

interface DraftCompareViewProps {
  detail: DraftDetail;
  accepting: boolean;
  exporting: boolean;
  onAccept: () => void;
  onExport: () => void;
}

/**
 * 草稿对照视图：桌面左右分栏（左原文 / 右成稿），移动端上下分段 + 切换 tab。
 * 成稿 Markdown 经 marked + sanitize-html 白名单渲染。
 */
export default function DraftCompareView({
  detail,
  accepting,
  exporting,
  onAccept,
  onExport,
}: DraftCompareViewProps) {
  const [pane, setPane] = useState<ComparePane>('draft');
  const flagMeta = ORIGINALITY_META[detail.originalityFlag];
  const accepted = detail.status !== 'draft';

  const draftHtml = useMemo(() => renderMarkdownToSafeHtml(detail.body), [detail.body]);

  const originalPane = (
    <div data-testid="compare-original" className="min-w-0">
      <p className="gov-label">原文</p>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-foreground">
        {detail.articleTitle}
      </h3>
      {detail.articleSummary ? (
        <p className="mt-2 text-[13px] leading-relaxed text-secondary-foreground">
          {detail.articleSummary}
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">原文无摘要，可打开链接查看全文。</p>
      )}
      {detail.articleLink ? (
        <a
          href={detail.articleLink}
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-primary transition-colors duration-150 hover:opacity-80"
        >
          打开原文链接
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );

  const draftPane = (
    <div data-testid="compare-draft" className="min-w-0">
      <p className="gov-label">成稿 · {platformName(detail.platform)}</p>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-foreground">
        {detail.title}
      </h3>
      <div
        data-testid="draft-body"
        className="prose mt-3 max-w-none text-[14px] prose-headings:text-foreground prose-p:leading-relaxed prose-p:text-foreground/85 prose-a:text-primary dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: draftHtml }}
      />
    </div>
  );

  return (
    <div className="px-5 pb-6 pt-1 sm:px-7">
      {/* needs_review 红色提示条 */}
      {detail.originalityFlag === 'needs_review' ? (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-2xl border border-error/40 bg-error/10 px-4 py-2.5 text-[12px] font-medium text-error"
        >
          <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
          相似度过高，请人工核对后再发布
        </div>
      ) : null}

      {/* 顶部：平台徽章 + 相似度大号数字 + 原创度说明 */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-medium',
            platformBadgeClass(detail.platform),
          )}
        >
          {platformName(detail.platform)}
        </span>
        <span
          className={cn(
            'inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-medium',
            flagMeta.badgeClass,
          )}
        >
          {flagMeta.label}
        </span>
        {accepted ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2.5 text-[11px] font-medium text-success">
            <Check aria-hidden="true" className="h-3 w-3" />
            已采用
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          aria-label={`相似度 ${formatSimilarity(detail.similarityScore)}`}
          className={cn(
            'font-mono text-3xl font-semibold tabular-nums',
            similarityToneClass(detail.similarityScore),
          )}
        >
          {formatSimilarity(detail.similarityScore)}
        </span>
        <span className="text-[12px] text-muted-foreground">
          与原文相似度{detail.originalityFlag === 'ok' ? '，差异度达标' : detail.originalityFlag === 'rewritten' ? '，已自动降重一次' : '，超出安全线'}
        </span>
      </div>

      {/* 移动端对照切换 tab（桌面端隐藏，左右分栏） */}
      <div className="mt-4 flex gap-1 rounded-full border border-border bg-secondary/60 p-1 md:hidden">
        {(
          [
            ['original', '原文'],
            ['draft', '成稿'],
          ] as Array<[ComparePane, string]>
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pane === id}
            onClick={() => setPane(id)}
            className={cn(
              'flex h-9 flex-1 items-center justify-center rounded-full text-xs font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              pane === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {/* 桌面左右分栏 / 移动单栏切换 */}
      <div className="mt-4 hidden gap-5 md:grid md:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-secondary/40 p-4">{originalPane}</div>
        <div className="rounded-2xl border border-border/60 bg-secondary/40 p-4">{draftPane}</div>
      </div>
      <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/40 p-4 md:hidden">
        {pane === 'original' ? originalPane : draftPane}
      </div>

      {/* 操作行 */}
      <div className="sticky bottom-0 -mx-1 mt-5 flex items-center justify-end gap-2 border-t border-border/60 px-1 pb-1 pt-3">
        <button
          type="button"
          disabled={exporting}
          onClick={onExport}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-5',
            'text-sm font-medium text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {exporting ? '导出中…' : '导出 Markdown'}
        </button>
        <button
          type="button"
          disabled={accepted || accepting}
          onClick={onAccept}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-5',
            'text-sm font-medium text-success transition-all duration-150 hover:bg-success/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success',
            'disabled:pointer-events-none disabled:opacity-60',
          )}
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          {accepted ? '已采用' : accepting ? '采用中…' : '采用'}
        </button>
      </div>
    </div>
  );
}

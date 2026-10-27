'use client';

import { useCallback, useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Link2, TriangleAlert } from 'lucide-react';
import type { DraftDetail } from '@/lib/api/apiClient';
import PublishToWechatButton from './PublishToWechatButton';
import PostRegisterSheet from './PostRegisterSheet';
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
  /** 登记发布后回调（刷新草稿箱「已发布」态）。 */
  onPublished?: () => void;
}

/** 各平台创作/发布后台地址（复制文案后直接去贴）。 */
const PLATFORM_CREATOR_URL: Record<string, { url: string; label: string }> = {
  wechat: { url: 'https://mp.weixin.qq.com/', label: '打开公众号后台' },
  xhs: { url: 'https://creator.xiaohongshu.com/publish/publish?source=official', label: '打开小红书创作中心' },
  douyin: { url: 'https://creator.douyin.com/creator-micro/content/upload', label: '打开抖音创作者中心' },
};

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
  onPublished,
}: DraftCompareViewProps) {
  const [pane, setPane] = useState<ComparePane>('draft');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // 平台化产物：公众号（摘要/备选标题）、小红书（标签/封面文案）、小说化（章节名）+ 两段式策划案
  const payload = detail.payload ?? null;
  const tags = payload?.tags ?? [];
  const titleCandidates = payload?.titleCandidates ?? [];
  const outline = payload?.outline ?? null;
  const hasPlatformMeta = Boolean(payload?.summary || payload?.coverText || tags.length || titleCandidates.length || payload?.chapterTitle || outline);

  const platformMeta = hasPlatformMeta ? (
    <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
      {payload?.chapterTitle ? (
        <p className="text-[12px] text-secondary-foreground">章节名：{payload.chapterTitle}</p>
      ) : null}
      {payload?.summary ? (
        <p className="text-[12px] leading-relaxed text-secondary-foreground">
          <span className="text-muted-foreground">摘要：</span>{payload.summary}
        </p>
      ) : null}
      {payload?.coverText ? (
        <p className="text-[12px] text-secondary-foreground">
          <span className="text-muted-foreground">封面文案：</span>{payload.coverText}
        </p>
      ) : null}
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted-foreground">话题：</span>
          {tags.map((tag) => (
            <span key={tag} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{tag}</span>
          ))}
        </div>
      ) : null}
      {titleCandidates.length > 0 ? (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">备选标题（{titleCandidates.length}）</summary>
          <ul className="mt-1 space-y-0.5 pl-4 text-secondary-foreground">
            {titleCandidates.map((item, index) => (
              <li key={`${item}-${index}`} className="list-disc">{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {outline ? (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">创作大纲 · {outline.angle}</summary>
          <ol className="mt-1 space-y-0.5 pl-4 text-secondary-foreground">
            {outline.sections.map((section, index) => (
              <li key={`${section.heading}-${index}`} className="list-decimal">
                {section.heading}
                {section.points.length > 0 ? <span className="text-muted-foreground">：{section.points.join('；')}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  ) : null;

  // 文案发布闭环（文案阶段）：复制格式化文案 → 去平台后台粘贴发布 → 回填链接登记（带 draftId）
  const publishText = useMemo(() => {
    const tags = (payload?.tags ?? []).join(' ');
    if (detail.platform === 'xhs') {
      return [detail.title, '', detail.body, '', tags].filter(Boolean).join('\n');
    }
    if (detail.platform === 'wechat') {
      return [detail.title, '', payload?.summary ?? '', '', detail.body].filter(Boolean).join('\n');
    }
    return [detail.title, '', detail.body].filter(Boolean).join('\n');
  }, [detail, payload]);

  const creator = PLATFORM_CREATOR_URL[detail.platform];

  const handleCopyPublishText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(publishText);
    } catch {
      // 兜底：ExecCommand（Electron/无剪贴板权限时）
      const textarea = document.createElement('textarea');
      textarea.value = publishText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [publishText]);

  const draftPane = (
    <div data-testid="compare-draft" className="min-w-0">
      <p className="gov-label">成稿 · {platformName(detail.platform)}</p>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-foreground">
        {detail.title}
      </h3>
      {platformMeta}
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

      <PostRegisterSheet
        open={registerOpen}
        draftId={detail.id}
        defaultTitle={detail.title}
        onClose={() => setRegisterOpen(false)}
        onRegistered={() => onPublished?.()}
      />

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
        <button
          type="button"
          onClick={() => void handleCopyPublishText()}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-5',
            'text-sm font-medium text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {copied ? '已复制' : '复制文案'}
        </button>
        {creator ? (
          <a
            href={creator.url}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-5',
              'text-sm font-medium text-muted-foreground transition-all duration-150 hover:text-foreground',
            )}
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {creator.label}
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5',
            'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Link2 aria-hidden="true" className="h-4 w-4" />
          登记发布链接
        </button>
        {accepted ? <PublishToWechatButton draftId={detail.id} onPublished={onPublished} /> : null}
      </div>
    </div>
  );
}

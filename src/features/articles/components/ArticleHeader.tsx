'use client';

import { Star, FileText, Languages, Sparkles, Download, Search } from "lucide-react";
import type { Article, Feed, ArticleAiDigestSource } from "../../../types";
import { formatRelativeTime } from "../../../utils/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getFilteredReasonLabel } from "../utils";
import ReaderToolbarIconButton from "../../reader/components/ReaderToolbarIconButton";

interface ArticleHeaderProps {
  article: Article | null;
  feed: Feed | null;
  isDesktop: boolean;
  reserveTopSpace: boolean;
  effectiveArticleTitleVisible: boolean;
  showBilingualTitle: boolean;
  titleOriginal: string;
  titleZh: string | undefined;
  articleFiltered: boolean;
  referenceTime: Date;
  showDesktopStarButton: boolean;
  showDesktopFulltextButton: boolean;
  showDesktopTranslationButton: boolean;
  showDesktopAiSummaryButton: boolean;
  showDesktopMarkdownExportButton: boolean;
  fulltextButtonDisabled: boolean;
  aiTranslationButtonDisabled: boolean;
  aiSummaryButtonDisabled: boolean;
  bodyTranslationEligible: boolean;
  onOpenSearch?: () => void;
  onToggleStar: (id: string) => void;
  onFulltextButtonClick: () => void;
  onAiTranslationButtonClick: () => void;
  onAiSummaryButtonClick: () => void;
  onMarkdownExportButtonClick: () => void;
}

function renderDesktopToolbar({
  article,
  effectiveArticleTitleVisible,
  titleOriginal,
  showDesktopStarButton,
  showDesktopFulltextButton,
  showDesktopTranslationButton,
  showDesktopAiSummaryButton,
  showDesktopMarkdownExportButton,
  onOpenSearch,
  onToggleStar,
  onFulltextButtonClick,
  onAiTranslationButtonClick,
  onAiSummaryButtonClick,
  onMarkdownExportButtonClick,
}: {
  article: Article | null;
  effectiveArticleTitleVisible: boolean;
  titleOriginal: string;
  showDesktopStarButton: boolean;
  showDesktopFulltextButton: boolean;
  showDesktopTranslationButton: boolean;
  showDesktopAiSummaryButton: boolean;
  showDesktopMarkdownExportButton: boolean;
  onOpenSearch?: () => void;
  onToggleStar: (id: string) => void;
  onFulltextButtonClick: () => void;
  onAiTranslationButtonClick: () => void;
  onAiSummaryButtonClick: () => void;
  onMarkdownExportButtonClick: () => void;
}) {
  const desktopToolbarTitle = article
    ? titleOriginal
    : "选择文章后可查看内容";
  const showToolbarTitle = Boolean(article && !effectiveArticleTitleVisible);

  return (
    <div
      data-testid="article-desktop-toolbar"
      className="flex h-12 min-w-0 items-center justify-between gap-3 px-4"
    >
      <div className="min-w-0 flex-1">
        {showToolbarTitle && article?.link ? (
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`打开原文：${desktopToolbarTitle}`}
            className="block truncate rounded-sm text-[0.96rem] font-semibold tracking-[0.01em] underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {desktopToolbarTitle}
          </a>
        ) : showToolbarTitle ? (
          <span className="block truncate text-[0.96rem] font-semibold tracking-[0.01em] text-foreground">
            {desktopToolbarTitle}
          </span>
        ) : null}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {showDesktopStarButton ? (
          <ReaderToolbarIconButton
            icon={({ className }: { className?: string }) => (
              <Star
                className={className}
                fill={article?.isStarred ? "currentColor" : "none"}
              />
            )}
            label={article?.isStarred ? "已收藏" : "收藏"}
            pressed={Boolean(article?.isStarred)}
            onClick={article ? () => onToggleStar(article.id) : undefined}
          />
        ) : null}
        {showDesktopFulltextButton ? (
          <ReaderToolbarIconButton
            icon={FileText}
            label="抓取全文"
            onClick={article ? onFulltextButtonClick : undefined}
          />
        ) : null}
        {showDesktopTranslationButton ? (
          <ReaderToolbarIconButton
            icon={Languages}
            label="翻译"
            onClick={article ? onAiTranslationButtonClick : undefined}
          />
        ) : null}
        {showDesktopAiSummaryButton ? (
          <ReaderToolbarIconButton
            icon={Sparkles}
            label="生成摘要"
            onClick={article ? onAiSummaryButtonClick : undefined}
          />
        ) : null}
        {showDesktopMarkdownExportButton ? (
          <ReaderToolbarIconButton
            icon={Download}
            label="导出文章"
            onClick={onMarkdownExportButtonClick}
          />
        ) : null}
        <ReaderToolbarIconButton
          icon={Search}
          label="全局搜索"
          onClick={onOpenSearch}
        />
      </div>
    </div>
  );
}

export default function ArticleHeader({
  article,
  feed,
  isDesktop,
  reserveTopSpace,
  effectiveArticleTitleVisible,
  showBilingualTitle,
  titleOriginal,
  titleZh,
  articleFiltered,
  referenceTime,
  showDesktopStarButton,
  showDesktopFulltextButton,
  showDesktopTranslationButton,
  showDesktopAiSummaryButton,
  showDesktopMarkdownExportButton,
  fulltextButtonDisabled,
  aiTranslationButtonDisabled,
  aiSummaryButtonDisabled,
  bodyTranslationEligible,
  onOpenSearch,
  onToggleStar,
  onFulltextButtonClick,
  onAiTranslationButtonClick,
  onAiSummaryButtonClick,
  onMarkdownExportButtonClick,
}: ArticleHeaderProps) {
  const showDesktopToolbar = reserveTopSpace && isDesktop;

  return (
    <>
      {showDesktopToolbar
        ? renderDesktopToolbar({
            article,
            effectiveArticleTitleVisible,
            titleOriginal,
            showDesktopStarButton,
            showDesktopFulltextButton,
            showDesktopTranslationButton,
            showDesktopAiSummaryButton,
            showDesktopMarkdownExportButton,
            onOpenSearch,
            onToggleStar,
            onFulltextButtonClick,
            onAiTranslationButtonClick,
            onAiSummaryButtonClick,
            onMarkdownExportButtonClick,
          })
        : reserveTopSpace
          ? <div className="h-12 shrink-0" />
          : null}

      {article ? (
        <div className="mb-8">
          <h1 className="mb-4 break-words text-3xl font-bold tracking-tight">
            {article.link ? (
              <a
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "group max-w-full break-words rounded-sm underline-offset-4 transition-colors hover:text-foreground/90 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  showBilingualTitle
                    ? "inline-flex flex-col items-start gap-1"
                    : "inline-flex items-center gap-2",
                )}
              >
                <span className="break-words">{titleOriginal}</span>
                {showBilingualTitle ? (
                  <span className="break-words text-base font-medium text-muted-foreground">
                    {titleZh}
                  </span>
                ) : null}
              </a>
            ) : (
              <span
                className={cn(
                  "max-w-full break-words",
                  showBilingualTitle
                    ? "inline-flex flex-col items-start gap-1"
                    : undefined,
                )}
              >
                <span className="break-words">{titleOriginal}</span>
                {showBilingualTitle ? (
                  <span className="break-words text-base font-medium text-muted-foreground">
                    {titleZh}
                  </span>
                ) : null}
              </span>
            )}
          </h1>

          <div className="mb-4 flex items-center text-sm text-muted-foreground">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <span
                  aria-hidden="true"
                  className="text-[11px] leading-none"
                >
                  📰
                </span>
                {feed?.icon ? (
                  <img
                    src={feed.icon}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    width={16}
                    height={16}
                    data-testid="article-feed-icon"
                    className="absolute inset-0 h-full w-full rounded-[3px] bg-background object-cover"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
              </span>
              <span className="min-w-0 break-words">{feed?.title}</span>
              <span aria-hidden="true" className="shrink-0">
                ·
              </span>
              <span className="shrink-0">
                {formatRelativeTime(article.publishedAt, referenceTime)}
              </span>
              {articleFiltered ? (
                <Badge
                  variant="secondary"
                  className="h-5 shrink-0 px-1.5 text-[10px] font-medium"
                  data-testid="article-filter-badge"
                >
                  {getFilteredReasonLabel(article.filteredBy)}
                </Badge>
              ) : null}
              {article.author && (
                <>
                  <span aria-hidden="true" className="shrink-0">
                    ·
                  </span>
                  <span className="min-w-0 break-words">
                    {article.author}
                  </span>
                </>
              )}
            </div>
          </div>

          {!showDesktopToolbar ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => onToggleStar(article.id)}
                variant={article.isStarred ? "default" : "secondary"}
                size="compact"
                className="cursor-pointer"
              >
                <Star fill={article.isStarred ? "currentColor" : "none"} />
                <span>{article.isStarred ? "已收藏" : "收藏"}</span>
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="compact"
                className="cursor-pointer"
                onClick={onFulltextButtonClick}
                disabled={fulltextButtonDisabled}
              >
                <FileText />
                <span>抓取全文</span>
              </Button>

              {bodyTranslationEligible ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="compact"
                  className="cursor-pointer"
                  onClick={onAiTranslationButtonClick}
                  disabled={aiTranslationButtonDisabled}
                >
                  <Languages />
                  <span>翻译</span>
                </Button>
              ) : null}

              <Button
                type="button"
                variant="secondary"
                size="compact"
                className="cursor-pointer"
                onClick={onAiSummaryButtonClick}
                disabled={aiSummaryButtonDisabled}
              >
                <Sparkles />
                <span>生成摘要</span>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
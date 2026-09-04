'use client';

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ARTICLE_STATUS_CARD_CLASS_NAME =
  "mb-4 rounded-2xl border border-border/65 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-muted)_78%,white_22%),color-mix(in_oklab,var(--color-background)_86%,white_14%))] px-4 py-3 dark:border-white/[0.06] dark:bg-card";
const ARTICLE_SUMMARY_CARD_CLASS_NAME =
  "relative mb-4 cursor-pointer rounded-2xl border border-border/60 border-l-[3px] border-l-primary/45 bg-[color-mix(in_oklab,var(--color-primary)_6%,var(--color-background)_94%)] px-4 py-3 transition-[border-color,box-shadow,transform,background-color] duration-200 hover:-translate-y-px hover:border-primary/55 hover:bg-[color-mix(in_oklab,var(--color-primary)_8%,var(--color-background)_92%)] dark:border-white/[0.06] dark:border-l-primary/38 dark:bg-[linear-gradient(135deg,color-mix(in_oklab,var(--color-primary)_12%,var(--color-card)_88%),var(--color-card))]";
const ARTICLE_SUMMARY_BADGE_CLASS_NAME =
  "inline-flex items-center gap-1.5 rounded-full bg-background/78 px-2 py-0.5 text-[11px] font-medium tracking-wide text-[color-mix(in_oklab,var(--color-primary)_40%,var(--color-muted-foreground)_60%)] ring-1 ring-[color-mix(in_oklab,var(--color-primary)_14%,var(--color-border)_86%)] dark:bg-card/82 dark:text-[color-mix(in_oklab,var(--color-primary)_54%,white_46%)] dark:ring-primary/24";

interface ArticleAiSummaryProps {
  articleId: string;
  aiSummaryText: string;
  aiSummaryExpanded: boolean;
  aiSummaryLoading: boolean;
  aiSummaryMissingApiKey: boolean;
  aiSummaryWaitingFulltext: boolean;
  aiSummarySessionRunning: boolean;
  aiSummaryFontSizeClass: string;
  aiSummaryLineHeightClass: string;
  fontFamilyClass: string;
  aiSummaryLines: string[];
  aiSummaryTldrText: string;
  aiSummaryContentId: string;
  toggleAiSummaryExpanded: () => void;
}

export default function ArticleAiSummary({
  articleId,
  aiSummaryText,
  aiSummaryExpanded,
  aiSummaryLoading,
  aiSummaryMissingApiKey,
  aiSummaryWaitingFulltext,
  aiSummarySessionRunning,
  aiSummaryFontSizeClass,
  aiSummaryLineHeightClass,
  fontFamilyClass,
  aiSummaryLines,
  aiSummaryTldrText,
  aiSummaryContentId,
  toggleAiSummaryExpanded,
}: ArticleAiSummaryProps) {
  return (
    <>
      {aiSummaryText ? (
        <section
          className={ARTICLE_SUMMARY_CARD_CLASS_NAME}
          aria-label="AI 摘要"
          onClick={toggleAiSummaryExpanded}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className={ARTICLE_SUMMARY_BADGE_CLASS_NAME}>
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI 摘要</span>
              </span>
              {aiSummarySessionRunning ? (
                <span className="text-[11px] text-muted-foreground">
                  正在生成摘要
                </span>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                摘要可能有误，请以原文为准
              </span>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-2 h-7 shrink-0 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground dark:border dark:border-transparent dark:hover:border-white/[0.06] dark:hover:bg-[var(--glass-bg)]"
              aria-expanded={aiSummaryExpanded}
              aria-controls={aiSummaryContentId}
              onClick={(event) => {
                event.stopPropagation();
                toggleAiSummaryExpanded();
              }}
            >
              {aiSummaryExpanded ? "收起摘要" : "展开摘要"}
            </Button>
          </div>

          <div
            id={aiSummaryContentId}
            className="mt-2 border-t border-border/40 pt-2"
          >
            {aiSummaryExpanded ? (
              <div
                className={cn(
                  "space-y-2 text-foreground/85",
                  aiSummaryFontSizeClass,
                  aiSummaryLineHeightClass,
                  fontFamilyClass,
                )}
              >
                {aiSummaryLines.map((line, index) => (
                  <p key={`${articleId}-ai-summary-${index}`}>{line}</p>
                ))}
              </div>
            ) : (
              <p
                className={cn(
                  "line-clamp-2 text-foreground/85",
                  aiSummaryFontSizeClass,
                  aiSummaryLineHeightClass,
                  fontFamilyClass,
                )}
              >
                {aiSummaryTldrText || aiSummaryText}
              </p>
            )}
          </div>
        </section>
      ) : null}

      {!aiSummaryText && aiSummaryLoading ? (
        <div
          className={ARTICLE_STATUS_CARD_CLASS_NAME}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70"
              aria-hidden="true"
            />
            <span>正在生成摘要，请稍候…</span>
          </div>
        </div>
      ) : null}

      {!aiSummaryText && aiSummaryMissingApiKey ? (
        <div className={`${ARTICLE_STATUS_CARD_CLASS_NAME} text-sm text-muted-foreground`}>
          请先在设置中完成 AI 配置，才能生成摘要
        </div>
      ) : null}

      {!aiSummaryText && aiSummaryWaitingFulltext ? (
        <div className={`${ARTICLE_STATUS_CARD_CLASS_NAME} text-sm text-muted-foreground`}>
          请先等待全文抓取完成，再开始摘要
        </div>
      ) : null}
    </>
  );
}
'use client';

import { Button } from "@/components/ui/button";

const ARTICLE_STATUS_CARD_CLASS_NAME =
  "mb-4 rounded-2xl border border-border/65 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-muted)_78%,white_22%),color-mix(in_oklab,var(--color-background)_86%,white_14%))] px-4 py-3 dark:border-white/[0.06] dark:bg-card";

interface ArticleErrorCardProps {
  showAsyncErrorCard: boolean;
  aiSummaryFailed: boolean;
  aiTranslateFailed: boolean;
  aiSummaryErrorMessage: string;
  aiTranslateErrorMessage: string;
  onAiSummaryButtonClick: () => void;
  onAiTranslationButtonClick: () => void;
}

export default function ArticleErrorCard({
  showAsyncErrorCard,
  aiSummaryFailed,
  aiTranslateFailed,
  aiSummaryErrorMessage,
  aiTranslateErrorMessage,
  onAiSummaryButtonClick,
  onAiTranslationButtonClick,
}: ArticleErrorCardProps) {
  if (!showAsyncErrorCard) {
    return null;
  }

  return (
    <section
      className={`${ARTICLE_STATUS_CARD_CLASS_NAME} text-sm text-muted-foreground`}
      aria-label="处理失败"
    >
      <div className="mb-2 font-medium text-foreground">处理失败</div>
      <div className="space-y-3">
        {aiSummaryFailed ? (
          <div className="flex flex-wrap items-start justify-between gap-2 sm:items-center">
            <span className="min-w-0 flex-1 break-words">
              摘要：{aiSummaryErrorMessage}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onAiSummaryButtonClick}
            >
              重试
            </Button>
          </div>
        ) : null}
        {aiTranslateFailed ? (
          <div className="flex flex-wrap items-start justify-between gap-2 sm:items-center">
            <span className="min-w-0 flex-1 break-words">
              翻译：{aiTranslateErrorMessage}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onAiTranslationButtonClick}
            >
              重试
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
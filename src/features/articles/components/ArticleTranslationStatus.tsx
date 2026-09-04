'use client';

const ARTICLE_STATUS_CARD_CLASS_NAME =
  "mb-4 rounded-2xl border border-border/65 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-muted)_78%,white_22%),color-mix(in_oklab,var(--color-background)_86%,white_14%))] px-4 py-3 dark:border-white/[0.06] dark:bg-card";

interface ArticleTranslationStatusProps {
  hasAiTranslationContent: boolean;
  aiTranslationLoading: boolean;
  aiTranslationMissingApiKey: boolean;
  aiTranslationTimedOut: boolean;
  aiTranslationWaitingFulltext: boolean;
}

export default function ArticleTranslationStatus({
  hasAiTranslationContent,
  aiTranslationLoading,
  aiTranslationMissingApiKey,
  aiTranslationTimedOut,
  aiTranslationWaitingFulltext,
}: ArticleTranslationStatusProps) {
  return (
    <>
      {!hasAiTranslationContent && aiTranslationLoading ? (
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
            <span>正在翻译文章，请稍候…</span>
          </div>
        </div>
      ) : null}

      {!hasAiTranslationContent && aiTranslationMissingApiKey ? (
        <div className={`${ARTICLE_STATUS_CARD_CLASS_NAME} text-sm text-muted-foreground`}>
          请先在设置中完成 AI 配置，才能翻译文章
        </div>
      ) : null}

      {!hasAiTranslationContent && aiTranslationTimedOut ? (
        <div className={`${ARTICLE_STATUS_CARD_CLASS_NAME} text-sm text-muted-foreground`}>
          翻译还在处理中。请稍后重试，或刷新查看结果。
        </div>
      ) : null}

      {!hasAiTranslationContent && aiTranslationWaitingFulltext ? (
        <div className={`${ARTICLE_STATUS_CARD_CLASS_NAME} text-sm text-muted-foreground`}>
          请先等待全文抓取完成，再开始翻译
        </div>
      ) : null}
    </>
  );
}
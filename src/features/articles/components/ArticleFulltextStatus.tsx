'use client';

const ARTICLE_STATUS_CARD_CLASS_NAME =
  "mb-4 rounded-2xl border border-border/65 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-muted)_78%,white_22%),color-mix(in_oklab,var(--color-background)_86%,white_14%))] px-4 py-3 dark:border-white/[0.06] dark:bg-card";

interface ArticleFulltextStatusProps {
  fulltextLoading: boolean;
}

export default function ArticleFulltextStatus({
  fulltextLoading,
}: ArticleFulltextStatusProps) {
  if (!fulltextLoading) {
    return null;
  }

  return (
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
        <span>正在抓取全文，完成后会自动更新</span>
      </div>
    </div>
  );
}
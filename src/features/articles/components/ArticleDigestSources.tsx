'use client';

import type { Article, ArticleAiDigestSource } from "../../../types";
import { formatRelativeTime } from "../../../utils/date";
import { cn } from "@/lib/utils";

const AI_DIGEST_SOURCES_VISIBLE_LIMIT = 3;
const AI_DIGEST_SOURCES_SCROLL_MAX_HEIGHT_CLASS = "max-h-[13.5rem]";
const ARTICLE_SOURCE_BUTTON_CLASS_NAME =
  "flex w-full items-start justify-between gap-3 rounded-xl border border-border/60 bg-[color-mix(in_oklab,var(--color-background)_84%,white_16%)] px-3 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/16 hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-white/[0.06] dark:bg-card dark:hover:border-primary/20 dark:hover:bg-[color-mix(in_oklab,var(--color-primary)_10%,var(--color-card)_90%)]";

interface ArticleDigestSourcesProps {
  isAiDigestArticle: boolean;
  aiDigestSources: ArticleAiDigestSource[];
  article: Article;
  referenceTime: Date;
  onAiDigestSourceClick: (source: ArticleAiDigestSource) => void;
}

export default function ArticleDigestSources({
  isAiDigestArticle,
  aiDigestSources,
  article,
  referenceTime,
  onAiDigestSourceClick,
}: ArticleDigestSourcesProps) {
  if (!isAiDigestArticle) {
    return null;
  }

  const aiDigestSourcesOverflow =
    aiDigestSources.length > AI_DIGEST_SOURCES_VISIBLE_LIMIT;

  return (
    <section
      data-testid="ai-digest-sources-section"
      className="mt-6 rounded-2xl border border-border/65 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-muted)_74%,white_26%),color-mix(in_oklab,var(--color-background)_88%,white_12%))] px-4 py-3 dark:border-white/[0.06] dark:bg-[var(--glass-bg)]"
      aria-label="来源"
    >
      <h2 className="text-sm font-semibold">来源</h2>
      {aiDigestSources.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          暂无来源记录
        </p>
      ) : (
        <div
          data-testid={
            aiDigestSourcesOverflow
              ? "ai-digest-sources-scroll-container"
              : undefined
          }
          className={cn(
            "mt-2",
            aiDigestSourcesOverflow &&
              // Cap the panel at roughly three source cards; longer lists scroll inside.
              `${AI_DIGEST_SOURCES_SCROLL_MAX_HEIGHT_CLASS} overflow-y-auto pr-1`,
          )}
        >
          <ul className="space-y-2">
            {aiDigestSources.map((source) => (
              <li
                key={`${article.id}-${source.articleId}-${source.position}`}
              >
                <button
                  type="button"
                  className={ARTICLE_SOURCE_BUTTON_CLASS_NAME}
                  onClick={() => {
                    void onAiDigestSourceClick(source);
                  }}
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block break-words text-sm font-medium text-foreground">
                      {source.title}
                    </span>
                    <span className="block break-words text-xs text-muted-foreground">
                      {source.feedTitle}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(
                      source.publishedAt ?? article.publishedAt,
                      referenceTime,
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
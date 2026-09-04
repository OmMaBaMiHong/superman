import { cn } from '@/lib/utils';
import type { ArticleVirtualRow } from '../utils/articleListModel';

interface ArticleTimelineNavProps {
  rows: ArticleVirtualRow[];
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  selectedArticleId: string | null;
  onSelectArticle: (articleId: string) => void;
}

function formatTimelineTime(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '--:--';

  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function ArticleTimelineNav({
  rows,
  topSpacerHeight,
  bottomSpacerHeight,
  selectedArticleId,
  onSelectArticle,
}: ArticleTimelineNavProps) {
  return (
    <nav
      aria-label="文章时间线"
      data-testid="article-timeline-rail"
      className="hidden w-24 shrink-0 border-r border-border/60 pr-2 text-left md:block dark:border-white/[0.05]"
    >
      <div aria-hidden="true" style={{ height: topSpacerHeight }} />
      {rows.map((row) => {
        if (row.type === 'section') {
          return (
            <div key={`timeline:${row.key}`} className="flex items-center pl-4 pr-2" style={{ height: row.height }}>
              <span className="truncate text-[13px] font-medium text-muted-foreground">{row.sectionTitle}</span>
            </div>
          );
        }

        const article = row.article;
        if (!article) return null;

        const timeLabel = formatTimelineTime(article.publishedAt);
        const displayTitle = article.titleZh?.trim() || article.title;
        const selected = selectedArticleId === article.id;

        return (
          <button
            key={`timeline:${row.key}`}
            type="button"
            aria-current={selected ? 'true' : undefined}
            aria-label={`${timeLabel} ${displayTitle}`}
            onClick={() => onSelectArticle(article.id)}
            className="group relative flex w-full items-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            style={{ height: row.height }}
          >
            <span
              className={cn(
                'w-12 shrink-0 pt-4 text-[18px] font-semibold tabular-nums leading-none transition-colors',
                selected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
              )}
            >
              {timeLabel}
            </span>
            <span className="relative flex h-full flex-1 justify-center pt-5" aria-hidden="true">
              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/70 dark:bg-white/[0.07]" />
              <span
                className={cn(
                  'relative h-2.5 w-2.5 rounded-full border border-background transition-colors dark:border-background',
                  selected
                    ? 'bg-primary ring-2 ring-primary/15'
                    : 'bg-[color-mix(in_oklab,var(--color-primary)_52%,white_48%)] group-hover:bg-primary',
                )}
              />
            </span>
          </button>
        );
      })}
      <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
    </nav>
  );
}

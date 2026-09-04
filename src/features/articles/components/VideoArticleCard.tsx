import { ImageIcon, Play } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { Article } from '@/types';
import { getArticleVideoMeta } from '@/lib/media/video';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/utils/date';

interface VideoArticleCardProps {
  article: Article;
  feedTitle: string;
  kind?: 'picture' | 'video';
  referenceTime: Date;
  selected: boolean;
  onSelect: (articleId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, articleId: string) => void;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getDuration(article: Article): string | null {
  const attachment = article.mediaAttachments?.find(
    (item) => typeof item.durationSeconds === 'number' && item.durationSeconds > 0,
  );
  return formatDuration(attachment?.durationSeconds);
}

/**
 * 媒体网格卡片：封面在上、标题在下。用于视频视图中栏的「网格」形态
 * （未选中文章时一行展示多个，grid-cols-2 sm:grid-cols-3 lg:grid-cols-4）。
 */
export default function VideoArticleCard({
  article,
  feedTitle,
  kind = 'video',
  referenceTime,
  selected,
  onSelect,
  onKeyDown,
}: VideoArticleCardProps) {
  const videoMeta = getArticleVideoMeta({
    link: article.link,
    content: article.content,
    previewImage: article.previewImage,
    mediaAttachments: article.mediaAttachments,
  });
  const thumbnailUrl = kind === 'video' ? videoMeta?.thumbnailUrl ?? article.previewImage : article.previewImage;
  const duration = kind === 'video' ? getDuration(article) : null;
  const displayTitle = article.titleZh?.trim() || article.title;
  const cardTestId =
    kind === 'video'
      ? `article-video-grid-card-${article.id}`
      : `article-media-grid-card-${article.id}`;

  return (
    <button
      type="button"
      data-article-nav="true"
      data-article-id={article.id}
      data-testid={cardTestId}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${displayTitle}，${feedTitle}，${formatRelativeTime(article.publishedAt, referenceTime)}，${article.isRead ? '已读' : '未读'}`}
      onClick={() => onSelect(article.id)}
      onKeyDown={(event) => onKeyDown(event, article.id)}
      className={cn(
        'group min-w-0 rounded-2xl border border-transparent p-2 text-left transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:border-white/[0.03]',
        selected
          ? 'bg-[color-mix(in_oklab,var(--color-primary)_11%,white_89%)] dark:border-primary/26 dark:bg-[var(--reader-pane-active-strong)]'
          : 'hover:-translate-y-0.5 hover:bg-[var(--reader-pane-hover)] dark:hover:bg-[color-mix(in_oklab,var(--color-primary)_12%,var(--color-card)_88%)]',
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-muted dark:bg-card">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {kind === 'video' ? (
              <Play className="h-7 w-7" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-7 w-7" aria-hidden="true" />
            )}
          </div>
        )}
        {kind === 'video' ? (
          <span
            aria-label="视频文章"
            className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/62 text-white ring-1 ring-white/15 backdrop-blur-md"
          >
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          </span>
        ) : null}
        {duration ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/72 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
            {duration}
          </span>
        ) : null}
      </div>
      <div className="px-1 py-2">
        <h3
          data-selected-row-title
          className={cn(
            'line-clamp-2 text-[0.92rem] font-semibold leading-snug',
            article.isRead ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {displayTitle}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span data-selected-row-feed className="min-w-0 truncate font-medium">
            {feedTitle}
          </span>
          <span data-selected-row-time className="shrink-0">
            {formatRelativeTime(article.publishedAt, referenceTime)}
          </span>
        </div>
      </div>
    </button>
  );
}

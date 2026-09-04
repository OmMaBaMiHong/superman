import { ImageIcon, Play } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { Article } from '@/types';
import { getArticleVideoMeta } from '@/lib/media/video';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/utils/date';

interface VideoArticleRowProps {
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
 * 票根式媒体行：封面在左、标题在右，一行一条。
 * 用于视频视图选中详情后中栏的「列表」形态，按时间倒序排列。
 */
export default function VideoArticleRow({
  article,
  feedTitle,
  kind = 'video',
  referenceTime,
  selected,
  onSelect,
  onKeyDown,
}: VideoArticleRowProps) {
  const videoMeta = getArticleVideoMeta({
    link: article.link,
    content: article.content,
    previewImage: article.previewImage,
    mediaAttachments: article.mediaAttachments,
  });
  const thumbnailUrl =
    kind === 'video' ? videoMeta?.thumbnailUrl ?? article.previewImage : article.previewImage;
  const duration = kind === 'video' ? getDuration(article) : null;
  const displayTitle = article.titleZh?.trim() || article.title;
  const rowTestId =
    kind === 'video' ? `article-video-row-${article.id}` : `article-media-row-${article.id}`;

  return (
    <button
      type="button"
      data-article-nav="true"
      data-article-id={article.id}
      data-testid={rowTestId}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${displayTitle}，${feedTitle}，${formatRelativeTime(article.publishedAt, referenceTime)}，${article.isRead ? '已读' : '未读'}`}
      onClick={() => onSelect(article.id)}
      onKeyDown={(event) => onKeyDown(event, article.id)}
      className={cn(
        'group flex w-full min-w-0 items-stretch gap-2.5 rounded-xl border border-transparent p-1.5 text-left transition-[background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:border-white/[0.03]',
        selected
          ? 'bg-[color-mix(in_oklab,var(--color-primary)_11%,white_89%)] dark:border-primary/26 dark:bg-[var(--reader-pane-active-strong)]'
          : 'hover:bg-[var(--reader-pane-hover)] dark:hover:bg-[color-mix(in_oklab,var(--color-primary)_12%,var(--color-card)_88%)]',
      )}
    >
      <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-muted dark:bg-card">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {kind === 'video' ? (
              <Play className="h-5 w-5" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
        )}
        {duration ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/72 px-1 py-px text-[10px] font-semibold tabular-nums text-white">
            {duration}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-0.5">
        <h3
          data-selected-row-title
          title={displayTitle}
          className={cn(
            'line-clamp-2 text-[0.88rem] font-semibold leading-snug',
            article.isRead ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {displayTitle}
        </h3>
        <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
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

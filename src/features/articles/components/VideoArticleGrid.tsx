import type { KeyboardEvent, ReactNode } from 'react';
import type { Article } from '@/types';
import VideoArticleCard from './VideoArticleCard';
import VideoArticleRow from './VideoArticleRow';

interface VideoArticleGridProps {
  articles: Article[];
  feedTitleById: Map<string, string>;
  kind?: 'picture' | 'video';
  referenceTime: Date;
  selectedArticleId: string | null;
  onSelectArticle: (articleId: string) => void;
  onArticleKeyDown: (event: KeyboardEvent<HTMLButtonElement>, articleId: string) => void;
  renderFooter: () => ReactNode;
}

/**
 * 媒体容器：根据是否选中详情自动切换形态。
 * - 未选中详情：网格形态，一行多个（grid-cols-2 sm:grid-cols-3 lg:grid-cols-4），
 *   由 VideoArticleCard 提供封面在上/标题在下的卡片视觉。
 * - 已选中详情：票根式列表，一行一条（封面左/标题右，按时间倒序），
 *   由 VideoArticleRow 提供单行视觉。
 */
export default function VideoArticleGrid({
  articles,
  feedTitleById,
  kind = 'video',
  referenceTime,
  selectedArticleId,
  onSelectArticle,
  onArticleKeyDown,
  renderFooter,
}: VideoArticleGridProps) {
  const gridTestId = kind === 'video' ? 'article-video-grid' : 'article-media-grid';
  const listMode = selectedArticleId !== null;
  const itemProps = (article: Article) => ({
    article,
    feedTitle: feedTitleById.get(article.feedId) ?? '',
    kind,
    referenceTime,
    selected: selectedArticleId === article.id,
    onSelect: onSelectArticle,
    onKeyDown: onArticleKeyDown,
  });

  return (
    <>
      <div
        data-testid={gridTestId}
        className={
          listMode
            ? 'flex flex-col gap-1.5 px-3 py-3'
            : 'grid grid-cols-2 gap-3 px-3 py-3 sm:grid-cols-3 lg:grid-cols-4'
        }
      >
        {articles.map((article) =>
          listMode ? (
            <VideoArticleRow key={article.id} {...itemProps(article)} />
          ) : (
            <VideoArticleCard key={article.id} {...itemProps(article)} />
          ),
        )}
      </div>
      {renderFooter()}
    </>
  );
}

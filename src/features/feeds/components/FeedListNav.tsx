import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  READER_PANE_ACTIVE_ITEM_CLASS_NAME,
  READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
} from '@/lib/ui/designSystem';
import { cn } from '@/lib/utils';

/**
 * 左栏内容项（非导航菜单）：
 * 顶部导航轨道承载 FeedViewTabs 之后，FeedListNav 仅保留「收藏文章」入口，
 * 继续作为侧边栏内容区的一部分渲染在 FeedTree 之前。
 */
interface FeedListNavProps {
  unreadBadgeClassName: string;
  renderedSelectedView: string;
  starredArticleCount: number;
  onSelectView: (viewId: string) => void;
}

export default function FeedListNav({
  unreadBadgeClassName,
  renderedSelectedView,
  starredArticleCount,
  onSelectView,
}: FeedListNavProps) {
  return (
    <div className="space-y-0.5 px-2 pb-2 pt-2">
      <button
        type="button"
        onClick={() => onSelectView('starred')}
        aria-current={renderedSelectedView === 'starred' ? 'true' : undefined}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border border-transparent px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:border-white/[0.03]',
          renderedSelectedView === 'starred'
            ? READER_PANE_ACTIVE_ITEM_CLASS_NAME
            : cn(
                'text-foreground hover:text-accent-foreground',
                READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
              ),
        )}
      >
        <div className="flex min-w-0 items-center">
          <Star aria-hidden="true" className="mr-2 inline-block h-4 w-4 shrink-0 align-[-2px]" />
          <span>收藏文章</span>
        </div>
        {starredArticleCount > 0 ? (
          <Badge
            variant="secondary"
            aria-hidden="true"
            className={cn(
              'h-5 min-w-6 shrink-0 justify-center px-1.5 text-[10px] font-semibold tabular-nums',
              unreadBadgeClassName,
            )}
          >
            {starredArticleCount}
          </Badge>
        ) : null}
      </button>
    </div>
  );
}

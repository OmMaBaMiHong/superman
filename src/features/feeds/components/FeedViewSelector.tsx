import type { FeedContentView } from '@/types';
import { cn } from '@/lib/utils';
import { isReaderContentPageView } from '@/lib/reader/view';
import { FEED_VIEW_TAB_ITEMS, getContentViewForTab } from './FeedViewTabs';

interface FeedViewSelectorProps {
  labelId: string;
  value: FeedContentView;
  onChange: (value: FeedContentView) => void;
}

const selectableViews = FEED_VIEW_TAB_ITEMS
  .map((item) => ({ ...item, contentView: getContentViewForTab(item.id) }))
  .filter(
    (item) =>
      // 内容页视图（发现/知识库）不是订阅源「内容类型」，必须过滤，防污染 feed 类型选择器。
      !isReaderContentPageView(item.id) &&
      item.contentView !== null &&
      item.contentView !== 'digest',
  ) as Array<(typeof FEED_VIEW_TAB_ITEMS)[number] & { contentView: Exclude<FeedContentView, 'digest'> }>;

export default function FeedViewSelector({ labelId, value, onChange }: FeedViewSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="grid grid-cols-4 gap-2 rounded-2xl border border-border/70 bg-background/60 p-1.5 dark:border-white/[0.07] dark:bg-card/58"
    >
      {selectableViews.map((item) => {
        const active = value === item.contentView;

        return (
          <button
            key={item.contentView}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(item.contentView)}
            className={cn(
              'flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              active
                ? 'bg-primary/10 text-primary dark:bg-[var(--reader-pane-active)] dark:text-foreground'
                : 'text-muted-foreground hover:bg-[var(--reader-pane-hover)] hover:text-foreground dark:hover:bg-[color-mix(in_oklab,var(--color-primary)_12%,var(--color-card)_88%)]',
            )}
          >
            <item.Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}

import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { type Dispatch, type KeyboardEvent, type SetStateAction, useMemo } from 'react';
import { Badge as BadgeUI } from '@/components/ui/badge';
import {
  READER_PANE_ACTIVE_ITEM_CLASS_NAME,
  READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
} from '@/lib/ui/designSystem';
import { cn } from '@/lib/utils';
import type { Category, Feed } from '../../../types';
import { FeedCategoryContextMenu, FeedItemContextMenu } from './FeedContextMenu';

const uncategorizedName = '未分类';
const uncategorizedId = 'cat-uncategorized';
const LEFT_RAIL_UNREAD_BADGE_CLASS_NAME =
  'border-border/60 bg-[color-mix(in_oklab,var(--color-background)_86%,white_14%)] text-muted-foreground dark:border-white/[0.08] dark:bg-[color-mix(in_oklab,var(--color-primary)_10%,var(--color-card)_90%)] dark:text-foreground/86';

interface FeedGroup {
  id: string;
  name: string;
  feeds: Feed[];
}

interface FeedTreeProps {
  appCategories: Category[];
  categoryMaster: { id: string; name: string }[];
  renderedSelectedView: string;
  activeViewTabName: string;
  visibleFeeds: Feed[];
  showFilteredByFeedId: Record<string, boolean>;
  hoveredFeedErrorId: string | null;
  onToggleCategory: (categoryId: string) => void;
  onCategoryKeyDown: (event: KeyboardEvent<HTMLButtonElement>, categoryId: string, expanded: boolean) => void;
  onSelectView: (viewId: string) => void;
  onSetRenameCategoryId: (id: string) => void;
  onSetDeleteCategoryId: (id: string) => void;
  onSetEditFeedId: (id: string) => void;
  onSetEditAiDigestFeedId: (id: string) => void;
  onSetDeleteFeedId: (id: string) => void;
  onSetFulltextPolicyFeedId: (id: string) => void;
  onSetSummaryPolicyFeedId: (id: string) => void;
  onSetTranslationPolicyFeedId: (id: string) => void;
  onMoveCategory: (categoryId: string, direction: 'up' | 'down') => void;
  onMoveFeedToCategory: (feedId: string, categoryId: string | null, categoryName: string) => void;
  onToggleFilteredArticlesVisibility: (feedId: string) => void;
  onToggleFeedEnabled: (feedId: string, enabled: boolean) => void;
  onHoveredFeedErrorChange: Dispatch<SetStateAction<string | null>>;
}

export default function FeedTree({
  appCategories,
  categoryMaster,
  renderedSelectedView,
  activeViewTabName,
  visibleFeeds,
  showFilteredByFeedId,
  hoveredFeedErrorId,
  onToggleCategory,
  onCategoryKeyDown,
  onSelectView,
  onSetRenameCategoryId,
  onSetDeleteCategoryId,
  onSetEditFeedId,
  onSetEditAiDigestFeedId,
  onSetDeleteFeedId,
  onSetFulltextPolicyFeedId,
  onSetSummaryPolicyFeedId,
  onSetTranslationPolicyFeedId,
  onMoveCategory,
  onMoveFeedToCategory,
  onToggleFilteredArticlesVisibility,
  onToggleFeedEnabled,
  onHoveredFeedErrorChange,
}: FeedTreeProps) {
  const expandedByCategoryId = new Map(appCategories.map((item) => [item.id, item.expanded ?? true]));

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();

    appCategories.forEach((item) => {
      map.set(item.id, item.name);
    });
    categoryMaster.forEach((item) => {
      map.set(item.id, item.name);
    });

    return map;
  }, [appCategories, categoryMaster]);

  const categoryIdByName = useMemo(() => {
    const map = new Map<string, string>();

    categoryNameById.forEach((name, id) => {
      const key = name.trim().toLowerCase();
      if (!key || map.has(key)) {
        return;
      }
      map.set(key, id);
    });

    return map;
  }, [categoryNameById]);

  const feedGroups = useMemo(() => {
    type FeedGroup = { id: string; name: string; feeds: typeof visibleFeeds };
    const groups = new Map<string, FeedGroup>();

    visibleFeeds.forEach((feed) => {
      const normalizedCategoryId = feed.categoryId?.trim();
      const normalizedLegacyCategory = feed.category?.trim();

      let groupId = uncategorizedId;
      let groupName = uncategorizedName;

      if (normalizedCategoryId && categoryNameById.has(normalizedCategoryId)) {
        groupId = normalizedCategoryId;
        groupName = categoryNameById.get(normalizedCategoryId) ?? uncategorizedName;
      } else if (normalizedLegacyCategory) {
        const mappedCategoryId = categoryIdByName.get(normalizedLegacyCategory.toLowerCase());
        if (mappedCategoryId) {
          groupId = mappedCategoryId;
          groupName = categoryNameById.get(mappedCategoryId) ?? normalizedLegacyCategory;
        }
      }

      const existing = groups.get(groupId);
      if (existing) {
        existing.feeds.push(feed);
      } else {
        groups.set(groupId, { id: groupId, name: groupName, feeds: [feed] });
      }
    });

    categoryMaster.forEach((category) => {
      if (!groups.has(category.id)) {
        groups.set(category.id, { id: category.id, name: category.name, feeds: [] });
      }
    });

    if (!groups.has(uncategorizedId)) {
      groups.set(uncategorizedId, { id: uncategorizedId, name: uncategorizedName, feeds: [] });
    }

    const orderedIds = [
      ...categoryMaster.map((item) => item.id),
      uncategorizedId,
      ...Array.from(groups.keys()).filter(
        (id) => id !== uncategorizedId && !categoryMaster.some((category) => category.id === id)
      ),
    ];

    return orderedIds
      .map((id) => groups.get(id))
      .filter((group): group is FeedGroup => group !== undefined && group.feeds.length > 0);
  }, [visibleFeeds, categoryMaster, categoryNameById, categoryIdByName]);

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-3">
      <div
        data-testid="feed-view-list-header"
        className="mb-1 flex items-center justify-between px-2 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground"
      >
        <span>{activeViewTabName}</span>
        <span>{visibleFeeds.length}</span>
      </div>
      {feedGroups.map((category) => {
        const categoryFeeds = category.feeds;
        const expanded = expandedByCategoryId.get(category.id) ?? true;
        const categoryIndex = categoryMaster.findIndex((item) => item.id === category.id);
        const categoryTrigger = (
          <button
            type="button"
            onClick={() => onToggleCategory(category.id)}
            onKeyDown={(event) => onCategoryKeyDown(event, category.id, expanded)}
            aria-expanded={expanded}
            aria-controls={`feed-category-panel-${category.id}`}
            className={cn(
              'flex w-full items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground transition-colors hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:border-white/[0.02]',
              READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
            )}
          >
            {expanded ? (
              <ChevronDown size={16} aria-hidden="true" />
            ) : (
              <ChevronRight size={16} aria-hidden="true" />
            )}
            <span>{category.name}</span>
          </button>
        );

        return (
          <div key={category.id} className="mb-1.5">
            {category.id === uncategorizedId ? (
              categoryTrigger
            ) : (
              <FeedCategoryContextMenu
                categoryId={category.id}
                categoryIndex={categoryIndex}
                categoryMasterLength={categoryMaster.length}
                onRename={() => onSetRenameCategoryId(category.id)}
                onMoveUp={() => onMoveCategory(category.id, 'up')}
                onMoveDown={() => onMoveCategory(category.id, 'down')}
                onDelete={() => onSetDeleteCategoryId(category.id)}
              >
                {categoryTrigger}
              </FeedCategoryContextMenu>
            )}

            {expanded && (
              <div id={`feed-category-panel-${category.id}`} className="mt-0.5 space-y-0.5 pl-4">
                {categoryFeeds.map((feed) => {
                  const fetchErrorText = feed.fetchRawError || feed.fetchError;
                  const isFeedErrored = Boolean(fetchErrorText);
                  const isRssFeed = (feed.kind ?? 'rss') === 'rss';
                  const showTextAutomationPolicies = isRssFeed && !feed.isPodcast;
                  const showFilteredArticles = Boolean(showFilteredByFeedId[feed.id]);
                  const feedButton = (
                    <button
                      type="button"
                      onClick={() => onSelectView(feed.id)}
                      aria-current={renderedSelectedView === feed.id ? 'true' : undefined}
                      aria-describedby={isFeedErrored ? `feed-error-${feed.id}` : undefined}
                      onMouseEnter={() => {
                        if (isFeedErrored) {
                          onHoveredFeedErrorChange(feed.id);
                        }
                      }}
                      onMouseLeave={() => {
                        onHoveredFeedErrorChange((current) => (current === feed.id ? null : current));
                      }}
                      onFocus={() => {
                        if (isFeedErrored) {
                          onHoveredFeedErrorChange(feed.id);
                        }
                      }}
                      onBlur={() => {
                        onHoveredFeedErrorChange((current) => (current === feed.id ? null : current));
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-xl border border-transparent px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:border-white/[0.03]',
                        renderedSelectedView === feed.id
                          ? READER_PANE_ACTIVE_ITEM_CLASS_NAME
                          : cn(
                              'text-foreground hover:text-accent-foreground',
                              READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
                            ),
                        !feed.enabled && 'opacity-60',
                        isFeedErrored && 'text-destructive hover:text-destructive',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          className={cn(
                            'relative flex h-4 w-4 shrink-0 items-center justify-center',
                            isFeedErrored && 'text-destructive',
                          )}
                        >
                          <span aria-hidden="true" className="text-[11px] leading-none">
                            📰
                          </span>
                          {feed.icon ? (
                            <img
                              src={feed.icon}
                              alt=""
                              aria-hidden="true"
                              loading="lazy"
                              decoding="async"
                              fetchPriority="low"
                              width={16}
                              height={16}
                              className="absolute inset-0 h-full w-full rounded-[3px] bg-background object-cover"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : null}
                        </span>
                        <span className="truncate font-medium">{feed.title}</span>
                        {feed.provider === 'fever' ? (
                          <BadgeUI variant="outline" className="h-5 shrink-0 rounded-full px-2 text-[10px]">
                            Fever
                          </BadgeUI>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {isFeedErrored ? (
                          <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                        ) : null}
                        {feed.unreadCount > 0 ? (
                          <BadgeUI
                            variant="secondary"
                            className={cn(
                              'h-5 min-w-6 justify-center px-1.5 text-[10px] font-semibold tabular-nums',
                              LEFT_RAIL_UNREAD_BADGE_CLASS_NAME,
                            )}
                          >
                            {feed.unreadCount}
                          </BadgeUI>
                        ) : null}
                      </div>
                    </button>
                  );

                  return (
                    <FeedItemContextMenu
                      key={feed.id}
                      feed={feed}
                      categoryMaster={categoryMaster}
                      uncategorizedName={uncategorizedName}
                      showFilteredArticles={showFilteredArticles}
                      isRssFeed={isRssFeed}
                      showTextAutomationPolicies={showTextAutomationPolicies}
                      hoveredFeedErrorId={hoveredFeedErrorId}
                      onHoveredFeedErrorChange={onHoveredFeedErrorChange}
                      onEdit={() => {
                        if (isRssFeed) {
                          onSetEditFeedId(feed.id);
                          return;
                        }
                        onSetEditAiDigestFeedId(feed.id);
                      }}
                      onMoveToCategory={(categoryId, categoryName) =>
                        onMoveFeedToCategory(feed.id, categoryId, categoryName)
                      }
                      onToggleFiltered={() => onToggleFilteredArticlesVisibility(feed.id)}
                      onToggleEnabled={() => onToggleFeedEnabled(feed.id, feed.enabled)}
                      onDelete={() => onSetDeleteFeedId(feed.id)}
                      onFulltextPolicy={() => onSetFulltextPolicyFeedId(feed.id)}
                      onSummaryPolicy={() => onSetSummaryPolicyFeedId(feed.id)}
                      onTranslationPolicy={() => onSetTranslationPolicyFeedId(feed.id)}
                    >
                      {feedButton}
                    </FeedItemContextMenu>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
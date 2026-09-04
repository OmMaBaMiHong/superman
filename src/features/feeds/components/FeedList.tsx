import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../../store/appStore';
import type { ViewType } from '../../../types';
import { deleteCategory, patchCategory, reorderCategories } from '@/lib/api/apiClient';
import { runImmediateOperation } from '../../notifications/userOperationNotifier';
import {
  AI_DIGEST_VIEW_ID,
  ARTICLE_VIEW_ID,
  DISCOVER_VIEW_ID,
  GITHUB_VIEW_ID,
  PUBLISH_CENTER_VIEW_ID,
  VIDEO_VIEW_ID,
} from '@/lib/reader/view';
import { FEED_SUBSCRIBE_REQUEST_EVENT } from '../lib/subscribeFeedBridge';
import { useHydratedSelectedView } from '../../../hooks';
import {
  FEED_VIEW_TAB_ITEMS,
  buildViewTabCounts,
  getActiveViewTabId,
  getContentViewForTab,
  type FeedViewTabId,
} from './FeedViewTabs';
import FeedRailTabs, { type FeedRailTab } from './FeedRailTabs';
import FeedDialogsHost from './FeedDialogsHost';
import FeedTree from './FeedTree';
import FeedListFooter from './FeedListFooter';
import FeedListHeader from './FeedListHeader';
import FeedListNav from './FeedListNav';
import WorkbenchMenu, { type WorkbenchTab } from '@/features/workbench/components/WorkbenchMenu';

const uncategorizedName = '未分类';
const uncategorizedId = 'cat-uncategorized';
export const LEFT_RAIL_UNREAD_BADGE_CLASS_NAME =
  'border-border/60 bg-[color-mix(in_oklab,var(--color-background)_86%,white_14%)] text-muted-foreground dark:border-white/[0.08] dark:bg-[color-mix(in_oklab,var(--color-primary)_10%,var(--color-card)_90%)] dark:text-foreground/86';

interface FeedListProps {
  reserveCloseButtonSpace?: boolean;
  initialSelectedView?: ViewType;
  onOpenSettings?: () => void;
  onAddGithub?: () => void;
}

export default function FeedList({
  reserveCloseButtonSpace = false,
  initialSelectedView,
  onOpenSettings,
  onAddGithub,
}: FeedListProps) {
  const appCategories = useAppStore((state) => state.categories);
  const articles = useAppStore((state) => state.articles);
  const feeds = useAppStore((state) => state.feeds);
  const loadSnapshot = useAppStore((state) => state.loadSnapshot);
  const showFilteredByFeedId = useAppStore((state) => state.showFilteredByFeedId);
  const selectedView = useAppStore((state) => state.selectedView);
  const setSelectedView = useAppStore((state) => state.setSelectedView);
  const workbenchTab = useAppStore((state) => state.workbenchTab);
  const setWorkbenchTab = useAppStore((state) => state.setWorkbenchTab);
  const toggleCategory = useAppStore((state) => state.toggleCategory);
  const toggleShowFilteredForFeed = useAppStore((state) => state.toggleShowFilteredForFeed);
  const addFeed = useAppStore((state) => state.addFeed);
  const updateFeed = useAppStore((state) => state.updateFeed);
  const removeFeed = useAppStore((state) => state.removeFeed);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [addAiDigestOpen, setAddAiDigestOpen] = useState(false);
  const [presetFeedUrl, setPresetFeedUrl] = useState<string | null>(null);
  const [presetFeedTitle, setPresetFeedTitle] = useState<string | null>(null);
  const [editFeedId, setEditFeedId] = useState<string | null>(null);
  const [editAiDigestFeedId, setEditAiDigestFeedId] = useState<string | null>(null);
  const [deleteFeedId, setDeleteFeedId] = useState<string | null>(null);
  const [fulltextPolicyFeedId, setFulltextPolicyFeedId] = useState<string | null>(null);
  const [summaryPolicyFeedId, setSummaryPolicyFeedId] = useState<string | null>(null);
  const [translationPolicyFeedId, setTranslationPolicyFeedId] = useState<string | null>(null);
  const [renameCategoryId, setRenameCategoryId] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [hoveredFeedErrorId, setHoveredFeedErrorId] = useState<string | null>(null);

  // 上次停留的 RSS 内容视图（点击一级「RSS订阅」时回到这里，默认「全部」）。
  const [lastRssView, setLastRssView] = useState<ViewType>('all');

  const handleRailTabChange = useCallback(
    (tab: FeedRailTab) => {
      if (tab === 'rss') {
        setSelectedView(lastRssView);
      } else if (tab === 'github') {
        setSelectedView(GITHUB_VIEW_ID);
      } else {
        setSelectedView(PUBLISH_CENTER_VIEW_ID);
      }
    },
    [lastRssView, setSelectedView],
  );

  const handleViewTabChange = useCallback(
    (view: FeedViewTabId) => {
      setLastRssView(view);
      setSelectedView(view);
    },
    [setSelectedView],
  );

  const handleWorkbenchMenuTabChange = useCallback((tab: WorkbenchTab) => {
    setWorkbenchTab(tab);
  }, [setWorkbenchTab]);

  const starredArticleCount = useMemo(
    () => articles.reduce((count, article) => count + (article.isStarred ? 1 : 0), 0),
    [articles],
  );

  const handleSubscribeFeed = useCallback((url: string, title: string) => {
    setPresetFeedUrl(url);
    setPresetFeedTitle(title);
    setTimeout(() => setAddFeedOpen(true), 100);
  }, []);

  // 发现页入口：从「+」菜单切换到内容页视图（恢复完整发现页，非弹窗）。
  const handleOpenDiscover = useCallback(() => {
    setSelectedView(DISCOVER_VIEW_ID);
  }, [setSelectedView]);

  // 订阅事件桥（arch-ui-integration §1.1.3）：
  // DiscoverPage 等外部面板 dispatch requestSubscribeFeed → 复用左栏完整订阅流（预填 AddFeedDialog）。
  useEffect(() => {
    const handleSubscribeFeedRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{ url: string; title: string }>;
      const url = customEvent.detail?.url;
      const title = customEvent.detail?.title;
      if (typeof url !== 'string' || !url.trim()) return;
      handleSubscribeFeed(url, typeof title === 'string' ? title : '');
    };

    window.addEventListener(FEED_SUBSCRIBE_REQUEST_EVENT, handleSubscribeFeedRequest);
    return () => {
      window.removeEventListener(FEED_SUBSCRIBE_REQUEST_EVENT, handleSubscribeFeedRequest);
    };
  }, [handleSubscribeFeed]);

  const handleAddFeedDialogClose = (open: boolean) => {
    setAddFeedOpen(open);
    if (!open) {
      setPresetFeedUrl(null);
      setPresetFeedTitle(null);
    }
  };

  const handleCategoryKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    categoryId: string,
    expanded: boolean,
  ) => {
    if (event.key === 'ArrowLeft' && expanded) {
      event.preventDefault();
      toggleCategory(categoryId);
      return;
    }
    if (event.key === 'ArrowRight' && !expanded) {
      event.preventDefault();
      toggleCategory(categoryId);
    }
  };

  const categoryMaster = useMemo(() => {
    return appCategories
      .filter((item) => item.id !== uncategorizedId && item.name !== uncategorizedName)
      .map((item) => ({ id: item.id, name: item.name }));
  }, [appCategories]);

  const renderedSelectedView = useHydratedSelectedView(selectedView, initialSelectedView);
  const activeViewTabId = useMemo<FeedViewTabId>(
    () => getActiveViewTabId(renderedSelectedView, feeds),
    [feeds, renderedSelectedView],
  );
  const viewTabCounts = useMemo(() => buildViewTabCounts(feeds), [feeds]);
  // 一级轨道高亮：从选中视图推导来源（单一数据源，自动跟随任何入口的视图切换）。
  const activeRailTab = useMemo<FeedRailTab>(() => {
    if (renderedSelectedView === GITHUB_VIEW_ID) return 'github';
    if (renderedSelectedView === PUBLISH_CENTER_VIEW_ID) return 'workbench';
    return 'rss';
  }, [renderedSelectedView]);
  const activeViewTabName =
    FEED_VIEW_TAB_ITEMS.find((item) => item.id === activeViewTabId)?.name ?? '全部';
  const visibleFeeds = useMemo(() => {
    const contentView = getContentViewForTab(activeViewTabId);
    return feeds.filter((feed) => {
      const kind = feed.kind ?? 'rss';
      if (activeViewTabId === 'all') return kind === 'rss';
      if (activeViewTabId === AI_DIGEST_VIEW_ID) return kind === 'ai_digest';
      if (activeViewTabId === GITHUB_VIEW_ID) return kind === 'github';
      if (kind !== 'rss') return false;
      return (feed.view ?? 'article') === contentView;
    });
  }, [activeViewTabId, feeds]);

  const activeRenameCategory = useMemo(
    () => (renameCategoryId ? categoryMaster.find((c) => c.id === renameCategoryId) ?? null : null),
    [categoryMaster, renameCategoryId],
  );
  const loadSnapshotSilently = async (view: ViewType) => {
    try { await loadSnapshot({ view }); } catch { /* silent */ }
  };

  const moveCategory = async (categoryId: string, direction: 'up' | 'down') => {
    const categoryIndex = categoryMaster.findIndex((category) => category.id === categoryId);
    if (categoryIndex < 0) return;
    const targetIndex = direction === 'up' ? categoryIndex - 1 : categoryIndex + 1;
    if (targetIndex < 0 || targetIndex >= categoryMaster.length) return;
    const nextOrder = [...categoryMaster];
    const [category] = nextOrder.splice(categoryIndex, 1);
    if (!category) return;
    nextOrder.splice(targetIndex, 0, category);
    await runImmediateOperation({
      actionKey: 'category.reorder',
      execute: () =>
        reorderCategories(
          nextOrder.map((item, index) => ({ id: item.id, position: index })),
          { notifyOnError: false },
        ),
    });
    await loadSnapshotSilently(selectedView);
  };

  const renameCategory = async (name: string) => {
    if (!activeRenameCategory) return;
    await runImmediateOperation({
      actionKey: 'category.update',
      execute: () => patchCategory(activeRenameCategory.id, { name }, { notifyOnError: false }),
    });
    await loadSnapshotSilently(selectedView);
  };

  const handleDeleteCategory = async (categoryId: string) => {
    await runImmediateOperation({
      actionKey: 'category.delete',
      execute: () => deleteCategory(categoryId, { notifyOnError: false }),
    });
    await loadSnapshotSilently(selectedView);
  };

  const moveFeedToCategory = async (feedId: string, categoryId: string | null, _categoryName: string) => {
    await runImmediateOperation({
      actionKey: 'feed.moveToCategory',
      context: { categoryName: _categoryName },
      execute: () => updateFeed(feedId, { categoryId }),
    });
  };

  const toggleFilteredArticlesVisibility = async (feedId: string) => {
    toggleShowFilteredForFeed(feedId);
    if (selectedView !== feedId) return;
    try { await loadSnapshot({ view: feedId }); } catch { /* silent */ }
  };

  const handleToggleFeedEnabled = (feedId: string, enabled: boolean) => {
    void (async () => {
      try {
        await runImmediateOperation({
          actionKey: enabled ? 'feed.disable' : 'feed.enable',
          execute: () => updateFeed(feedId, { enabled: !enabled }),
        });
      } catch { /* notifier handles toast */ }
    })();
  };

  const handleDeleteFeedConfirm = () => {
    if (!deleteFeedId) return;
    void (async () => {
      try {
        await runImmediateOperation({
          actionKey: 'feed.delete',
          execute: () => removeFeed(deleteFeedId),
        });
        setDeleteFeedId(null);
      } catch { /* notifier handles toast */ }
    })();
  };

  const handleDeleteCategoryConfirm = () => {
    if (!deleteCategoryId) return;
    void handleDeleteCategory(deleteCategoryId);
    setDeleteCategoryId(null);
  };

  return (
    <>
      <div className="flex h-full flex-col dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-card)_34%,transparent),transparent)]">
        <FeedListHeader
          reserveCloseButtonSpace={reserveCloseButtonSpace}
          addMenuOpen={addMenuOpen}
          onAddMenuOpenChange={setAddMenuOpen}
          onAddFeed={() => setAddFeedOpen(true)}
          onAddAiDigest={() => setAddAiDigestOpen(true)}
          onOpenDiscover={handleOpenDiscover}
          onAddGithub={onAddGithub}
        />

        {/* 最左侧边栏顶部导航：一级来源轨道 + 二级内容视图轨道（可滚动 / 可拖拽排序） */}
        <FeedRailTabs
          activeRailTab={activeRailTab}
          activeViewTabId={activeViewTabId}
          viewTabCounts={viewTabCounts}
          unreadBadgeClassName={LEFT_RAIL_UNREAD_BADGE_CLASS_NAME}
          onSelectRailTab={handleRailTabChange}
          onSelectViewTab={handleViewTabChange}
        />

        {activeRailTab === 'workbench' ? (
          <WorkbenchMenu activeTab={workbenchTab} onSelectTab={handleWorkbenchMenuTabChange} />
        ) : (
          <>
            <FeedListNav
              unreadBadgeClassName={LEFT_RAIL_UNREAD_BADGE_CLASS_NAME}
              renderedSelectedView={renderedSelectedView}
              starredArticleCount={starredArticleCount}
              onSelectView={setSelectedView}
            />

            <FeedTree
              appCategories={appCategories}
              categoryMaster={categoryMaster}
              renderedSelectedView={renderedSelectedView}
              activeViewTabName={activeViewTabName}
              visibleFeeds={visibleFeeds}
              showFilteredByFeedId={showFilteredByFeedId}
              hoveredFeedErrorId={hoveredFeedErrorId}
              onToggleCategory={toggleCategory}
              onCategoryKeyDown={handleCategoryKeyDown}
              onSelectView={setSelectedView}
              onSetRenameCategoryId={setRenameCategoryId}
              onSetDeleteCategoryId={setDeleteCategoryId}
              onSetEditFeedId={setEditFeedId}
              onSetEditAiDigestFeedId={setEditAiDigestFeedId}
              onSetDeleteFeedId={setDeleteFeedId}
              onSetFulltextPolicyFeedId={setFulltextPolicyFeedId}
              onSetSummaryPolicyFeedId={setSummaryPolicyFeedId}
              onSetTranslationPolicyFeedId={setTranslationPolicyFeedId}
              onMoveCategory={moveCategory}
              onMoveFeedToCategory={moveFeedToCategory}
              onToggleFilteredArticlesVisibility={toggleFilteredArticlesVisibility}
              onToggleFeedEnabled={handleToggleFeedEnabled}
              onHoveredFeedErrorChange={setHoveredFeedErrorId}
            />
          </>
        )}

        <FeedListFooter onOpenSettings={onOpenSettings} />
      </div>

      <FeedDialogsHost
        categoryMaster={categoryMaster}
        feeds={feeds}
        addFeedOpen={addFeedOpen}
        onAddFeedOpenChange={handleAddFeedDialogClose}
        presetFeedUrl={presetFeedUrl}
        presetFeedTitle={presetFeedTitle}
        onAddFeed={(payload) => addFeed(payload)}
        addAiDigestOpen={addAiDigestOpen}
        onAddAiDigestOpenChange={setAddAiDigestOpen}
        editFeedId={editFeedId}
        onEditFeedClose={() => setEditFeedId(null)}
        onEditFeedSubmit={(payload) =>
          updateFeed(editFeedId!, payload, { syncInBackground: true, refreshAfterSave: true })
        }
        editAiDigestFeedId={editAiDigestFeedId}
        onEditAiDigestClose={() => setEditAiDigestFeedId(null)}
        activeRenameCategory={activeRenameCategory}
        onRenameCategoryClose={() => setRenameCategoryId(null)}
        onRenameCategorySubmit={renameCategory}
        summaryPolicyFeedId={summaryPolicyFeedId}
        onSummaryPolicyClose={() => setSummaryPolicyFeedId(null)}
        onSummaryPolicySubmit={async (patch) => {
          if (!summaryPolicyFeedId) return;
          await updateFeed(summaryPolicyFeedId, patch);
        }}
        fulltextPolicyFeedId={fulltextPolicyFeedId}
        onFulltextPolicyClose={() => setFulltextPolicyFeedId(null)}
        onFulltextPolicySubmit={async (patch) => {
          if (!fulltextPolicyFeedId) return;
          await updateFeed(fulltextPolicyFeedId, patch);
        }}
        translationPolicyFeedId={translationPolicyFeedId}
        onTranslationPolicyClose={() => setTranslationPolicyFeedId(null)}
        onTranslationPolicySubmit={async (patch) => {
          if (!translationPolicyFeedId) return;
          await updateFeed(translationPolicyFeedId, patch);
        }}
        deleteFeedId={deleteFeedId}
        onDeleteFeedClose={() => setDeleteFeedId(null)}
        onDeleteFeedConfirm={handleDeleteFeedConfirm}
        deleteCategoryId={deleteCategoryId}
        onDeleteCategoryClose={() => setDeleteCategoryId(null)}
        onDeleteCategoryConfirm={handleDeleteCategoryConfirm}
      />
    </>
  );
}
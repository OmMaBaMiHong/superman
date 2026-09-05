import dynamic from 'next/dynamic';
import { ChevronLeft, PanelLeft, Search, Settings as SettingsIcon } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import ArticleList from '../../articles/components/ArticleList';
import ArticleView, { dispatchReaderArticleCommand } from '../../articles/components/ArticleView';
import FeedList from '../../feeds/components/FeedList';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import ResizeHandle from './ResizeHandle';
import GlobalSearchDialog from './GlobalSearchDialog';
import ReaderContentPage from './ReaderContentPage';
import { getSelectedArticleFromState, useAppStore } from '../../../store/appStore';
import { useSettingsStore } from '../../../store/settingsStore';
import type { ViewType } from '../../../types';
import type { SettingsSectionKey } from '../../settings/components/SettingsCenterDrawer';
import { toast } from '@/features/toast/toast';
import { runImmediateFailure, runImmediateSuccess } from '@/features/notifications/userOperationNotifier';
import {
  getOAuthProviderMeta,
  isOAuthCallbackOutcome,
  resolveOAuthCallbackReason,
} from '@/features/oauth/utils/oauthProviderMeta';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  FROSTED_HEADER_CLASS_NAME,
  READER_FEED_DRAWER_SHEET_CLASS_NAME,
  READER_TABLET_ARTICLE_PANE_CLASS_NAME,
} from '@/lib/ui/designSystem';
import { cn } from '@/lib/utils';
import {
  AI_DIGEST_VIEW_ID,
  isReaderContentPageView,
  PUBLISH_CENTER_VIEW_ID,
  VIDEO_VIEW_ID,
} from '@/lib/reader/view';
import {
  normalizeReaderPaneWidth,
  READER_LEFT_PANE_MAX_WIDTH,
  READER_LEFT_PANE_MIN_WIDTH,
  READER_MIDDLE_PANE_MAX_WIDTH,
  READER_MIDDLE_PANE_MIN_WIDTH,
  READER_RESIZE_DESKTOP_MIN_WIDTH,
  READER_RIGHT_PANE_MIN_WIDTH,
  READER_TABLET_MIN_WIDTH,
} from '../utils';

type ResizeTarget = 'left' | 'middle';
const LEFT_RESIZE_PREVIEW_OFFSET_VARIABLE = '--reader-left-resize-preview-offset';
const MIDDLE_RESIZE_PREVIEW_OFFSET_VARIABLE = '--reader-middle-resize-preview-offset';
const MOBILE_SMART_VIEW_LABELS: Record<string, string> = {
  all: '全部文章',
  unread: '未读文章',
  starred: '收藏文章',
  'ai-digest': '智能报告',
  [PUBLISH_CENTER_VIEW_ID]: '工作台',
};
const GLOBAL_SEARCH_SHORTCUT_KEY = 'f';
const READER_VIEW_SHORTCUTS: Record<string, ViewType> = {
  a: 'all',
  u: AI_DIGEST_VIEW_ID,
  s: 'starred',
};
const READER_SHORTCUT_GROUPS: Array<{
  title: string;
  shortcuts: Array<{ keys: string[]; label: string }>;
}> = [
  {
    title: '导航',
    shortcuts: [
      { keys: ['j', 'n'], label: '下一篇文章' },
      { keys: ['k', 'p'], label: '上一篇文章' },
      { keys: ['g', 'a'], label: '全部文章' },
      { keys: ['g', 'u'], label: '智能报告' },
      { keys: ['g', 's'], label: '收藏文章' },
    ],
  },
  {
    title: '操作',
    shortcuts: [
      { keys: ['m'], label: '标记当前文章为已读' },
      { keys: ['s'], label: '收藏或取消收藏' },
      { keys: ['a'], label: '生成摘要' },
      { keys: ['t'], label: '翻译文章' },
      { keys: ['r'], label: '刷新当前视图' },
      { keys: ['u'], label: '切换中栏未读过滤' },
      { keys: ['/'], label: '全局搜索' },
      { keys: ['['], label: '折叠或展开侧栏' },
    ],
  },
  {
    title: '帮助',
    shortcuts: [
      { keys: ['?'], label: '显示键盘快捷键' },
      { keys: ['Esc'], label: '关闭快捷键帮助' },
    ],
  },
];

function isEditableShortcutTarget(target: EventTarget | null) {
  let currentNode = target instanceof Node ? target : null;

  while (currentNode) {
    if (currentNode instanceof HTMLElement) {
      const contentEditable = currentNode.getAttribute('contenteditable');
      if (
        currentNode.isContentEditable ||
        currentNode.contentEditable === 'true' ||
        currentNode.contentEditable === 'plaintext-only' ||
        contentEditable === '' ||
        contentEditable === 'true' ||
        currentNode.tagName === 'INPUT' ||
        currentNode.tagName === 'TEXTAREA' ||
        currentNode.tagName === 'SELECT'
      ) {
        return true;
      }
    }

    currentNode = currentNode.parentNode;
  }

  return false;
}

function hasActiveDialogOutsideShortcutHelp() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  return dialogs.some((dialog) => dialog.dataset.readerShortcutHelp !== 'true');
}

function getNextReaderArticleId(input: {
  articles: Array<{ id: string }>;
  selectedArticleId: string | null;
  direction: 1 | -1;
}) {
  const { articles, selectedArticleId, direction } = input;
  if (articles.length === 0) return null;

  const currentIndex = selectedArticleId
    ? articles.findIndex((article) => article.id === selectedArticleId)
    : -1;

  if (currentIndex < 0) {
    return articles[0]?.id ?? null;
  }

  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), articles.length - 1);
  return articles[nextIndex]?.id ?? null;
}

function isShortcutHelpKey(event: KeyboardEvent) {
  return event.key === '?' || (event.shiftKey && event.key === '/');
}

function renderShortcutKeys(shortcut: { keys: string[]; label: string }) {
  return shortcut.keys.map((key) => (
    <kbd
      key={`${shortcut.label}-${key}`}
      className="min-w-6 rounded-md border border-border/75 bg-muted/70 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-5 text-foreground shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]"
    >
      {key}
    </kbd>
  ));
}

function focusReaderArticleButton(articleId: string) {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[data-article-nav="true"]'),
  );
  const button = buttons.find((item) => item.dataset.articleId === articleId);
  button?.focus();
}

const MemoizedFeedList = memo(FeedList);
const MemoizedArticleList = memo(ArticleList);
const MemoizedArticleView = memo(ArticleView);
const SettingsCenterModal = dynamic(() => import('../../settings/components/SettingsCenterModal'), {
  ssr: false,
  loading: () => null,
});

interface ReaderLayoutProps {
  renderedAt?: string;
  initialSelectedView?: ViewType;
}

export default function ReaderLayout({ renderedAt, initialSelectedView }: ReaderLayoutProps = {}) {
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const selectedView = useAppStore((state) => state.selectedView);
  const selectedArticleId = useAppStore((state) => state.selectedArticleId);
  const feeds = useAppStore((state) => state.feeds);
  const selectedFeedView = useAppStore(
    (state) => state.feeds.find((feed) => feed.id === state.selectedView)?.view ?? null,
  );
  const setSelectedArticle = useAppStore((state) => state.setSelectedArticle);
  const setSelectedView = useAppStore((state) => state.setSelectedView);
  const general = useSettingsStore((state) => state.persistedSettings.general);
  const updateReaderLayoutSettings = useSettingsStore((state) => state.updateReaderLayoutSettings);
  const selectedArticleTitle = useAppStore(
    (state) => getSelectedArticleFromState(state)?.title ?? '',
  );
  const selectedViewLabel = useAppStore((state) => {
    if (MOBILE_SMART_VIEW_LABELS[state.selectedView]) {
      return MOBILE_SMART_VIEW_LABELS[state.selectedView];
    }

    return state.feeds.find((feed) => feed.id === state.selectedView)?.title ?? '订阅视图';
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionKey>('general');
  const openSettings = useCallback((section?: SettingsSectionKey) => {
    setSettingsInitialSection(section ?? 'general');
    setSettingsOpen(true);
  }, []);

  // 三方授权回调结果消费（docs/arch-oauth-hub.md §3.3）：
  // 平台 302 回站时带 ?settings=oauth&oauth=success|denied|failed&provider=...&reason=...，
  // 挂载时读取一次 → 打开「三方授权」分区 + 对应 toast → 清理 query（防刷新重复提示）。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('settings') !== 'oauth') {
      return;
    }

    const outcome = params.get('oauth');
    const provider = params.get('provider');
    if (!isOAuthCallbackOutcome(outcome)) {
      return;
    }

    const displayName = getOAuthProviderMeta(provider ?? '')?.displayName ?? provider ?? '';

    if (outcome === 'success') {
      runImmediateSuccess({ actionKey: 'oauth.authorize.result', context: { displayName } });
    } else if (outcome === 'denied') {
      // 用户主动取消不是错误：弹中性提示而非红色报错（路由侧同语义）。
      toast.info('你在平台侧取消了授权');
    } else {
      runImmediateFailure({
        actionKey: 'oauth.authorize.result',
        err: resolveOAuthCallbackReason(params.get('reason')),
        context: { displayName },
      });
    }

    openSettings('oauth');

    // 清理 query，避免刷新页面后重复弹提示。
    const url = new URL(window.location.href);
    url.searchParams.delete('settings');
    url.searchParams.delete('oauth');
    url.searchParams.delete('provider');
    url.searchParams.delete('reason');
    window.history.replaceState({}, '', url.toString());
  }, [openSettings]);

  // 移动端 tab bar 跨页入口：从 /governance、/trending 点「设置」跳回 `/?settings=open`，
  // 挂载时消费一次 → 打开设置抽屉 → 清理 query（异步调度，避免 effect 内同步 setState）。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('settings') !== 'open') {
      return undefined;
    }

    const timer = window.setTimeout(() => openSettings(), 0);

    const url = new URL(window.location.href);
    url.searchParams.delete('settings');
    window.history.replaceState({}, '', url.toString());
    return () => window.clearTimeout(timer);
  }, [openSettings]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [activeSearchHighlightQuery, setActiveSearchHighlightQuery] = useState('');
  const selectionKey = `${selectedView}:${selectedArticleId ?? ''}`;
  const [feedSheetState, setFeedSheetState] = useState(() => ({
    open: false,
    selectionKey,
  }));
  const [viewportWidth, setViewportWidth] = useState<number>(READER_RESIZE_DESKTOP_MIN_WIDTH);
  const [visibleResizeTarget, setVisibleResizeTarget] = useState<ResizeTarget | null>(null);
  const [draggingTarget, setDraggingTarget] = useState<ResizeTarget | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const liveLeftPaneWidthRef = useRef(general.leftPaneWidth);
  const liveMiddlePaneWidthRef = useRef(general.middlePaneWidth);
  const dragStateRef = useRef<
    | {
        target: ResizeTarget;
        startX: number;
        startLeftPaneWidth: number;
        startMiddlePaneWidth: number;
      }
    | null
  >(null);
  const pendingGoShortcutRef = useRef(false);

  const isDesktop = viewportWidth >= READER_RESIZE_DESKTOP_MIN_WIDTH;
  const isTablet =
    viewportWidth >= READER_TABLET_MIN_WIDTH && viewportWidth < READER_RESIZE_DESKTOP_MIN_WIDTH;
  const isMobile = viewportWidth < READER_TABLET_MIN_WIDTH;
  const feedSheetOpen = !isDesktop && feedSheetState.open && feedSheetState.selectionKey === selectionKey;
  const leftPaneWidth = sidebarCollapsed ? 0 : general.leftPaneWidth;
  const middlePaneWidth = general.middlePaneWidth;
  const isMediaReaderView =
    selectedView === VIDEO_VIEW_ID ||
    selectedFeedView === 'video' ||
    selectedFeedView === 'picture';
  const expandMediaListPane = isDesktop && isMediaReaderView && !selectedArticleId;
  const mobileHeading = selectedArticleId ? selectedArticleTitle || '阅读文章' : selectedViewLabel;
  const mobileSurfaceClassName = cn(
    'overflow-hidden border border-border/60 bg-[color-mix(in_oklab,var(--color-background)_86%,white_14%)] shadow-none supports-[backdrop-filter]:bg-[color-mix(in_oklab,var(--color-background)_78%,white_22%)]',
    'dark:border-white/[0.06] dark:bg-card/92 dark:supports-[backdrop-filter]:bg-card/81',
  );

  const setResizePreviewOffset = useCallback((target: ResizeTarget, offset: number) => {
    const layout = layoutRef.current;
    if (!layout) {
      return;
    }

    layout.style.setProperty(
      target === 'left'
        ? LEFT_RESIZE_PREVIEW_OFFSET_VARIABLE
        : MIDDLE_RESIZE_PREVIEW_OFFSET_VARIABLE,
      `${offset}px`,
    );
  }, []);

  const resetResizePreviewOffsets = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) {
      return;
    }

    layout.style.setProperty(LEFT_RESIZE_PREVIEW_OFFSET_VARIABLE, '0px');
    layout.style.setProperty(MIDDLE_RESIZE_PREVIEW_OFFSET_VARIABLE, '0px');
  }, []);

  const clearDraggingState = useCallback(() => {
    dragStateRef.current = null;
    setDraggingTarget(null);
    setVisibleResizeTarget(null);
    resetResizePreviewOffsets();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [resetResizePreviewOffsets]);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      if (dragState.target === 'left') {
        const nextWidth = normalizeReaderPaneWidth(
          dragState.startLeftPaneWidth + (event.clientX - dragState.startX),
          dragState.startLeftPaneWidth,
          READER_LEFT_PANE_MIN_WIDTH,
          READER_LEFT_PANE_MAX_WIDTH,
        );

        liveLeftPaneWidthRef.current = nextWidth;
        setResizePreviewOffset('left', nextWidth - dragState.startLeftPaneWidth);
        return;
      }

      const layoutWidth = layoutRef.current?.clientWidth ?? 0;
      const effectiveLeftPaneWidth = sidebarCollapsed ? 0 : liveLeftPaneWidthRef.current;
      const maxMiddlePaneWidth = Math.min(
        READER_MIDDLE_PANE_MAX_WIDTH,
        Math.max(
          READER_MIDDLE_PANE_MIN_WIDTH,
          layoutWidth - effectiveLeftPaneWidth - READER_RIGHT_PANE_MIN_WIDTH,
        ),
      );
      const nextWidth = normalizeReaderPaneWidth(
        dragState.startMiddlePaneWidth + (event.clientX - dragState.startX),
        dragState.startMiddlePaneWidth,
        READER_MIDDLE_PANE_MIN_WIDTH,
        maxMiddlePaneWidth,
      );

      liveMiddlePaneWidthRef.current = nextWidth;
      setResizePreviewOffset('middle', nextWidth - dragState.startMiddlePaneWidth);
    },
    [setResizePreviewOffset, sidebarCollapsed],
  );

  const handlePointerUp = useCallback(() => {
    const dragState = dragStateRef.current;

    if (dragState?.target === 'left') {
      updateReaderLayoutSettings({ leftPaneWidth: liveLeftPaneWidthRef.current });
    }

    if (dragState?.target === 'middle') {
      updateReaderLayoutSettings({ middlePaneWidth: liveMiddlePaneWidthRef.current });
    }

    window.removeEventListener('pointermove', handlePointerMove);
    clearDraggingState();
  }, [clearDraggingState, handlePointerMove, updateReaderLayoutSettings]);

  useLayoutEffect(() => {
    const handleResize = () => {
      const nextWidth = window.innerWidth;
      setViewportWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));

      if (nextWidth < READER_RESIZE_DESKTOP_MIN_WIDTH) {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        clearDraggingState();
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [clearDraggingState, handlePointerMove, handlePointerUp]);

  useEffect(() => {
    // 阅读器级快捷键集中在布局层，避免不同面板重复抢键盘事件。
    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();
      const commandOrControlSearch =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        normalizedKey === GLOBAL_SEARCH_SHORTCUT_KEY;

      if (!commandOrControlSearch && (event.metaKey || event.ctrlKey)) {
        return;
      }

      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      if (shortcutHelpOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShortcutHelpOpen(false);
        }
        return;
      }

      if (hasActiveDialogOutsideShortcutHelp()) {
        return;
      }

      if (commandOrControlSearch) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.shiftKey && !isShortcutHelpKey(event)) {
        return;
      }

      const state = useAppStore.getState();

      if (pendingGoShortcutRef.current) {
        pendingGoShortcutRef.current = false;
        const nextView = READER_VIEW_SHORTCUTS[normalizedKey];
        if (!nextView) {
          return;
        }

        event.preventDefault();
        state.setSelectedView(nextView);
        return;
      }

      if (normalizedKey === 'g') {
        event.preventDefault();
        pendingGoShortcutRef.current = true;
        return;
      }

      const selectArticleByDirection = (direction: 1 | -1) => {
        const nextArticleId = getNextReaderArticleId({
          articles: state.articles,
          selectedArticleId: state.selectedArticleId,
          direction,
        });

        if (!nextArticleId || nextArticleId === state.selectedArticleId) {
          return;
        }

        event.preventDefault();
        state.setSelectedArticle(nextArticleId);
        // 全局 j/k 导航也要同步焦点，否则旧文章会保留 focus-visible 边框。
        focusReaderArticleButton(nextArticleId);
      };

      if (isShortcutHelpKey(event)) {
        event.preventDefault();
        setShortcutHelpOpen(true);
        return;
      }

      if (normalizedKey === '/') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (normalizedKey === 'j' || normalizedKey === 'n') {
        selectArticleByDirection(1);
        return;
      }

      if (normalizedKey === 'k' || normalizedKey === 'p') {
        selectArticleByDirection(-1);
        return;
      }

      if (normalizedKey === 'm') {
        if (!state.selectedArticleId) return;
        event.preventDefault();
        state.markAsRead(state.selectedArticleId);
        return;
      }

      if (normalizedKey === 's') {
        if (!state.selectedArticleId) return;
        event.preventDefault();
        state.toggleStar(state.selectedArticleId);
        return;
      }

      if (normalizedKey === 'a') {
        if (!state.selectedArticleId) return;
        event.preventDefault();
        dispatchReaderArticleCommand('ai-summary');
        return;
      }

      if (normalizedKey === 't') {
        if (!state.selectedArticleId) return;
        event.preventDefault();
        dispatchReaderArticleCommand('ai-translate');
        return;
      }

      if (normalizedKey === 'u') {
        event.preventDefault();
        state.toggleShowUnreadOnly();
        return;
      }

      if (normalizedKey === 'r') {
        event.preventDefault();
        void state.loadSnapshot({ view: state.selectedView });
        return;
      }

      if (event.key === '[') {
        event.preventDefault();
        state.toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
    };
  }, [shortcutHelpOpen]);

  const isResizeTargetActive = (target: ResizeTarget) => visibleResizeTarget === target;

  const handleResizeHandleEnter = (target: ResizeTarget) => {
    if (draggingTarget !== null) {
      return;
    }

    setVisibleResizeTarget(target);
  };

  const handleResizeHandleLeave = (target: ResizeTarget) => {
    if (draggingTarget !== null) {
      return;
    }

    setVisibleResizeTarget((current) => (current === target ? null : current));
  };

  const startLeftResize: React.PointerEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    resetResizePreviewOffsets();
    liveLeftPaneWidthRef.current = general.leftPaneWidth;
    liveMiddlePaneWidthRef.current = general.middlePaneWidth;
    dragStateRef.current = {
      target: 'left',
      startX: event.clientX,
      startLeftPaneWidth: general.leftPaneWidth,
      startMiddlePaneWidth: general.middlePaneWidth,
    };
    setDraggingTarget('left');
    setVisibleResizeTarget('left');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const startMiddleResize: React.PointerEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    resetResizePreviewOffsets();
    liveLeftPaneWidthRef.current = general.leftPaneWidth;
    liveMiddlePaneWidthRef.current = general.middlePaneWidth;
    dragStateRef.current = {
      target: 'middle',
      startX: event.clientX,
      startLeftPaneWidth: general.leftPaneWidth,
      startMiddlePaneWidth: general.middlePaneWidth,
    };
    setDraggingTarget('middle');
    setVisibleResizeTarget('middle');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  return (
    <div
      ref={layoutRef}
      data-testid="reader-layout-root"
      className={cn(
        'relative flex h-screen flex-col overflow-hidden bg-background text-foreground dark:bg-[radial-gradient(ellipse_at_top,var(--color-popover)_0%,var(--color-background)_48%,color-mix(in_oklab,var(--color-background)_70%,black_30%)_100%)]',
      )}
    >
      {isDesktop ? (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          <div
            data-testid="reader-feed-pane"
            className={cn(
              'glass-surface-strong shrink-0 overflow-hidden rounded-none border-r transition-colors duration-200',
              isResizeTargetActive('left') ? 'border-primary/60' : '',
            )}
            style={{ width: `${leftPaneWidth}px` }}
          >
            <MemoizedFeedList
            initialSelectedView={initialSelectedView}
            onOpenSettings={openSettings}
            onAddGithub={() => openSettings('github')}
          />
          </div>

          <ResizeHandle
            testId="reader-resize-handle-left"
            active={isResizeTargetActive('left')}
            dragging={draggingTarget === 'left'}
            previewOffsetVariable={LEFT_RESIZE_PREVIEW_OFFSET_VARIABLE}
            onPointerDown={startLeftResize}
            onPointerEnter={() => handleResizeHandleEnter('left')}
            onPointerLeave={() => handleResizeHandleLeave('left')}
          />

          {isReaderContentPageView(selectedView) ? (
            /* 内容页视图：中栏+右栏合并为一个可滚动面板（左栏永在） */
            <div
              data-testid="reader-content-pane"
              className="glass-surface-light min-w-0 flex-1 overflow-hidden rounded-none"
            >
              <ReaderContentPage view={selectedView} />
            </div>
          ) : (
            <>
              <div
                data-testid="reader-article-pane"
                className={cn(
                  'glass-surface-light transition-colors duration-200',
                  expandMediaListPane
                    ? 'min-w-0 flex-1'
                    : cn(
                        'shrink-0',
                        isResizeTargetActive('middle') ? 'border-primary/60' : '',
                      ),
                )}
                style={expandMediaListPane ? undefined : { width: `${middlePaneWidth}px` }}
              >
                <MemoizedArticleList
                  key={selectedView}
                  renderedAt={renderedAt}
                  initialSelectedView={initialSelectedView}
                />
              </div>

              {!expandMediaListPane ? (
                <>
                  <ResizeHandle
                    testId="reader-resize-handle-middle"
                    active={isResizeTargetActive('middle')}
                    dragging={draggingTarget === 'middle'}
                    previewOffsetVariable={MIDDLE_RESIZE_PREVIEW_OFFSET_VARIABLE}
                    onPointerDown={startMiddleResize}
                    onPointerEnter={() => handleResizeHandleEnter('middle')}
                    onPointerLeave={() => handleResizeHandleLeave('middle')}
                  />

                  <div className="glass-surface-light relative flex-1 overflow-hidden">
                    <MemoizedArticleView
                      renderedAt={renderedAt}
                      highlightQuery={activeSearchHighlightQuery}
                      onOpenSearch={() => setSearchOpen(true)}
                    />
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--color-primary)_14%,transparent),transparent_72%)] dark:bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--color-primary)_20%,transparent),transparent_72%)]" />

            <div className="relative flex h-full min-h-0 flex-col">
              <div
                data-testid="reader-non-desktop-topbar"
                className={cn(
                  'flex h-14 shrink-0 items-center gap-2 border-b px-2.5 sm:px-3',
                  FROSTED_HEADER_CLASS_NAME,
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={isMobile && selectedArticleId ? '返回文章列表' : '打开订阅源列表'}
                  className="h-9 w-9 shrink-0 rounded-full"
                  onClick={() => {
                    if (isMobile && selectedArticleId) {
                      setSelectedArticle(null);
                      return;
                    }

                    setFeedSheetState({
                      open: true,
                      selectionKey,
                    });
                  }}
                >
                  {isMobile && selectedArticleId ? (
                    <ChevronLeft className="h-4 w-4" />
                  ) : (
                    <PanelLeft className="h-4 w-4" />
                  )}
                </Button>

                <div className="min-w-0 flex-1 px-1 text-center">
                  <h1 className="truncate text-sm font-semibold text-foreground sm:text-[15px]">
                    {mobileHeading}
                  </h1>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="打开全局搜索"
                    className="h-9 w-9 rounded-full"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="打开设置"
                    className="h-9 w-9 rounded-full"
                    onClick={() => openSettings()}
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {isReaderContentPageView(selectedView) ? (
                /* 内容页视图：平板/移动在内容区渲染同一内容页面板（左栏经抽屉保留） */
                <div
                  data-testid="reader-mobile-content-pane"
                  className={cn(
                    'min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-3 sm:px-4 sm:pb-4',
                    // 手机端为底部 tab bar 留出空间
                    isMobile && 'pb-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)]',
                  )}
                >
                  <div
                    className={cn(
                      'h-full overflow-hidden rounded-[1.5rem]',
                      mobileSurfaceClassName,
                    )}
                  >
                    <ReaderContentPage view={selectedView} />
                  </div>
                </div>
              ) : isTablet ? (
                <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
                  <div
                    data-testid="reader-tablet-article-pane"
                    className={cn(
                      READER_TABLET_ARTICLE_PANE_CLASS_NAME,
                      'overflow-hidden rounded-[1.5rem] border border-border/70 shadow-none',
                    )}
                  >
                    <MemoizedArticleList
                      key={selectedView}
                      renderedAt={renderedAt}
                      initialSelectedView={initialSelectedView}
                    />
                  </div>

                  <div
                    className={cn(
                      'relative min-w-0 flex-1 rounded-[1.5rem]',
                      mobileSurfaceClassName,
                    )}
                  >
                    <MemoizedArticleView
                      renderedAt={renderedAt}
                      highlightQuery={activeSearchHighlightQuery}
                      reserveTopSpace={false}
                    />
                  </div>
                </div>
              ) : (
                <div
                  data-testid="reader-mobile-layout"
                  className="relative min-h-0 flex-1 overflow-hidden"
                >
                  <div
                    className={cn(
                      'h-full min-h-0 bg-background/96 dark:bg-background/97',
                      // 底部 tab bar 占位：避免列表末行/正文被固定导航遮挡
                      'pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
                      selectedArticleId
                        ? 'rounded-none'
                        : 'rounded-t-[1.35rem] border-t border-border/60 dark:border-white/[0.05]',
                    )}
                  >
                    {selectedArticleId ? (
                      <MemoizedArticleView
                        renderedAt={renderedAt}
                        highlightQuery={activeSearchHighlightQuery}
                        reserveTopSpace={false}
                      />
                    ) : (
                      <MemoizedArticleList
                        key={selectedView}
                        renderedAt={renderedAt}
                        initialSelectedView={initialSelectedView}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!isDesktop ? (
        <Sheet
          open={feedSheetOpen}
          onOpenChange={(open) =>
            setFeedSheetState((currentState) => ({
              ...currentState,
              open,
            }))
          }
        >
          <SheetContent
            side="left"
            className={READER_FEED_DRAWER_SHEET_CLASS_NAME}
            data-testid="reader-feed-drawer"
            closeLabel="关闭订阅源列表"
            overlayProps={{ 'data-testid': 'reader-feed-drawer-overlay' }}
          >
            <SheetTitle className="sr-only">导航与 RSS 源</SheetTitle>
            <SheetDescription className="sr-only">切换视图、分类和 RSS 源</SheetDescription>
            <MemoizedFeedList
              initialSelectedView={initialSelectedView}
              reserveCloseButtonSpace
            />
          </SheetContent>
        </Sheet>
      ) : null}

      {/* 移动端底部 tab bar（<768px；平板/桌面端由 md:hidden 隐藏，不挂载避免轮询） */}
      {isMobile ? <MobileTabBar onOpenSettings={() => openSettings()} /> : null}

      <GlobalSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelectResult={async (result, query) => {
          setActiveSearchHighlightQuery(query);
          await useAppStore.getState().openArticleInReader({
            view: result.feedId,
            articleId: result.id,
            articleHistory: 'push',
          });
        }}
      />

      <Dialog open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen}>
        <DialogContent
          closeLabel="关闭键盘快捷键"
          className="max-h-[min(86vh,44rem)] max-w-xl overflow-y-auto p-0"
          data-reader-shortcut-help="true"
        >
          <DialogHeader className="border-b border-border/70 px-5 pb-4 pt-5">
            <DialogTitle>键盘快捷键</DialogTitle>
            <DialogDescription>
              常用阅读操作可直接用键盘完成，输入框和弹窗内不会触发这些快捷键。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 px-5 py-5 sm:grid-cols-3">
            {READER_SHORTCUT_GROUPS.map((group) => (
              <section key={group.title} className="min-w-0">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {group.title}
                </h3>
                <dl className="space-y-2.5">
                  {group.shortcuts.map((shortcut) => (
                    <div key={`${group.title}-${shortcut.label}`} className="flex items-start justify-between gap-3">
                      <dt className="flex min-w-0 flex-wrap gap-1">
                        {renderShortcutKeys(shortcut)}
                      </dt>
                      <dd className="min-w-0 flex-1 text-right text-sm leading-6 text-muted-foreground">
                        {shortcut.label}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {settingsOpen && (
        <SettingsCenterModal
          onClose={() => setSettingsOpen(false)}
          initialSection={settingsInitialSection}
        />
      )}
    </div>
  );
}

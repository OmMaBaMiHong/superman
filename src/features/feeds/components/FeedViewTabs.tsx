import type { LucideIcon } from 'lucide-react';
import {
  Clapperboard,
  FileText,
  Github,
  LayoutDashboard,
  Newspaper,
  Send,
  Sparkles,
} from 'lucide-react';
import type { Feed, FeedContentView, ViewType } from '@/types';
import {
  AI_DIGEST_VIEW_ID,
  ARTICLE_VIEW_ID,
  GITHUB_VIEW_ID,
  OVERVIEW_VIEW_ID,
  PUBLISH_CENTER_VIEW_ID,
  VIDEO_VIEW_ID,
} from '@/lib/reader/view';

export type FeedViewTabId =
  | 'all'
  | typeof OVERVIEW_VIEW_ID
  | typeof ARTICLE_VIEW_ID
  | typeof VIDEO_VIEW_ID
  | typeof AI_DIGEST_VIEW_ID
  | typeof GITHUB_VIEW_ID
  | typeof PUBLISH_CENTER_VIEW_ID;

export type FeedViewTabCountMap = Record<FeedViewTabId, number>;

interface FeedViewTabItem {
  id: FeedViewTabId;
  name: string;
  Icon: LucideIcon;
}

export const FEED_VIEW_TAB_ITEMS: FeedViewTabItem[] = [
  // 总览是登录后的门户视图，固定排在轨道第一位。
  { id: OVERVIEW_VIEW_ID, name: '总览', Icon: LayoutDashboard },
  { id: 'all', name: '全部', Icon: Newspaper },
  { id: ARTICLE_VIEW_ID, name: '图文', Icon: FileText },
  { id: VIDEO_VIEW_ID, name: '视频', Icon: Clapperboard },
  { id: PUBLISH_CENTER_VIEW_ID, name: '工作台', Icon: Send },
  { id: AI_DIGEST_VIEW_ID, name: '智能报告', Icon: Sparkles },
  { id: GITHUB_VIEW_ID, name: 'GitHub', Icon: Github },
];

export function getContentViewForTab(tabId: FeedViewTabId): FeedContentView | null {
  switch (tabId) {
    case ARTICLE_VIEW_ID:
      return 'article';
    case VIDEO_VIEW_ID:
      return 'video';
    case AI_DIGEST_VIEW_ID:
      return 'digest';
    case GITHUB_VIEW_ID:
      return 'github';
    // 内容页视图与 'all' 同语义：不映射任何 FeedContentView，
    // FeedList 的 visibleFeeds 因此自然为空。
    case 'all':
    case OVERVIEW_VIEW_ID:
    case PUBLISH_CENTER_VIEW_ID:
      return null;
  }
}

export function getTabForContentView(view: FeedContentView | null | undefined): FeedViewTabId {
  switch (view) {
    case 'video':
      return VIDEO_VIEW_ID;
    case 'digest':
      return AI_DIGEST_VIEW_ID;
    case 'github':
      return GITHUB_VIEW_ID;
    case 'article':
    default:
      return ARTICLE_VIEW_ID;
  }
}

export function isFeedViewTabId(view: ViewType): view is FeedViewTabId {
  return FEED_VIEW_TAB_ITEMS.some((item) => item.id === view);
}

/**
 * 把任意选中视图映射为顶部导航轨道的高亮 Tab：
 * - 内容页 / 智能视图 Tab 直接命中；
 * - starred 视为「全部」聚合；
 * - 具体订阅源按其 kind / view 归属对应 Tab（ai_digest → 智能报告）。
 * FeedList（侧边栏）与 ReaderLayout（顶部轨道）共用，保证高亮一致。
 */
export function getActiveViewTabId(view: ViewType, feeds: ReadonlyArray<Feed>): FeedViewTabId {
  if (isFeedViewTabId(view)) {
    return view;
  }
  if (view === 'starred') {
    return 'all';
  }
  const activeFeed = feeds.find((feed) => feed.id === view);
  if (!activeFeed) return 'all';
  if ((activeFeed.kind ?? 'rss') === 'ai_digest') return AI_DIGEST_VIEW_ID;
  return getTabForContentView(activeFeed.view ?? 'article');
}

/**
 * 汇总各 Tab 未读数（从 feeds 推导，供顶部导航轨道 Badge 使用）。
 * 逻辑与 FeedList 原先的 viewTabCounts 完全一致，现提升到轨道层。
 */
export function buildViewTabCounts(feeds: ReadonlyArray<Feed>): FeedViewTabCountMap {
  const counts: FeedViewTabCountMap = {
    all: 0,
    [OVERVIEW_VIEW_ID]: 0,
    [ARTICLE_VIEW_ID]: 0,
    [VIDEO_VIEW_ID]: 0,
    [AI_DIGEST_VIEW_ID]: 0,
    [GITHUB_VIEW_ID]: 0,
    [PUBLISH_CENTER_VIEW_ID]: 0,
  };

  for (const feed of feeds) {
    const kind = feed.kind ?? 'rss';
    if (kind === 'ai_digest') {
      counts[AI_DIGEST_VIEW_ID] += feed.unreadCount;
      continue;
    }
    if (kind === 'github') {
      // ADR-04：GitHub 独立 Tab，不混入「全部」聚合计数。
      counts[GITHUB_VIEW_ID] += feed.unreadCount;
      continue;
    }
    counts.all += feed.unreadCount;
    counts[getTabForContentView(feed.view ?? 'article')] += feed.unreadCount;
  }

  return counts;
}

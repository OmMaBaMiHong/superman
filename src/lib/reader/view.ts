import type { FeedContentView } from '@/types';

export const AI_DIGEST_VIEW_ID = 'ai-digest';
/**
 * 总览仪表盘的 view id：登录后的门户视图，同属**内容页视图**。
 *
 * 与 discover / knowledge 同语义：中栏+右栏合并为一个可滚动面板，
 * 数据全部由 `useAppStore` 本地推导，**不走 snapshot API**，
 * 因此只并入 `isReaderContentPageView`，绝不并入 `isAggregateView`。
 * 组件一律引用本常量，禁止字符串字面量。
 */
export const OVERVIEW_VIEW_ID = 'overview';
/**
 * GitHub 独立 Tab 的 view id（ADR-04）。
 *
 * 与 `FeedContentView` 的 `'github'` 取值刻意保持一致：
 * GitHub feed 的 `feeds.view` 就是 `'github'`，左栏 Tab 也用同一个 id，
 * 省掉 ai_digest（view='digest' vs viewId='ai-digest'）那样的映射心智负担。
 */
export const GITHUB_VIEW_ID = 'github';
/**
 * 发布中心内容页视图 id。
 *
 * 与 discover / knowledge 同语义：中栏+右栏合并为一个可滚动面板，
 * 数据走「发布中心」本地 API（转发到随附 Python 发布服务），不走 snapshot API，
 * 因此只并入 `isReaderContentPageView`，绝不并入 `isAggregateView`。
 */
export const PUBLISH_CENTER_VIEW_ID = 'publish-center';
/**
 * 发现页内容页视图 id。
 *
 * 与 overview / publish-center 同语义：中栏+右栏合并为一个可滚动面板，
 * 数据走「发现」推荐接口（/api/feeds/recommended），不走 snapshot API，
 * 因此只并入 `isReaderContentPageView`，绝不并入 `isAggregateView`。
 * 入口在左栏顶部「+」菜单，点击切换到本视图（不再使用弹窗）。
 */
export const DISCOVER_VIEW_ID = 'discover';
export const ARTICLE_VIEW_ID = 'smart-articles';
export const VIDEO_VIEW_ID = 'smart-videos';

export const SMART_MEDIA_VIEW_IDS = [ARTICLE_VIEW_ID, VIDEO_VIEW_ID] as const;

export type SmartMediaViewId = (typeof SMART_MEDIA_VIEW_IDS)[number];

export function isSmartMediaView(view: string): view is SmartMediaViewId {
  return SMART_MEDIA_VIEW_IDS.includes(view as SmartMediaViewId);
}

export function getContentViewForSmartMediaView(view: SmartMediaViewId): FeedContentView {
  switch (view) {
    case ARTICLE_VIEW_ID:
      return 'article';
    case VIDEO_VIEW_ID:
      return 'video';
  }
}

export function isRssSmartView(view: string): boolean {
  return view === 'all' || view === 'unread' || view === 'starred';
}

/**
 * 内容页视图判定：总览 / 工作台（发布中心）/ 发现。
 *
 * 内容页**不走 snapshot API**，明确不并入 `isAggregateView` / `SMART_MEDIA_VIEW_IDS` /
 * `isRssSmartView` —— 并入会触发 `loadSnapshot({ view: 'overview' })` 打到无效接口。
 */
export function isReaderContentPageView(view: string): boolean {
  return (
    view === OVERVIEW_VIEW_ID ||
    view === PUBLISH_CENTER_VIEW_ID ||
    view === DISCOVER_VIEW_ID
  );
}

export function isGithubView(view: string): boolean {
  return view === GITHUB_VIEW_ID;
}

export function isAggregateView(view: string): boolean {
  return (
    isRssSmartView(view) ||
    isSmartMediaView(view) ||
    view === AI_DIGEST_VIEW_ID ||
    isGithubView(view)
  );
}

export function shouldUseDefaultUnreadOnly(view: string): boolean {
  return view !== 'unread' && view !== 'starred';
}

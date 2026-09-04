/**
 * 订阅请求事件桥（arch-ui-integration §1.1.3）。
 *
 * DiscoverPage 与 FeedList 分处不同面板，FeedList 的「预填 AddFeedDialog」流程是内部状态
 * （`presetFeedUrl/presetFeedTitle/addFeedOpen`），不宜把整套 dialog 状态提升到 ReaderLayout。
 *
 * 最小事件桥：
 * - DiscoverPage 侧调用 `requestSubscribeFeed(url, title)` dispatch 自定义事件；
 * - FeedList 侧挂载时监听该事件 → 复用既有 `handleSubscribeFeed`（关推荐弹窗、预填、打开 AddFeedDialog）。
 *
 * 收益：复用左栏完整订阅流（含校验/分类预填），零状态提升；测试可直接 dispatch 事件断言。
 */

export const FEED_SUBSCRIBE_REQUEST_EVENT = 'feedfuse:subscribe-feed-request';

export interface FeedSubscribeRequestDetail {
  url: string;
  title: string;
}

/** 请求左栏 FeedList 预填 AddFeedDialog 并打开。 */
export function requestSubscribeFeed(url: string, title: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<FeedSubscribeRequestDetail>(FEED_SUBSCRIBE_REQUEST_EVENT, {
      detail: { url, title },
    }),
  );
}

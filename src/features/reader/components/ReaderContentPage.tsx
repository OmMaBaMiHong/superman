'use client';

import { useMemo } from 'react';
import {
  DISCOVER_VIEW_ID,
  OVERVIEW_VIEW_ID,
  PUBLISH_CENTER_VIEW_ID,
  isReaderContentPageView,
} from '@/lib/reader/view';
import type { ViewType } from '@/types';
import { useAppStore } from '@/store/appStore';
import OverviewPage from '@/features/overview/components/OverviewPage';
import WorkbenchPage from '@/features/workbench/components/WorkbenchPage';
import DiscoverPage from '@/features/discover/components/DiscoverPage';
import { requestSubscribeFeed } from '@/features/feeds/lib/subscribeFeedBridge';

interface ReaderContentPageProps {
  view: ViewType;
}

/**
 * 阅读器内容页视图面板（arch-ui-integration §3.2）。
 *
 * 当 `selectedView` 为 总览/工作台/发现 时，中栏+右栏合并为一个可滚动面板：
 * - overview  → `<OverviewPage />`
 * - publish-center → `<WorkbenchPage />`
 * - discover → `<DiscoverPage />`（订阅走左栏事件桥 requestSubscribeFeed）
 *
 * 非内容页视图返回 null（由 ReaderLayout 决定是否渲染本组件）。
 */
export default function ReaderContentPage({ view }: ReaderContentPageProps) {
  const feeds = useAppStore((state) => state.feeds);
  // 已订阅 URL 集合：供发现页统计「已订阅源」与按钮态（未订阅时可一键订阅）。
  const existingUrls = useMemo(() => new Set(feeds.map((feed) => feed.url)), [feeds]);

  if (!isReaderContentPageView(view)) {
    return null;
  }

  if (view === OVERVIEW_VIEW_ID) {
    return (
      <div data-testid="reader-content-page" className="h-full min-h-0 overflow-y-auto">
        <OverviewPage />
      </div>
    );
  }

  if (view === PUBLISH_CENTER_VIEW_ID) {
    return (
      <div data-testid="reader-content-page" className="h-full min-h-0 overflow-y-auto">
        <WorkbenchPage />
      </div>
    );
  }

  if (view === DISCOVER_VIEW_ID) {
    return (
      <div data-testid="reader-content-page" className="h-full min-h-0 overflow-y-auto">
        <DiscoverPage onSubscribeFeed={requestSubscribeFeed} existingUrls={existingUrls} />
      </div>
    );
  }

  return null;
}

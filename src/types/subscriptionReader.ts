/** DSH reading data is independent of governance status. */
export interface SubscriptionFeed {
  id: string;
  title: string;
  url: string;
  siteUrl: string | null;
  iconUrl: string | null;
  enabled: boolean;
  lastFetchStatus: number | null;
  lastFetchError: string | null;
  lastFetchedAt: string | null;
  articleCount: number;
  unreadCount: number;
  latestTitle: string | null;
  latestPublishedAt: string | null;
  /** 分类：手动分类名优先，为空时由本地关键词标签库推断（见 core/reader/feedCategory）。 */
  categoryName: string;
  /** Highest ingested ID, used to notice arrivals without replacing the visible list. */
  newestId: string | null;
}

export type SubscriptionWorkFilter = 'all' | 'article' | 'video';

export interface SubscriptionWork {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  summary: string | null;
  author: string | null;
  sourceUrl: string | null;
  previewImage: string | null;
  publishedAt: string | null;
  isRead: boolean;
  contentType: 'text' | 'image' | 'video';
  inCandidatePool: boolean;
  governanceStatus: string | null;
}

export interface SubscriptionWorkPage {
  items: SubscriptionWork[];
  nextCursor: string | null;
}

export interface SubscriptionWorkDetail extends SubscriptionWork {
  content: string | null;
  hasPlayableVideo: boolean;
  mediaAttachments: Array<{ id: string; url: string; mimeType: string; durationSeconds: number | null }>;
}

export type FeedKind = 'rss' | 'ai_digest' | 'github';
export type FeedProvider = 'local_rss' | 'fever';
export type FeedContentView =
  | 'article'
  | 'picture'
  | 'video'
  | 'social'
  | 'digest'
  | 'github';
export type UserType = 'initial_admin' | 'admin' | 'member';

export interface Feed {
  id: string;
  kind: FeedKind;
  provider: FeedProvider;
  remoteManaged?: boolean;
  remoteSource?: 'fever' | null;
  title: string;
  url: string;
  siteUrl?: string | null;
  icon?: string;
  unreadCount: number;
  enabled: boolean;
  fullTextOnOpenEnabled: boolean;
  fullTextOnFetchEnabled: boolean;
  aiSummaryOnOpenEnabled: boolean;
  aiSummaryOnFetchEnabled: boolean;
  bodyTranslateOnFetchEnabled: boolean;
  bodyTranslateOnOpenEnabled: boolean;
  titleTranslateEnabled: boolean;
  bodyTranslateEnabled: boolean;
  articleListDisplayMode: 'card' | 'list';
  view?: FeedContentView;
  categoryId?: string | null;
  category?: string | null;
  fetchStatus: number | null;
  fetchError: string | null;
  fetchRawError?: string | null;
  isPodcast?: boolean;
}

export interface Category {
  id: string;
  name: string;
  expanded?: boolean;
}

export type Folder = Category;

export interface ArticleMediaAttachment {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

export interface Article {
  id: string;
  feedId: string;
  title: string;
  titleOriginal?: string;
  titleZh?: string;
  content: string;
  aiSummary?: string;
  aiSummarySession?: ArticleAiSummarySession | null;
  aiTranslationZhHtml?: string;
  aiTranslationBilingualHtml?: string;
  previewImage?: string;
  summary: string;
  author?: string;
  publishedAt: string;
  link: string;
  filterStatus?: 'pending' | 'passed' | 'filtered' | 'error';
  isFiltered?: boolean;
  filteredBy?: string[];
  isRead: boolean;
  isStarred: boolean;
  remoteSource?: 'fever' | null;
  bodyTranslationEligible?: boolean;
  bodyTranslationBlockedReason?: string | null;
  aiDigestSources?: ArticleAiDigestSource[];
  mediaAttachments?: ArticleMediaAttachment[];
  /** kind='github' 的条目附加信息，非 GitHub 条目为 undefined/null */
  githubMeta?: GithubArticleMeta | null;
}

export interface ArticleAiDigestSource {
  articleId: string;
  feedId: string;
  feedTitle: string;
  title: string;
  link?: string | null;
  publishedAt?: string | null;
  position: number;
}

export interface ArticleAiSummarySession {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  draftText: string;
  finalText: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rawErrorMessage?: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'auto';
  fontSize: 'small' | 'medium' | 'large';
  fontFamily: 'sans' | 'serif';
  lineHeight: 'compact' | 'normal' | 'relaxed';
}

export interface GeneralSettings {
  theme: 'light' | 'dark' | 'auto';
  fontSize: 'small' | 'medium' | 'large';
  fontFamily: 'sans' | 'serif';
  lineHeight: 'compact' | 'normal' | 'relaxed';
  autoMarkReadEnabled: boolean;
  autoMarkReadDelayMs: 0 | 2000 | 5000;
  defaultUnreadOnlyInAll: boolean;
  sidebarCollapsed: boolean;
  leftPaneWidth: number;
  middlePaneWidth: number;
}

export interface AIPersistedSettings {
  summaryEnabled: boolean;
  translateEnabled: boolean;
  autoSummarize: boolean;
  deepThinkingEnabled: boolean;
  model: string;
  apiBaseUrl: string;
  summaryPrompt: string;
  translationPrompt: string;
  translation: {
    useSharedAi: boolean;
    model: string;
    apiBaseUrl: string;
  };
}

export interface RssSourceSetting {
  id: string;
  name: string;
  url: string;
  category: string | null;
  enabled: boolean;
}

export interface ArticleFilterKeywordSettings {
  enabled: boolean;
  keywords: string[];
}

export interface ArticleFilterAiSettings {
  enabled: boolean;
  prompt: string;
}

export interface ArticleFilterSettings {
  keyword: ArticleFilterKeywordSettings;
  ai: ArticleFilterAiSettings;
}

export type RssMaxStoredArticlesPerFeed = 100 | 200 | 500 | 1000 | 2000;

export interface RssSettings {
  sources: RssSourceSetting[];
  fetchIntervalMinutes: 5 | 15 | 30 | 60 | 120;
  maxStoredArticlesPerFeed: RssMaxStoredArticlesPerFeed;
  articleFilter: ArticleFilterSettings;
}

export type LoggingRetentionDays = 1 | 3 | 7 | 14 | 30 | 90;
export type SystemLogLevel = 'error' | 'warning' | 'info';
export type SystemLogCategory =
  | 'feed'
  | 'category'
  | 'article'
  | 'opml'
  | 'settings'
  | 'external_api'
  | 'ai_summary'
  | 'ai_translate'
  | 'ai_digest'
  | 'github'
  | 'oauth';

export interface LoggingSettings {
  enabled: boolean;
  retentionDays: LoggingRetentionDays;
  minLevel: SystemLogLevel;
}

export interface SystemLogItem {
  id: string;
  userId: string | null;
  level: SystemLogLevel;
  category: SystemLogCategory;
  message: string;
  details: string | null;
  source: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface SystemLogsPage {
  items: SystemLogItem[];
  page: number;
  pageSize: number;
  total: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface PersistedSettings {
  general: GeneralSettings;
  ai: AIPersistedSettings;
  categories: Category[];
  rss: RssSettings;
  logging: LoggingSettings;
}

export type ViewType = 'all' | 'unread' | 'starred' | string;

// === Highlights ===
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Highlight {
  id: string;
  articleId: number;
  userId: string;
  text: string;
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  color: HighlightColor;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// === Tags ===
export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
}

// === GitHub ===
/**
 * GitHub 条目类型。
 *
 * MVP 行为只开 `release`（API 层用 zod 限制），
 * 但类型与数据库 CHECK 约束提前按四值落地，P1 扩展 Issue/PR 时零迁移。
 */
export type GithubContentType = 'release' | 'issue' | 'pr' | 'commit';

/** 仓库订阅的同步健康状态（R05 状态 badge 四态）。 */
export type GithubSyncStatus = 'idle' | 'syncing' | 'rate_limited' | 'error';

/** 设置页仓库卡片使用的前端模型。`id` 即 `feedId`。 */
export interface GithubRepoSubscription {
  id: string;
  feedId: string;
  owner: string;
  repo: string;
  /** `${owner}/${repo}` */
  fullName: string;
  /** feeds.title，用户可改 */
  title: string;
  htmlUrl: string;
  avatarUrl: string | null;
  description: string | null;
  language: string | null;
  stargazers: number | null;
  contentTypes: GithubContentType[];
  includePrerelease: boolean;
  enabled: boolean;
  fetchIntervalMinutes: number;
  categoryId: string | null;
  unreadCount: number;
  status: GithubSyncStatus;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  rateLimitedUntil: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
}

export interface GithubRateLimitStatus {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

export interface GithubTokenStatus {
  hasToken: boolean;
  /** 形如 `ghp_****cdef`，永不返回明文 */
  maskedToken: string | null;
  rateLimit: GithubRateLimitStatus | null;
}

/** 中栏 / 右栏渲染 GitHub 条目所需的附加信息。 */
export interface GithubArticleMeta {
  ghType: GithubContentType;
  tagName: string | null;
  isPrerelease: boolean;
  htmlUrl: string;
}

// === OAuth 三方授权中心 ===
/**
 * 四家平台标识，与服务端 `OAUTH_PROVIDER_IDS` 一一对应。
 * 新增平台时需同步扩此处、服务端 registry 与 DB CHECK 约束。
 */
export type OAuthProviderId = 'github' | 'wechat' | 'douyin' | 'xiaohongshu';

/** 连接状态机，与服务端 `OAUTH_CONNECTION_STATUSES` 一一对应。 */
export type OAuthConnectionStatus = 'active' | 'expired' | 'revoked';

/**
 * 平台配置状态（设置页卡片模型）。
 *
 * 安全约定：本结构**绝不含** client secret 的明文或密文，
 * 只有 `maskedClientSecret`（形如 `abcd****wxyz`）。
 */
export interface OAuthProviderConfigStatus {
  provider: OAuthProviderId;
  displayName: string;
  configured: boolean;
  /** 公开值，明文返回。 */
  clientId: string;
  /** 形如 `abcd****wxyz`，永不返回明文。 */
  maskedClientSecret: string | null;
  enabled: boolean;
  /** 服务端单向推导，只读展示供用户复制到平台后台。 */
  redirectUri: string;
  supportsPkce: boolean;
  requiresExactRedirectUri: boolean;
}

/**
 * 已授权连接的对外视图。
 *
 * 安全约定：本结构**结构性地**不存在任何 token 字段，
 * 前端从设计上就拿不到凭据（而非依赖运行时过滤）。
 */
export interface OAuthConnectionView {
  id: string;
  provider: OAuthProviderId;
  status: OAuthConnectionStatus;
  displayName: string | null;
  avatarUrl: string | null;
  /** ISO 8601 UTC。 */
  authorizedAt: string;
  accessTokenExpiresAt: string | null;
  canRefresh: boolean;
}

/** 发起授权的返回值，前端拿到后自行 `location.assign`。 */
export interface OAuthAuthorizeResult {
  authorizeUrl: string;
}

/** 回调 302 回站后 query 中携带的结果标记。 */
export type OAuthCallbackOutcome = 'success' | 'denied' | 'failed';

/** RSSHub 平台 Cookie 授权。 */
export type RssHubCookieProvider = 'douyin' | 'xiaohongshu' | 'weibo';

/**
 * RSSHub 平台 Cookie 状态（设置页卡片模型）。
 *
 * 安全约定：本结构**结构性地**不存在 Cookie 明文或密文，
 * 只有 `maskedCookie`（形如 `abcd****wxyz`）。
 */
export interface RssHubCookieView {
  provider: RssHubCookieProvider;
  displayName: string;
  configured: boolean;
  maskedCookie: string | null;
  remark: string;
  /** ISO 8601 UTC。 */
  updatedAt: string | null;
}

// === Boards ===
export interface Board {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  icon: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardItem {
  boardId: string;
  articleId: number;
  sortOrder: number;
  addedAt: string;
}

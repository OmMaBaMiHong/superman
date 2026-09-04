import { useRef, useState, type FormEvent } from 'react';
import { ApiError, resolveRssHubSourceUrl } from '@/lib/api/apiClient';
import { mapApiErrorToUserMessage } from '@/lib/api/mapApiErrorToUserMessage';
import type { UserOperationActionKey } from '@/lib/userOperationCatalog';
import type { Category, FeedContentView } from '../../../types';
import { runImmediateOperation } from '../../notifications/userOperationNotifier';
import type {
  FeedDialogInitialValues,
  FeedDialogSubmitPayload,
  ValidationState,
} from '../feedDialog.types';
import type { RecommendedFeed } from '../recommendedFeeds';
import { validateRssUrl } from '../utils/rssValidation';

export type FeedDiscoveryInputType = 'empty' | 'rsshub' | 'rss';

interface UseFeedDialogFormOptions {
  actionKey: UserOperationActionKey;
  categories: Category[];
  initialValues?: Partial<FeedDialogInitialValues>;
  skipUrlValidation?: boolean;
  onSubmit: (payload: FeedDialogSubmitPayload) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

interface FieldErrors {
  title?: string;
  url?: string;
}

const uncategorizedCategory: Category = {
  id: 'cat-uncategorized',
  name: '未分类',
  expanded: true,
};

function normalizeCategoryText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function normalizeCategoryKey(value: string | null | undefined): string {
  return normalizeCategoryText(value).toLowerCase();
}

function ensureCategoryOptions(categories: Category[]): Category[] {
  if (categories.some((item) => item.name === uncategorizedCategory.name)) {
    return categories;
  }

  return [uncategorizedCategory, ...categories];
}

function resolveInitialCategoryInput(
  categoryId: string | null | undefined,
  categories: Category[],
  fallbackCategoryId: string | null,
) {
  const nextCategoryId = typeof categoryId === 'undefined' ? fallbackCategoryId : categoryId;
  if (!nextCategoryId) return uncategorizedCategory.name;

  return categories.find((item) => item.id === nextCategoryId)?.name ?? uncategorizedCategory.name;
}

function findMatchingCategory(categories: Category[], input: string): Category | undefined {
  const normalizedInput = normalizeCategoryText(input);
  if (!normalizedInput) return undefined;

  const normalizedKey = normalizedInput.toLowerCase();
  return categories.find(
    (item) => item.id === normalizedInput || normalizeCategoryKey(item.name) === normalizedKey,
  );
}

function isUncategorizedInput(value: string): boolean {
  return (
    !normalizeCategoryText(value) ||
    normalizeCategoryKey(value) === normalizeCategoryKey(uncategorizedCategory.name)
  );
}

function resolveCategoryPayload(
  categories: Category[],
  input: string,
): Pick<FeedDialogSubmitPayload, 'categoryId' | 'categoryName'> {
  const matchedCategory = findMatchingCategory(categories, input);

  if (isUncategorizedInput(input)) {
    return { categoryId: null };
  }

  if (matchedCategory && matchedCategory.name !== uncategorizedCategory.name) {
    return { categoryId: matchedCategory.id };
  }

  return { categoryName: normalizeCategoryText(input) };
}

function resolveTitleFieldError(title: string, titleTouched: boolean, submitAttempted: boolean): string | null {
  if ((titleTouched || submitAttempted) && !title) {
    return '请输入订阅名称。';
  }

  return null;
}

function resolveUrlFieldError({
  trimmedUrl,
  urlTouched,
  validationState,
  lastVerifiedUrl,
  validationMessage,
}: {
  trimmedUrl: string;
  urlTouched: boolean;
  validationState: ValidationState;
  lastVerifiedUrl: string | null;
  validationMessage: string | null;
}): string | null {
  if (!urlTouched) {
    return null;
  }

  if (!trimmedUrl) {
    return '请输入 RSS 地址。';
  }

  if (isInternalFeedUrl(trimmedUrl)) {
    return null;
  }

  // Blur 触发异步校验后，先展示验证中状态，不要提前渲染失败提示。
  if (validationState === 'validating') {
    return null;
  }

  if (validationState === 'failed') {
    return validationMessage ?? '暂时无法验证该链接，请检查后重试。';
  }

  if (validationState !== 'verified' || lastVerifiedUrl !== trimmedUrl) {
    return '请先验证可用的 RSS 地址。';
  }

  return null;
}

function isInternalFeedUrl(url: string): boolean {
  return url.toLowerCase().startsWith('rsshub://');
}

function detectFeedDiscoveryInputType(url: string): FeedDiscoveryInputType {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return 'empty';
  if (trimmed.startsWith('rsshub://')) return 'rsshub';
  return 'rss';
}

function isHttpFeedCandidate(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

// 根据 RSSHub 路由路径和来源域名推断视图类型
function inferViewFromRssHubRoute(routePath: string, sourceDomain?: string): FeedContentView | null {
  const path = routePath.toLowerCase();
  const domain = (sourceDomain ?? '').toLowerCase();

  // 视频平台
  if (
    path.includes('/bilibili/') || path.includes('/douyin/') || path.includes('/youtube/') ||
    path.includes('/tiktok/') || path.includes('/vimeo/') || path.includes('/twitch/') ||
    domain.includes('bilibili') || domain.includes('douyin') || domain.includes('youtube') ||
    domain.includes('tiktok') || domain.includes('vimeo') || domain.includes('twitch')
  ) {
    return 'video';
  }

  // 社交平台
  if (
    path.includes('/twitter/') || path.includes('/x/') || path.includes('/weibo/') ||
    path.includes('/mastodon/') || path.includes('/bsky/') || path.includes('/threads/') ||
    path.includes('/zhihu/') || path.includes('/tieba/') || path.includes('/douban/') ||
    domain.includes('twitter') || domain.includes('x.com') || domain.includes('weibo') ||
    domain.includes('zhihu') || domain.includes('tieba') || domain.includes('douban')
  ) {
    return 'social';
  }

  // 图片平台
  if (
    path.includes('/pinterest/') || path.includes('/instagram/') || path.includes('/unsplash/') ||
    path.includes('/deviantart/') || path.includes('/pixiv/') ||
    domain.includes('pinterest') || domain.includes('instagram') || domain.includes('pixiv')
  ) {
    return 'picture';
  }

  return null;
}

// 根据来源域名建议分类名称
function inferCategoryFromSourceDomain(sourceDomain?: string): string | null {
  if (!sourceDomain) return null;
  const domain = sourceDomain.toLowerCase();

  const domainMap: Record<string, string> = {
    'bilibili.com': 'B站',
    'douyin.com': '抖音',
    'youtube.com': 'YouTube',
    'twitter.com': 'Twitter',
    'x.com': 'Twitter',
    'weibo.com': '微博',
    'xiaohongshu.com': '小红书',
    'zhihu.com': '知乎',
    'douban.com': '豆瓣',
    'instagram.com': 'Instagram',
    'pinterest.com': 'Pinterest',
    'tiktok.com': 'TikTok',
    'vimeo.com': 'Vimeo',
    'twitch.tv': 'Twitch',
    'github.com': 'GitHub',
    'reddit.com': 'Reddit',
    'medium.com': 'Medium',
    'pixiv.net': 'Pixiv',
    'deviantart.com': 'DeviantArt',
    'dribbble.com': '设计',
    'behance.net': '设计',
  };

  return domainMap[domain] ?? null;
}

// 从 rsshub:// 路由路径中提取来源域名，用于分类推断
const ROUTE_SEGMENT_TO_DOMAIN: Record<string, string> = {
  'bilibili': 'bilibili.com',
  'douyin': 'douyin.com',
  'youtube': 'youtube.com',
  'twitter': 'twitter.com',
  'x': 'x.com',
  'weibo': 'weibo.com',
  'xiaohongshu': 'xiaohongshu.com',
  'zhihu': 'zhihu.com',
  'douban': 'douban.com',
  'instagram': 'instagram.com',
  'pinterest': 'pinterest.com',
  'tiktok': 'tiktok.com',
  'vimeo': 'vimeo.com',
  'twitch': 'twitch.tv',
  'github': 'github.com',
  'reddit': 'reddit.com',
  'medium': 'medium.com',
  'pixiv': 'pixiv.net',
  'deviantart': 'deviantart.com',
  'dribbble': 'dribbble.com',
  'behance': 'behance.net',
};

function extractSourceDomainFromRoutePath(routePath: string): string | undefined {
  const segments = routePath.replace(/^\//, '').split('/').filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();
  if (!firstSegment) return undefined;
  return ROUTE_SEGMENT_TO_DOMAIN[firstSegment];
}

export function useFeedDialogForm({
  actionKey,
  categories,
  initialValues,
  skipUrlValidation = false,
  onSubmit,
  onOpenChange,
}: UseFeedDialogFormOptions) {
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const categoryOptions = ensureCategoryOptions(categories);
  const selectableCategories = categoryOptions.filter(
    (item) => item.name !== uncategorizedCategory.name,
  );
  const initialCategoryId =
    typeof initialValues?.categoryId === 'undefined'
      ? selectableCategories[0]?.id
      : initialValues.categoryId;
  const defaultCategoryInput = resolveInitialCategoryInput(
    initialCategoryId,
    categoryOptions,
    selectableCategories[0]?.id ?? null,
  );
  const initialUrl = initialValues?.url ?? '';
  const initialTrimmedUrl = initialUrl.trim();
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [url, setUrl] = useState(initialUrl);
  const [view, setView] = useState<FeedContentView>(initialValues?.view ?? 'article');
  const [categoryInput, setCategoryInput] = useState(defaultCategoryInput);
  const [validationState, setValidationState] = useState<ValidationState>(
    initialTrimmedUrl ? 'verified' : 'idle',
  );
  const [lastVerifiedUrl, setLastVerifiedUrl] = useState<string | null>(initialTrimmedUrl || null);
  const [validatedSiteUrl, setValidatedSiteUrl] = useState<string | null>(initialValues?.siteUrl ?? null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const validationRequestIdRef = useRef(0);

  const trimmedTitle = title.trim();
  const trimmedUrl = url.trim();
  const detectedInputType = detectFeedDiscoveryInputType(trimmedUrl);
  const titleFieldError =
    serverFieldErrors.title ?? resolveTitleFieldError(trimmedTitle, titleTouched, submitAttempted);
  const urlFieldError =
    serverFieldErrors.url ??
    resolveUrlFieldError({
      trimmedUrl,
      urlTouched,
      validationState,
      lastVerifiedUrl,
      validationMessage,
    });
  const canSave =
    Boolean(trimmedTitle) &&
    Boolean(trimmedUrl) &&
    (skipUrlValidation ||
      isInternalFeedUrl(trimmedUrl) ||
      (validationState === 'verified' && lastVerifiedUrl === trimmedUrl)) &&
    !submitting;
  const canResolveSourceUrl =
    !skipUrlValidation &&
    isHttpFeedCandidate(trimmedUrl) &&
    validationState !== 'validating' &&
    !submitting;

  const resetValidationState = () => {
    setValidationState('idle');
    setLastVerifiedUrl(null);
    setValidatedSiteUrl(null);
    setValidationMessage(null);
  };

  const focusFirstInvalidField = (errors: { url?: string | null; title?: string | null }) => {
    if (errors.url) {
      urlInputRef.current?.focus();
      return;
    }

    if (errors.title) {
      titleInputRef.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSubmitAttempted(true);
    setTitleTouched(true);
    setUrlTouched(true);
    setSubmitError(null);

    const nextTitleError = resolveTitleFieldError(trimmedTitle, true, true);
    const nextUrlError = resolveUrlFieldError({
      trimmedUrl,
      urlTouched: true,
      validationState,
      lastVerifiedUrl,
      validationMessage,
    });

    if (nextTitleError || nextUrlError) {
      focusFirstInvalidField({ url: nextUrlError, title: nextTitleError });
      return;
    }

    void (async () => {
      setSubmitting(true);
      setServerFieldErrors({});

      try {
        await runImmediateOperation({
          actionKey,
          execute: () =>
            onSubmit({
              title: trimmedTitle,
              url: trimmedUrl,
              siteUrl: validatedSiteUrl,
              view,
              ...resolveCategoryPayload(categoryOptions, categoryInput),
            }),
        });
        onOpenChange(false);
      } catch (error) {
        if (error instanceof ApiError) {
          setServerFieldErrors({
            title: error.fields?.title,
            url: error.fields?.url,
          });
          focusFirstInvalidField({ url: error.fields?.url, title: error.fields?.title });
        }

        setSubmitError(mapApiErrorToUserMessage(error));
      } finally {
        setSubmitting(false);
      }
    })();
  };

  const handleValidate = async (urlToValidate: string) => {
    if (skipUrlValidation) {
      setValidationState('verified');
      setLastVerifiedUrl(urlToValidate);
      return;
    }

    if (!urlToValidate) {
      resetValidationState();
      return;
    }

    if (isInternalFeedUrl(urlToValidate)) {
      const requestId = validationRequestIdRef.current + 1;
      validationRequestIdRef.current = requestId;
      setValidationState('validating');
      setValidationMessage('正在识别 RSSHub 路由…');

      try {
        const rssHubResult = await resolveRssHubSourceUrl(urlToValidate);
        if (requestId !== validationRequestIdRef.current) return;

        if (rssHubResult.resolved && rssHubResult.routePath) {
          setValidationState('verified');
          setLastVerifiedUrl(urlToValidate);
          setValidatedSiteUrl(null);
          setValidationMessage(
            rssHubResult.title
              ? `已识别为 RSSHub 订阅：${rssHubResult.title}`
              : '已识别为内置 RSSHub 订阅地址。',
          );

          const suggestedTitle = typeof rssHubResult.title === 'string' ? rssHubResult.title.trim() : '';
          if (suggestedTitle && !title.trim()) {
            setTitle(suggestedTitle);
          }

          // 自动识别视图类型
          const sourceDomain = rssHubResult.sourceDomain ?? extractSourceDomainFromRoutePath(rssHubResult.routePath);
          const inferredView = inferViewFromRssHubRoute(rssHubResult.routePath, sourceDomain);
          if (inferredView && view === 'article') {
            setView(inferredView);
          }

          // 自动建议分类
          const suggestedCategory = inferCategoryFromSourceDomain(sourceDomain);
          if (suggestedCategory && isUncategorizedInput(categoryInput)) {
            setCategoryInput(suggestedCategory);
          }
          return;
        }
      } catch {
        if (requestId !== validationRequestIdRef.current) return;
      }

      setValidationState('verified');
      setLastVerifiedUrl(urlToValidate);
      setValidatedSiteUrl(null);
      setValidationMessage('已识别为内置 RSSHub 订阅地址。');
      return;
    }

    const requestId = validationRequestIdRef.current + 1;
    validationRequestIdRef.current = requestId;
    setValidationState('validating');
    setValidationMessage(isHttpFeedCandidate(urlToValidate) ? '正在识别 RSSHub 订阅…' : '正在验证链接…');

    try {
      if (isHttpFeedCandidate(urlToValidate)) {
        const rssHubResult = await resolveRssHubSourceUrl(urlToValidate);
        if (requestId !== validationRequestIdRef.current) {
          return;
        }

        if (rssHubResult.resolved && rssHubResult.rssHubUrl) {
          setUrl(rssHubResult.rssHubUrl);
          setValidationState('verified');
          setLastVerifiedUrl(rssHubResult.rssHubUrl);
          setValidatedSiteUrl(rssHubResult.finalUrl ?? null);
          setValidationMessage(
            rssHubResult.title
              ? `已识别为 RSSHub 订阅：${rssHubResult.title}`
              : '已识别为 RSSHub 订阅。',
          );

          const suggestedTitle = typeof rssHubResult.title === 'string' ? rssHubResult.title.trim() : '';
          if (suggestedTitle && !title.trim()) {
            setTitle(suggestedTitle);
          }

          // 自动识别视图类型
          const suggestedRoutePath = rssHubResult.routePath ?? '';
          const suggestedSourceDomain = rssHubResult.sourceDomain;
          const inferredView = inferViewFromRssHubRoute(suggestedRoutePath, suggestedSourceDomain);
          if (inferredView && view === 'article') {
            setView(inferredView);
          }

          // 自动建议分类（仅当用户未手动选择分类时）
          const suggestedCategory = inferCategoryFromSourceDomain(suggestedSourceDomain);
          if (suggestedCategory && isUncategorizedInput(categoryInput)) {
            setCategoryInput(suggestedCategory);
          }
          return;
        }

        setValidationMessage('正在验证链接…');
      }

      const result = await validateRssUrl(urlToValidate);
      if (requestId !== validationRequestIdRef.current) {
        return;
      }

      if (result.ok) {
        setValidationState('verified');
        setLastVerifiedUrl(urlToValidate);
        setValidatedSiteUrl(typeof result.siteUrl === 'string' ? result.siteUrl : null);
        setValidationMessage('链接可用，已识别为 RSS 源。');

        const suggestedTitle = typeof result.title === 'string' ? result.title.trim() : '';
        if (suggestedTitle) {
          setTitle(suggestedTitle);
        }
        return;
      }

      setValidationState('failed');
      setLastVerifiedUrl(null);
      setValidatedSiteUrl(null);
      setValidationMessage(result.message ?? '暂时无法验证该链接，请检查后重试。');
    } catch {
      if (requestId !== validationRequestIdRef.current) {
        return;
      }

      setValidationState('failed');
      setLastVerifiedUrl(null);
      setValidatedSiteUrl(null);
      setValidationMessage('暂时无法验证该链接，请检查后重试。');
    }
  };

  const handleUrlChange = (nextUrl: string) => {
    validationRequestIdRef.current += 1;
    setUrl(nextUrl);
    if (skipUrlValidation) {
      setValidationState('verified');
      setLastVerifiedUrl(nextUrl.trim());
      return;
    }
    setUrlTouched(false);
    setSubmitError(null);
    setServerFieldErrors((current) => ({ ...current, url: undefined }));
    resetValidationState();
  };

  const handleUrlBlur = (nextUrl: string) => {
    setUrlTouched(true);
    const blurValue = nextUrl.trim();
    if (validationState === 'verified' && lastVerifiedUrl === blurValue) {
      return;
    }

    void handleValidate(blurValue);
  };

  const handleResolveSourceUrl = () => {
    setUrlTouched(true);
    void handleValidate(trimmedUrl);
  };

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    setSubmitError(null);
    setServerFieldErrors((current) => ({ ...current, title: undefined }));
  };

  const handleTitleBlur = () => {
    setTitleTouched(true);
  };

  const applyRecommendedFeed = (feed: RecommendedFeed) => {
    validationRequestIdRef.current += 1;
    const nextUrl = feed.url.trim();
    setUrl(nextUrl);
    setTitle(feed.title);
    setView(feed.view);
    setCategoryInput(feed.category);
    setValidationState('verified');
    setLastVerifiedUrl(nextUrl);
    setValidatedSiteUrl(null);
    setValidationMessage('已选择内置推荐源，可以直接添加。');
    setTitleTouched(false);
    setUrlTouched(false);
    setSubmitError(null);
    setServerFieldErrors({});
    titleInputRef.current?.focus();
  };

  return {
    applyRecommendedFeed,
    canSave,
    canResolveSourceUrl,
    categoryInput,
    categoryOptions,
    detectedInputType,
    handleSubmit,
    handleResolveSourceUrl,
    handleTitleBlur,
    handleTitleChange,
    handleUrlBlur,
    handleUrlChange,
    setView,
    setCategoryInput,
    submitError,
    submitting,
    title,
    titleFieldError,
    titleInputRef,
    url,
    urlFieldError,
    urlInputRef,
    validationMessage,
    validationState,
    view,
  };
}

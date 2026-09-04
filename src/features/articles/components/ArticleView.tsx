import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import { getSelectedArticleFromState, useAppStore } from "../../../store/appStore";
import { useSettingsStore } from "../../../store/settingsStore";
import type { ArticleAiDigestSource } from "../../../types";
import { enqueueArticleFulltext, getArticleTasks, type ArticleTasksDto } from "@/lib/api/apiClient";
import { pollWithBackoff } from "@/lib/api/polling";
import { useRenderTimeSnapshot } from "../../../hooks";
import { cn } from "@/lib/utils";
import { useAnimatedAiSummaryText, useImmersiveTranslation, useStreamingAiSummary } from "../hooks";
import { buildImmersiveHtml } from "../utils";
import { buildArticleMarkdownDocument, sanitizeArticleMarkdownFilename, triggerArticleMarkdownDownload } from "../utils";
import ArticleScrollAssist from "./ArticleScrollAssist";
import ArticleImagePreview from "./ArticleImagePreview";
import { READER_RESIZE_DESKTOP_MIN_WIDTH } from "../../reader/utils";
import { highlightHtmlByQuery } from "../../reader/utils";
import { toast } from "../../toast/toast";
import { getArticleVideoMeta } from "@/lib/media/video";
import ArticleHeader from "./ArticleHeader";
import ArticleMediaSection from "./ArticleMediaSection";
import ArticleFulltextStatus from "./ArticleFulltextStatus";
import ArticleAiSummary from "./ArticleAiSummary";
import ArticleErrorCard from "./ArticleErrorCard";
import ArticleTranslationStatus from "./ArticleTranslationStatus";
import ArticleBody from "./ArticleBody";
import ArticleDigestSources from "./ArticleDigestSources";
import DouyinVideoStats from "./DouyinVideoStats";

const FLOATING_TITLE_SCROLL_THRESHOLD_PX = 96;
const READER_COMMAND_EVENT_NAME = "feedfuse:reader-command";
type ReaderArticleCommand = "ai-summary" | "ai-translate";

function getPlayableMediaAttachment(article: { mediaAttachments?: Array<{ url: string; mimeType: string }> } | null) {
  return article?.mediaAttachments?.find((a) => { const m = a.mimeType.toLowerCase(); return a.url && (m.startsWith("audio/") || m.startsWith("video/")); }) ?? null;
}

function dispatchReaderArticleCommand(command: ReaderArticleCommand) {
  window.dispatchEvent(new CustomEvent(READER_COMMAND_EVENT_NAME, { detail: { command } }));
}

interface ArticleViewProps { highlightQuery?: string; onOpenSearch?: () => void; onTitleVisibilityChange?: (isVisible: boolean) => void; reserveTopSpace?: boolean; renderedAt?: string; }
type ImagePreviewState = { articleId: string | null; previewId: number; src: string; alt: string; };

export default function ArticleView({
  highlightQuery = "", onOpenSearch, onTitleVisibilityChange, reserveTopSpace = true, renderedAt,
}: ArticleViewProps = {}) {
  const article = useAppStore((s) => getSelectedArticleFromState(s));
  const feed = useAppStore((s) => { const ca = getSelectedArticleFromState(s); return ca ? (s.feeds.find((i) => i.id === ca.feedId) ?? null) : null; });
  const markAsRead = useAppStore((s) => s.markAsRead);
  const toggleStar = useAppStore((s) => s.toggleStar);
  const refreshArticle = useAppStore((s) => s.refreshArticle);
  const openArticleInReader = useAppStore((s) => s.openArticleInReader);
  const general = useSettingsStore((s) => s.persistedSettings.general);
  const autoMarkReadEnabled = useSettingsStore((s) => s.persistedSettings.general.autoMarkReadEnabled);
  const autoMarkReadDelayMs = useSettingsStore((s) => s.persistedSettings.general.autoMarkReadDelayMs);
  const [tasks, setTasks] = useState<ArticleTasksDto | null>(null);
  const [aiSummaryExpandedArticleId, setAiSummaryExpandedArticleId] = useState<string | null>(null);
  const lastReportedTitleVisibilityRef = useRef<boolean | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const articleContentRef = useRef<HTMLDivElement | null>(null);
  const imagePreviewSequenceRef = useRef(0);
  const scrollStateFrameRef = useRef<number | null>(null);
  const pendingScrollElementRef = useRef<HTMLDivElement | null>(null);
  const [scrollAssistArticleId, setScrollAssistArticleId] = useState<string | null>(null);
  const [scrollAssistPercent, setScrollAssistPercent] = useState(0);
  const [articleTitleVisible, setArticleTitleVisible] = useState(true);
  const [hasScrollableContent, setHasScrollableContent] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(true);
  const referenceTime = useRenderTimeSnapshot(renderedAt);
  const feedFullTextOnOpenEnabled = feed?.fullTextOnOpenEnabled ?? false;
  const feedAiSummaryOnOpenEnabled = feed?.aiSummaryOnOpenEnabled ?? false;
  const feedBodyTranslateOnOpenEnabled = feed?.bodyTranslateOnOpenEnabled ?? false;
  const currentArticleId = article?.id ?? null;
  const immersiveTranslation = useImmersiveTranslation({ articleId: currentArticleId });
  const streamingAiSummary = useStreamingAiSummary({ articleId: currentArticleId, initialSession: article?.aiSummarySession ?? null, onCompleted: async (id) => { await refreshArticle(id); } });
  const requestStreamingAiSummary = streamingAiSummary.requestSummary;
  const fulltextStatus = tasks?.fulltext.status ?? "idle";
  const fulltextPending = Boolean(currentArticleId && (fulltextStatus === "queued" || fulltextStatus === "running"));
  const fulltextLoading = fulltextPending;
  const aiSummaryLoading = streamingAiSummary.loading;
  const aiSummaryMissingApiKey = streamingAiSummary.missingApiKey;
  const aiSummaryWaitingFulltext = streamingAiSummary.waitingFulltext;
  const aiSummaryExpanded = Boolean(currentArticleId && aiSummaryExpandedArticleId === currentArticleId);
  const aiTranslationLoading = immersiveTranslation.loading;
  const aiTranslationMissingApiKey = immersiveTranslation.missingApiKey;
  const aiTranslationTimedOut = immersiveTranslation.timedOut;
  const aiTranslationWaitingFulltext = immersiveTranslation.waitingFulltext;
  const aiTranslationViewing = immersiveTranslation.viewing;
  const immersiveTranslationSession = immersiveTranslation.session;
  const requestImmersiveTranslation = immersiveTranslation.requestTranslation;
  const hasLegacyAiTranslationContent = Boolean(article?.aiTranslationBilingualHtml?.trim() || article?.aiTranslationZhHtml?.trim());
  const hasImmersiveSegments = immersiveTranslation.segments.length > 0;
  const hasAiTranslationContent = hasLegacyAiTranslationContent || hasImmersiveSegments;
  const bodyTranslationEligible = article?.bodyTranslationEligible !== false;
  const isAiDigestArticle = (feed?.kind ?? "rss") === "ai_digest";
  const isPodcastArticle = Boolean(article?.mediaAttachments?.length);
  const aiDigestSources = article?.aiDigestSources ?? [];
  const titleOriginal = article?.titleOriginal?.trim() || article?.title || "";
  const titleZh = article?.titleZh?.trim();
  const showBilingualTitle = aiTranslationViewing && Boolean(titleZh);
  const showDesktopToolbar = reserveTopSpace && isDesktop;
  const activeImagePreview = imagePreview?.articleId === currentArticleId ? imagePreview : null;
  const ssm = scrollAssistArticleId === currentArticleId;
  const effectiveScrollAssistPercent = ssm ? scrollAssistPercent : 0;
  const effectiveArticleTitleVisible = ssm ? articleTitleVisible : true;
  const effectiveHasScrollableContent = ssm ? hasScrollableContent : false;

  const reportTitleVisibility = useCallback((v: boolean) => {
    if (!onTitleVisibilityChange || lastReportedTitleVisibilityRef.current === v) return;
    lastReportedTitleVisibilityRef.current = v;
    onTitleVisibilityChange(v);
  }, [onTitleVisibilityChange]);

  const updateScrollAssistState = useCallback((el: HTMLDivElement) => {
    const ms = Math.max(el.scrollHeight - el.clientHeight, 0);
    const np = ms <= 0 ? 0 : Math.min(1, Math.max(0, el.scrollTop / ms));
    setScrollAssistArticleId((c) => c === currentArticleId ? c : currentArticleId);
    setHasScrollableContent((c) => c === (ms > 0) ? c : ms > 0);
    setScrollAssistPercent((c) => c === Math.round(np * 100) ? c : Math.round(np * 100));
    setArticleTitleVisible((c) => c === (el.scrollTop <= FLOATING_TITLE_SCROLL_THRESHOLD_PX) ? c : el.scrollTop <= FLOATING_TITLE_SCROLL_THRESHOLD_PX);
  }, [currentArticleId]);

  const cancelScheduledScrollStateUpdate = useCallback(() => {
    if (typeof window === "undefined") return;
    const id = scrollStateFrameRef.current;
    if (id === null) return;
    window.cancelAnimationFrame(id);
    scrollStateFrameRef.current = null;
  }, []);

  const scheduleScrollStateUpdate = useCallback((el: HTMLDivElement) => {
    pendingScrollElementRef.current = el;
    if (typeof window === "undefined" || scrollStateFrameRef.current !== null) return;
    scrollStateFrameRef.current = window.requestAnimationFrame(() => {
      scrollStateFrameRef.current = null;
      const p = pendingScrollElementRef.current;
      if (p) updateScrollAssistState(p);
    });
  }, [updateScrollAssistState]);

  const onArticleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    reportTitleVisibility(el.scrollTop <= FLOATING_TITLE_SCROLL_THRESHOLD_PX);
    scheduleScrollStateUpdate(el);
  }, [reportTitleVisibility, scheduleScrollStateUpdate]);

  useEffect(() => () => cancelScheduledScrollStateUpdate(), [cancelScheduledScrollStateUpdate]);

  const handleBackToTop = useCallback(() => { scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const ud = () => { const nd = window.innerWidth >= READER_RESIZE_DESKTOP_MIN_WIDTH; setIsDesktop((c) => c === nd ? c : nd); };
    ud();
    window.addEventListener("resize", ud);
    return () => window.removeEventListener("resize", ud);
  }, []);

  useEffect(() => { lastReportedTitleVisibilityRef.current = null; reportTitleVisibility(true); }, [article?.id, reportTitleVisibility]);

  useEffect(() => {
    if (!article || article.isRead) return;
    if (!autoMarkReadEnabled) return;
    if (autoMarkReadDelayMs === 0) { markAsRead(article.id); return; }
    const t = setTimeout(() => markAsRead(article.id), autoMarkReadDelayMs);
    return () => clearTimeout(t);
  }, [article, autoMarkReadDelayMs, autoMarkReadEnabled, markAsRead]);

  const requestFulltext = useCallback(async (articleId: string, input?: { signal?: AbortSignal; force?: boolean }) => {
    const signal = input?.signal;
    await enqueueArticleFulltext(articleId, { force: Boolean(input?.force) });
    const r = await pollWithBackoff({
      fn: () => getArticleTasks(articleId),
      stop: (v) => { const s = v.fulltext.status; return s === "idle" || s === "succeeded" || s === "failed"; },
      onValue: (v) => { if (!signal?.aborted) setTasks(v); }, signal,
    });
    if (r.value?.fulltext.status === "succeeded") { await refreshArticle(articleId); return; }
    if (r.value?.fulltext.status === "failed") {
      const fr = r.value.fulltext.errorMessage?.trim() || r.value.fulltext.rawErrorMessage?.trim() || "请稍后重试";
      toast.error(`抓取全文失败：${fr}`, { dedupeKey: `article-fulltext-failed:${articleId}:${r.value.fulltext.jobId ?? "none"}:${r.value.fulltext.errorCode ?? fr}` });
    }
  }, [refreshArticle]);

  useEffect(() => {
    const articleId = article?.id ?? null;
    const articleLink = article?.link ?? "";
    if (!articleId) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    void (async () => {
      setTasks(null);
      try { const t = await getArticleTasks(articleId); if (!signal.aborted) setTasks(t); } catch (err) { console.error(err); if (signal.aborted) return; }
      if (!feedFullTextOnOpenEnabled || isAiDigestArticle || isPodcastArticle || !articleLink) return;
      try { await requestFulltext(articleId, { signal, force: false }); } catch (err) { console.error(err); }
    })();
    return () => { ctrl.abort(); setTasks(null); };
  }, [article?.id, article?.link, feedFullTextOnOpenEnabled, isAiDigestArticle, isPodcastArticle, requestFulltext]);

  useEffect(() => {
    if (!article?.id || !feedAiSummaryOnOpenEnabled || isPodcastArticle) return;
    const hs = Boolean(article?.aiSummary?.trim());
    const he = Boolean(article?.aiSummarySession);
    if (hs || he) return;
    queueMicrotask(() => { void requestStreamingAiSummary(); });
  }, [article?.aiSummary, article?.aiSummarySession, article?.aiSummarySession?.id, article?.aiSummarySession?.status, article?.id, feedAiSummaryOnOpenEnabled, isPodcastArticle, requestStreamingAiSummary]);

  useEffect(() => {
    if (!article?.id || !feedBodyTranslateOnOpenEnabled || isAiDigestArticle || isPodcastArticle || !bodyTranslationEligible || hasAiTranslationContent || immersiveTranslationSession) return;
    void requestImmersiveTranslation({ force: false, autoView: true });
  }, [article?.id, bodyTranslationEligible, feedBodyTranslateOnOpenEnabled, isAiDigestArticle, isPodcastArticle, hasAiTranslationContent, immersiveTranslationSession, requestImmersiveTranslation]);

  const textAutomationDisabled = isAiDigestArticle || isPodcastArticle;
  const fulltextButtonDisabled = fulltextPending || textAutomationDisabled;
  const aiTranslationButtonDisabled = textAutomationDisabled;
  const aiSummaryButtonDisabled = textAutomationDisabled || (feedFullTextOnOpenEnabled && fulltextPending);
  const showDesktopStarButton = Boolean(article);
  const showDesktopMarkdownExportButton = Boolean(article);
  const showDesktopFulltextButton = Boolean(article) && !fulltextButtonDisabled;
  const showDesktopTranslationButton = Boolean(article) && bodyTranslationEligible && !aiTranslationButtonDisabled;
  const showDesktopAiSummaryButton = Boolean(article) && !aiSummaryButtonDisabled;
  const activeAiSummarySession = streamingAiSummary.session;
  const showingStreamingSummary = Boolean(activeAiSummarySession);
  const sourceAiSummaryText = showingStreamingSummary ? activeAiSummarySession?.finalText?.trim() || activeAiSummarySession?.draftText?.trim() || "" : (article?.aiSummary?.trim() ?? "");
  const { displayText: animatedAiSummaryText } = useAnimatedAiSummaryText({ articleId: currentArticleId, sourceText: sourceAiSummaryText, status: activeAiSummarySession?.status ?? null });

  function onFulltextButtonClick() { if (!article?.id || textAutomationDisabled) return; void requestFulltext(article.id, { force: true }); }
  function onAiSummaryButtonClick() { if (!article?.id || textAutomationDisabled) return; void requestStreamingAiSummary({ force: true }); }
  function onAiTranslationButtonClick() { if (!article?.id || textAutomationDisabled) return; void requestImmersiveTranslation({ force: true, autoView: true }); }

  useEffect(() => {
    const h = (e: Event) => {
      const cmd = (e as CustomEvent<{ command?: ReaderArticleCommand }>).detail?.command;
      if (cmd === "ai-summary" && article?.id && !aiSummaryButtonDisabled) { void requestStreamingAiSummary({ force: true }); return; }
      if (cmd === "ai-translate" && article?.id && bodyTranslationEligible && !aiTranslationButtonDisabled) { void requestImmersiveTranslation({ force: true, autoView: true }); }
    };
    window.addEventListener(READER_COMMAND_EVENT_NAME, h);
    return () => window.removeEventListener(READER_COMMAND_EVENT_NAME, h);
  }, [aiSummaryButtonDisabled, aiTranslationButtonDisabled, article?.id, bodyTranslationEligible, requestImmersiveTranslation, requestStreamingAiSummary]);

  function onMarkdownExportButtonClick() {
    if (!article) return;
    triggerArticleMarkdownDownload({ filename: sanitizeArticleMarkdownFilename(titleOriginal), content: buildArticleMarkdownDocument({ title: titleOriginal, publishedAt: article.publishedAt, link: article.link, contentHtml: article.content }) });
  }

  async function onAiDigestSourceClick(source: ArticleAiDigestSource) {
    await openArticleInReader({ view: source.feedId, articleId: source.articleId, articleHistory: "push" });
  }

  const toggleAiSummaryExpanded = useCallback(() => {
    if (!currentArticleId) return;
    setAiSummaryExpandedArticleId((c) => c === currentArticleId ? null : currentArticleId);
  }, [currentArticleId]);

  const openImagePreview = useCallback((image: HTMLImageElement) => {
    const src = image.currentSrc || image.getAttribute("src") || image.src;
    if (!src) return;
    imagePreviewSequenceRef.current += 1;
    setImagePreview({ articleId: currentArticleId, previewId: imagePreviewSequenceRef.current, src, alt: image.getAttribute("alt")?.trim() || "文章图片" });
  }, [currentArticleId]);

  const getPreviewableArticleImage = useCallback((target: Element) => {
    const img = target.closest("img");
    return (img instanceof HTMLImageElement && !img.closest("a[href]")) ? img : null;
  }, []);

  const onArticleContentClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const rt = t.closest('[data-action="retry-segment"]');
    if (rt) {
      const si = rt.getAttribute("data-segment-index");
      const n = si ? Number(si) : Number.NaN;
      if (Number.isInteger(n) && n >= 0) { void immersiveTranslation.retrySegment(n); }
      return;
    }
    const img = getPreviewableArticleImage(t);
    if (!img) return;
    e.preventDefault();
    openImagePreview(img);
  }, [getPreviewableArticleImage, immersiveTranslation, openImagePreview]);

  const onArticleContentKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const img = getPreviewableArticleImage(t);
    if (!img) return;
    e.preventDefault();
    openImagePreview(img);
  }, [getPreviewableArticleImage, openImagePreview]);

  const immersiveHtml = useMemo(() => buildImmersiveHtml(article?.content ?? "", immersiveTranslation.segments), [article?.content, immersiveTranslation.segments]);
  const bodyHtml = aiTranslationViewing && hasImmersiveSegments ? immersiveHtml : aiTranslationViewing && hasLegacyAiTranslationContent ? article?.aiTranslationBilingualHtml?.trim() || article?.aiTranslationZhHtml?.trim() || article?.content || "" : article?.content || "";
  const highlightedBodyHtml = useMemo(() => highlightHtmlByQuery(bodyHtml, highlightQuery), [bodyHtml, highlightQuery]);

  useEffect(() => {
    const c = articleContentRef.current;
    if (!c) return;
    for (const n of c.querySelectorAll("img")) {
      if (!(n instanceof HTMLImageElement) || n.closest("a[href]")) continue;
      const alt = n.alt?.trim();
      n.tabIndex = 0;
      n.setAttribute("role", "button");
      n.setAttribute("aria-label", alt ? `查看大图：${alt}` : "查看大图");
      n.classList.add("cursor-zoom-in");
    }
    for (const n of c.querySelectorAll("video")) {
      if (n instanceof HTMLVideoElement) n.classList.add("my-5", "w-full", "max-w-full", "rounded-lg", "bg-black");
    }
  }, [highlightedBodyHtml]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => { reportTitleVisibility(el.scrollTop <= FLOATING_TITLE_SCROLL_THRESHOLD_PX); updateScrollAssistState(el); });
    return () => window.cancelAnimationFrame(id);
  }, [article?.id, bodyHtml, isDesktop, reportTitleVisibility, updateScrollAssistState]);

  if (!article) {
    return (
      <div className="flex h-full flex-col bg-background text-foreground dark:bg-[linear-gradient(180deg,var(--glass-bg-light),transparent)]">
        <ArticleHeader article={null} feed={feed} isDesktop={isDesktop} reserveTopSpace={reserveTopSpace} effectiveArticleTitleVisible={effectiveArticleTitleVisible} showBilingualTitle={showBilingualTitle} titleOriginal={titleOriginal} titleZh={titleZh} articleFiltered={false} referenceTime={referenceTime} showDesktopStarButton={false} showDesktopFulltextButton={false} showDesktopTranslationButton={false} showDesktopAiSummaryButton={false} showDesktopMarkdownExportButton={false} fulltextButtonDisabled={false} aiTranslationButtonDisabled={false} aiSummaryButtonDisabled={false} bodyTranslationEligible={false} onOpenSearch={onOpenSearch} onToggleStar={toggleStar} onFulltextButtonClick={onFulltextButtonClick} onAiTranslationButtonClick={onAiTranslationButtonClick} onAiSummaryButtonClick={onAiSummaryButtonClick} onMarkdownExportButtonClick={onMarkdownExportButtonClick} />
        <div className="flex flex-1 items-center justify-center"><p className="text-muted-foreground">从列表中选择一篇文章开始阅读</p></div>
      </div>
    );
  }

  const fontSizeClass = { small: "text-sm", medium: "text-base", large: "text-lg" }[general.fontSize];
  const lineHeightClass = { compact: "leading-normal", normal: "leading-relaxed", relaxed: "leading-loose" }[general.lineHeight];
  const fontFamilyClass = general.fontFamily === "serif" ? "font-serif" : "font-sans";
  const aiSummaryFontSizeClass = { small: "text-sm", medium: "text-sm", large: "text-base" }[general.fontSize];
  const aiSummaryLineHeightClass = { compact: "leading-relaxed", normal: "leading-relaxed", relaxed: "leading-relaxed" }[general.lineHeight];
  const aiSummaryText = showingStreamingSummary ? animatedAiSummaryText : sourceAiSummaryText;
  const aiSummaryLines = aiSummaryText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const aiSummaryTldrText = aiSummaryLines.slice(0, 2).join(" ");
  const aiSummaryContentId = `ai-summary-${article.id}`;
  const aiSummarySessionFailed = activeAiSummarySession?.status === "failed";
  const aiSummarySessionRunning = activeAiSummarySession?.status === "queued" || activeAiSummarySession?.status === "running";
  const aiSummaryFailed = aiSummarySessionFailed || tasks?.ai_summary.status === "failed";
  const aiSummaryErrorMessage = activeAiSummarySession?.rawErrorMessage || tasks?.ai_summary.rawErrorMessage || activeAiSummarySession?.errorMessage || tasks?.ai_summary.errorMessage || "暂时无法生成摘要";
  const aiTranslateFailed = tasks?.ai_translate.status === "failed";
  const aiTranslateErrorMessage = tasks?.ai_translate.rawErrorMessage || tasks?.ai_translate.errorMessage || "暂时无法完成翻译";
  const showAsyncErrorCard = !aiSummaryLoading && !aiSummaryMissingApiKey && !aiSummaryWaitingFulltext && !aiTranslationLoading && !aiTranslationMissingApiKey && !aiTranslationTimedOut && !aiTranslationWaitingFulltext && (aiSummaryFailed || aiTranslateFailed);
  const showScrollAssist = isDesktop && !effectiveArticleTitleVisible && effectiveHasScrollableContent;
  const articleFiltered = article.isFiltered || article.filterStatus === "filtered";
  const playableMediaAttachment = getPlayableMediaAttachment(article);
  const articleVideoMeta = getArticleVideoMeta({ link: article.link, content: article.content, previewImage: article.previewImage, mediaAttachments: article.mediaAttachments });

  return (
    <div className="flex h-full flex-col bg-background text-foreground dark:bg-[linear-gradient(180deg,var(--glass-bg-light),transparent)]">
      <ArticleHeader article={article} feed={feed} isDesktop={isDesktop} reserveTopSpace={reserveTopSpace} effectiveArticleTitleVisible={effectiveArticleTitleVisible} showBilingualTitle={showBilingualTitle} titleOriginal={titleOriginal} titleZh={titleZh} articleFiltered={articleFiltered} referenceTime={referenceTime} showDesktopStarButton={showDesktopStarButton} showDesktopFulltextButton={showDesktopFulltextButton} showDesktopTranslationButton={showDesktopTranslationButton} showDesktopAiSummaryButton={showDesktopAiSummaryButton} showDesktopMarkdownExportButton={showDesktopMarkdownExportButton} fulltextButtonDisabled={fulltextButtonDisabled} aiTranslationButtonDisabled={aiTranslationButtonDisabled} aiSummaryButtonDisabled={aiSummaryButtonDisabled} bodyTranslationEligible={bodyTranslationEligible} onOpenSearch={onOpenSearch} onToggleStar={toggleStar} onFulltextButtonClick={onFulltextButtonClick} onAiTranslationButtonClick={onAiTranslationButtonClick} onAiSummaryButtonClick={onAiSummaryButtonClick} onMarkdownExportButtonClick={onMarkdownExportButtonClick} />
      <div className="relative flex-1 overflow-hidden" data-testid="article-viewport">
        <div ref={scrollContainerRef} className="h-full overflow-y-auto" onScroll={onArticleScroll} data-testid="article-scroll-container">
          <div className="w-full px-8 pb-12 pt-4 dark:bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--color-primary)_7%,transparent),transparent_22%)] lg:pl-12 lg:pr-8" data-testid="article-content-shell">
            <ArticleMediaSection articleVideoMeta={articleVideoMeta} playableMediaAttachment={playableMediaAttachment} titleOriginal={titleOriginal} articleId={currentArticleId} />
            <DouyinVideoStats contentHtml={article?.content ?? ''} articleId={currentArticleId} />
            <ArticleFulltextStatus fulltextLoading={fulltextLoading} />
            <ArticleAiSummary articleId={article.id} aiSummaryText={aiSummaryText} aiSummaryExpanded={aiSummaryExpanded} aiSummaryLoading={aiSummaryLoading} aiSummaryMissingApiKey={aiSummaryMissingApiKey} aiSummaryWaitingFulltext={aiSummaryWaitingFulltext} aiSummarySessionRunning={aiSummarySessionRunning} aiSummaryFontSizeClass={aiSummaryFontSizeClass} aiSummaryLineHeightClass={aiSummaryLineHeightClass} fontFamilyClass={fontFamilyClass} aiSummaryLines={aiSummaryLines} aiSummaryTldrText={aiSummaryTldrText} aiSummaryContentId={aiSummaryContentId} toggleAiSummaryExpanded={toggleAiSummaryExpanded} />
            <ArticleErrorCard showAsyncErrorCard={showAsyncErrorCard} aiSummaryFailed={aiSummaryFailed} aiTranslateFailed={aiTranslateFailed} aiSummaryErrorMessage={aiSummaryErrorMessage} aiTranslateErrorMessage={aiTranslateErrorMessage} onAiSummaryButtonClick={onAiSummaryButtonClick} onAiTranslationButtonClick={onAiTranslationButtonClick} />
            <ArticleTranslationStatus hasAiTranslationContent={hasAiTranslationContent} aiTranslationLoading={aiTranslationLoading} aiTranslationMissingApiKey={aiTranslationMissingApiKey} aiTranslationTimedOut={aiTranslationTimedOut} aiTranslationWaitingFulltext={aiTranslationWaitingFulltext} />
            <ArticleBody ref={articleContentRef} bodyHtml={highlightedBodyHtml} fontSizeClass={fontSizeClass} lineHeightClass={lineHeightClass} fontFamilyClass={fontFamilyClass} onClick={onArticleContentClick} onKeyDown={onArticleContentKeyDown} />
            <ArticleDigestSources isAiDigestArticle={isAiDigestArticle} aiDigestSources={aiDigestSources} article={article} referenceTime={referenceTime} onAiDigestSourceClick={onAiDigestSourceClick} />
          </div>
        </div>
        <ArticleScrollAssist visible={showScrollAssist} percent={effectiveScrollAssistPercent} onBackToTop={handleBackToTop} />
        <ArticleImagePreview key={activeImagePreview?.previewId ?? "empty"} image={activeImagePreview} open={Boolean(activeImagePreview)} onOpenChange={(o) => { if (!o) setImagePreview(null); }} />
      </div>
    </div>
  );
}

export { dispatchReaderArticleCommand };
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ExternalLink, Play, Plus, RefreshCw, Rss } from 'lucide-react';
import { addSubscriptionCandidate, getSubscriptionWork, listSubscriptionFeeds, listSubscriptionWorks, markSubscriptionWorkRead } from '@/lib/api/apiClient';
import type { SubscriptionFeed, SubscriptionWork, SubscriptionWorkDetail, SubscriptionWorkFilter } from '@/types/subscriptionReader';
import { toast } from '@/features/toast/toast';
import VideoEmbed from '@/components/ui/video-embed';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import FeedsManagerSheet from '../components/FeedsManagerSheet';
import SubscriptionVideoPlayer from '../components/SubscriptionVideoPlayer';
import { cn } from '@/lib/utils';

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-border px-3 text-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const FILTERS: Array<[SubscriptionWorkFilter, string]> = [['all', '全部'], ['article', '文章'], ['video', '视频']];

function httpUrl(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

function platform(feed: SubscriptionFeed): string {
  const url = `${feed.url} ${feed.siteUrl ?? ''}`;
  if (/douyin|iesdouyin/i.test(url)) return '抖音';
  if (/bilibili|b23\.tv/i.test(url)) return 'B站';
  if (/mp\.weixin|wechat/i.test(url)) return '公众号';
  if (/youtube|youtu\.be/i.test(url)) return 'YouTube';
  if (/twitter|x\.com/i.test(url)) return 'X';
  return 'RSS';
}

function dateLabel(value: string | null): string {
  if (!value) return '发布日期未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '发布日期未知';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return date.toLocaleDateString('zh-CN');
}

function Avatar({ feed }: { feed: SubscriptionFeed }) {
  const [failed, setFailed] = useState(false);
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 text-sm font-semibold text-primary">
    {httpUrl(feed.iconUrl) && !failed ? <img src={feed.iconUrl!} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : feed.title.slice(0, 1)}
  </span>;
}

/** Same reader in the narrow DSH panel and the full-width Web app. */
export default function H5ReaderPage() {
  const initialQuery = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const [feeds, setFeeds] = useState<SubscriptionFeed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);
  const [feedsError, setFeedsError] = useState(false);
  const [selectedFeed, setSelectedFeed] = useState<string | null>(initialQuery.get('feed'));
  const [type, setType] = useState<SubscriptionWorkFilter>(initialQuery.get('type') === 'video' ? 'video' : initialQuery.get('type') === 'article' ? 'article' : 'all');
  const [items, setItems] = useState<SubscriptionWork[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialQuery.get('item'));
  const [detail, setDetail] = useState<SubscriptionWorkDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [readError, setReadError] = useState(false);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [arrivals, setArrivals] = useState<Record<string, number>>({});
  const feedSnapshot = useRef<SubscriptionFeed[] | null>(null);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const listScroll = useRef<HTMLDivElement>(null);

  const reloadFeeds = useCallback(async () => {
    try {
      const result = await listSubscriptionFeeds({ notifyOnError: false });
      if (feedSnapshot.current) {
        const previous = new Map(feedSnapshot.current.map((feed) => [feed.id, feed]));
        setArrivals((current) => {
          const next = { ...current };
          for (const feed of result.items) {
            const old = previous.get(feed.id);
            if (old && old.newestId !== feed.newestId && feed.articleCount > old.articleCount) {
              next[feed.id] = (next[feed.id] ?? 0) + feed.articleCount - old.articleCount;
            }
          }
          return next;
        });
      }
      feedSnapshot.current = result.items;
      setFeeds(result.items);
      setFeedsError(false);
    } catch { setFeedsError(true); }
    finally { setFeedsLoading(false); }
  }, []);

  useEffect(() => {
    void reloadFeeds();
    const timer = window.setInterval(() => { if (!document.hidden) void reloadFeeds(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [reloadFeeds]);

  const loadWorks = useCallback(async () => {
    if (selectedFeed === null) return;
    const version = ++listVersion.current;
    setLoading(true);
    setListError(false);
    setItems([]);
    setCursor(null);
    setLoadingMore(false);
    try {
      const result = await listSubscriptionWorks({ feedId: selectedFeed === 'all' ? undefined : selectedFeed, type }, { notifyOnError: false });
      if (version !== listVersion.current) return;
      setItems(result.items);
      setCursor(result.nextCursor);
      setArrivals((current) => selectedFeed === 'all' ? {} : { ...current, [selectedFeed]: 0 });
      if (listScroll.current) listScroll.current.scrollTop = 0;
    } catch { if (version === listVersion.current) setListError(true); }
    finally { if (version === listVersion.current) setLoading(false); }
  }, [selectedFeed, type]);

  useEffect(() => { void loadWorks(); return () => { listVersion.current += 1; }; }, [loadWorks]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (selectedFeed) query.set('feed', selectedFeed);
    if (type !== 'all') query.set('type', type);
    if (selectedId) query.set('item', selectedId);
    window.history.replaceState(null, '', `#/reader${query.size ? `?${query}` : ''}`);
  }, [selectedFeed, type, selectedId]);

  const markRead = useCallback(async (work: SubscriptionWork) => {
    try {
      await markSubscriptionWorkRead(work.id, { notifyOnError: false });
      setReadError(false);
      setItems((current) => current.map((item) => item.id === work.id ? { ...item, isRead: true } : item));
      setDetail((current) => current?.id === work.id ? { ...current, isRead: true } : current);
      void reloadFeeds();
    } catch { setReadError(true); }
  }, [reloadFeeds]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    const version = ++detailVersion.current;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(false);
    setReadError(false);
    try {
      const result = await getSubscriptionWork(selectedId, { notifyOnError: false });
      if (version !== detailVersion.current) return;
      setDetail(result.item);
      if (!result.item.isRead) void markRead(result.item);
    } catch { if (version === detailVersion.current) setDetailError(true); }
    finally { if (version === detailVersion.current) setDetailLoading(false); }
  }, [selectedId, markRead]);

  useEffect(() => { void loadDetail(); return () => { detailVersion.current += 1; }; }, [loadDetail]);

  async function loadMore() {
    if (!cursor || loadingMore || selectedFeed === null) return;
    const version = listVersion.current;
    setLoadingMore(true);
    try {
      const result = await listSubscriptionWorks({ feedId: selectedFeed === 'all' ? undefined : selectedFeed, type, cursor }, { notifyOnError: true });
      if (version !== listVersion.current) return;
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((old) => old.id === item.id))]);
      setCursor(result.nextCursor);
    } catch { /* apiClient displays the error; existing page remains available. */ }
    finally { if (version === listVersion.current) setLoadingMore(false); }
  }

  async function addCandidate(work: SubscriptionWork) {
    if (work.inCandidatePool || adding[work.id]) return;
    setAdding((current) => ({ ...current, [work.id]: true }));
    try {
      await addSubscriptionCandidate(work.id);
      const update = <T extends SubscriptionWork,>(item: T): T => item.id === work.id ? { ...item, inCandidatePool: true, governanceStatus: 'archived' } : item;
      setItems((current) => current.map(update));
      setDetail((current) => current ? update(current) : current);
      toast.success('已加入候选池，可在创作的选题池中查看');
    } catch { /* apiClient displays the failure and permits retry. */ }
    finally { setAdding((current) => ({ ...current, [work.id]: false })); }
  }

  function candidateButton(work: SubscriptionWork) {
    const label = work.governanceStatus === 'used' ? '已用于创作' : work.inCandidatePool ? '已加入候选池' : '加入候选池';
    return <button type="button" aria-label={`${label}：${work.title}`} disabled={work.inCandidatePool || adding[work.id]}
      className={cn(buttonClass, 'shrink-0 text-primary')} onClick={() => void addCandidate(work)}>
      {work.inCandidatePool ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      {adding[work.id] ? '加入中…' : label}
    </button>;
  }

  function chooseFeed(id: string) { setSelectedId(null); setSelectedFeed(id); setType('all'); }
  const feed = feeds.find((entry) => entry.id === selectedFeed);
  const unread = feeds.reduce((sum, entry) => sum + entry.unreadCount, 0);
  const newCount = selectedFeed === 'all' ? Object.values(arrivals).reduce((sum, count) => sum + count, 0) : arrivals[selectedFeed ?? ''] ?? 0;

  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background pb-[calc(5rem+env(safe-area-inset-bottom))] text-foreground md:pb-0 md:pl-20">
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <BookOpen className="h-4 w-4 text-primary" /><h1 className="text-sm font-semibold">阅读</h1>
      <span className="text-xs text-muted-foreground">{feeds.length} 个订阅 · {unread} 条未读</span>
      <button className={cn(buttonClass, 'ml-auto px-2')} aria-label="刷新阅读列表" onClick={() => { void reloadFeeds(); if (selectedFeed && !selectedId) void loadWorks(); }}><RefreshCw className="h-4 w-4" /></button>
      <button className={cn(buttonClass, 'px-2')} aria-label="订阅管理" onClick={() => setManagerOpen(true)}><Plus className="h-4 w-4" /><span className="hidden min-[400px]:inline">订阅</span></button>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside aria-label="订阅博主" className={cn('min-h-0 w-full shrink-0 overflow-y-auto border-r border-border/60 p-3 md:block md:w-56 xl:w-72', selectedFeed !== null ? 'hidden' : 'block')}>
        <button className={cn('mb-3 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-left', selectedFeed === 'all' && 'ring-1 ring-primary/40')} onClick={() => chooseFeed('all')}>
          <Rss className="h-5 w-5 text-primary" /><span className="flex-1 text-sm font-medium">全部动态</span><span className="font-mono text-xs text-primary">{unread}</span>
        </button>
        {feedsLoading && <p role="status" className="p-4 text-sm text-muted-foreground">正在加载订阅…</p>}
        {feedsError && <div role="alert" className="mb-3 rounded-xl bg-warning/10 p-3 text-xs">订阅加载失败 <button className="underline" onClick={() => void reloadFeeds()}>重试</button></div>}
        {!feedsLoading && !feedsError && feeds.length === 0 && <p className="p-4 text-sm text-muted-foreground">还没有订阅，点击右上角添加博主或 RSS。</p>}
        <ul className="space-y-2">{feeds.map((entry) => {
          const failed = Boolean(entry.lastFetchError) || (entry.lastFetchStatus !== null && entry.lastFetchStatus >= 400);
          return <li key={entry.id}><button aria-label={`打开博主：${entry.title}`} onClick={() => chooseFeed(entry.id)} className={cn('flex w-full gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-secondary', selectedFeed === entry.id ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card/60')}>
            <Avatar feed={entry} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1"><span className="truncate text-sm font-semibold">{entry.title}</span>{entry.unreadCount > 0 && <span className="ml-auto rounded-full bg-primary/10 px-1.5 font-mono text-[10px] text-primary">{entry.unreadCount}</span>}</span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">{platform(entry)} · {entry.articleCount} 个作品</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{entry.latestTitle ?? '暂无作品更新'}</span>
              {entry.latestPublishedAt && <span className="mt-1 block text-[10px] text-muted-foreground">{dateLabel(entry.latestPublishedAt)}</span>}
              {failed && <span className="mt-1 block line-clamp-2 text-[11px] text-warning">{entry.lastFetchError || `采集失败（${entry.lastFetchStatus}）`}</span>}
              {!entry.enabled && <span className="block text-[11px] text-muted-foreground">已暂停采集</span>}
              {entry.enabled && !entry.lastFetchedAt && !failed && <span className="block text-[11px] text-muted-foreground">等待首次采集</span>}
            </span>
          </button></li>;
        })}</ul>
      </aside>
      <section aria-label="博主作品" className={cn('min-h-0 min-w-0 flex-1 flex-col border-r border-border/60 md:flex', selectedFeed === null || selectedId ? 'hidden' : 'flex', selectedId && 'md:max-w-[360px]')}>
        {selectedFeed === null ? <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">选择一位博主，查看他的文章和视频</div> : <>
          <div className="shrink-0 border-b border-border/60 p-3">
            <div className="flex items-center gap-2">
              <button className={cn(buttonClass, 'px-2 md:hidden')} aria-label="返回博主列表" onClick={() => setSelectedFeed(null)}><ArrowLeft className="h-4 w-4" /></button>
              <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{feed?.title ?? '全部动态'}</h2>{feed && <p className="mt-1 text-[11px] text-muted-foreground">{platform(feed)} · {feed.articleCount} 个作品 · {feed.unreadCount} 条未读</p>}</div>
              {httpUrl(feed?.siteUrl) && <a className={buttonClass} href={feed!.siteUrl!} target="_blank" rel="noreferrer">主页<ExternalLink className="h-3 w-3" /></a>}
            </div>
            {feed?.lastFetchedAt && <p className="mt-2 text-[10px] text-muted-foreground">上次采集：{new Date(feed.lastFetchedAt).toLocaleString('zh-CN')}</p>}
            <div className="mt-3 flex gap-2">{FILTERS.map(([value, label]) => <button key={value} aria-pressed={type === value} className={cn(buttonClass, type === value && 'border-primary/40 bg-primary/10 text-primary')} onClick={() => { setSelectedId(null); setType(value); }}>{label}</button>)}</div>
          </div>
          {newCount > 0 && <button className="shrink-0 bg-primary/10 p-3 text-xs text-primary" onClick={() => void loadWorks()}>有 {newCount} 条新作品，点击更新</button>}
          <div ref={listScroll} className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && <p role="status" className="p-6 text-center text-sm text-muted-foreground">正在加载作品…</p>}
            {listError && <div role="alert" className="p-6 text-center text-sm">作品列表加载失败<button className={cn(buttonClass, 'mt-3')} onClick={() => void loadWorks()}>重新加载列表</button></div>}
            {!loading && !listError && items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{feed?.lastFetchStatus && feed.lastFetchStatus >= 400 ? '暂未采集到作品，请查看博主的采集错误。' : '暂无符合条件的作品'}</p>}
            <ul className="space-y-3">{items.map((item, index) => <li key={item.id}>
              {(index === 0 || dateLabel(items[index - 1].publishedAt) !== dateLabel(item.publishedAt)) && <h3 className="mb-2 mt-3 text-xs font-medium text-muted-foreground">{dateLabel(item.publishedAt)}</h3>}
              <div className={cn('gov-card overflow-hidden p-3', selectedId === item.id && 'gov-card-selected')}>
                <button data-testid="reader-article-row" className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedId(item.id)}>
                  {httpUrl(item.previewImage) && <div className="relative mb-3"><img src={item.previewImage!} alt="" loading="lazy" className="max-h-40 w-full rounded-xl object-cover" />{item.contentType === 'video' && <Play className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-black/60 p-2 text-white" />}</div>}
                  <span className="flex items-center gap-2 text-[10px] text-muted-foreground"><span>{item.contentType === 'video' ? '视频' : '文章'}</span><span className="truncate">{item.feedTitle}</span>{!item.isRead && <span className="ml-auto shrink-0 text-primary">未读</span>}</span>
                  <h4 className={cn('mt-2 line-clamp-3 text-sm leading-relaxed', item.isRead ? 'font-medium' : 'font-semibold')}>{item.title}</h4>
                  {item.summary && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.summary}</p>}
                </button>
                <div className="mt-3 flex justify-end">{candidateButton(item)}</div>
              </div>
            </li>)}</ul>
            {cursor && <button className={cn(buttonClass, 'mt-4 w-full')} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '加载中…' : '加载更多作品'}</button>}
          </div>
        </>}
      </section>
      {selectedId && <section aria-label="作品详情" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 p-3"><button className={buttonClass} aria-label="返回作品列表" onClick={() => setSelectedId(null)}><ArrowLeft className="h-4 w-4" />返回</button><span className="ml-auto">{detail && candidateButton(detail)}</span></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5">
          {detailLoading && <p role="status" className="p-6 text-sm text-muted-foreground">正在加载作品…</p>}
          {detailError && <div role="alert" className="space-y-3 text-center"><p>作品加载失败</p><button className={buttonClass} onClick={() => void loadDetail()}>重新加载作品</button></div>}
          {detail && <article className="mx-auto max-w-2xl">
            <p className="text-xs text-muted-foreground">{detail.feedTitle}{detail.author ? ` · ${detail.author}` : ''}</p>
            <h2 className="mt-3 text-xl font-semibold leading-relaxed">{detail.title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><time>{detail.publishedAt ? new Date(detail.publishedAt).toLocaleString('zh-CN') : '发布日期未知'}</time>{httpUrl(detail.sourceUrl) && <a href={detail.sourceUrl!} target="_blank" rel="noreferrer" className="text-primary">查看原文 ↗</a>}</div>
            {readError && <button className="mt-3 text-xs text-warning underline" onClick={() => void markRead(detail)}>已读状态保存失败，点击重试</button>}
            {detail.hasPlayableVideo ? <SubscriptionVideoPlayer key={detail.id} id={detail.id} title={detail.title} poster={httpUrl(detail.previewImage)} /> : detail.contentType === 'video' ? <VideoEmbed sourceUrl={detail.sourceUrl} previewImage={detail.previewImage} title={detail.title} /> : null}
            {detail.content ? <div data-testid="reader-content" className="prose mt-5 max-w-none break-words text-[15px] prose-img:max-w-full prose-video:max-w-full dark:prose-invert" dangerouslySetInnerHTML={{ __html: detail.content }} /> : <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{detail.summary || '暂未获取正文，可通过原文链接查看。'}</p>}
          </article>}
        </div>
      </section>}
    </div>
    <FeedsManagerSheet open={managerOpen} onClose={() => setManagerOpen(false)} onChanged={() => { void reloadFeeds(); }} />
    <MobileTabBar />
  </div>;
}

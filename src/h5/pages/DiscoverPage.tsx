'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Compass, Flame, Github, Plus, Puzzle, RefreshCw, Rss } from 'lucide-react';
import {
  createFeed,
  deleteFeed,
  listRecommendedFeeds,
  listFeedItems,
  listSubscribePrefs,
  listSubscribeSources,
  saveSubscribePrefs,
  type RecommendedFeedEntry,
  type SubscribeSourceEntry,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import SubscribeTabs, {
  type NavIcon,
  type SubscribeNavState,
  type SubscribePill,
} from '../components/SubscribeTabs';

const TrendingConsole = lazy(() => import('@/features/trending/components/TrendingConsole'));

/** 一级来源图标注册表：subscribe_sources.icon → lucide 组件（未知图标回退罗盘）。 */
const SOURCE_ICONS: Record<string, NavIcon> = {
  flame: Flame,
  rss: Rss,
  github: Github,
  puzzle: Puzzle,
  bell: Rss,
  zap: Flame,
  newspaper: Rss,
};

/** 数据库不可用/无配置时的兜底来源（与 0016 迁移种子一致）。 */
const DEFAULT_SOURCES: SubscribeSourceEntry[] = [
  { key: 'hot', label: '热点新闻', icon: 'flame', sort: 10 },
  { key: 'rss', label: 'RSS 订阅', icon: 'rss', sort: 20 },
  { key: 'github', label: 'GitHub', icon: 'github', sort: 30 },
  { key: 'dsh', label: 'DSH 插件', icon: 'puzzle', sort: 40 },
];

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  ai: { label: 'AI', className: 'border-purple-400/40 bg-purple-400/10 text-purple-500 dark:text-purple-300' },
  bilibili: { label: 'B站', className: 'border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300' },
  douyin: { label: '抖音', className: 'border-neutral-400/40 bg-neutral-400/10 text-neutral-600 dark:text-neutral-300' },
  tech: { label: '科技', className: 'border-teal-400/40 bg-teal-400/10 text-teal-600 dark:text-teal-300' },
  rss: { label: 'RSS', className: 'border-border bg-secondary text-secondary-foreground' },
};

export interface DiscoverPageProps {
  /** 进入时的子 tab key（/discover?tab=github 等）；缺省第一个来源。 */
  initialTab?: string;
}

export default function DiscoverPage({ initialTab }: DiscoverPageProps = {}) {
  const [sources, setSources] = useState<SubscribeSourceEntry[]>(DEFAULT_SOURCES);
  const [subTab, setSubTab] = useState<string>(initialTab ?? DEFAULT_SOURCES[0]?.key ?? 'hot');
  const [recommended, setRecommended] = useState<RecommendedFeedEntry[]>([]);
  const [subscribedUrls, setSubscribedUrls] = useState<Set<string>>(new Set());
  const [feedIdByUrl, setFeedIdByUrl] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [subscribingUrl, setSubscribingUrl] = useState<string | null>(null);
  // 用户订阅偏好：sourceKey → 子类 key 列表。未勾选 = 不展示（订阅制：勾了才给看）。
  const [prefs, setPrefs] = useState<Record<string, string[]>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [savingPrefs, setSavingPrefs] = useState(false);
  // 通道视图（热点控制台等）上报给统一导航的数据
  const [navState, setNavState] = useState<SubscribeNavState>({});
  const handleNavUpdate = useCallback((next: SubscribeNavState) => setNavState(next), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rec, feeds, src, prefRows] = await Promise.all([
        listRecommendedFeeds({ notifyOnError: false }),
        listFeedItems({ notifyOnError: false }),
        listSubscribeSources({ notifyOnError: false }).catch(() => DEFAULT_SOURCES),
        listSubscribePrefs({ notifyOnError: false }).catch(() => []),
      ]);
      setRecommended(rec);
      setSubscribedUrls(new Set(feeds.items.map((f) => f.url)));
      setFeedIdByUrl(new Map(feeds.items.map((f) => [f.url, String((f as { id?: string }).id ?? '')])));
      if (src.length > 0) setSources(src);
      const grouped: Record<string, string[]> = {};
      for (const row of prefRows) {
        (grouped[row.sourceKey] ??= []).push(row.prefKey);
      }
      setPrefs(grouped);
    } catch {
      // 静默：保持已有状态
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 切到非通道视图时清掉通道上报的导航数据（避免残留）
  useEffect(() => {
    if (subTab === 'rss') setNavState({});
  }, [subTab]);

  const subscribe = useCallback(async (item: RecommendedFeedEntry) => {
    setSubscribingUrl(item.url);
    try {
      await createFeed({ title: item.title, url: item.url, siteUrl: item.siteUrl ?? null, categoryName: null });
      setSubscribedUrls((prev) => new Set([...prev, item.url]));
    } catch {
      // apiClient 已统一 toast
    } finally {
      setSubscribingUrl(null);
    }
  }, []);

  const unsubscribe = useCallback(
    async (item: RecommendedFeedEntry) => {
      const feedId = feedIdByUrl.get(item.url);
      if (!feedId) return;
      setSubscribingUrl(item.url);
      try {
        await deleteFeed(feedId);
        setSubscribedUrls((prev) => {
          const next = new Set(prev);
          next.delete(item.url);
          return next;
        });
      } catch {
        // apiClient 已统一 toast
      } finally {
        setSubscribingUrl(null);
      }
    },
    [feedIdByUrl],
  );

  const savePrefs = useCallback(async (source: string, keys: string[]) => {
    setSavingPrefs(true);
    try {
      await saveSubscribePrefs(source, keys);
      setPrefs((prev) => ({ ...prev, [source]: keys }));
      setPickerOpen(false);
    } catch {
      // apiClient 已统一 toast
    } finally {
      setSavingPrefs(false);
    }
  }, []);

  // 展示口径 = 已订阅：RSS 只出订阅的博主；未订阅显示引导
  const subscribedFeeds = useMemo(
    () => recommended.filter((r) => subscribedUrls.has(r.url)),
    [recommended, subscribedUrls],
  );

  // RSS 分类标签（按已订阅博主推断分类，筛选订阅流）
  const RSS_CATS = ['全部', 'AI', '科技', '开源', '新闻热点', '独立开发'] as const;
  type RssCat = (typeof RSS_CATS)[number];
  function inferRssCat(item: RecommendedFeedEntry): Exclude<RssCat, '全部'> {
    if (item.platform === 'ai') return 'AI';
    if (item.platform === 'tech') return '科技';
    if (item.url.includes('github.com') || item.title.toLowerCase().includes('trending')) return '开源';
    if (/36氪|热榜|新闻|日报|晚报/.test(item.title)) return '新闻热点';
    if (/独立|变现|ezindie/.test(item.title)) return '独立开发';
    if (item.platform === 'bilibili') return '科技';
    return '独立开发';
  }
  const [rssCat, setRssCat] = useState<RssCat>('全部');
  const rssList = useMemo(
    () => (rssCat === '全部' ? subscribedFeeds : subscribedFeeds.filter((r) => inferRssCat(r) === rssCat)),
    [subscribedFeeds, rssCat],
  );
  const rssCounts = useMemo(() => {
    const map = new Map<RssCat, number>();
    for (const item of subscribedFeeds) {
      const cat = inferRssCat(item);
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return map;
  }, [subscribedFeeds]);

  // 订阅管理加号：打开当前来源的勾选面板（热点/GitHub 带草稿态，RSS 即时生效）
  const openPicker = useCallback(() => {
    const prefKey = subTab === 'github' ? 'github' : subTab === 'hot' ? 'hot' : '';
    setDraftKeys(prefKey ? prefs[prefKey] ?? [] : []);
    setPickerOpen(true);
  }, [subTab, prefs]);

  const plusButton = (
    <button
      type="button"
      onClick={openPicker}
      aria-label="管理订阅"
      title="管理订阅"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary transition-colors duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
    </button>
  );

  const trendingView = (channel: 'news' | 'github' | 'dsh') => (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
        </div>
      }
    >
      <TrendingConsole
        embedded
        initialHotTab={channel}
        // 订阅制：勾了才展示（空数组 = 未勾选任何子类 → 通道显示引导）
        platformFilter={subTab === 'hot' ? prefs.hot ?? [] : undefined}
        categoryFilter={subTab === 'github' ? prefs.github ?? [] : undefined}
        onNavUpdate={handleNavUpdate}
      />
    </Suspense>
  );

  // 订阅管理加号：按当前来源渲染可订阅项（勾选保存在插件本地库）
  const pickerTitle =
    subTab === 'hot'
      ? '订阅热点平台'
      : subTab === 'rss'
        ? '订阅博主'
        : subTab === 'github'
          ? '订阅 GitHub 分类'
          : subTab === 'dsh'
            ? '订阅 DSH 插件'
            : '订阅';
  const pickerHint =
    subTab === 'hot'
      ? '勾选要看的平台，只有勾选的平台会展示。'
      : subTab === 'rss'
        ? '点选即订阅/退订，内容自动进入你的阅读流。'
        : subTab === 'github'
          ? '勾选关注的分类（如设计与素材），只有勾选的分类会展示。'
          : '插件市场订阅即将开放。';

  const toggleRssFeed = async (item: RecommendedFeedEntry) => {
    if (subscribedUrls.has(item.url)) {
      await unsubscribe(item);
    } else {
      await subscribe(item);
    }
  };

  /** 博主卡片网格（RSS 订阅流）。 */
  const feedCards = (items: RecommendedFeedEntry[]) => {
    if (loading) {
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">还没有订阅内容</p>
          <p className="mt-2 text-xs text-muted-foreground">点右上角「+」勾选订阅，内容会出现在这里。</p>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item) => {
          const badge = PLATFORM_BADGE[item.platform ?? 'rss'] ?? PLATFORM_BADGE.rss;
          const subscribed = subscribedUrls.has(item.url);
          const busy = subscribingUrl === item.url;
          return (
            <div
              key={item.url}
              className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start gap-2.5">
                <span className={cn('inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold', badge.className)}>
                  {badge.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{item.title}</span>
              </div>
              <p className="line-clamp-2 min-h-[34px] text-[11.5px] leading-relaxed text-muted-foreground">{item.description}</p>
              <div className="mt-auto">
                {subscribed ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                    <Check className="h-3 w-3" aria-hidden="true" /> 已订阅
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void subscribe(item)}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-[11.5px] font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97] disabled:opacity-50"
                  >
                    {busy ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
                    {busy ? '订阅中…' : '订阅'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const trendingView = (channel: 'news' | 'github' | 'dsh') => (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
        </div>
      }
    >
      <TrendingConsole
        embedded
        initialHotTab={channel}
        // 订阅制：勾了才展示（空数组 = 未勾选任何子类 → 通道显示引导）
        platformFilter={subTab === 'hot' ? prefs.hot ?? [] : undefined}
        categoryFilter={subTab === 'github' ? prefs.github ?? [] : undefined}
        onNavUpdate={handleNavUpdate}
      />
    </Suspense>
  );

  // 统一导航数据：RSS 来自本地分类；通道视图来自控制台上报
  const activeNav: SubscribeNavState =
    subTab === 'rss'
      ? {
          pills: RSS_CATS.filter((cat) => cat === '全部' || (rssCounts.get(cat) ?? 0) > 0).map((cat) => ({
            key: cat,
            label: cat,
            count: cat === '全部' ? subscribedFeeds.length : rssCounts.get(cat),
            active: rssCat === cat,
          })),
          onPill: (key) => setRssCat(key as RssCat),
          onRefresh: () => void load(),
        }
      : navState;

  return (
    <div className={subTab === 'rss' ? 'min-h-screen bg-background' : 'flex min-h-screen flex-col bg-background'}>
      {/* 通道视图（热点/GitHub/DSH）满幅贴边贴底；RSS 订阅流保留窄容器网格 */}
      <main
        className={
          subTab === 'rss'
            ? 'mx-auto max-w-5xl px-4 pb-28 pt-4 sm:px-6 md:pb-10'
            : 'flex min-h-0 flex-1 flex-col px-0 pb-3 pt-4'
        }
      >
        <SubscribeTabs
          tabs={sources.map((s) => ({ key: s.key, label: s.label, Icon: SOURCE_ICONS[s.icon] ?? Compass }))}
          active={subTab}
          onChange={setSubTab}
          pills={activeNav.pills}
          onPill={activeNav.onPill}
          stats={activeNav.stats}
          plus={plusButton}
          sync={subTab === 'hot' && navState.canSync ? { syncing: !!navState.syncing, onSync: navState.onSync! } : null}
          onRefresh={activeNav.onRefresh}
          className={subTab === 'rss' ? undefined : 'px-4 shrink-0'}
        />

        {subTab === 'hot' ? (
          // 热点新闻：平台榜单（插件自采 trend_radar_items + 中台补充渠道；按订阅平台过滤）
          trendingView('news')
        ) : null}

        {subTab === 'github' ? (
          // GitHub：中台 GitHub 趋势仓库通道（按订阅分类过滤）
          trendingView('github')
        ) : null}

        {subTab === 'dsh' ? (
          // DSH 插件：中台插件市场通道
          trendingView('dsh')
        ) : null}

        {subTab === 'rss' ? feedCards(rssList) : null}

        {!['hot', 'rss', 'github', 'dsh'].includes(subTab) ? (
          // 配置化新增的来源：内容视图按 key 渐进接入
          <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">「{sources.find((s) => s.key === subTab)?.label ?? subTab}」内容视图即将上线</p>
          </div>
        ) : null}
      </main>

      {pickerOpen ? (
        <div
          role="dialog"
          aria-label={pickerTitle}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-foreground">{pickerTitle}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{pickerHint}</p>
            <div className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
              {subTab === 'rss' ? (
                loading ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
                ) : (
                  recommended.map((item) => {
                    const subscribed = subscribedUrls.has(item.url);
                    const busy = subscribingUrl === item.url;
                    return (
                      <button
                        key={item.url}
                        type="button"
                        role="checkbox"
                        aria-checked={subscribed}
                        disabled={busy}
                        onClick={() => void toggleRssFeed(item)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition-colors duration-150',
                          subscribed ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-secondary/60',
                          busy && 'opacity-50',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            subscribed ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                          )}
                        >
                          {subscribed ? <Check aria-hidden="true" className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {subscribed ? <span className="shrink-0 text-[10px] opacity-70">已订阅</span> : null}
                      </button>
                    );
                  })
                )
              ) : subTab === 'dsh' ? (
                <p className="py-6 text-center text-xs text-muted-foreground">插件市场订阅即将开放。</p>
              ) : (
                <>
                  {(navState.pills ?? []).length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">数据加载中…</p>
                  ) : (
                    (navState.pills ?? []).map((pick) => {
                      const checked = draftKeys.includes(pick.key);
                      return (
                        <button
                          key={pick.key}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() =>
                            setDraftKeys((prev) =>
                              prev.includes(pick.key) ? prev.filter((k) => k !== pick.key) : [...prev, pick.key],
                            )
                          }
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition-colors duration-150',
                            checked ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-secondary/60',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                            )}
                          >
                            {checked ? <Check aria-hidden="true" className="h-3 w-3" /> : null}
                          </span>
                          {pick.label}
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="inline-flex h-9 items-center rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {subTab === 'rss' ? '完成' : '取消'}
              </button>
              {subTab !== 'rss' && subTab !== 'dsh' ? (
                <button
                  type="button"
                  disabled={savingPrefs}
                  onClick={() => void savePrefs(subTab === 'github' ? 'github' : 'hot', draftKeys)}
                  className="inline-flex h-9 items-center rounded-full bg-primary px-5 text-xs font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 disabled:opacity-50"
                >
                  {savingPrefs ? '保存中…' : '保存'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Compass, Flame, Github, Plus, Puzzle, RefreshCw, Rss } from 'lucide-react';
import {
  createFeed,
  listRecommendedFeeds,
  listFeedItems,
  listSubscribePrefs,
  listSubscribeSources,
  saveSubscribePrefs,
  type RecommendedFeedEntry,
  type SubscribeSourceEntry,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import SubscribeTabs, { type NavIcon } from '../components/SubscribeTabs';

const TrendingConsole = lazy(() => import('@/features/trending/components/TrendingConsole'));

type Category = '全部' | 'AI' | '科技' | '开源' | '新闻热点' | '独立开发';

const CATEGORY_ORDER: Category[] = ['全部', 'AI', '科技', '开源', '新闻热点', '独立开发'];

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

/** 根据推荐源的 platform 和标题推断细分类。 */
function inferCategory(item: RecommendedFeedEntry): Exclude<Category, '全部'> {
  if (item.platform === 'ai') return 'AI';
  if (item.platform === 'tech') return '科技';
  if (item.url.includes('github.com') || item.title.toLowerCase().includes('trending')) return '开源';
  if (/36氪|热榜|新闻|日报|晚报/.test(item.title)) return '新闻热点';
  if (/独立|变现|ezindie/.test(item.title)) return '独立开发';
  if (item.platform === 'bilibili') return '科技';
  return '独立开发';
}

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  ai: { label: 'AI', className: 'border-purple-400/40 bg-purple-400/10 text-purple-500 dark:text-purple-300' },
  bilibili: { label: 'B站', className: 'border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300' },
  douyin: { label: '抖音', className: 'border-neutral-400/40 bg-neutral-400/10 text-neutral-600 dark:text-neutral-300' },
  tech: { label: '科技', className: 'border-teal-400/40 bg-teal-400/10 text-teal-600 dark:text-teal-300' },
  rss: { label: 'RSS', className: 'border-border bg-secondary text-secondary-foreground' },
};

function categoryOf(item: RecommendedFeedEntry): Exclude<Category, '全部'> {
  return inferCategory(item);
}

export interface DiscoverPageProps {
  /** 进入时的子 tab key（/discover?tab=github 等）；缺省第一个来源。 */
  initialTab?: string;
}

export default function DiscoverPage({ initialTab }: DiscoverPageProps = {}) {
  const [sources, setSources] = useState<SubscribeSourceEntry[]>(DEFAULT_SOURCES);
  const [subTab, setSubTab] = useState<string>(initialTab ?? DEFAULT_SOURCES[0]?.key ?? 'hot');
  const [recommended, setRecommended] = useState<RecommendedFeedEntry[]>([]);
  const [subscribedUrls, setSubscribedUrls] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>('全部');
  const [subscribingUrl, setSubscribingUrl] = useState<string | null>(null);
  // 用户订阅偏好：sourceKey → 子类 key 列表（空 = 全订）
  const [prefs, setPrefs] = useState<Record<string, string[]>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [savingPrefs, setSavingPrefs] = useState(false);
  // 通道视图（热点控制台等）上报给统一导航的二级内容/统计/动作/可选项
  const [navExt, setNavExt] = useState<{
    secondary?: ReactNode;
    stats?: ReactNode;
    actions?: ReactNode;
    picks?: Array<{ key: string; label: string }>;
  }>({});
  const handleNavUpdate = useCallback(
    (next: {
      secondary?: ReactNode;
      stats?: ReactNode;
      actions?: ReactNode;
      picks?: Array<{ key: string; label: string }>;
    }) =>
      setNavExt((prev) => ({
        secondary: next.secondary,
        stats: next.stats,
        actions: next.actions,
        picks: next.picks ?? prev.picks,
      })),
    [],
  );

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

  // 切到非通道视图时清掉通道上报的二级内容（避免残留）
  useEffect(() => {
    if (subTab === 'rss') setNavExt({});
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

  const savePrefs = useCallback(
    async (source: string, keys: string[]) => {
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
    },
    [],
  );

  const filtered = useMemo(
    () => (category === '全部' ? recommended : recommended.filter((r) => categoryOf(r) === category)),
    [recommended, category],
  );

  const counts = useMemo(() => {
    const map = new Map<Category, number>();
    for (const item of recommended) {
      const cat = categoryOf(item);
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return map;
  }, [recommended]);

  // 热点平台勾选（空 = 全订）
  const hotPlatformFilter = prefs.hot?.length ? prefs.hot : undefined;
  const hotPicks = navExt.picks ?? [];
  const openHotPicker = useCallback(() => {
    setDraftKeys(hotPlatformFilter ?? hotPicks.map((p) => p.key));
    setPickerOpen(true);
  }, [hotPlatformFilter, hotPicks]);

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
          <p className="text-sm font-medium text-foreground">这个分类暂时没有推荐</p>
          <p className="mt-2 text-xs text-muted-foreground">换个分类看看，或者搜索添加你自己的博主。</p>
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
        platformFilter={subTab === 'hot' ? hotPlatformFilter : undefined}
        onNavUpdate={handleNavUpdate}
      />
    </Suspense>
  );

  // RSS 二级分类 chips（紧贴一级下方，由统一导航渲染）
  const rssSecondary = CATEGORY_ORDER.map((cat) => {
    const n = cat === '全部' ? recommended.length : counts.get(cat) ?? 0;
    if (cat !== '全部' && n === 0) return null;
    return (
      <button
        key={cat}
        type="button"
        onClick={() => setCategory(cat)}
        className={cn(
          'flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150',
          category === cat
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-card text-muted-foreground hover:text-foreground',
        )}
      >
        {cat}
        {n > 0 ? <span className="ml-1 opacity-50">{n}</span> : null}
      </button>
    );
  });

  return (
    <div className={subTab === 'rss' ? 'min-h-screen bg-background' : 'flex min-h-screen flex-col bg-background'}>
      {/* 通道视图（热点/GitHub/DSH）满幅贴边贴底；RSS 发现流保留窄容器网格 */}
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
          className={subTab === 'rss' ? undefined : 'px-4 shrink-0'}
          actions={
            <>
              {subTab === 'hot' ? (
                <button
                  type="button"
                  onClick={openHotPicker}
                  aria-label="选择订阅的平台"
                  title="选择订阅哪些平台"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary transition-colors duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
              {navExt.actions}
              {subTab === 'rss' ? (
                <button
                  type="button"
                  onClick={() => void load()}
                  aria-label="刷新"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <RefreshCw aria-hidden="true" className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </button>
              ) : null}
            </>
          }
          secondary={subTab === 'rss' ? rssSecondary : navExt.secondary}
          stats={subTab === 'rss' ? null : navExt.stats}
        />

        {subTab === 'hot' ? (
          // 热点新闻：平台榜单（插件自采 trend_radar_items + 中台补充渠道，30 分钟一轮；按订阅平台过滤）
          trendingView('news')
        ) : null}

        {subTab === 'github' ? (
          // GitHub：中台 GitHub 趋势仓库通道
          trendingView('github')
        ) : null}

        {subTab === 'dsh' ? (
          // DSH 插件：中台插件市场通道
          trendingView('dsh')
        ) : null}

        {subTab === 'rss' ? feedCards(filtered) : null}

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
          aria-label="选择订阅的子类"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-foreground">订阅热点平台</p>
            <p className="mt-1 text-[11px] text-muted-foreground">勾选要看的平台；全部不勾 = 全部订阅。</p>
            <div className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
              {hotPicks.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">数据加载中…</p>
              ) : (
                hotPicks.map((pick) => {
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
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="inline-flex h-9 items-center rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingPrefs}
                onClick={() => void savePrefs('hot', draftKeys)}
                className="inline-flex h-9 items-center rounded-full bg-primary px-5 text-xs font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {savingPrefs ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

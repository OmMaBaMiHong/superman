'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Flame, Github, Plus, Puzzle, RefreshCw, Rss } from 'lucide-react';
import {
  createFeed,
  listRecommendedFeeds,
  listFeedItems,
  type RecommendedFeedEntry,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import SubscribeTabs from '../components/SubscribeTabs';

const TrendingConsole = lazy(() => import('@/features/trending/components/TrendingConsole'));

type Category = '全部' | 'AI' | '科技' | '开源' | '新闻热点' | '独立开发';

const CATEGORY_ORDER: Category[] = ['全部', 'AI', '科技', '开源', '新闻热点', '独立开发'];

/** 订阅页一级子 tab：热点新闻 / RSS 订阅 / GitHub / DSH 插件。 */
type SubTab = 'hot' | 'rss' | 'github' | 'dsh';

const SUB_TABS: Array<{ key: SubTab; label: string; Icon: typeof Flame }> = [
  { key: 'hot', label: '热点新闻', Icon: Flame },
  { key: 'rss', label: 'RSS 订阅', Icon: Rss },
  { key: 'github', label: 'GitHub', Icon: Github },
  { key: 'dsh', label: 'DSH 插件', Icon: Puzzle },
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
  /** 进入时的子 tab（/discover?tab=hot|github|dsh）；缺省 RSS 发现流。 */
  initialTab?: 'hot' | 'github' | 'dsh';
}

export default function DiscoverPage({ initialTab }: DiscoverPageProps = {}) {
  // 工作台点进来默认落在热点新闻（订阅的第一来源）
  const [subTab, setSubTab] = useState<SubTab>(initialTab ?? 'hot');
  const [recommended, setRecommended] = useState<RecommendedFeedEntry[]>([]);
  const [subscribedUrls, setSubscribedUrls] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>('全部');
  const [subscribingUrl, setSubscribingUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rec, feeds] = await Promise.all([
        listRecommendedFeeds({ notifyOnError: false }),
        listFeedItems({ notifyOnError: false }),
      ]);
      setRecommended(rec);
      setSubscribedUrls(new Set(feeds.items.map((f) => f.url)));
    } catch {
      // 静默：保持已有状态
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      <TrendingConsole embedded initialHotTab={channel} />
    </Suspense>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* 通道视图（热点/GitHub/DSH）满幅贴边贴底；RSS 发现流保留窄容器网格 */}
      <main
        className={
          subTab === 'rss'
            ? 'mx-auto max-w-5xl px-4 pb-28 pt-4 sm:px-6 md:pb-10'
            : 'px-0 pb-3 pt-4'
        }
      >
        <SubscribeTabs
          tabs={SUB_TABS}
          active={subTab}
          onChange={setSubTab}
          className={subTab === 'rss' ? undefined : 'px-4'}
          actions={
            subTab !== 'hot' ? (
              <button
                type="button"
                onClick={() => void load()}
                aria-label="刷新"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <RefreshCw aria-hidden="true" className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </button>
            ) : null
          }
          secondary={
            subTab === 'rss'
              ? CATEGORY_ORDER.map((cat) => {
                  const n = cat === '全部' ? recommended.length : counts.get(cat) ?? 0;
                  if (cat !== '全部' && n === 0) return null;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={cn(
                        'flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150',
                        category === cat
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {cat}
                      {n > 0 ? <span className="ml-1 opacity-50">{n}</span> : null}
                    </button>
                  );
                })
              : null
          }
        />

        {subTab === 'hot' ? (
          // 热点新闻：平台榜单（插件自采 trend_radar_items + 中台补充渠道，30 分钟一轮）
          trendingView('news')
        ) : null}

        {subTab === 'github' ? (
          // GitHub：中台 GitHub 趋势仓库通道（star 数 / 分类切换在热点控制台内）
          trendingView('github')
        ) : null}

        {subTab === 'dsh' ? (
          // DSH 插件：中台插件市场
          trendingView('dsh')
        ) : null}

        {subTab === 'rss' ? feedCards(filtered) : null}
      </main>
    </div>
  );
}
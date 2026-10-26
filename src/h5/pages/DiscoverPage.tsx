'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Flame, Github, Plus, RefreshCw, Rss } from 'lucide-react';
import {
  createFeed,
  listRecommendedFeeds,
  listFeedItems,
  type RecommendedFeedEntry,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';

const TrendingConsole = lazy(() => import('@/features/trending/components/TrendingConsole'));

type Category = '全部' | 'AI' | '科技' | '开源' | '新闻热点' | '独立开发';

const CATEGORY_ORDER: Category[] = ['全部', 'AI', '科技', '开源', '新闻热点', '独立开发'];

/** 订阅页子 tab：热点新闻（平台榜单）/ RSS 订阅（博主发现流）/ GitHub（仓库订阅）。 */
type SubTab = 'hot' | 'rss' | 'github';

const SUB_TABS: Array<{ key: SubTab; label: string; Icon: typeof Flame }> = [
  { key: 'hot', label: '热点新闻', Icon: Flame },
  { key: 'rss', label: 'RSS 订阅', Icon: Rss },
  { key: 'github', label: 'GitHub', Icon: Github },
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
  /** 进入时的子 tab（/discover?tab=hot|github）；缺省 RSS 发现流。 */
  initialTab?: 'hot' | 'github';
}

export default function DiscoverPage({ initialTab }: DiscoverPageProps = {}) {
  const [subTab, setSubTab] = useState<SubTab>(initialTab ?? 'rss');
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

  const githubFeeds = useMemo(
    () => recommended.filter((r) => categoryOf(r) === '开源' || r.url.includes('github.com')),
    [recommended],
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

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        {/* 头部 */}
        <div className="mb-4">
          <h1 className="text-xl font-bold">订阅</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            热点榜单、博主 RSS 与 GitHub 仓库，内容自动进入你的阅读流
          </p>
        </div>

        {/* 子 tab：热点新闻 / RSS 订阅 / GitHub */}
        <div role="tablist" aria-label="订阅分类" className="mb-5 flex items-center gap-1.5">
          {SUB_TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={subTab === key}
              onClick={() => setSubTab(key)}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-full border px-4 text-[12.5px] font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                subTab === key
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {subTab === 'hot' ? (
          // 热点新闻：平台榜单（插件自采的 trend_radar_items，30 分钟一轮）
          <Suspense
            fallback={
              <div className="flex min-h-[40vh] items-center justify-center">
                <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
              </div>
            }
          >
            <TrendingConsole embedded initialHotTab="news" />
          </Suspense>
        ) : null}

        {subTab === 'github' ? (
          // GitHub：仓库订阅源 + 中台 GitHub 趋势通道
          <Suspense
            fallback={
              <div className="flex min-h-[40vh] items-center justify-center">
                <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
              </div>
            }
          >
            <div>
              <p className="mb-3 text-[12px] text-muted-foreground">GitHub 趋势仓库与开源动态，来自你订阅的仓库源。</p>
              {feedCards(githubFeeds)}
              <div className="mt-5 rounded-2xl border border-border bg-card px-4 py-3.5">
                <p className="text-[12px] text-muted-foreground">
                  想看实时 GitHub Trending 榜单（含 star 数与热度排名）？切到「热点新闻」旁的
                  <button
                    type="button"
                    onClick={() => setSubTab('hot')}
                    className="mx-1 text-primary underline-offset-2 hover:underline"
                  >
                    热点新闻
                  </button>
                  后选 GitHub 通道。
                </p>
              </div>
            </div>
          </Suspense>
        ) : null}

        {subTab === 'rss' ? (
          <>
            {/* 分类 chips */}
            <div className="mb-4 flex flex-wrap gap-2">
              {CATEGORY_ORDER.map((cat) => {
                const n = cat === '全部' ? recommended.length : counts.get(cat) ?? 0;
                if (cat !== '全部' && n === 0) return null;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-150',
                      category === cat
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {cat}
                    {n > 0 ? <span className="ml-1 opacity-50">{n}</span> : null}
                  </button>
                );
              })}
            </div>

            {feedCards(filtered)}
          </>
        ) : null}
      </main>
    </div>
  );
}

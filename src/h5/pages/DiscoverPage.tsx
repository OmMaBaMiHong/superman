'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Flame, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import {
  createFeed,
  listRecommendedFeeds,
  listFeedItems,
  type RecommendedFeedEntry,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';

type Category = '全部' | 'AI' | '科技' | 'B站' | '通用';

const CATEGORY_ORDER: Category[] = ['全部', 'AI', '科技', 'B站', '通用'];

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  ai: { label: 'AI', className: 'border-purple-400/40 bg-purple-400/10 text-purple-500 dark:text-purple-300' },
  bilibili: { label: 'B站', className: 'border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300' },
  douyin: { label: '抖音', className: 'border-neutral-400/40 bg-neutral-400/10 text-neutral-600 dark:text-neutral-300' },
  tech: { label: '科技', className: 'border-teal-400/40 bg-teal-400/10 text-teal-600 dark:text-teal-300' },
  rss: { label: 'RSS', className: 'border-border bg-secondary text-secondary-foreground' },
};

function categoryOf(item: RecommendedFeedEntry): Exclude<Category, '全部'> {
  if (item.platform === 'ai') return 'AI';
  if (item.platform === 'bilibili') return 'B站';
  if (item.platform === 'tech') return '科技';
  return '通用';
}

export default function DiscoverPage() {
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        {/* 头部 */}
        <div className="mb-5">
          <h1 className="text-xl font-bold">发现</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            订阅博主，内容自动进入你的阅读流
          </p>
        </div>

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

        {/* 博主卡网格 */}
        {filtered.length === 0 ? (
          <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">这个分类暂时没有推荐</p>
            <p className="mt-2 text-xs text-muted-foreground">换个分类看看，或者搜索添加你自己的博主。</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
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
        )}

        {/* 热点提示条 */}
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-orange-200/60 bg-orange-50/60 px-4 py-3 dark:border-orange-500/20 dark:bg-orange-500/5">
          <Flame className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            想看今天全平台的热点榜单？
          </p>
          <a
            href="#/trending"
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-orange-300/60 px-3.5 text-[11.5px] font-medium text-orange-600 transition-colors hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-500/10"
          >
            <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
            进热点页
          </a>
        </div>
      </main>
    </div>
  );
}

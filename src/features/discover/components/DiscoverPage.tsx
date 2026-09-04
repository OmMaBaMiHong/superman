'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Flame,
  Github,
  Layers,
  Plus,
  Rss,
  Search,
  Users,
} from 'lucide-react';
import { getRecommendedFeeds, type RecommendedFeedItem } from '@/lib/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/glass/EmptyState';
import ErrorState from '@/components/glass/ErrorState';
import GlassChip from '@/components/glass/GlassChip';
import { GlassSkeletonList } from '@/components/glass/GlassSkeleton';
import StatCard from '@/components/glass/StatCard';
import GithubPage from '@/features/github/components/GithubPage';

const CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI' },
  { id: 'tech', label: '技术' },
  { id: 'news', label: '新闻' },
  { id: 'dev', label: '开发' },
  { id: 'design', label: '设计' },
  { id: 'opensource', label: '开源' },
  { id: 'chinese', label: '中文' },
  { id: 'business', label: '商业' },
  { id: 'science', label: '科学' },
] as const;

/** 数据源 Tab：RSS 本期有数据，GitHub 本期为「即将上线」占位（默认③）。 */
const SOURCE_TABS = [
  { id: 'rss', label: 'RSS 源', Icon: Rss },
  { id: 'github', label: 'GitHub 仓库', Icon: Github },
] as const;
type SourceTabId = (typeof SOURCE_TABS)[number]['id'];

function matchCategory(item: RecommendedFeedItem, categoryId: string): boolean {
  if (categoryId === 'all') return true;
  const title = item.title.toLowerCase();
  const desc = (item.description ?? '').toLowerCase();
  const url = item.url.toLowerCase();

  switch (categoryId) {
    case 'ai':
      return /ai|openai|anthropic|hugging.?face|llm|gpt|claude|machine.?learning/.test(title + desc + url);
    case 'tech':
      return /tech|技术|hacker.?news|techcrunch|the.?verge|ars.?technica|mit|科技/.test(title + desc + url);
    case 'news':
      return /news|华尔街|联合早报|cnbeta|经济学人|36氪|虎嗅/.test(title + desc + url);
    case 'dev':
      return /github|dev\.to|mdn|web\.dev|docker|kubernetes|stack.?overflow|开发者/.test(title + desc + url);
    case 'design':
      return /design|dribbble|smashing|ui|ux/.test(title + desc + url);
    case 'opensource':
      return /open.?source|github|google.?open.?source/.test(title + desc + url);
    case 'chinese':
      return /中文|36氪|知乎|b站|v2ex|美团|虎嗅|cnbeta|华尔街|联合早报|橘鸦|微信/.test(title + desc + url);
    case 'business':
      return /product.?hunt|startup|独立变现|ezindie|商业/.test(title + desc + url);
    case 'science':
      return /science|科学|nature|arxiv|research/.test(title + desc + url);
    default:
      return true;
  }
}

interface DiscoverPageProps {
  onSubscribeFeed?: (url: string, title: string) => void;
  existingUrls?: Set<string>;
}

export default function DiscoverPage({ onSubscribeFeed, existingUrls }: DiscoverPageProps) {
  const [items, setItems] = useState<RecommendedFeedItem[]>([]);
  // loading/error 初始值即「加载中」，挂载后 effect 不再同步 setState，避免 lint 级联渲染告警。
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeSourceTab, setActiveSourceTab] = useState<SourceTabId>('rss');

  useEffect(() => {
    getRecommendedFeeds({ notifyOnError: false })
      .then(setItems)
      .catch(() => setError('加载推荐列表失败，请稍后重试'))
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = useMemo(() => {
    let result = items;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q) ||
          (item.description ?? '').toLowerCase().includes(q),
      );
    }

    if (activeCategory !== 'all') {
      result = result.filter((item) => matchCategory(item, activeCategory));
    }

    return result;
  }, [items, searchQuery, activeCategory]);

  const stats = useMemo(
    () => ({
      recommendedTotal: items.length,
      hotTotal: items.filter((item) => item.source === 'aggregated').length,
      subscribedTotal: existingUrls?.size ?? 0,
      matchedTotal: filteredItems.length,
    }),
    [items, filteredItems, existingUrls],
  );

  const handleSubscribe = useCallback(
    (item: RecommendedFeedItem) => {
      // 发现页已并入阅读器视图：订阅一律走左栏订阅事件桥
      // （ReaderContentPage 传入 onSubscribeFeed=requestSubscribeFeed → FeedList 预填 AddFeedDialog），
      // 不再有整页跳转回退分支。
      onSubscribeFeed?.(item.url, item.title);
    },
    [onSubscribeFeed],
  );

  const isSubscribed = useCallback(
    (url: string) => existingUrls?.has(url) ?? false,
    [existingUrls],
  );

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">发现</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          发现热门订阅源，一键订阅关注
        </p>
      </div>

      {/* 统计卡片行（GlassCard 变体，数字用 font-mono + tabular-nums） */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="推荐订阅源" value={stats.recommendedTotal} icon={Rss} />
        <StatCard label="热门推荐" value={stats.hotTotal} icon={Flame} />
        <StatCard label="已订阅源" value={stats.subscribedTotal} icon={CheckCircle2} />
        <StatCard label="匹配结果" value={stats.matchedTotal} icon={Layers} />
      </div>

      {/* 数据源 Tab：RSS / GitHub（按原型 tab-bar 玻璃化） */}
      <div
        className="glass-surface-light mb-6 flex w-fit items-center gap-1 rounded-xl p-1"
        role="tablist"
        aria-label="数据源"
      >
        {SOURCE_TABS.map((tab) => {
          const active = activeSourceTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveSourceTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <tab.Icon aria-hidden="true" className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSourceTab === 'github' ? (
        /* GitHub 数据源：挂载 GithubPage（真实接口 /api/github/repos）。
           这里刻意只替换渲染内容，不动视图路由与快照逻辑 —— GITHUB_VIEW_ID 仍是
           isAggregateView 的聚合视图（ADR-04 的 GitHub feed 文章流），行为不变。
           GithubPage 自带 loading / error / empty 三态，外层不再套 .glass-surface
           （每容器最多 1 层玻璃模糊）。 */
        <div className="min-h-0 flex-1">
          <GithubPage />
        </div>
      ) : (
        <>
          {/* 搜索栏（玻璃输入框） */}
          <div className="glass-surface-light relative mb-6 flex h-10 items-center rounded-xl">
            <Search
              aria-hidden="true"
              className="absolute left-3 h-4 w-4 text-muted-foreground"
            />
            <Input
              placeholder="搜索订阅源名称、URL 或关键词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-full border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0"
            />
          </div>

          {/* 分类筛选（GlassChip） */}
          <div className="mb-6 flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <GlassChip
                key={cat.id}
                active={activeCategory === cat.id}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.label}
              </GlassChip>
            ))}
          </div>

          {/* 内容区域：容器一层玻璃（1 层 blur），三态与列表行均落在其内部，
              行内只用 token 配色、不逐项 blur。三态统一复用 glass/ 共享组件。 */}
          <div className="glass-surface flex min-h-0 flex-1 flex-col overflow-y-auto p-2 sm:p-3">
            {loading ? (
              <GlassSkeletonList className="p-1" count={5} />
            ) : error ? (
              <ErrorState className="flex-1" title={error} />
            ) : filteredItems.length === 0 ? (
              <EmptyState
                className="flex-1"
                icon={Search}
                title={searchQuery ? '没有找到匹配的订阅源' : '暂无推荐订阅源'}
              />
            ) : (
              <div className="space-y-1">
                {filteredItems.map((item) => {
                  const subscribed = isSubscribed(item.url);

                  return (
                    <div
                      key={item.id}
                      className="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-muted/40"
                    >
                      {/* 图标 */}
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-muted-foreground">
                        <Rss className="h-4 w-4" aria-hidden="true" />
                      </div>

                      {/* 内容 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{item.title}</span>
                          {item.source === 'builtin' ? (
                            <Badge
                              variant="secondary"
                              className="shrink-0 rounded-full px-1.5 py-0 text-[10px] font-medium text-warning"
                            >
                              推荐
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="shrink-0 rounded-full px-1.5 py-0 text-[10px] font-medium text-info"
                            >
                              热门
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="truncate">{item.url}</span>
                          {item.subscriberCount > 0 && (
                            <span className="flex shrink-0 items-center gap-1">
                              <Users className="h-3 w-3" aria-hidden="true" />
                              {item.subscriberCount}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-1 text-xs text-muted-foreground/80 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex shrink-0 items-center gap-1">
                        {item.siteUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100"
                            onClick={() => window.open(item.siteUrl!, '_blank', 'noopener,noreferrer')}
                            title="打开网站"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant={subscribed ? 'outline' : 'default'}
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          disabled={subscribed}
                          onClick={() => handleSubscribe(item)}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          {subscribed ? '已订阅' : '订阅'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

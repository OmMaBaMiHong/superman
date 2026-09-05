'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Rss, SearchX } from 'lucide-react';
import {
  createFeed,
  listFeedItems,
  listRecommendedFeeds,
  type FeedListItem,
  type RecommendedFeedEntry,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  bilibili: { label: 'B站', className: 'border-primary/40 bg-primary/10 text-primary' },
  douyin: { label: '抖音', className: 'border-primary/40 bg-primary/10 text-primary' },
  ai: { label: 'AI', className: 'border-success/40 bg-success/10 text-success' },
  tech: { label: '科技', className: 'border-warning/40 bg-warning/10 text-warning' },
  rss: { label: 'RSS', className: 'border-border bg-secondary text-secondary-foreground' },
};

type ManagerTab = 'mine' | 'recommended';

interface FeedsManagerSheetProps {
  open: boolean;
  onClose: () => void;
  /** 订阅成功后回调（阅读器刷新文章列表）。 */
  onChanged?: () => void;
}

/** 订阅管理 sheet：我的订阅（列表 + 新增表单）/ 推荐博主（一键订阅）。 */
export default function FeedsManagerSheet({ open, onClose, onChanged }: FeedsManagerSheetProps) {
  const [tab, setTab] = useState<ManagerTab>('mine');
  const [feeds, setFeeds] = useState<FeedListItem[]>([]);
  const [recommended, setRecommended] = useState<RecommendedFeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [subscribedUrls, setSubscribedUrls] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [feedResult, recommendedResult] = await Promise.all([
        listFeedItems({ notifyOnError: false }),
        listRecommendedFeeds({ notifyOnError: false }),
      ]);
      setFeeds(feedResult.items);
      setRecommended(recommendedResult);
      setSubscribedUrls(new Set(feedResult.items.map((item) => item.url)));
    } catch {
      // 静默，保持旧数据
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const subscribe = useCallback(
    async (input: { title: string; url: string; siteUrl?: string | null; categoryName?: string }) => {
      setSubmitting(true);
      try {
        await createFeed({
          title: input.title,
          url: input.url,
          siteUrl: input.siteUrl ?? null,
          categoryName: input.categoryName || null,
        });
        toast.success(`已订阅「${input.title}」`);
        setTitle('');
        setUrl('');
        setCategoryName('');
        await load();
        onChanged?.();
      } catch {
        // apiClient 已统一 toast 错误
      } finally {
        setSubmitting(false);
      }
    },
    [load, onChanged],
  );

  return (
    <GlassDetailSheet open={open} onClose={onClose} ariaLabel="订阅管理">
      <div className="px-5 pb-6 pt-1 sm:px-7">
        <div className="flex items-center gap-2">
          <Rss aria-hidden="true" className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">订阅管理</h2>
        </div>

        <div className="mt-3 flex gap-1 rounded-full border border-border bg-secondary/60 p-1">
          {(
            [
              ['mine', `我的订阅（${feeds.length}）`],
              ['recommended', '推荐博主'],
            ] as Array<[ManagerTab, string]>
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'flex h-9 flex-1 items-center justify-center rounded-full text-xs font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {tab === 'mine' ? (
          <div className="mt-4 space-y-4">
            {/* 新增订阅表单 */}
            <form
              className="space-y-2.5 rounded-2xl border border-border/60 bg-secondary/40 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void subscribe({ title, url, categoryName });
              }}
            >
              <p className="text-[13px] font-semibold text-foreground">新增订阅</p>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="名称（如：何同学）"
                aria-label="订阅名称"
                required
                className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…/feed.xml 或 rsshub:// 路由"
                aria-label="订阅链接"
                required
                className="h-11 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                type="text"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="分类（可选，如：视频）"
                aria-label="分类"
                className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                B站博主：<code className="font-mono text-primary">rsshub://bilibili/user/video/用户UID</code>
                ；抖音博主：<code className="font-mono text-primary">rsshub://douyin/user/博主sec_uid</code>
                （本地 RSSHub 已内置）
              </p>
              <button
                type="submit"
                disabled={submitting || !title.trim() || !url.trim()}
                className={cn(
                  'inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-primary/10',
                  'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.98]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                {submitting ? '订阅中…' : '添加订阅'}
              </button>
            </form>

            {/* 现有订阅列表 */}
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
                ))}
              </div>
            ) : feeds.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">还没有订阅源</p>
            ) : (
              <ul className="space-y-2">
                {feeds.map((feed) => (
                  <li
                    key={feed.id}
                    data-testid="feed-row"
                    className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        feed.lastFetchStatus === 200 ? 'bg-success' : 'bg-warning',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{feed.title}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {feed.url}
                      </span>
                    </span>
                    {feed.categoryTitle ? (
                      <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                        {feed.categoryTitle}
                      </span>
                    ) : null}
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {feed.articleCount} 条
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          /* 推荐博主 */
          <div className="mt-4">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
                ))}
              </div>
            ) : recommended.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <SearchX aria-hidden="true" className="h-6 w-6 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">暂无推荐数据</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {recommended.map((entry) => {
                  const badge = PLATFORM_BADGE[entry.platform ?? 'rss'] ?? PLATFORM_BADGE.rss;
                  const subscribed = subscribedUrls.has(entry.url);
                  return (
                    <li
                      key={entry.id}
                      data-testid="recommended-row"
                      className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5"
                    >
                      <span
                        className={cn(
                          'inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium',
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {entry.title}
                        </span>
                        {entry.description ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {entry.description}
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        disabled={subscribed || submitting}
                        onClick={() => void subscribe({ title: entry.title, url: entry.url, siteUrl: entry.siteUrl })}
                        className={cn(
                          'inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-all duration-150',
                          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          subscribed
                            ? 'border-success/40 bg-success/10 text-success'
                            : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.97]',
                          'disabled:pointer-events-none disabled:opacity-60',
                        )}
                      >
                        {subscribed ? (
                          <>
                            <Check aria-hidden="true" className="h-3 w-3" />
                            已订阅
                          </>
                        ) : (
                          '订阅'
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </GlassDetailSheet>
  );
}

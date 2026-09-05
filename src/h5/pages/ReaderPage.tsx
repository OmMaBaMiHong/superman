'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import {
  getGovernanceItemDetail,
  getGovernanceQueue,
  type GovernanceItemDetail,
  type GovernanceQueueItem,
} from '@/lib/api/apiClient';
import ContentTypeBadge from '@/components/ui/content-type-badge';
import QualityScore from '@/features/governance/components/QualityScore';
import { formatPublishedAt } from '@/features/governance/components/GovernanceQueueCard';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 100;

/**
 * 最小可用阅读器（H5 版）：
 * - 数据复用治理队列 archived 文章 + 详情接口（插件 API 面没有阅读器快照，
 *   K5 前不搬 reader snapshot 链）；
 * - 桌面：左栏源/列表，右栏正文；移动：列表全宽，点开正文全屏 + 返回。
 */
export default function H5ReaderPage() {
  const [items, setItems] = useState<GovernanceQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFeed, setSelectedFeed] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GovernanceItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getGovernanceQueue({ statuses: ['archived'], page: 1, pageSize: PAGE_SIZE })
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const feeds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.feedTitle, (counts.get(item.feedTitle) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }, [items]);

  const filteredItems = useMemo(
    () => (selectedFeed ? items.filter((item) => item.feedTitle === selectedFeed) : items),
    [items, selectedFeed],
  );

  const openArticle = useCallback((item: GovernanceQueueItem) => {
    setSelectedId(item.id);
    setDetail(null);
    setDetailLoading(true);
    void getGovernanceItemDetail(item.id, { notifyOnError: false })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  const articleList = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* 源筛选 chips */}
      <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto bg-background/80 px-3 py-2.5 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setSelectedFeed('')}
          className={cn(
            'flex h-9 shrink-0 items-center rounded-full border px-3.5 text-xs font-medium transition-colors duration-150',
            selectedFeed === ''
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground',
          )}
        >
          全部
          <span className="ml-1 font-mono text-[10px] tabular-nums opacity-60">{items.length}</span>
        </button>
        {feeds.map(([feedTitle, count]) => (
          <button
            key={feedTitle}
            type="button"
            onClick={() => setSelectedFeed((current) => (current === feedTitle ? '' : feedTitle))}
            className={cn(
              'flex h-9 shrink-0 items-center rounded-full border px-3.5 text-xs font-medium transition-colors duration-150',
              selectedFeed === feedTitle
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground',
            )}
          >
            {feedTitle}
            <span className="ml-1 font-mono text-[10px] tabular-nums opacity-60">{count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2.5 p-3">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="gov-card h-24 animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="mx-3 mt-6 rounded-[1.25rem] border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm font-medium text-foreground">没有已归档的文章</p>
          <p className="mt-2 text-xs text-muted-foreground">去审批台准奏一些内容，归档后就能在这里阅读。</p>
        </div>
      ) : (
        <ul className="space-y-2.5 p-3">
          {filteredItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid="reader-article-row"
                onClick={() => openArticle(item)}
                className={cn(
                  'gov-card w-full p-3.5 text-left [--gov-accent:var(--glass-border)]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  selectedId === item.id && 'gov-card-selected',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <ContentTypeBadge type={item.contentType} />
                  <span className="ml-auto">
                    <QualityScore score={item.qualityScore} />
                  </span>
                </div>
                <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                  {item.title}
                </h3>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="max-w-[9rem] truncate">{item.feedTitle}</span>
                  <span aria-hidden="true">·</span>
                  <time className="font-mono tabular-nums">{formatPublishedAt(item.publishedAt)}</time>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const readingPane = (
    <div className="flex h-full min-h-0 flex-col">
      {/* 移动端正文顶栏（返回） */}
      <div className="glass-surface-strong flex h-12 shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 px-3 md:hidden">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          aria-label="返回文章列表"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <span className="truncate text-sm font-medium text-foreground">阅读</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selectedId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <BookOpen aria-hidden="true" className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">从列表选择一篇文章开始阅读</p>
          </div>
        ) : detailLoading || !detail ? (
          <div className="mx-auto max-w-2xl space-y-3 p-6" aria-busy="true">
            <div className="h-8 w-3/4 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-64 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : (
          <article className="mx-auto max-w-2xl px-5 pb-16 pt-6 sm:px-8">
            <div className="flex items-center gap-1.5">
              <ContentTypeBadge type={detail.contentType} />
              <QualityScore score={detail.qualityScore} />
            </div>
            <h1 className="mt-3 text-xl font-semibold leading-snug text-foreground sm:text-2xl">
              {detail.title}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              <span>{detail.feedTitle}</span>
              {detail.author ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{detail.author}</span>
                </>
              ) : null}
              <span aria-hidden="true">·</span>
              <time className="font-mono tabular-nums">{formatPublishedAt(detail.publishedAt)}</time>
              {detail.sourceUrl ? (
                <a
                  href={detail.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary transition-colors duration-150 hover:opacity-80"
                >
                  原文链接 ↗
                </a>
              ) : null}
            </div>
            {detail.previewImage ? (
              <img
                src={detail.previewImage}
                alt=""
                loading="lazy"
                className="mt-4 max-h-72 w-full rounded-2xl border border-border/60 object-cover"
              />
            ) : null}
            {detail.content ? (
              <div
                data-testid="reader-content"
                className="prose mt-5 max-w-none text-[15px] prose-headings:text-foreground prose-p:leading-relaxed prose-p:text-foreground/85 prose-a:text-primary prose-img:rounded-2xl dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: detail.content }}
              />
            ) : (
              <p className="mt-5 text-sm leading-relaxed text-secondary-foreground">
                {detail.summary ?? '暂无正文，可打开原文链接查看。'}
              </p>
            )}
          </article>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 移动端：列表 ↔ 正文全屏切换；桌面：左右分栏 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className={cn(
            'flex min-h-0 flex-col md:w-[400px] md:shrink-0 md:border-r md:border-border',
            selectedId ? 'hidden md:flex' : 'flex-1',
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 px-4 pt-1">
            <BookOpen aria-hidden="true" className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">阅读</h1>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {filteredItems.length} 篇
            </span>
          </div>
          {articleList}
        </div>

        <div
          className={cn(
            'min-w-0 flex-1',
            selectedId ? 'fixed inset-0 z-30 bg-background md:static md:z-auto' : 'hidden md:block',
          )}
        >
          {selectedId ? readingPane : (
            <div className="hidden h-full items-center justify-center md:flex">
              <p className="text-sm text-muted-foreground">从列表选择一篇文章开始阅读</p>
            </div>
          )}
        </div>
      </div>

      {!selectedId ? <MobileTabBar /> : null}
    </div>
  );
}

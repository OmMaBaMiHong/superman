'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ExternalLink, Flame, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import {
  getTrendRadarToday,
  promoteTrendRadarItem,
  type TrendRadarItem,
  type TrendRadarToday,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';

const POLL_MS = 60_000;

/** 排名变化徽章：升红降蓝（热榜语境排名变小=上升），无历史不显示。 */
function RankDelta({ item }: { item: TrendRadarItem }) {
  if (item.previousRank === null || item.rank === null || item.previousRank === item.rank) {
    return null;
  }
  const rising = item.rank < item.previousRank;
  const delta = Math.abs(item.previousRank - item.rank);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] tabular-nums',
        rising ? 'text-red-400' : 'text-sky-400',
      )}
      title={`上次第 ${item.previousRank} 名`}
    >
      {rising ? (
        <TrendingUp aria-hidden="true" className="h-3 w-3" />
      ) : (
        <TrendingDown aria-hidden="true" className="h-3 w-3" />
      )}
      {delta}
    </span>
  );
}

function TrendRadarRow({
  item,
  promoting,
  onPromote,
}: {
  item: TrendRadarItem;
  promoting: boolean;
  onPromote: (item: TrendRadarItem) => void;
}) {
  const promoted = item.promotedAt !== null;
  const isExternal = /^https?:\/\//.test(item.url);

  return (
    <li
      data-testid="trend-radar-item"
      className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
    >
      <span className="w-7 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {item.rank ?? '—'}
      </span>
      <RankDelta item={item} />
      <div className="min-w-0 flex-1">
        {isExternal ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex max-w-full items-center gap-1 text-sm text-foreground transition-colors hover:text-primary"
          >
            <span className="truncate">{item.title}</span>
            <ExternalLink
              aria-hidden="true"
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
            />
          </a>
        ) : (
          <span className="block truncate text-sm text-foreground">{item.title}</span>
        )}
      </div>
      {item.hotValue ? (
        <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70 sm:inline">
          {item.hotValue}
        </span>
      ) : null}
      <button
        type="button"
        disabled={promoted || promoting}
        onClick={() => onPromote(item)}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 font-mono text-[11px] transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          promoted
            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
          promoting && 'opacity-50',
        )}
      >
        {promoted ? (
          <>
            <Check aria-hidden="true" className="h-3 w-3" />
            已转选题
          </>
        ) : promoting ? (
          '转送中…'
        ) : (
          '转为选题'
        )}
      </button>
    </li>
  );
}

/** 热点雷达主控台：平台分组热榜 + 一键转选题。桌面端优先，移动端适配后续独立任务。 */
export default function TrendingConsole() {
  const [data, setData] = useState<TrendRadarToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<Record<string, boolean>>({});

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await getTrendRadarToday(undefined, { notifyOnError: false }));
      setError(null);
    } catch {
      if (!silent) setError('热点数据加载失败，请稍后重试。');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const handlePromote = useCallback((item: TrendRadarItem) => {
    setPromoting((current) => ({ ...current, [item.id]: true }));
    void promoteTrendRadarItem(item.id)
      .then(() => {
        setData((current) => {
          if (!current) return current;
          return {
            ...current,
            platforms: current.platforms.map((group) => ({
              ...group,
              items: group.items.map((entry) =>
                entry.id === item.id
                  ? { ...entry, promotedAt: new Date().toISOString() }
                  : entry,
              ),
            })),
          };
        });
      })
      .catch(() => {
        // apiClient 已统一 toast 错误
      })
      .finally(() => {
        setPromoting((current) => ({ ...current, [item.id]: false }));
      });
  }, []);

  return (
    <div className="min-h-screen">
      {/* 顶部指挥条 */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="返回阅读器"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                <Flame aria-hidden="true" className="h-4 w-4 text-primary" />
                热点雷达
              </h1>
              <p className="gov-label">Trend Radar</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {data ? (
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                {data.date} · {data.platforms.length} 平台 · {data.total} 条
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              aria-label="刷新热榜"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="gov-card h-56 animate-pulse bg-card/60" aria-hidden="true" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">{error}</p>
            <p className="gov-label mt-6">Load Failed</p>
          </div>
        ) : !data || data.platforms.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">今天还没有热榜数据</p>
            <p className="mt-2 text-xs text-muted-foreground">
              等 TrendRadar 跑完一轮，sync job 会把当天热榜同步进来。
            </p>
            <p className="gov-label mt-6">Radar Silent</p>
          </div>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2">
            {data.platforms.map((group) => (
              <section key={group.platform} className="gov-card overflow-hidden bg-card/60">
                <header className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="truncate text-sm font-medium text-foreground">
                    {group.platformName}
                  </h2>
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {group.items.length} 条
                  </span>
                </header>
                <ul>
                  {group.items.map((item) => (
                    <TrendRadarRow
                      key={item.id}
                      item={item}
                      promoting={promoting[item.id] ?? false}
                      onPromote={handlePromote}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

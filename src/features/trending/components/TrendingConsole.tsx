'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flame,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  getTrendRadarItemDetail,
  getTrendRadarToday,
  promoteTrendRadarItem,
  type TrendRadarItem,
  type TrendRadarItemDetail,
  type TrendRadarToday,
} from '@/lib/api/apiClient';
import ContentTypeBadge from '@/components/ui/content-type-badge';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import { cn } from '@/lib/utils';

const POLL_MS = 60_000;

/** 排名变化徽章：升红降绿（热榜语境排名变小=上升；深色终端风禁用蓝色），无历史不显示。 */
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
        rising ? 'text-red-500' : 'text-primary',
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
  onOpenDetail,
}: {
  item: TrendRadarItem;
  onOpenDetail: (item: TrendRadarItem) => void;
}) {
  const promoted = item.promotedAt !== null;

  return (
    <li>
      <button
        type="button"
        data-testid="trend-radar-item"
        onClick={() => onOpenDetail(item)}
        className={cn(
          'flex min-h-[44px] w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0',
          'transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:w-6">
          {item.rank ?? '—'}
        </span>
        <RankDelta item={item} />
        <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-foreground">
          {item.title}
        </span>
        <ContentTypeBadge type={item.contentType} />
        {item.hotValue ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {item.hotValue}
          </span>
        ) : null}
        {promoted ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-success">
            <Check aria-hidden="true" className="h-3 w-3" />
            已转
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** 热榜详情内容：payload_json 有啥展示啥 + 转为选题。 */
function TrendRadarDetailView({
  detail,
  promoting,
  onPromote,
}: {
  detail: TrendRadarItemDetail;
  promoting: boolean;
  onPromote: () => void;
}) {
  const promoted = detail.promotedAt !== null;
  const isExternal = /^https?:\/\//.test(detail.url);
  // payload 里排除已上提的字段，其余按序展示
  const payloadEntries = Object.entries(detail.payload).filter(
    ([key]) => key !== 'previousRank',
  );

  return (
    <div className="px-5 pb-6 pt-1 sm:px-7">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-5 items-center rounded-full border border-border bg-secondary px-2 text-[10px] font-medium text-secondary-foreground">
          {detail.platformName || detail.platform}
        </span>
        <ContentTypeBadge type={detail.contentType} />
        {detail.rank !== null ? (
          <span className="inline-flex h-5 items-center rounded-full border border-warning/40 bg-warning/10 px-1.5 font-mono text-[10px] font-semibold tabular-nums text-warning">
            第 {detail.rank} 名
          </span>
        ) : null}
      </div>

      <h2 className="mt-3 text-xl font-semibold leading-snug text-foreground">{detail.title}</h2>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
        {detail.hotValue ? (
          <span className="font-mono tabular-nums">热度 {detail.hotValue}</span>
        ) : null}
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">{detail.sourceDate}</span>
        {isExternal ? (
          <a
            href={detail.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary transition-colors duration-150 hover:opacity-80"
          >
            打开原链接
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      {payloadEntries.length > 0 ? (
        <dl className="mt-4 space-y-2 rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3">
          {payloadEntries.map(([key, value]) => (
            <div key={key} className="flex items-start gap-3 text-[13px]">
              <dt className="shrink-0 font-mono text-[11px] text-muted-foreground">{key}</dt>
              <dd className="min-w-0 flex-1 break-all text-secondary-foreground">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">该条目没有更多详情数据。</p>
      )}

      <div className="sticky bottom-0 -mx-1 mt-5 flex items-center justify-end gap-2 border-t border-border/60 px-1 pb-1 pt-3">
        <button
          type="button"
          disabled={promoted || promoting}
          onClick={onPromote}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border px-5 text-sm font-medium transition-all duration-150 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
            'disabled:pointer-events-none disabled:opacity-60',
            promoted
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20',
          )}
        >
          {promoted ? (
            <>
              <Check aria-hidden="true" className="h-4 w-4" />
              已转选题
            </>
          ) : promoting ? (
            '转送中…'
          ) : (
            '转为选题'
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 热点雷达主控台（横向轨道版）：
 * 平台 = 横向 snap 轨道（拖动切平台），顶部 pill 栏双向联动，列内纵向滚动；
 * 条目点开详情 sheet，详情里可「转为选题」。
 */
export default function TrendingConsole() {
  const [data, setData] = useState<TrendRadarToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<Record<string, boolean>>({});
  const [activePlatform, setActivePlatform] = useState(0);
  const [draggingRail, setDraggingRail] = useState(false);

  const [detailItem, setDetailItem] = useState<TrendRadarItem | null>(null);
  const [detail, setDetail] = useState<TrendRadarItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const railRef = useRef<HTMLDivElement>(null);
  const pillBarRef = useRef<HTMLDivElement>(null);
  const railDragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  /** 鼠标拖拽后短暂抑制条目点击（拖轨道不应误开详情）。 */
  const railDragSuppressUntilRef = useRef(0);
  /** 拖动/程序平滑滚动期间屏蔽 scroll 事件回写，避免 pill 高亮抖动。 */
  const suppressScrollSyncRef = useRef(false);

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
        const promotedAt = new Date().toISOString();
        setData((current) => {
          if (!current) return current;
          return {
            ...current,
            platforms: current.platforms.map((group) => ({
              ...group,
              items: group.items.map((entry) =>
                entry.id === item.id ? { ...entry, promotedAt } : entry,
              ),
            })),
          };
        });
        setDetail((current) => (current ? { ...current, promotedAt } : current));
      })
      .catch(() => {
        // apiClient 已统一 toast 错误
      })
      .finally(() => {
        setPromoting((current) => ({ ...current, [item.id]: false }));
      });
  }, []);

  const openDetail = useCallback((item: TrendRadarItem) => {
    if (Date.now() < railDragSuppressUntilRef.current) return;
    setDetailItem(item);
    setDetail(null);
    setDetailLoading(true);
    void getTrendRadarItemDetail(item.id, { notifyOnError: false })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  // ── 轨道几何：列的 snap 吸附点 = 列 offsetLeft - 容器左内边距 ──
  const getColumnOffsets = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return [];
    const paddingLeft = parseFloat(window.getComputedStyle(rail).paddingLeft) || 0;
    return Array.from(rail.querySelectorAll<HTMLElement>('[data-platform-column]')).map(
      (column) => column.offsetLeft - paddingLeft,
    );
  }, []);

  const nearestPlatformIndex = useCallback(
    (scrollLeft: number) => {
      const offsets = getColumnOffsets();
      if (offsets.length === 0) return 0;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      offsets.forEach((offset, index) => {
        const distance = Math.abs(scrollLeft - offset);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      return best;
    },
    [getColumnOffsets],
  );

  const scrollToPlatform = useCallback(
    (index: number) => {
      const rail = railRef.current;
      if (!rail) return;
      const offsets = getColumnOffsets();
      const target = offsets[index];
      if (typeof target !== 'number') return;
      // 程序平滑滚动期间锁回写，滚动结束由超时释放
      suppressScrollSyncRef.current = true;
      setActivePlatform(index);
      rail.scrollTo({ left: target, behavior: 'smooth' });
      window.setTimeout(() => {
        suppressScrollSyncRef.current = false;
      }, 500);
    },
    [getColumnOffsets],
  );

  // 拖轨道 → pill 高亮同步（scroll 事件算最近列）
  const onRailScroll = useCallback(() => {
    if (suppressScrollSyncRef.current) return;
    const rail = railRef.current;
    if (!rail) return;
    const index = nearestPlatformIndex(rail.scrollLeft);
    setActivePlatform((current) => (current === index ? current : index));
  }, [nearestPlatformIndex]);

  // pill 高亮变化时，把激活 pill 滚进可视区
  useEffect(() => {
    const bar = pillBarRef.current;
    const active = bar?.querySelector<HTMLElement>('[aria-current="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePlatform]);

  // 鼠标拖拽轨道（触摸由原生滚动接管）：拖拽中关 snap，松手吸附最近列
  const onRailPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    railDragRef.current = { startX: event.clientX, startScrollLeft: railRef.current?.scrollLeft ?? 0 };
    setDraggingRail(true);
  };

  const onRailPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = railDragRef.current;
    const rail = railRef.current;
    if (!drag || !rail) return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 6) {
      railDragSuppressUntilRef.current = Date.now() + 400;
    }
    rail.scrollLeft = drag.startScrollLeft - dx;
  };

  const onRailPointerUp = () => {
    if (!railDragRef.current) return;
    railDragRef.current = null;
    setDraggingRail(false);
    // 吸附最近列
    const rail = railRef.current;
    if (!rail) return;
    scrollToPlatform(nearestPlatformIndex(rail.scrollLeft));
  };

  const platforms = data?.platforms ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      {/* 顶部指挥条 */}
      <header className="glass-surface-strong sticky top-0 z-10 rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-9"
              aria-label="返回阅读器"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                <Flame aria-hidden="true" className="h-4 w-4 text-primary" />
                热点雷达
              </h1>
              <p className="text-[11px] text-muted-foreground">Trend Radar</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {data ? (
              <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground sm:inline">
                {data.date} · {data.platforms.length} 平台 · {data.total} 条
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              aria-label="刷新热榜"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-9"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 平台 pill 栏（与轨道双向联动） */}
        {platforms.length > 0 ? (
          <div
            ref={pillBarRef}
            role="tablist"
            aria-label="平台切换"
            className="flex gap-1.5 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-6"
          >
            {platforms.map((group, index) => (
              <button
                key={group.platform}
                type="button"
                role="tab"
                aria-selected={activePlatform === index}
                aria-current={activePlatform === index ? 'true' : undefined}
                onClick={() => scrollToPlatform(index)}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  activePlatform === index
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {group.platformName}
                <span className="font-mono text-[10px] tabular-nums opacity-60">
                  {group.items.length}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-0 pb-28 pt-4 md:pb-8">
        {loading ? (
          <div className="flex gap-4 px-4 sm:px-6">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="gov-card h-[60vh] w-[88vw] shrink-0 animate-pulse md:w-[380px]"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : error ? (
          <div className="mx-4 rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center sm:mx-6">
            <p className="text-sm font-medium text-foreground">{error}</p>
          </div>
        ) : platforms.length === 0 ? (
          <div className="mx-4 rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center sm:mx-6">
            <p className="text-sm font-medium text-foreground">今天还没有热榜数据</p>
            <p className="mt-2 text-xs text-muted-foreground">
              等 TrendRadar 跑完一轮，sync job 会把当天热榜同步进来。
            </p>
          </div>
        ) : (
          /* 横向 snap 轨道：每平台一列，列内纵向滚动 */
          <div
            ref={railRef}
            data-testid="trend-platform-rail"
            onScroll={onRailScroll}
            onPointerDown={onRailPointerDown}
            onPointerMove={onRailPointerMove}
            onPointerUp={onRailPointerUp}
            onPointerCancel={onRailPointerUp}
            onPointerLeave={onRailPointerUp}
            className={cn(
              'relative flex gap-4 overflow-x-auto px-4 sm:px-6',
              draggingRail ? 'cursor-grabbing select-none' : 'cursor-grab snap-x snap-mandatory',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            )}
          >
            {platforms.map((group) => (
              <section
                key={group.platform}
                data-platform-column={group.platform}
                className="gov-card flex h-[calc(100vh-15rem)] max-h-[42rem] w-[88vw] shrink-0 snap-start flex-col overflow-hidden [--gov-accent:var(--glass-border)] md:w-[380px]"
              >
                <header className="flex shrink-0 items-center justify-between border-b border-border px-3.5 py-2.5">
                  <h2 className="truncate text-[13px] font-semibold text-foreground">
                    {group.platformName}
                  </h2>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                    {group.items.length} 条
                  </span>
                </header>
                <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {group.items.map((item) => (
                    <TrendRadarRow key={item.id} item={item} onOpenDetail={openDetail} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* 详情 sheet：移动端底部滑上 / 桌面端居中 modal */}
      <GlassDetailSheet
        open={detailItem !== null}
        onClose={() => {
          setDetailItem(null);
          setDetail(null);
        }}
        ariaLabel={detailItem ? `热点详情：${detailItem.title}` : '热点详情'}
      >
        {detailItem ? (
          detailLoading || !detail ? (
            <div className="space-y-3 px-5 pb-10 pt-2 sm:px-7" aria-busy="true">
              <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
              <div className="h-7 w-4/5 animate-pulse rounded-lg bg-muted" />
              <div className="h-32 animate-pulse rounded-2xl bg-muted" />
            </div>
          ) : (
            <TrendRadarDetailView
              detail={detail}
              promoting={promoting[detailItem.id] ?? false}
              onPromote={() => handlePromote(detailItem)}
            />
          )
        ) : null}
      </GlassDetailSheet>

      <MobileTabBar />
    </div>
  );
}

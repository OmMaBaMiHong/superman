'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flame,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import {
  getTrendRadarItemDetail,
  getTrendRadarToday,
  promoteTrendRadarItem,
  syncTrendRadarNow,
  type TrendRadarItem,
  type TrendRadarItemDetail,
  type TrendRadarToday,
  extractTrendRadarOriginal,
} from '@/lib/api/apiClient';
import {
  fetchChaosHotBoard,
  fetchChaosGithubRepos,
  type ChaosGithubPage,
  type ChaosGithubRepo,
} from '@/lib/api/chaosHotboard';
import { toast } from '@/features/toast/toast';
import ContentTypeBadge from '@/components/ui/content-type-badge';
import DirectionBadge from '@/components/ui/direction-badge';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import { cn } from '@/lib/utils';

const POLL_MS = 60_000;

/** 数据通道子 tab：三条通道各自独立数据源，互不混装。 */
const HOT_TABS: Array<{ key: 'news' | 'github' | 'dsh'; label: string }> = [
  { key: 'news', label: '新闻热点' },
  { key: 'github', label: 'GitHub' },
  { key: 'dsh', label: 'DSH' },
];

/** GitHub 仓库卡片：owner/repo + 描述 + topics 标签 + 功能类目 + 质量分 + 更新时间（对齐 GitHub 搜索结果视图）。 */
function GithubRepoCard({ item }: { item: ChaosGithubRepo }) {
  const updated = item.updatedAt ? item.updatedAt.slice(0, 10) : null;
  return (
    <li className="border-b border-border/60 px-3.5 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <a
          href={item.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-sm font-semibold text-primary hover:underline"
        >
          {item.repo}
        </a>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
          {item.categoryName}
        </span>
      </div>
      {item.description ? (
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
          {item.description}
        </p>
      ) : null}
      {item.topics.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.topics.map((topic) => (
            <span
              key={topic}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
            >
              {topic}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-3 font-mono text-[10px] tabular-nums text-muted-foreground/70">
        {item.qualityScore !== null ? (
          <span className="inline-flex items-center gap-1">
            <Star aria-hidden="true" className="h-3 w-3" />
            {item.qualityScore}/5
          </span>
        ) : null}
        {updated ? <span>更新于 {updated}</span> : null}
      </div>
    </li>
  );
}

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
        {promoted ? <DirectionBadge directionKey={item.directionKey} /> : null}
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

  // 原文抓取（二创素材）：打开即自动抓，视频类条目引导走原链接/转选题后处理
  const isVideo = detail.contentType === 'video';
  const [original, setOriginal] = useState<{ title: string | null; text: string } | null>(null);
  const [originalState, setOriginalState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    if (isVideo) {
      setOriginalState('unavailable');
      return undefined;
    }
    setOriginal(null);
    setOriginalState('loading');
    let cancelled = false;
    void extractTrendRadarOriginal(detail.id, { notifyOnError: false })
      .then((result) => {
        if (cancelled) return;
        setOriginal(result);
        setOriginalState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setOriginalState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id, isVideo]);

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

      {isVideo ? (
        <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3 text-[13px] text-muted-foreground">
          视频类条目：直接{isExternal ? <a href={detail.url} target="_blank" rel="noreferrer" className="mx-0.5 text-primary hover:opacity-80">打开原视频</a> : null}观看；
          转为选题后可下载视频、提取文案再二创。
        </div>
      ) : originalState === 'loading' ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3 text-[13px] text-muted-foreground" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          正在抓取原文…
        </div>
      ) : originalState === 'ready' && original ? (
        <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">原文</p>
          <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-secondary-foreground">
            {original.text}
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3 text-[13px] text-muted-foreground">
          未能自动抓取原文（源页面可能反爬或不是文章页），可{isExternal ? <a href={detail.url} target="_blank" rel="noreferrer" className="mx-0.5 text-primary hover:opacity-80">打开原链接</a> : null}查看；
          转为选题后走全文管道补抓。
        </div>
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
  const [detailError, setDetailError] = useState<string | null>(null);

  const railRef = useRef<HTMLDivElement>(null);
  const pillBarRef = useRef<HTMLDivElement>(null);
  const railDragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  /** 鼠标拖拽后短暂抑制条目点击（拖轨道不应误开详情）。 */
  const railDragSuppressUntilRef = useRef(0);
  /** 拖动/程序平滑滚动期间屏蔽 scroll 事件回写，避免 pill 高亮抖动。 */
  const suppressScrollSyncRef = useRef(false);

  // 三 tab：新闻热点 / GitHub / DSH（数据通道分离，各自独立加载）
  const [hotTab, setHotTab] = useState<'news' | 'github' | 'dsh'>('news');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // 新闻热榜走中台（已排除 GitHub 代码源）；不可用/未配置降级本地 TrendRadar
      const hotboard = await fetchChaosHotBoard();
      if (hotboard && hotboard.platforms.length > 0) {
        setData(hotboard as never);
        setError(null);
      } else {
        setData(await getTrendRadarToday(undefined, { notifyOnError: false }));
        setError(null);
      }
    } catch {
      if (!silent) setError('热点数据加载失败，请稍后重试。');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // GitHub 仓库（治理后卡片，服务端分页，滚动追加）
  const [repoState, setRepoState] = useState<ChaosGithubPage | null>(null);
  const [repos, setRepos] = useState<ChaosGithubRepo[]>([]);
  const [repoCat, setRepoCat] = useState('all');
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const reposLoadedRef = useRef(false);

  const loadRepos = useCallback(async (category: string, page = 1) => {
    setRepoLoading(true);
    setRepoError(null);
    try {
      const result = await fetchChaosGithubRepos(page, category);
      if (!result) {
        setRepoError('GitHub 数据加载失败，请稍后重试。');
        return;
      }
      setRepoState(result);
      setRepos((current) => (page > 1 ? [...current, ...result.items] : result.items));
    } finally {
      setRepoLoading(false);
    }
  }, []);

  // 切到 GitHub tab 按需首载（一次），之后翻页/切类目由交互触发
  useEffect(() => {
    if (hotTab === 'github' && !reposLoadedRef.current) {
      reposLoadedRef.current = true;
      void loadRepos('all', 1);
    }
  }, [hotTab, loadRepos]);

  const switchRepoCat = useCallback(
    (key: string) => {
      setRepoCat(key);
      void loadRepos(key, 1);
    },
    [loadRepos],
  );

  // 列表底部 sentinel：滚进视口自动追加下一页
  const repoSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (hotTab !== 'github') return;
    const node = repoSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && repoState?.hasMore && !repoLoading) {
          void loadRepos(repoCat, repoState.page + 1);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hotTab, repoState, repoLoading, repoCat, loadRepos]);

  // 立即同步：不等调度器周期，直接读 TrendRadar 当日 SQLite upsert 进库
  const [syncing, setSyncing] = useState(false);
  const handleSyncNow = useCallback(() => {
    setSyncing(true);
    void syncTrendRadarNow()
      .then((r) => {
        toast.success(r.status === 'ok'
          ? `已同步 ${r.upserted} 条热榜（${r.platforms} 个平台）`
          : 'TrendRadar 今天还没有数据：等它跑完一轮再同步');
        return load(true);
      })
      .catch(() => toast.error('同步失败，请确认 TrendRadar 与执行器状态'))
      .finally(() => setSyncing(false));
  }, [load]);

  // 分钟级轮询只服务新闻热点 tab；GitHub/DSH 按需加载不轮询
  useEffect(() => {
    if (hotTab !== 'news') return;
    void load();
    const timer = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, hotTab]);

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
    setDetailError(null);
    setDetailLoading(true);
    void getTrendRadarItemDetail(item.id, { notifyOnError: false })
      .then((result) => {
        setDetail(result);
        setDetailError(null);
      })
      .catch(() => {
        // 失败不再静默挂骨架：弹窗内给出错误与重试
        setDetail(null);
        setDetailError('详情加载失败，请重试');
      })
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
            {hotTab === 'news' && data ? (
              <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground sm:inline">
                {data.date} · {data.platforms.length} 平台 · {data.total} 条
              </span>
            ) : null}
            {hotTab === 'news' ? (
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={syncing}
                aria-label="立即同步热榜"
                title="立即读取 TrendRadar 当日数据入仓"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary transition-colors duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-9 sm:w-9"
              >
                <RefreshCw aria-hidden="true" className={cn('h-4 w-4', syncing && 'animate-spin')} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => (hotTab === 'github' ? switchRepoCat(repoCat) : void load())}
              aria-label="刷新"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-9"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 数据通道子 tab：新闻热点 / GitHub / DSH */}
        <div
          role="tablist"
          aria-label="热点数据源"
          className="flex items-center gap-1.5 px-4 pb-2 sm:px-6"
        >
          {HOT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={hotTab === tab.key}
              onClick={() => setHotTab(tab.key)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                hotTab === tab.key
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 平台 pill 栏（与轨道双向联动，仅新闻热点 tab） */}
        {hotTab === 'news' && platforms.length > 0 ? (
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
        {hotTab === 'news' ? (
          loading ? (
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
              <p className="text-sm font-medium text-foreground">新闻热榜数据接入中</p>
              <p className="mt-2 text-xs text-muted-foreground">
                中台资讯源就位后自动展示；GitHub 仓库在「GitHub」tab 查看。
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
          )
        ) : hotTab === 'github' ? (
          /* GitHub 仓库：功能类目 chips + 仓库卡片列表 + 滚动分页 */
          <div className="mx-4 sm:mx-6">
            {repoState && repoState.categories.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => switchRepoCat('all')}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
                    repoCat === 'all'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  全部
                  <span className="font-mono text-[10px] tabular-nums opacity-60">{repoState.grandTotal}</span>
                </button>
                {repoState.categories.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => switchRepoCat(cat.key)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
                      repoCat === cat.key
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {cat.name}
                    <span className="font-mono text-[10px] tabular-nums opacity-60">{cat.count}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {repoError ? (
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">{repoError}</p>
              </div>
            ) : repos.length === 0 && repoLoading ? (
              <div className="flex justify-center py-16" aria-busy="true">
                <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : repos.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">暂无 GitHub 仓库数据</p>
                <p className="mt-2 text-xs text-muted-foreground">中台采集器就绪后自动展示。</p>
              </div>
            ) : (
              <>
                <div className="gov-card overflow-hidden">
                  <ul>
                    {repos.map((item) => (
                      <GithubRepoCard key={item.id} item={item} />
                    ))}
                  </ul>
                </div>
                <div ref={repoSentinelRef} className="flex justify-center py-6 text-xs text-muted-foreground">
                  {repoLoading ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : repoState?.hasMore ? (
                    <span>上滑加载更多</span>
                  ) : (
                    <span>已全部加载 · {repos.length} 个仓库</span>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mx-4 rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center sm:mx-6">
            <p className="text-sm font-medium text-foreground">DSH 生态动态</p>
            <p className="mt-2 text-xs text-muted-foreground">数据通道筹备中，敬请期待。</p>
          </div>
        )}
      </main>

      {/* 详情 sheet：移动端底部滑上 / 桌面端居中 modal */}
      <GlassDetailSheet
        open={detailItem !== null}
        onClose={() => {
          setDetailItem(null);
          setDetail(null);
          setDetailError(null);
        }}
        ariaLabel={detailItem ? `热点详情：${detailItem.title}` : '热点详情'}
      >
        {detailItem ? (
          detailError ? (
            <div className="space-y-3 px-5 pb-10 pt-6 sm:px-7" role="alert">
              <p className="text-sm font-medium text-foreground">{detailError}</p>
              <button
                type="button"
                onClick={() => detailItem && openDetail(detailItem)}
                className="inline-flex h-9 items-center rounded-full border border-border px-4 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                重试
              </button>
            </div>
          ) : detailLoading || !detail ? (
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

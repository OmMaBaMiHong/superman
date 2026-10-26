'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SubscribeNavState } from '@/h5/components/SubscribeTabs';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flame,
  RefreshCw,
  Star,
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
  fetchChaosDshMarket,
  fetchChaosDshCategories,
  type ChaosGithubPage,
  type ChaosGithubRepo,
  type ChaosDshPlugin,
} from '@/lib/api/chaosHotboard';
import { toast } from '@/features/toast/toast';
import ContentTypeBadge from '@/components/ui/content-type-badge';
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

/** DSH 插件市场卡片：popular 排名徽章（前三奖牌）+ 名称/描述分层 + stars 指标 + tags + 安装命令。 */
function DshPluginCard({ item, rank }: { item: ChaosDshPlugin; rank: number }) {
  const stars = item.stars >= 1000 ? `${(item.stars / 1000).toFixed(1)}k` : String(item.stars);
  return (
    <li className="border-b border-border/60 px-3.5 py-3 last:border-b-0">
      <div className="flex items-start gap-2.5">
        <RankBadge rank={rank} />
        <div className="min-w-0 flex-1">
          <a
            href={item.sourceUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[13.5px] font-semibold leading-snug text-foreground hover:underline"
            title={item.name}
          >
            {item.name}
          </a>
          {item.description ? (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
              {item.description}
            </p>
          ) : null}
          {item.tags.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {item.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="max-w-[10rem] truncate rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary/90"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {item.installCommand ? (
            <code className="mt-1.5 block truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground/80">
              <span aria-hidden="true" className="mr-1 text-success">$</span>
              {item.installCommand}
            </code>
          ) : null}
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-0.5 pt-0.5 font-mono text-[10px] tabular-nums font-medium text-amber-600 dark:text-amber-400"
          title={`${item.stars} stars`}
        >
          <Star aria-hidden="true" className="h-3 w-3" />
          {stars}
        </span>
      </div>
    </li>
  );
}

/** 星数格式化：1234 → 1.2k（与 GitHub 惯例一致）。 */
function formatStars(stars: number): string {
  return stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : String(stars);
}

/** GitHub 仓库卡片：首字母方块 + owner/repo 分层名 + 中文描述(回退原文) + topics/类目标签行 + 星数/语言指标。 */
function GithubRepoCard({ item }: { item: ChaosGithubRepo }) {
  const slash = item.repo.indexOf('/');
  const owner = slash > 0 ? item.repo.slice(0, slash) : '';
  const name = slash > 0 ? item.repo.slice(slash + 1) : item.repo;
  const initial = (name || owner || '?').charAt(0).toUpperCase();
  const updated = item.updatedAt ? item.updatedAt.slice(0, 10) : null;
  const description = item.descriptionZh?.trim() || item.description;
  return (
    <li className="border-b border-border/60 px-3.5 py-3 last:border-b-0">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted/40 font-mono text-[13px] font-bold text-primary"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={item.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[13.5px] leading-snug hover:underline"
            title={item.repo}
          >
            {owner ? <span className="text-muted-foreground">{owner}/</span> : null}
            <span className="font-semibold text-foreground">{name}</span>
          </a>
          {description ? (
            <p
              className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground"
              title={item.descriptionZh ? item.description ?? '' : undefined}
            >
              {description}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="rounded border border-border bg-muted px-1.5 py-px text-[10px] font-medium text-foreground/80">
              {item.categoryName}
            </span>
            {item.topics.slice(0, 3).map((topic) => (
              <span
                key={topic}
                className="max-w-[10rem] truncate rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
          {item.stars !== null ? (
            <span
              className="inline-flex items-center gap-0.5 font-mono text-[11px] tabular-nums font-medium text-amber-600 dark:text-amber-400"
              title={`${item.stars} stars`}
            >
              <Star aria-hidden="true" className="h-3 w-3" />
              {formatStars(item.stars)}
            </span>
          ) : null}
          {item.language ? (
            <span className="font-mono text-[10px] text-muted-foreground">{item.language}</span>
          ) : null}
        </div>
      </div>
      {updated ? (
        <p className="mt-1 pl-[42px] font-mono text-[10px] tabular-nums text-muted-foreground/80">
          更新于 {updated}
        </p>
      ) : null}
    </li>
  );
}

/** 排名变化徽章已从行内撤下（中台流数据无历史排名，NaN 误显）；详情 payload 里可看全量字段。 */

/** 排名徽章：前三名金银铜奖牌感，其余素色序号（对齐榜天下 atlas 榜单行语义）；明暗双主题可读。 */
function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) {
    return <span className="w-6 shrink-0" aria-hidden="true">—</span>;
  }
  const medal =
    rank === 1
      ? 'border-amber-500/50 bg-amber-100 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300'
      : rank === 2
        ? 'border-zinc-400/50 bg-zinc-200 text-zinc-700 dark:border-slate-300/40 dark:bg-slate-300/10 dark:text-slate-200'
        : rank === 3
          ? 'border-orange-500/50 bg-orange-100 text-orange-700 dark:border-orange-600/40 dark:bg-orange-600/15 dark:text-orange-300'
          : null;
  return (
    <span
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-md border font-mono text-[11px] tabular-nums',
        medal ?? 'border-transparent font-medium text-muted-foreground',
      )}
    >
      {rank}
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
  return (
    <li>
      <button
        type="button"
        data-testid="trend-radar-item"
        onClick={() => onOpenDetail(item)}
        className={cn(
          'flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0',
          'transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        <RankBadge rank={item.rank} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-[13.5px] font-medium leading-snug text-foreground">
            {item.title}
          </span>
          {item.summary ? (
            <span className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
              {item.summary}
            </span>
          ) : null}
        </span>
        {item.hotValue ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 pt-0.5 font-mono text-[10px] tabular-nums text-orange-400/90">
            <Flame aria-hidden="true" className="h-3 w-3" />
            {item.hotValue}
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
 *
 * embedded：嵌入订阅页子 tab 使用——隐藏自身页头（返回/标题）与内部数据通道
 * 切换（由父级 tab 控制），保留同步/刷新动作与平台 pill 栏。
 */
export interface TrendingConsoleProps {
  embedded?: boolean;
  initialHotTab?: 'news' | 'github' | 'dsh';
  /** 用户订阅的平台 key 白名单（空/缺省 = 全部）；作用于 pills、轨道与统计 */
  platformFilter?: string[];
  /** 用户订阅的 GitHub 分类 key（空/缺省 = 全部）；作用于分类 pills */
  categoryFilter?: string[];
  /**
   * 嵌入态导航上报：把二级 pills / 统计 / 动作以数据形式交给订阅页统一导航
   * （SubscribeTabs）渲染，本组件自身不再画导航。独立形态不传即用自带页头。
   */
  onNavUpdate?: (state: SubscribeNavState) => void;
}

export default function TrendingConsole({
  embedded = false,
  initialHotTab,
  platformFilter,
  categoryFilter,
  onNavUpdate,
}: TrendingConsoleProps = {}) {
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
  const [hotTab, setHotTab] = useState<'news' | 'github' | 'dsh'>(initialHotTab ?? 'news');

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

  // 中文描述异步回填：服务端受理翻译后，延时【单次】补拉替换列表（有受理闸门与次数上限，不是轮询）
  const ghRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghRefetchCountRef = useRef(0);
  useEffect(() => {
    if (hotTab !== 'github') return;
    const accepted = repoState?.translating ?? 0;
    if (accepted <= 0) {
      // 无新受理（翻完/冷却/未配模型）→ 计数清零，下一波回填重新获得补拉预算
      ghRefetchCountRef.current = 0;
      return;
    }
    if (ghRefetchCountRef.current >= 2) return;
    if (ghRefetchTimerRef.current) clearTimeout(ghRefetchTimerRef.current);
    ghRefetchCountRef.current += 1;
    ghRefetchTimerRef.current = setTimeout(() => {
      ghRefetchTimerRef.current = null;
      void loadRepos(repoCat, 1);
    }, 12_000);
    return () => {
      if (ghRefetchTimerRef.current) {
        clearTimeout(ghRefetchTimerRef.current);
        ghRefetchTimerRef.current = null;
      }
    };
  }, [repoState, hotTab, repoCat, loadRepos]);

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

  // DSH 插件市场（中台货架，服务端分页，按需首载）
  const [dshPlugins, setDshPlugins] = useState<ChaosDshPlugin[]>([]);
  const [dshTotal, setDshTotal] = useState(0);
  const [dshCats, setDshCats] = useState<Array<{ slug: string; name: string; pluginCount: number }>>([]);
  const [dshCat, setDshCat] = useState('all');
  const [dshPage, setDshPage] = useState(1);
  const [dshHasMore, setDshHasMore] = useState(false);
  const [dshLoading, setDshLoading] = useState(false);
  const [dshError, setDshError] = useState<string | null>(null);
  const dshLoadedRef = useRef(false);

  const loadDsh = useCallback(async (category: string, page: number) => {
    setDshLoading(true);
    setDshError(null);
    try {
      const result = await fetchChaosDshMarket(page, category);
      if (!result) {
        setDshError('DSH 市场数据加载失败，请稍后重试。');
        return;
      }
      setDshTotal(result.total);
      setDshPage(result.page);
      setDshHasMore(result.page * result.pageSize < result.total);
      setDshPlugins((current) => (page > 1 ? [...current, ...result.items] : result.items));
    } finally {
      setDshLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hotTab === 'dsh' && !dshLoadedRef.current) {
      dshLoadedRef.current = true;
      void fetchChaosDshCategories().then(setDshCats);
      void loadDsh('all', 1);
    }
  }, [hotTab, loadDsh]);

  const switchDshCat = useCallback(
    (slug: string) => {
      setDshCat(slug);
      void loadDsh(slug, 1);
    },
    [loadDsh],
  );

  const dshSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (hotTab !== 'dsh') return;
    const node = dshSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && dshHasMore && !dshLoading) {
          void loadDsh(dshCat, dshPage + 1);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hotTab, dshHasMore, dshLoading, dshCat, dshPage, loadDsh]);

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

  const allPlatforms = useMemo(() => data?.platforms ?? [], [data]);
  // 展示口径 = 用户订阅的平台（空 = 全部）；可订阅项（picks）始终上报全量，否则勾过了就加不回来
  // 订阅了分类时：浏览分类收敛到订阅集合内（repoCat 漂移到未订阅分类则自动切回）
  useEffect(() => {
    if (!categoryFilter || categoryFilter.length === 0 || !repoState) return;
    const subscribedCats = repoState.categories.filter((cat) => categoryFilter.includes(cat.key));
    if (subscribedCats.length === 0) return;
    if (!subscribedCats.some((cat) => cat.key === repoCat)) setRepoCat(subscribedCats[0].key);
  }, [categoryFilter, repoState, repoCat]);

  const platforms = useMemo(() => {
    // 订阅制严格口径：platformFilter 为 undefined（独立形态未接订阅制）才展示全量；
    // 空数组 = 用户一个平台都没勾 → 一条不展示（面板显示订阅引导）。
    if (platformFilter === undefined) return allPlatforms;
    return allPlatforms.filter((group) => platformFilter.includes(group.platform));
  }, [allPlatforms, platformFilter]);

  // 处理器经 ref 供导航上报 effect 使用：函数本体逐渲染重建，进依赖会导致每次渲染重复上报
  const navHandlersRef = useRef({
    scrollToPlatform,
    handleSyncNow,
    switchRepoCat,
    switchDshCat,
    load,
    platforms,
    repoCat,
    dshCats,
    dshCat,
    repoState,
  });
  navHandlersRef.current = {
    scrollToPlatform,
    handleSyncNow,
    switchRepoCat,
    switchDshCat,
    load,
    platforms,
    repoCat,
    dshCats,
    dshCat,
    repoState,
  };

  // 嵌入态：把二级筛选 pills / 统计 / 动作以【数据】上报给订阅页统一导航（SubscribeTabs）——
  // 嵌入态自身不渲染任何导航，所有来源同一组件同一几何。
  useEffect(() => {
    if (!embedded || !onNavUpdate) return;
    const h = navHandlersRef.current;
    let pills: Array<{ key: string; label: string; count?: number; active?: boolean }> = [];
    let stats: string | undefined = undefined;
    let canSync = false;
    let onRefresh: () => void = () => h.load();
    if (hotTab === 'news') {
      pills = platforms.map((group, index) => ({
        key: group.platform,
        label: group.platformName,
        count: group.items.length,
        active: activePlatform === index,
      }));
      stats = data
        ? `${data.date} · ${platforms.reduce((sum, group) => sum + group.items.length, 0)} 条`
        : undefined;
      canSync = true;
    } else if (hotTab === 'github' && h.repoState) {
      // 订阅制：勾选了分类 → 二级 pills 收敛到订阅集合（「全部」收起）
      const cats =
        categoryFilter === undefined
          ? h.repoState.categories
          : h.repoState.categories.filter((cat) => categoryFilter.includes(cat.key));
      pills = [
        ...(categoryFilter === undefined
          ? [{ key: 'all', label: '全部', count: h.repoState.grandTotal, active: h.repoCat === 'all' }]
          : []),
        ...cats.map((cat) => ({
          key: cat.key,
          label: cat.name,
          count: cat.count,
          active: h.repoCat === cat.key,
        })),
      ];
      stats = `共 ${h.repoState.grandTotal} 个仓库`;
      onRefresh = () => h.switchRepoCat(h.repoCat);
    } else if (hotTab === 'dsh' && h.dshCats.length > 0) {
      // 订阅制：勾选了插件分类 → 二级 pills 收敛到订阅集合（「全部」收起）
      const dshCatsVisible =
        categoryFilter === undefined
          ? h.dshCats
          : h.dshCats.filter((cat) => categoryFilter.includes(cat.slug));
      const dshTotal = dshCatsVisible.reduce((sum, cat) => sum + cat.pluginCount, 0);
      pills = [
        ...(categoryFilter === undefined
          ? [{ key: 'all', label: '全部', count: dshTotal, active: h.dshCat === 'all' }]
          : []),
        ...dshCatsVisible.map((cat) => ({
          key: cat.slug,
          label: cat.name,
          count: cat.pluginCount,
          active: h.dshCat === cat.slug,
        })),
      ];
      stats = `共 ${dshTotal} 个插件`;
      onRefresh = () => h.switchDshCat(h.dshCat);
    }
    onNavUpdate({
      pillGroups: pills.length > 0 ? [pills] : [],
      onPill: (_groupIndex: number, key: string) => {
        if (hotTab === 'news') {
          const idx = h.platforms.findIndex((group) => group.platform === key);
          if (idx >= 0) h.scrollToPlatform(idx);
        } else if (hotTab === 'github') h.switchRepoCat(key);
        else if (hotTab === 'dsh') h.switchDshCat(key);
      },
      onSync: () => h.handleSyncNow(),
      stats,
      canSync,
      onRefresh,
    });
    // 卸载/切走时清空宿主导航的二级行
    return () => onNavUpdate?.({});
    // 依赖全部来自组件状态/props（处理器走 ref），父级重渲染不会触发重复上报
  }, [
    embedded,
    onNavUpdate,
    hotTab,
    platforms,
    allPlatforms,
    data,
    syncing,
    activePlatform,
    repoState,
    repoCat,
    dshCats,
    dshCat,
    categoryFilter,
  ]);

  return (
    <div className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-screen flex-col'}>
      {/* 顶部指挥条（独立形态专用；嵌入态导航由订阅页 SubscribeTabs 统一渲染） */}
      {embedded ? null : (
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
                  title="立即同步热榜数据入仓"
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
          <div role="tablist" aria-label="热点数据源" className="flex items-center gap-1.5 px-4 pb-2 sm:px-6">
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
      )}

      <main className={cn('w-full flex-1 px-0', embedded ? 'flex min-h-0 flex-1 flex-col pb-2 pt-1' : 'mx-auto max-w-6xl pb-28 pt-4 md:pb-8')}>
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
              <p className="text-sm font-medium text-foreground">
                {embedded && platformFilter !== undefined ? '还没有订阅平台' : '新闻热榜数据接入中'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {embedded && platformFilter !== undefined
                  ? '点上方「+」勾选要订阅的平台，榜单会出现在这里。'
                  : '中台资讯源就位后自动展示；GitHub 仓库在「GitHub」tab 查看。'}
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
                embedded && 'min-h-0 flex-1 items-stretch',
              )}
            >
              {platforms.map((group) => (
                <section
                  key={group.platform}
                  data-platform-column={group.platform}
                  className={cn(
                    'gov-card flex w-[88vw] shrink-0 snap-start flex-col overflow-hidden [--gov-accent:var(--glass-border)] md:w-[380px]',
                    // 嵌入态列高随面板撑满（父链 flex 已算好剩余高度）；独立态按视口预算
                    embedded ? 'h-full min-h-0' : 'h-[calc(100vh-15rem)] max-h-[42rem]',
                  )}
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
          {/* 分类 pill 栏（按用户订阅的分类过滤；订阅后「全部」收起，浏览收敛到订阅集合） */}
          {!embedded && repoState && repoState.categories.length > 0 ? (
            <div className="flex items-center gap-1.5 px-4 pb-2.5 sm:px-6">
              {(!categoryFilter || categoryFilter.length === 0) && (
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
              )}
              {repoState.categories
                .filter((cat) => !categoryFilter || categoryFilter.length === 0 || categoryFilter.includes(cat.key))
                .map((cat) => (
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
            {embedded && categoryFilter !== undefined && repoState && !repoState.categories.some((cat) => categoryFilter.includes(cat.key)) ? (
              /* 订阅制：未勾选任何 GitHub 分类 → 不展示仓库，只出订阅引导 */
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">还没有订阅 GitHub 分类</p>
                <p className="mt-2 text-xs text-muted-foreground">点右上角「+」勾选关注的分类，仓库会出现在这里。</p>
              </div>
            ) : repoError ? (
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
          /* DSH 插件市场：分类 chips + 插件卡片 + 滚动分页 */
          <div className="mx-4 sm:mx-6">
            {!embedded && dshCats.some((cat) => cat.pluginCount > 0) && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => switchDshCat('all')}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
                    dshCat === 'all'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  全部
                  <span className="font-mono text-[10px] tabular-nums opacity-60">{dshCats.reduce((sum, c) => sum + c.pluginCount, 0)}</span>
                </button>
                {dshCats.filter((cat) => cat.pluginCount > 0).map((cat) => (
                  <button
                    key={cat.slug}
                    type="button"
                    onClick={() => switchDshCat(cat.slug)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
                      dshCat === cat.slug
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {cat.name}
                    <span className="font-mono text-[10px] tabular-nums opacity-60">{cat.pluginCount}</span>
                  </button>
                ))}
              </div>
            )}
            {embedded && categoryFilter !== undefined && !dshCats.some((cat) => categoryFilter.includes(cat.slug)) ? (
              /* 订阅制：未勾选任何插件分类 → 不展示插件，只出订阅引导 */
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">还没有订阅插件分类</p>
                <p className="mt-2 text-xs text-muted-foreground">点右上角「+」勾选关注的分类，插件会出现在这里。</p>
              </div>
            ) : dshError ? (
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">{dshError}</p>
              </div>
            ) : dshPlugins.length === 0 && dshLoading ? (
              <div className="flex justify-center py-16" aria-busy="true">
                <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : dshPlugins.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">暂无 DSH 插件数据</p>
                <p className="mt-2 text-xs text-muted-foreground">中台市场目录就绪后自动展示。</p>
              </div>
            ) : (
              <>
                <div className="gov-card overflow-hidden">
                  <ul>
                    {dshPlugins.map((item, index) => (
                      <DshPluginCard key={item.id} item={item} rank={index + 1} />
                    ))}
                  </ul>
                </div>
                <div ref={dshSentinelRef} className="flex justify-center py-6 text-xs text-muted-foreground">
                  {dshLoading ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : dshHasMore ? (
                    <span>上滑加载更多</span>
                  ) : (
                    <span>已全部加载 · {dshPlugins.length} / {dshTotal} 个插件</span>
                  )}
                </div>
              </>
            )}
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

      {embedded ? null : <MobileTabBar />}
    </div>
  );
}

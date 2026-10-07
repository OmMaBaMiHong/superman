'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Kanban, PenLine, RefreshCw, Rows3, Search } from 'lucide-react';
import {
  acceptDraft,
  approveGovernanceItem,
  createRewriteJobs,
  exportDraftMarkdown,
  getDraftDetail,
  getGovernanceQueue,
  getStudioBoard,
  listDrafts,
  listPipelineJobs,
  listPublishedPosts,
  redraftGovernanceItem,
  rejectGovernanceItem,
  retryPipelineJob,
  type DraftDetail,
  type DraftItem,
  type GovernanceQueueItem,
  type PipelineJobItem,
  type RewritePlatform,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import ContentDetailSheet from '@/features/contents/components/ContentDetailSheet';
import PerformanceSection from './PerformanceSection';
import GovernanceConsole from '@/features/governance/components/GovernanceConsole';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import { cn } from '@/lib/utils';
import DraftCompareView from './DraftCompareView';
import PipelineJobList from './PipelineJobList';
import PlatformPickerSheet from './PlatformPickerSheet';
import ProductPlanSection from './ProductPlanSection';
import TopicPoolCard from './TopicPoolCard';
import TopicKanbanBoard from './TopicKanbanBoard';
import {
  formatSimilarity,
  ORIGINALITY_META,
  platformBadgeClass,
  platformName,
  similarityToneClass,
} from '../lib/platforms';

type StudioSection = 'queue' | 'topics' | 'jobs' | 'drafts' | 'plans' | 'performance';

const SECTIONS: Array<{ id: StudioSection; name: string }> = [
  { id: 'queue', name: '审批' },
  { id: 'topics', name: '选题池' },
  { id: 'jobs', name: '创作中' },
  { id: 'drafts', name: '草稿箱' },
  { id: 'plans', name: '产品计划' },
  { id: 'performance', name: '表现' },
];

const GOV_PAGE_SIZE = 100; // 后端单页封顶 100：全量加载按 100 静默翻完，不暴露分页 UI
const SEARCH_DEBOUNCE_MS = 400;

// tab ↔ 看板列 的对应关系（产品计划/表现不是内容流转阶段，没有列）
const SECTION_TO_STAGE: Partial<Record<StudioSection, string>> = {
  queue: 'review',
  topics: 'pool',
  jobs: 'generating',
  drafts: 'drafts',
};

/** 任务列表浅等价：id+状态+更新时间不变即视为未变（轮询节流用）。 */
function sameJobs(prev: PipelineJobItem[], next: PipelineJobItem[]): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((job, i) => {
    const other = next[i];
    return job.id === other?.id && job.status === other.status && (job.updatedAt ?? '') === (other.updatedAt ?? '');
  });
}

/** 触发浏览器下载（导出 Markdown）。 */
function triggerDownload(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 创作页主控台：审批 / 选题池 / 流水线任务 / 草稿箱 / 产品计划 / 表现 分区（审批台整体嵌入）。
 *  列表 / 看板是同一份数据的两种视图：列表按 tab 看单阶段，看板把各阶段并排成列，tab 与列双向联动。 */
export default function StudioConsole({ initialSection }: { initialSection?: StudioSection }) {
  const [section, setSection] = useState<StudioSection>(initialSection ?? 'topics');

  // 视图模式：列表(默认，tab+各自列表) / 看板(同一份数据按阶段并排成列)。localStorage 记忆。
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  useEffect(() => {
    try {
      if (localStorage.getItem('studio_view_mode') === 'kanban') setViewMode('kanban');
    } catch {
      // localStorage 不可用时保持列表
    }
  }, []);
  const switchViewMode = useCallback((mode: 'list' | 'kanban') => {
    setViewMode(mode);
    try {
      localStorage.setItem('studio_view_mode', mode);
    } catch {
      // 忽略
    }
  }, []);

  // tab ↔ 看板列 的对应关系见模块级 SECTION_TO_STAGE
  /** 选中一个分区：列表模式下就是普通切换；看板模式下滚到对应列，非流转阶段切回列表。 */
  const activateSection = useCallback(
    (id: StudioSection) => {
      setSection(id);
      if (viewMode === 'kanban') {
        const stageId = SECTION_TO_STAGE[id];
        if (stageId) {
          document.getElementById(`ffw-kcol-${stageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          return;
        }
        switchViewMode('list');
      }
    },
    [viewMode, switchViewMode],
  );

  // ── 选题池（archived 文章，首屏水合 + 滚动分页追加）──
  const [topics, setTopics] = useState<GovernanceQueueItem[]>([]);
  const [topicsTotal, setTopicsTotal] = useState(0);
  const [topicsLoadingMore, setTopicsLoadingMore] = useState(false);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  // ── 审批列（看板第一列）：治理队列 candidate/pending（全量）──
  const [reviewItems, setReviewItems] = useState<GovernanceQueueItem[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);

  const loadReview = useCallback(async () => {
    const first = await getGovernanceQueue({ statuses: ['candidate', 'pending'], page: 1, pageSize: GOV_PAGE_SIZE });
    let items = first.items;
    if (items.length < first.total) {
      const pageCount = Math.ceil(first.total / GOV_PAGE_SIZE);
      const rest = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, i) =>
          getGovernanceQueue({ statuses: ['candidate', 'pending'], page: i + 2, pageSize: GOV_PAGE_SIZE })),
      );
      for (const part of rest) items = items.concat(part.items);
    }
    setReviewTotal(first.total);
    setReviewItems(items);
  }, []);

  // ── 流水线任务 ──
  const [jobs, setJobs] = useState<PipelineJobItem[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  // ── 草稿箱 ──
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  // 已发布草稿（published_posts.draftId 交叉比对，P2e-1b）
  const [publishedDraftIds, setPublishedDraftIds] = useState<Set<string>>(new Set());

  // ── 平台多选 sheet ──
  const [pickerItem, setPickerItem] = useState<GovernanceQueueItem | null>(null);
  const [pickerSubmitting, setPickerSubmitting] = useState(false);

  // ── 内容详情 sheet（查看正文/视频文案）──
  const [detailItem, setDetailItem] = useState<GovernanceQueueItem | null>(null);

  // ── 草稿对照 sheet ──
  const [compareItem, setCompareItem] = useState<DraftItem | null>(null);
  const [compareDetail, setCompareDetail] = useState<DraftDetail | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const searchTimerRef = useRef<number | null>(null);

  // 全量加载：不做「加载更多」分页，一次拉全、页面往下滚即可看全
  const loadTopics = useCallback(async (search: string) => {
    const keyword = search || undefined;
    const first = await getGovernanceQueue({ statuses: ['archived'], keyword, page: 1, pageSize: GOV_PAGE_SIZE });
    let items = first.items;
    if (items.length < first.total) {
      // 其余页并行拉：选题池可达数千条，串行翻页是看板首屏卡顿的主因
      const pageCount = Math.ceil(first.total / GOV_PAGE_SIZE);
      const rest = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, i) =>
          getGovernanceQueue({ statuses: ['archived'], keyword, page: i + 2, pageSize: GOV_PAGE_SIZE })),
      );
      for (const part of rest) items = items.concat(part.items);
    }
    setTopics(items);
    setTopicsTotal(first.total);
  }, []);

  // 选题池滚动分页：追加下一页（渲染多少由用户滚动决定，不做截断）
  const loadMoreTopics = useCallback(async () => {
    if (topicsLoadingMore || debouncedKeyword) return;
    if (topics.length === 0 || topics.length >= topicsTotal) return;
    setTopicsLoadingMore(true);
    try {
      const page = Math.floor(topics.length / GOV_PAGE_SIZE) + 1;
      const next = await getGovernanceQueue({ statuses: ['archived'], page, pageSize: GOV_PAGE_SIZE });
      setTopics((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...next.items.filter((item) => !seen.has(item.id))];
      });
      setTopicsTotal(next.total);
    } catch {
      // 静默
    } finally {
      setTopicsLoadingMore(false);
    }
  }, [topicsLoadingMore, topics.length, topicsTotal, debouncedKeyword]);

  // 搜索防抖
  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    };
  }, [keyword]);

  useEffect(() => {
    if (!debouncedKeyword) return; // 首屏（空关键词）由看板水合覆盖；这里只管列表搜索
    let cancelled = false;
    setTopicsLoading(true);
    void loadTopics(debouncedKeyword)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword, loadTopics]);

  // ── 看板水合（Phase A 本地缓存）：首屏读服务端 SQLite 缓存立即可渲染，
  // 后台 refresh=1 从源库整片重建换入；增删改在下次刷新天然反映。──
  const applyBoardSlices = useCallback((slices: {
    review: { items: GovernanceQueueItem[]; total: number };
    topics: { items: GovernanceQueueItem[]; total: number };
    drafts: { items: DraftItem[] };
    published: { items: Array<{ draftId: string }> };
    jobs: { items: PipelineJobItem[] };
  }) => {
    setReviewItems(slices.review.items);
    setReviewTotal(slices.review.total);
    setTopics(slices.topics.items);
    setTopicsTotal(slices.topics.total);
    setDrafts(slices.drafts.items);
    setPublishedDraftIds(new Set(slices.published.items.map((post) => post.draftId)));
    setJobs(slices.jobs.items);
    setTopicsLoading(false);
    setDraftsLoading(false);
    setJobsLoading(false);
  }, []);

  const boardHydratedRef = useRef(false);
  useEffect(() => {
    if (boardHydratedRef.current) return;
    boardHydratedRef.current = true;
    let cancelled = false;
    void (async () => {
      // 第一击：缓存（首次 ever 无缓存时服务端会落库重建，耗时同旧路径，之后秒开）
      let cached: Awaited<ReturnType<typeof getStudioBoard>> | null = null;
      try {
        cached = await getStudioBoard(undefined, { notifyOnError: false });
      } catch {
        cached = null;
      }
      if (cancelled || !cached?.slices) {
        // 缓存通道不可用（旧内核/接口缺失）：退回各自的直接加载
        setTopicsLoading(true);
        void loadReview().catch(() => {});
        void loadTopics(debouncedKeyword)
          .catch(() => {})
          .finally(() => {
            if (!cancelled) setTopicsLoading(false);
          });
        void loadDrafts();
        return;
      }
      applyBoardSlices(cached.slices);
      // 第二击（后台）：源库整片重建换入
      try {
        const fresh = await getStudioBoard({ refresh: true }, { notifyOnError: false });
        if (!cancelled) applyBoardSlices(fresh.slices);
      } catch {
        // 换入失败保留缓存内容
      }
    })();
    return () => {
      cancelled = true;
    };
    // 挂载时执行一次；debouncedKeyword/loadTopics 仅初始兜底路径引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 审批列治理动作（与审批台同一套 API）：准奏→归档进选题池；驳回→rejected；重拟→退回重新聚合
  const refreshAfterReviewAction = useCallback(() => {
    void loadReview().catch(() => {});
    void loadTopics(debouncedKeyword).catch(() => {});
  }, [loadReview, loadTopics, debouncedKeyword]);
  const handleReviewApprove = useCallback(
    (item: GovernanceQueueItem) => approveGovernanceItem(item.id).then(refreshAfterReviewAction),
    [refreshAfterReviewAction],
  );
  const handleReviewReject = useCallback(
    (item: GovernanceQueueItem, reason: string) => rejectGovernanceItem(item.id, { reason }).then(refreshAfterReviewAction),
    [refreshAfterReviewAction],
  );
  const handleReviewRedraft = useCallback(
    (item: GovernanceQueueItem, reason: string) => redraftGovernanceItem(item.id, { reason }).then(refreshAfterReviewAction),
    [refreshAfterReviewAction],
  );

  const loadJobs = useCallback(async (silent = true) => {
    if (!silent) setJobsLoading(true);
    try {
      const result = await listPipelineJobs({ kind: 'rewrite', pageSize: 50 }, { notifyOnError: false });
      // 轮询没变化就不换引用：否则每 5 秒整块看板（600 卡）全量 diff 重渲染，常驻卡顿
      setJobs((prev) => (sameJobs(prev, result.items) ? prev : result.items));
    } catch {
      // 静默
    } finally {
      if (!silent) setJobsLoading(false);
    }
  }, []);

  // 任务刷新事件驱动：挂载一次 + 面板重新可见/窗口聚焦时拉一次（无定时轮询）
  useEffect(() => {
    void loadJobs(false);
    const refresh = () => {
      if (!document.hidden) void loadJobs(true);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [loadJobs]);

  const loadDrafts = useCallback(async () => {
    try {
      const [result, postsResult] = await Promise.all([
        listDrafts({ pageSize: 50 }, { notifyOnError: false }),
        listPublishedPosts({ notifyOnError: false }),
      ]);
      setDrafts(result.items);
      setPublishedDraftIds(
        new Set(postsResult.items.map((post) => post.draftId).filter((id): id is string => id !== null)),
      );
    } catch {
      // 静默
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  // 草稿箱首屏由看板水合覆盖；loadDrafts 保留给采纳/发布后的局部刷新

  // 选题「生成中」状态：活跃 job 按 articleId 归组
  const activeJobsByArticle = useMemo(() => {
    const map = new Map<string, PipelineJobItem[]>();
    for (const job of jobs) {
      if (job.status !== 'queued' && job.status !== 'running') continue;
      const list = map.get(job.articleId) ?? [];
      list.push(job);
      map.set(job.articleId, list);
    }
    return map;
  }, [jobs]);

  // 有失败任务且当前无活跃任务的选题（看板卡片标红提醒重试）
  const failedArticleIds = useMemo(() => {
    const failed = new Set<string>();
    for (const job of jobs) {
      if (job.status === 'failed') failed.add(job.articleId);
    }
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'running') failed.delete(job.articleId);
    }
    return failed;
  }, [jobs]);

  const handleConfirmPlatforms = useCallback(
    (platforms: RewritePlatform[]) => {
      if (!pickerItem) return;
      setPickerSubmitting(true);
      void createRewriteJobs({ articleId: pickerItem.id, platforms })
        .then(() => {
          setPickerItem(null);
          void loadJobs(true);
          setSection('jobs');
        })
        .catch(() => {
          // apiClient 已统一 toast 错误
        })
        .finally(() => setPickerSubmitting(false));
    },
    [pickerItem, loadJobs],
  );

  const handleRetry = useCallback(
    (job: PipelineJobItem) => {
      setRetrying((current) => ({ ...current, [job.id]: true }));
      void retryPipelineJob(job.id)
        .then(() => loadJobs(true))
        .catch(() => {})
        .finally(() => setRetrying((current) => ({ ...current, [job.id]: false })));
    },
    [loadJobs],
  );

  const openCompare = useCallback((item: DraftItem) => {
    setCompareItem(item);
    setCompareDetail(null);
    setCompareLoading(true);
    void getDraftDetail(item.id, { notifyOnError: false })
      .then(setCompareDetail)
      .catch(() => setCompareDetail(null))
      .finally(() => setCompareLoading(false));
  }, []);

  const closeCompare = useCallback(() => {
    setCompareItem(null);
    setCompareDetail(null);
  }, []);

  const handleAccept = useCallback(() => {
    if (!compareItem) return;
    setAccepting(true);
    void acceptDraft(compareItem.id)
      .then(() => {
        setCompareDetail((current) => (current ? { ...current, status: 'accepted' } : current));
        setCompareItem((current) => (current ? { ...current, status: 'accepted' } : current));
        void loadDrafts();
      })
      .catch(() => {})
      .finally(() => setAccepting(false));
  }, [compareItem, loadDrafts]);

  const handleExport = useCallback(() => {
    if (!compareItem) return;
    setExporting(true);
    void exportDraftMarkdown(compareItem.id)
      .then(({ markdown, fileName }) => triggerDownload(fileName, markdown))
      .catch(() => {})
      .finally(() => setExporting(false));
  }, [compareItem]);



  return (
    // studio-shell：DSH 面板内页面根在顶部标签条之下，高度基数在 globals.css 按宿主收窄
    <div className="studio-shell flex min-h-dvh flex-col">
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
                <PenLine aria-hidden="true" className="h-4 w-4 text-primary" />
                创作
              </h1>
              <p className="text-[11px] text-muted-foreground">洗稿流水线 Studio</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadJobs(false);
              void loadDrafts();
              void loadTopics(debouncedKeyword).catch(() => {});
            }}
            aria-label="刷新"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-9"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* 分区切换 pill + 列表/看板视图切换（同一份数据的两种表现形式） */}
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 pb-2.5 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={section === entry.id}
                onClick={() => activateSection(entry.id)}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  section === entry.id
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.name}
                {entry.id === 'jobs' && jobs.length > 0 ? (
                  <span className="font-mono text-[10px] tabular-nums opacity-60">{jobs.length}</span>
                ) : null}
                {entry.id === 'drafts' && drafts.length > 0 ? (
                  <span className="font-mono text-[10px] tabular-nums opacity-60">{drafts.length}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="视图切换"
            className="flex flex-none items-center gap-1 rounded-full border border-border bg-card p-1"
          >
            <button
              type="button"
              aria-label="列表视图"
              aria-pressed={viewMode === 'list'}
              onClick={() => switchViewMode('list')}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
                viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Rows3 aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="看板视图"
              aria-pressed={viewMode === 'kanban'}
              onClick={() => switchViewMode('kanban')}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
                viewMode === 'kanban' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Kanban aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main
        className={cn(
          'px-4 pt-5 sm:px-6',
          viewMode === 'kanban'
            ? // 看板：整页剩余高度全给轨道、宽度放开（列多时横向滑），底部与客户端探底
              'flex min-h-0 flex-1 flex-col'
            : 'mx-auto max-w-6xl pb-28 md:pb-10',
        )}
      >
        {/* ── 看板模式：与列表同一份数据，各阶段并排成列，tab 与列双向联动 ── */}
        {viewMode === 'kanban' ? (
          <section aria-label="看板" className="flex min-h-0 flex-1 flex-col">
            {topicsLoading && topics.length === 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="gov-card h-96 animate-pulse" aria-hidden="true" />
                ))}
              </div>
            ) : (
              <TopicKanbanBoard
                reviewItems={reviewItems}
                reviewTotal={reviewTotal}
                topics={topics}
                poolHasMore={topics.length < topicsTotal && !debouncedKeyword}
                poolLoadingMore={topicsLoadingMore}
                onLoadMorePool={() => void loadMoreTopics()}
                activeJobsByArticle={activeJobsByArticle}
                failedArticleIds={failedArticleIds}
                drafts={drafts}
                publishedDraftIds={publishedDraftIds}
                activeSection={section}
                onStageSelect={(stageSectionId) => activateSection(stageSectionId as StudioSection)}
                onReviewApprove={handleReviewApprove}
                onReviewReject={handleReviewReject}
                onReviewRedraft={handleReviewRedraft}
                onGenerate={setPickerItem}
                onOpenDetail={setDetailItem}
                onOpenDraft={openCompare}
              />
            )}
          </section>
        ) : (
          <>

        {/* ── 审批（治理队列整体嵌入） ── */}
        {section === 'queue' ? (
          <section aria-label="审批">
            <GovernanceConsole embedded />
          </section>
        ) : null}

        {/* ── 产品计划（商业决策 MVP 规划） ── */}
        {section === 'plans' ? <ProductPlanSection /> : null}

        {/* ── 表现（发布后作品数据追踪，P2d） ── */}
        {section === 'performance' ? <PerformanceSection /> : null}

        {/* ── 选题卡池 ── */}
        {section === 'topics' ? (
          <section aria-label="选题池">
            <div className="relative mb-4">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索选题（标题 / 摘要）…"
                aria-label="搜索选题"
                className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {topicsLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="gov-card h-44 animate-pulse" aria-hidden="true" />
                ))}
              </div>
            ) : topics.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">
                  {debouncedKeyword ? '没有匹配的选题' : '选题池是空的'}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {debouncedKeyword ? '换个关键词试试。' : '先去审批台准奏一些内容，归档后就能在这里改写。'}
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {topics.map((item) => (
                    <TopicPoolCard
                      key={item.id}
                      item={item}
                      activeJobs={activeJobsByArticle.get(item.id) ?? []}
                      onGenerate={setPickerItem}
                      onOpenDetail={setDetailItem}
                    />
                  ))}
                </div>
                {!debouncedKeyword && topics.length < topicsTotal ? (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => void loadMoreTopics()}
                      disabled={topicsLoadingMore}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50"
                    >
                      {topicsLoadingMore ? '加载中…' : `加载更多（已加载 ${topics.length} / 共 ${topicsTotal}）`}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {/* ── 流水线任务 ── */}
        {section === 'jobs' ? (
          <section aria-label="流水线任务">
            {jobsLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="gov-card h-24 animate-pulse" aria-hidden="true" />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">还没有流水线任务</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  从选题池挑一篇文章，点「生成稿件」就会出现在这里。
                </p>
              </div>
            ) : (
              <PipelineJobList jobs={jobs} retrying={retrying} onRetry={handleRetry} />
            )}
          </section>
        ) : null}

        {/* ── 草稿箱 ── */}
        {section === 'drafts' ? (
          <section aria-label="草稿箱">
            {draftsLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="gov-card h-20 animate-pulse" aria-hidden="true" />
                ))}
              </div>
            ) : drafts.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
                <p className="text-sm font-medium text-foreground">草稿箱是空的</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  改写任务跑完后，成稿会自动进草稿箱。
                </p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {drafts.map((draft) => {
                  const flagMeta = ORIGINALITY_META[draft.originalityFlag];
                  return (
                    <li key={draft.id}>
                      <button
                        type="button"
                        data-testid="draft-row"
                        onClick={() => openCompare(draft)}
                        className={cn(
                          'gov-card flex w-full items-center gap-3 p-4 text-left [--gov-accent:var(--glass-border)]',
                          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium',
                            platformBadgeClass(draft.platform),
                          )}
                        >
                          {platformName(draft.platform)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {draft.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            原：{draft.articleTitle}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 font-mono text-sm font-semibold tabular-nums',
                            similarityToneClass(draft.similarityScore),
                          )}
                        >
                          {formatSimilarity(draft.similarityScore)}
                        </span>
                        <span
                          className={cn(
                            'inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium',
                            flagMeta.badgeClass,
                          )}
                        >
                          {flagMeta.label}
                        </span>
                        {draft.status !== 'draft' ? (
                          <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-success/40 bg-success/10 px-2 text-[11px] font-medium text-success">
                            已采用
                          </span>
                        ) : null}
                        {publishedDraftIds.has(draft.id) ? (
                          <span
                            data-testid="draft-published-badge"
                            className="inline-flex h-6 shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-2 text-[11px] font-medium text-primary"
                          >
                            已发布
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
          </>
        )}
      </main>

      {/* 平台多选 sheet */}
      <PlatformPickerSheet
        open={pickerItem !== null}
        articleTitle={pickerItem?.title ?? ''}
        submitting={pickerSubmitting}
        onClose={() => setPickerItem(null)}
        onConfirm={handleConfirmPlatforms}
      />

      {/* 内容详情 sheet（查看正文/视频文案 + 重试提取） */}
      <ContentDetailSheet
        articleId={detailItem?.id ?? null}
        onClose={() => setDetailItem(null)}
        onGenerate={() => {
          if (detailItem) {
            setPickerItem(detailItem);
            setDetailItem(null);
          }
        }}
      />

      {/* 草稿对照 sheet */}
      <GlassDetailSheet
        open={compareItem !== null}
        onClose={closeCompare}
        ariaLabel={compareItem ? `草稿对照：${compareItem.title}` : '草稿对照'}
      >
        {compareItem ? (
          compareLoading || !compareDetail ? (
            <div className="space-y-3 px-5 pb-10 pt-2 sm:px-7" aria-busy="true">
              <div className="h-6 w-32 animate-pulse rounded-full bg-muted" />
              <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
              <div className="h-56 animate-pulse rounded-2xl bg-muted" />
            </div>
          ) : (
            <DraftCompareView
              detail={compareDetail}
              accepting={accepting}
              exporting={exporting}
              onAccept={handleAccept}
              onExport={handleExport}
            />
          )
        ) : null}
      </GlassDetailSheet>

      <MobileTabBar />
    </div>
  );
}

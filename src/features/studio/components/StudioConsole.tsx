'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, PenLine, RefreshCw, Search } from 'lucide-react';
import {
  acceptDraft,
  createRewriteJobs,
  exportDraftMarkdown,
  getDraftDetail,
  getGovernanceQueue,
  listDrafts,
  listPipelineJobs,
  listPublishedPosts,
  retryPipelineJob,
  type DraftDetail,
  type DraftItem,
  type GovernanceQueueItem,
  type PipelineJobItem,
  type RewritePlatform,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import PerformanceSection from './PerformanceSection';
import GovernanceConsole from '@/features/governance/components/GovernanceConsole';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import { cn } from '@/lib/utils';
import DraftCompareView from './DraftCompareView';
import PipelineJobList from './PipelineJobList';
import PlatformPickerSheet from './PlatformPickerSheet';
import TopicPoolCard from './TopicPoolCard';
import {
  formatSimilarity,
  ORIGINALITY_META,
  platformBadgeClass,
  platformName,
  similarityToneClass,
} from '../lib/platforms';

type StudioSection = 'queue' | 'topics' | 'jobs' | 'drafts' | 'performance';

const SECTIONS: Array<{ id: StudioSection; name: string }> = [
  { id: 'queue', name: '审批' },
  { id: 'topics', name: '选题池' },
  { id: 'jobs', name: '流水线任务' },
  { id: 'drafts', name: '草稿箱' },
  { id: 'performance', name: '表现' },
];

const TOPIC_PAGE_SIZE = 24;
const JOB_POLL_MS = 5_000;
const SEARCH_DEBOUNCE_MS = 400;

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

/** 创作页主控台：审批 / 选题池 / 流水线任务 / 草稿箱 四分区（审批台整体嵌入）。 */
export default function StudioConsole({ initialSection }: { initialSection?: 'queue' }) {
  const [section, setSection] = useState<StudioSection>(initialSection === 'queue' ? 'queue' : 'topics');

  // ── 选题池（archived 文章）──
  const [topics, setTopics] = useState<GovernanceQueueItem[]>([]);
  const [topicsTotal, setTopicsTotal] = useState(0);
  const [topicsPage, setTopicsPage] = useState(1);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsLoadingMore, setTopicsLoadingMore] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

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

  // ── 草稿对照 sheet ──
  const [compareItem, setCompareItem] = useState<DraftItem | null>(null);
  const [compareDetail, setCompareDetail] = useState<DraftDetail | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const searchTimerRef = useRef<number | null>(null);

  const loadTopics = useCallback(
    async (page: number, append: boolean, search: string) => {
      const result = await getGovernanceQueue({
        statuses: ['archived'],
        keyword: search || undefined,
        page,
        pageSize: TOPIC_PAGE_SIZE,
      });
      setTopicsTotal(result.total);
      setTopics((current) => (append ? [...current, ...result.items] : result.items));
      setTopicsPage(page);
    },
    [],
  );

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
    let cancelled = false;
    setTopicsLoading(true);
    void loadTopics(1, false, debouncedKeyword)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword, loadTopics]);

  const loadJobs = useCallback(async (silent = true) => {
    if (!silent) setJobsLoading(true);
    try {
      const result = await listPipelineJobs({ kind: 'rewrite', pageSize: 50 }, { notifyOnError: false });
      setJobs(result.items);
    } catch {
      // 静默
    } finally {
      if (!silent) setJobsLoading(false);
    }
  }, []);

  // 任务 5s 轮询（进行中的任务需要实时性）
  useEffect(() => {
    void loadJobs(false);
    const timer = window.setInterval(() => void loadJobs(true), JOB_POLL_MS);
    return () => window.clearInterval(timer);
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

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

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

  const hasMoreTopics = topics.length < topicsTotal;

  return (
    <div className="min-h-screen">
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
              void loadTopics(1, false, debouncedKeyword).catch(() => {});
            }}
            aria-label="刷新"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-9"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* 分区切换 pill */}
        <div className="mx-auto flex max-w-6xl gap-1.5 px-4 pb-2.5 sm:px-6">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={section === entry.id}
              onClick={() => setSection(entry.id)}
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
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 md:pb-10">
        {/* ── 审批（治理队列整体嵌入） ── */}
        {section === 'queue' ? (
          <section aria-label="审批">
            <GovernanceConsole embedded />
          </section>
        ) : null}

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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {topics.map((item) => (
                  <TopicPoolCard
                    key={item.id}
                    item={item}
                    activeJobs={activeJobsByArticle.get(item.id) ?? []}
                    onGenerate={setPickerItem}
                  />
                ))}
              </div>
            )}

            {hasMoreTopics && !topicsLoading ? (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  disabled={topicsLoadingMore}
                  onClick={() => {
                    setTopicsLoadingMore(true);
                    void loadTopics(topicsPage + 1, true, debouncedKeyword)
                      .catch(() => {})
                      .finally(() => setTopicsLoadingMore(false));
                  }}
                  className="h-11 rounded-full border border-border px-6 text-xs text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  {topicsLoadingMore ? '加载中…' : `加载更多（${topics.length}/${topicsTotal}）`}
                </button>
              </div>
            ) : null}
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
      </main>

      {/* 平台多选 sheet */}
      <PlatformPickerSheet
        open={pickerItem !== null}
        articleTitle={pickerItem?.title ?? ''}
        submitting={pickerSubmitting}
        onClose={() => setPickerItem(null)}
        onConfirm={handleConfirmPlatforms}
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

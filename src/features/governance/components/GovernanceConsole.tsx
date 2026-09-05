'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import {
  approveGovernanceItem,
  getGovernanceItemDetail,
  getGovernanceQueue,
  getGovernanceStats,
  listCategories,
  redraftGovernanceItem,
  rejectGovernanceItem,
  type CategoryDto,
  type GovernanceItemDetail,
  type GovernanceQueueItem,
  type GovernanceStats,
  type GovernanceStatus,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { cn } from '@/lib/utils';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import GovernanceItemDetailView from './GovernanceItemDetailView';
import GovernanceQueueCard, { type CardExitKind } from './GovernanceQueueCard';
import GovernanceStatsBar from './GovernanceStatsBar';

type QueueTab = 'all' | 'candidate' | 'pending';

const TABS: Array<{ id: QueueTab; name: string }> = [
  { id: 'all', name: '全部' },
  { id: 'candidate', name: '待批候选' },
  { id: 'pending', name: '重拟中' },
];

const TAB_STATUSES: Record<QueueTab, GovernanceStatus[]> = {
  all: ['candidate', 'pending'],
  candidate: ['candidate'],
  pending: ['pending'],
};

const PAGE_SIZE = 20;
const STATS_POLL_MS = 30_000;
const EXIT_ANIMATION_MS = 300;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/** 审批台主控台：统计条 + 待批队列 + 三键操作 + 快捷键。
 *  embedded=true 时嵌进创作台（隐藏自身 header / MobileTabBar / 底部留白）。 */
export default function GovernanceConsole({ embedded = false }: { embedded?: boolean }) {
  const reducedMotion = usePrefersReducedMotion();

  const [stats, setStats] = useState<GovernanceStats | null>(null);
  const [items, setItems] = useState<GovernanceQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<QueueTab>('all');
  const [categoryId, setCategoryId] = useState<string>('');
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [exiting, setExiting] = useState<Record<string, CardExitKind>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, 'approve' | 'reject' | 'redraft'>>({});
  const [reasonOpen, setReasonOpen] = useState<Record<string, 'reject' | 'redraft'>>({});
  // 详情 sheet：detailItem 供操作（队列条目），detail 为懒加载的全文数据
  const [detailItem, setDetailItem] = useState<GovernanceQueueItem | null>(null);
  const [detail, setDetail] = useState<GovernanceItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await getGovernanceStats({ notifyOnError: false }));
    } catch {
      // 统计条失败不打扰主流程，保持旧值。
    }
  }, []);

  const loadQueue = useCallback(
    async (nextPage: number, append: boolean) => {
      const result = await getGovernanceQueue({
        statuses: TAB_STATUSES[tab],
        categoryId: categoryId || undefined,
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      setTotal(result.total);
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setPage(nextPage);
    },
    [tab, categoryId],
  );

  // 首屏 + 筛选切换：重置队列
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedIndex(0);
    void (async () => {
      try {
        await loadQueue(1, false);
      } catch {
        // apiClient 已统一 toast 错误
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadQueue]);

  // 分类筛选选项
  useEffect(() => {
    void listCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  // 统计条：首屏加载 + 30s 轮询（侧边栏徽章共用同一 API）
  useEffect(() => {
    void loadStats();
    const timer = window.setInterval(() => void loadStats(), STATS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadStats]);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((entry) => entry.id !== id));
    setTotal((value) => Math.max(0, value - 1));
    setExiting((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedIndex((index) => Math.max(0, index - 1));
  }, []);

  const setPendingAction = useCallback((id: string, action: 'approve' | 'reject' | 'redraft' | null) => {
    setPendingActions((current) => {
      const next = { ...current };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  }, []);

  const handleApprove = useCallback(
    async (item: GovernanceQueueItem) => {
      if (pendingActions[item.id] || exiting[item.id]) return;
      setPendingAction(item.id, 'approve');
      setExiting((current) => ({ ...current, [item.id]: 'approve' }));
      try {
        await approveGovernanceItem(item.id);
        window.setTimeout(() => removeItem(item.id), reducedMotion ? 0 : EXIT_ANIMATION_MS);
        void loadStats();
      } catch {
        setExiting((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      } finally {
        setPendingAction(item.id, null);
      }
    },
    [pendingActions, exiting, reducedMotion, removeItem, loadStats, setPendingAction],
  );

  const handleSubmitReason = useCallback(
    async (item: GovernanceQueueItem, kind: 'reject' | 'redraft', reason: string) => {
      if (pendingActions[item.id]) return;
      setPendingAction(item.id, kind);
      try {
        if (kind === 'reject') {
          setExiting((current) => ({ ...current, [item.id]: 'reject' }));
          await rejectGovernanceItem(item.id, { reason });
          window.setTimeout(() => removeItem(item.id), reducedMotion ? 0 : EXIT_ANIMATION_MS);
        } else {
          await redraftGovernanceItem(item.id, { reason });
          // 打回重拟：卡片就地进入「重拟中」状态，redraft_count 徽章 +1 动画。
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? { ...entry, governanceStatus: 'pending', redraftCount: entry.redraftCount + 1 }
                : entry,
            ),
          );
          setReasonOpen((current) => {
            const next = { ...current };
            delete next[item.id];
            return next;
          });
        }
        void loadStats();
      } catch {
        setExiting((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      } finally {
        setPendingAction(item.id, null);
      }
    },
    [pendingActions, reducedMotion, removeItem, loadStats, setPendingAction],
  );

  const openDetail = useCallback((item: GovernanceQueueItem) => {
    setDetailItem(item);
    setDetail(null);
    setDetailLoading(true);
    void getGovernanceItemDetail(item.id, { notifyOnError: false })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  const closeDetail = useCallback(() => {
    setDetailItem(null);
    setDetail(null);
  }, []);

  const openReason = useCallback((id: string, kind: 'reject' | 'redraft') => {
    setReasonOpen((current) => {
      const next: Record<string, 'reject' | 'redraft'> = {};
      // 同一时间只允许一张卡片展开理由输入
      if (current[id] !== kind) next[id] = kind;
      return next;
    });
  }, []);

  const closeReason = useCallback((id: string) => {
    setReasonOpen((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  // ── 快捷键：J/K 上下移动，A 准奏，R 驳回 ──
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();

      if (key === 'j' || key === 'arrowdown') {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(items.length - 1, index + 1));
      } else if (key === 'k' || key === 'arrowup') {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(0, index - 1));
      } else if (key === 'a' || key === 'r') {
        const item = items[selectedIndex];
        if (!item) return;
        event.preventDefault();
        if (key === 'a') {
          void handleApprove(item);
        } else {
          openReason(item.id, 'reject');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, selectedIndex, handleApprove, openReason]);

  // 选中卡片滚动进视口
  useEffect(() => {
    const item = items[selectedIndex];
    if (!item || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, items]);

  const hasMore = items.length < total;
  const emptyCopy = useMemo(() => {
    if (tab === 'pending') {
      return { title: '没有在重拟的折子', hint: '被打回的奏折会在这里等待 AI 重新拟写。' };
    }
    if (tab === 'candidate') {
      return { title: '奏折已批完，天下太平', hint: '新的候选会在下次采集后呈上。' };
    }
    return { title: '奏折已批完，天下太平', hint: '队列空空如也。去阅读器看看已归档的内容吧。' };
  }, [tab]);

  return (
    <div className="min-h-screen">
      {/* 顶部指挥条（嵌入创作台时隐藏） */}
      {!embedded ? (
      <header className="glass-surface-strong sticky top-0 z-10 rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-9"
              aria-label="返回阅读器"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">审批台</h1>
              <p className="gov-label">Governance Console</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex">
              <span aria-hidden="true" className="gov-pulse-dot h-1.5 w-1.5 rounded-full bg-primary" />
              LIVE
            </span>
            <button
              type="button"
              onClick={() => {
                void loadQueue(1, false).catch(() => {});
                void loadStats();
              }}
              aria-label="刷新队列"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-9"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>
      ) : null}

      <main className={embedded ? 'space-y-5 pt-1' : 'mx-auto max-w-4xl space-y-6 px-4 pb-24 pt-6 sm:px-6 md:pb-6'}>
        <GovernanceStatsBar stats={stats} />

        {/* 工具行：状态 tab + 分类筛选 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="队列状态" className="glass-surface-light flex items-center gap-1 rounded-full p-1">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  tab === entry.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.name}
              </button>
            ))}
          </div>

          <select
            aria-label="按分类筛选"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="h-9 rounded-full border border-border bg-card px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {/* 队列 */}
        <div ref={listRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          {loading ? (
            Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="gov-card h-32 animate-pulse bg-card/60"
                aria-hidden="true"
              />
            ))
          ) : items.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
              <p className="text-sm font-medium text-foreground">{emptyCopy.title}</p>
              <p className="mt-2 text-xs text-muted-foreground">{emptyCopy.hint}</p>
            </div>
          ) : (
            items.map((item, index) => (
              <GovernanceQueueCard
                key={item.id}
                item={item}
                selected={index === selectedIndex}
                exiting={exiting[item.id] ?? null}
                pendingAction={pendingActions[item.id] ?? null}
                reasonOpen={reasonOpen[item.id] ?? null}
                onSelect={() => setSelectedIndex(index)}
                onOpenDetail={() => openDetail(item)}
                onApprove={() => void handleApprove(item)}
                onOpenReason={(kind) => openReason(item.id, kind)}
                onCancelReason={() => closeReason(item.id)}
                onSubmitReason={(kind, reason) => void handleSubmitReason(item, kind, reason)}
              />
            ))
          )}
        </div>

        {hasMore && !loading ? (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void loadQueue(page + 1, true)
                  .catch(() => {})
                  .finally(() => setLoadingMore(false));
              }}
              className="h-11 rounded-full border border-border px-6 text-xs text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              {loadingMore ? '加载中…' : `加载更多（${items.length}/${total}）`}
            </button>
          </div>
        ) : null}

        {/* 快捷键提示 */}
        <footer className="hidden flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-4 font-mono text-[10px] text-muted-foreground/70 md:flex">
          <span><kbd className="rounded border border-border px-1">J</kbd>/<kbd className="rounded border border-border px-1">K</kbd> 移动</span>
          <span><kbd className="rounded border border-border px-1">A</kbd> 准奏</span>
          <span><kbd className="rounded border border-border px-1">R</kbd> 驳回</span>
          <span><kbd className="rounded border border-border px-1">Enter</kbd> 提交理由</span>
          <span><kbd className="rounded border border-border px-1">Esc</kbd> 取消</span>
        </footer>

        {/* 移动端手势提示（桌面端显示快捷键条，二者互斥） */}
        <footer className="flex items-center justify-center gap-2 pt-4 font-mono text-[10px] text-muted-foreground/70 md:hidden">
          <span>右滑 准奏</span>
          <span aria-hidden="true">·</span>
          <span>左滑 驳回</span>
          <span aria-hidden="true">·</span>
          <span>点按卡片选中</span>
        </footer>
      </main>

      {/* 详情：移动端底部 sheet / 桌面端居中玻璃 modal */}
      <GlassDetailSheet
        open={detailItem !== null}
        onClose={closeDetail}
        ariaLabel={detailItem ? `奏折详情：${detailItem.title}` : '奏折详情'}
      >
        {detailItem ? (
          detailLoading || !detail ? (
            <div className="space-y-3 px-5 pb-10 pt-2 sm:px-7" aria-busy="true">
              <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
              <div className="h-7 w-4/5 animate-pulse rounded-lg bg-muted" />
              <div className="h-40 animate-pulse rounded-2xl bg-muted" />
            </div>
          ) : (
            <GovernanceItemDetailView
              detail={detail}
              pendingAction={pendingActions[detailItem.id] ?? null}
              reasonOpen={reasonOpen[detailItem.id] ?? null}
              onApprove={() => {
                void handleApprove(detailItem);
                closeDetail();
              }}
              onOpenReason={(kind) => openReason(detailItem.id, kind)}
              onCancelReason={() => closeReason(detailItem.id)}
              onSubmitReason={(kind, reason) => {
                void handleSubmitReason(detailItem, kind, reason);
                if (kind === 'reject') closeDetail();
              }}
            />
          )
        ) : null}
      </GlassDetailSheet>

      {!embedded ? <MobileTabBar /> : null}
    </div>
  );
}

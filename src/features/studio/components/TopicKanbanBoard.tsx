'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import Sortable from 'sortablejs';
import type { DraftItem, DraftStatus, GovernanceQueueItem, PipelineJobItem } from '@/lib/api/apiClient';
import { formatPublishedAt } from '@/features/governance/components/GovernanceQueueCard';
import { cn } from '@/lib/utils';
import {
  ORIGINALITY_META,
  formatSimilarity,
  platformBadgeClass,
  platformName,
  similarityToneClass,
} from '../lib/platforms';
import TopicPoolCard from './TopicPoolCard';

interface TopicKanbanBoardProps {
  /** 审批台待审条目（candidate/pending），看板第一列（全量）。 */
  reviewItems: GovernanceQueueItem[];
  reviewTotal: number;
  /** 选题池（archived，首屏 + 滚动分页追加）。 */
  topics: GovernanceQueueItem[];
  /** 选题池是否还有下一页（滚动到底触发 onLoadMorePool）。 */
  poolHasMore?: boolean;
  poolLoadingMore?: boolean;
  onLoadMorePool?: () => void;
  /** 进行中的改写任务（按 articleId 归组）。 */
  activeJobsByArticle: Map<string, PipelineJobItem[]>;
  /** 有失败任务且当前无活跃任务的选题（卡片标红提醒重试）。 */
  failedArticleIds: Set<string>;
  drafts: DraftItem[];
  publishedDraftIds: Set<string>;
  /** 当前选中的分区 id（与顶部 tab 联动：queue/topics/jobs/drafts）。 */
  activeSection?: string;
  /** 点击某列头 → 选中对应 tab（双向联动）。 */
  onStageSelect?: (sectionId: string) => void;
  /** 审批列三动作（与审批台同一套治理 API）。 */
  onReviewApprove: (item: GovernanceQueueItem) => Promise<void> | void;
  onReviewReject: (item: GovernanceQueueItem, reason: string) => Promise<void> | void;
  onReviewRedraft: (item: GovernanceQueueItem, reason: string) => Promise<void> | void;
  onGenerate: (item: GovernanceQueueItem) => void;
  onOpenDetail: (item: GovernanceQueueItem) => void;
  onOpenDraft: (draft: DraftItem) => void;
}

const DRAFT_STATUS_META: Record<DraftStatus, { label: string; badgeClass: string }> = {
  draft: { label: '草稿', badgeClass: 'border-border bg-secondary text-secondary-foreground' },
  accepted: { label: '已采纳', badgeClass: 'border-primary/40 bg-primary/10 text-primary' },
  exported: { label: '已导出', badgeClass: 'border-success/40 bg-success/10 text-success' },
};

const DRAFT_FILTERS: Array<{ id: DraftStatus | 'all'; name: string }> = [
  { id: 'all', name: '全部' },
  { id: 'draft', name: '草稿' },
  { id: 'accepted', name: '已采纳' },
  { id: 'exported', name: '已导出' },
];

interface BoardColumn {
  id: string;
  /** 对应顶部 tab 的分区 id；null = 该列没有对应 tab（如已发布）。 */
  sectionId: string | null;
  name: string;
  hint: string;
  /** 列头色点（从现有色板派生，不发明新色）。 */
  dotClass: string;
}

/** 单列渲染封顶：看板是工作面不是全量浏览，数千条只挂最近一段，条数徽章仍显真实总数。 */
const COLUMN_RENDER_CAP = 120;

/** 池列无任务：常量空数组，保证 TopicPoolCard memo 命中（行内 [] 每次渲染都是新引用）。 */
const EMPTY_ACTIVE_JOBS: import('@/lib/api/apiClient').PipelineJobItem[] = [];

/** 全局状态流转：审批 → 选题池 → 生成中 → 草稿箱 → 已发布。 */
const COLUMNS: BoardColumn[] = [
  { id: 'review', sectionId: 'queue', name: '审批', hint: '审批台准奏后进入选题池', dotClass: 'bg-warning' },
  { id: 'pool', sectionId: 'topics', name: '选题池', hint: '点「生成稿件」开始改写', dotClass: 'bg-muted-foreground/50' },
  { id: 'generating', sectionId: 'jobs', name: '创作中', hint: 'AI 正在改写生成稿件', dotClass: 'bg-primary' },
  { id: 'drafts', sectionId: 'drafts', name: '草稿箱', hint: '成稿待采纳 / 导出 / 发布', dotClass: 'bg-foreground/40' },
  { id: 'published', sectionId: null, name: '已发布', hint: '已发布到平台', dotClass: 'bg-success' },
];

/** 审批卡：与审批台同一套治理动作（准奏/驳回/重拟），驳回/重拟需填理由；不做「生成稿件」。 */
const ReviewCard = memo(function ReviewCard({ item, onApprove, onReject, onRedraft }: {
  item: GovernanceQueueItem;
  onApprove: (item: GovernanceQueueItem) => Promise<void> | void;
  onReject: (item: GovernanceQueueItem, reason: string) => Promise<void> | void;
  onRedraft: (item: GovernanceQueueItem, reason: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [reasonKind, setReasonKind] = useState<'reject' | 'redraft' | null>(null);
  const [reason, setReason] = useState('');

  async function submit(kind: 'reject' | 'redraft') {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      if (kind === 'reject') await onReject(item, trimmed);
      else await onRedraft(item, trimmed);
      setReasonKind(null);
      setReason('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      data-testid="review-board-card"
      data-item-id={item.id}
      className="gov-card flex flex-col p-3.5"
    >
      <div className="flex items-center gap-1.5">
        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10.5px] font-medium text-warning">
          待审批
        </span>
        <span className="ml-auto">
          {item.qualityScore != null ? (
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-secondary-foreground">
              {item.qualityScore} 分
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-2 text-left">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground">{item.title}</h3>
        {item.summary ? (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-secondary-foreground">{item.summary}</p>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="max-w-[9rem] truncate">{item.feedTitle}</span>
        {item.publishedAt ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={item.publishedAt} className="font-mono tabular-nums">{formatPublishedAt(item.publishedAt)}</time>
          </>
        ) : null}
      </div>

      {/* 与审批台同款的治理动作（点按钮不触发卡片拖拽/点击） */}
      <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onApprove(item)}
          title="准奏：归档进入选题池"
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2.5',
            'text-[11px] font-medium text-success transition-all duration-150 hover:bg-success/20 active:scale-[0.97]',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <Check aria-hidden="true" className="h-3 w-3" />
          准奏
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setReasonKind(reasonKind === 'reject' ? null : 'reject')}
          title="驳回：退回不采用"
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border border-error/30 px-2.5',
            'text-[11px] font-medium text-error transition-all duration-150 hover:bg-error/10 active:scale-[0.97]',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <X aria-hidden="true" className="h-3 w-3" />
          驳回
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setReasonKind(reasonKind === 'redraft' ? null : 'redraft')}
          title="重拟：退回重新聚合"
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border border-warning/40 px-2.5',
            'text-[11px] font-medium text-warning transition-all duration-150 hover:bg-warning/10 active:scale-[0.97]',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <RotateCcw aria-hidden="true" className="h-3 w-3" />
          重拟
        </button>
      </div>

      {reasonKind ? (
        <div className="mt-2" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            autoFocus
            placeholder={reasonKind === 'reject' ? '驳回理由（必填）' : '重拟原因 / 改进方向（必填）'}
            className="w-full rounded-lg border border-border bg-card p-2 text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="mt-1 flex justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => { setReasonKind(null); setReason(''); }}
              className="h-7 rounded-full border border-border px-3 text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => void submit(reasonKind)}
              className={cn(
                'h-7 rounded-full border px-3 text-[11px] font-medium transition-all duration-150',
                reasonKind === 'reject'
                  ? 'border-error/40 bg-error/10 text-error hover:bg-error/20'
                  : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              {busy ? '提交中…' : reasonKind === 'reject' ? '确认驳回' : '确认重拟'}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
});
function DraftBoardCard({ draft, published, onOpenDraft }: {
  draft: DraftItem;
  published: boolean;
  onOpenDraft: (draft: DraftItem) => void;
}) {
  const flagMeta = ORIGINALITY_META[draft.originalityFlag];
  const statusMeta = published
    ? { label: '已发布', badgeClass: 'border-success/40 bg-success/10 text-success' }
    : DRAFT_STATUS_META[draft.status];
  return (
    <article
      data-testid="draft-board-card"
      data-item-id={draft.id}
      className="gov-card flex flex-col p-3.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', platformBadgeClass(draft.platform))}>
          {platformName(draft.platform)}
        </span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', statusMeta.badgeClass)}>
          {statusMeta.label}
        </span>
      </div>
      <button type="button" onClick={() => onOpenDraft(draft)} className="mt-2 text-left">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground">{draft.title}</h3>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className={cn('font-mono tabular-nums', similarityToneClass(draft.similarityScore))}>
          相似 {formatSimilarity(draft.similarityScore)}
        </span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', flagMeta.badgeClass)}>{flagMeta.label}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={draft.updatedAt ?? undefined} className="font-mono tabular-nums">
          {formatPublishedAt(draft.updatedAt)}
        </time>
      </div>
    </article>
  );
}

/**
 * 创作看板：审批 → 选题池 → 生成中 → 草稿箱 → 已发布。
 * 布局：固定列宽的横向轨道，窗口放不下左右滑；整板锁定视口高度，每列内部独立滚动。
 * 拖拽：SortableJS（业界标准库）。列由状态推导，跨列拖拽仅在具备数据语义时触发动作
 * （选题池→生成中 = 打开平台选择，等同点「生成稿件」），其余落点弹回原位；列内排序保留。
 */
export default function TopicKanbanBoard({
  reviewItems,
  reviewTotal,
  topics,
  poolHasMore,
  poolLoadingMore,
  onLoadMorePool,
  activeJobsByArticle,
  failedArticleIds,
  drafts,
  publishedDraftIds,
  activeSection,
  onStageSelect,
  onReviewApprove,
  onReviewReject,
  onReviewRedraft,
  onGenerate,
  onOpenDetail,
  onOpenDraft,
}: TopicKanbanBoardProps) {
  // 草稿箱列内筛选（卡片属性，不是列分类）
  const [draftFilter, setDraftFilter] = useState<DraftStatus | 'all'>('all');
  const [, setTick] = useState(0);
  const sortableMap = useRef(new Map<string, Sortable>());
  const topicsRef = useRef(topics);
  const onGenerateRef = useRef(onGenerate);
  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);
  useEffect(() => {
    onGenerateRef.current = onGenerate;
  }, [onGenerate]);

  // SortableJS：列体挂载即创建实例（ref 回调时机最可靠），同一 group 可跨列拖
  const setBodyRef = useCallback((colId: string, el: HTMLDivElement | null) => {
    const prev = sortableMap.current.get(colId);
    if (prev) {
      prev.destroy();
      sortableMap.current.delete(colId);
    }
    if (!el) return;
    const inst = new Sortable(el, {
      group: 'ffw-board',
      animation: 150,
      draggable: '[data-card-id]',
      forceFallback: true,
      fallbackTolerance: 1,
      fallbackClass: 'sortable-fallback',
      chosenClass: 'ffw-drag-chosen',
      onEnd: (evt) => {
        const fromStage = (evt.from as HTMLElement).dataset.stage;
        const toStage = (evt.to as HTMLElement).dataset.stage;
        const cardId = (evt.item as HTMLElement).dataset.cardId;
        if (!fromStage || !toStage) return;
        if (fromStage === toStage) return; // 列内排序：保留视图顺序
        // 语义化跨列动作：选题池 → 生成中 = 打开平台选择（等同点「生成稿件」）
        if (fromStage === 'pool' && toStage === 'generating' && cardId) {
          const topic = topicsRef.current.find((t) => t.id === cardId);
          if (topic) onGenerateRef.current(topic);
        }
        // 列由状态推导，其余跨列移动不具备数据语义 → 弹回原位
        const parent = evt.from;
        const ref = evt.oldIndex != null ? parent.children[evt.oldIndex] ?? null : null;
        parent.insertBefore(evt.item, ref);
        setTick((t) => t + 1);
      },
    });
    sortableMap.current.set(colId, inst);
    el.dataset.sortableReady = '1';
  }, []);

  // ref 回调必须稳定（行内箭头每次渲染都是新函数，会让 React 反复 detach/attach，
  // 轮询重渲染时把进行中的拖拽实例 destroy 掉）
  const bodyRefSetters = useMemo(() => {
    const map: Record<string, (el: HTMLDivElement | null) => void> = {};
    for (const col of COLUMNS) {
      map[col.id] = (el: HTMLDivElement | null) => setBodyRef(col.id, el);
    }
    return map;
  }, [setBodyRef]);

  const draftsByArticle = useMemo(() => {
    const map = new Map<string, DraftItem[]>();
    for (const draft of drafts) {
      const list = map.get(draft.articleId) ?? [];
      list.push(draft);
      map.set(draft.articleId, list);
    }
    return map;
  }, [drafts]);

  // 池列滚动接近底部 → 加载下一页（无限滚动；渲染量由用户滚动决定，不做截断）
  const handlePoolScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return;
      onLoadMorePool?.();
    },
    [onLoadMorePool],
  );

  const poolCards = useMemo(
    () => topics.filter((item) => !activeJobsByArticle.has(item.id) && !draftsByArticle.has(item.id)),
    [topics, activeJobsByArticle, draftsByArticle],
  );
  const generatingCards = useMemo(
    () => topics.filter((item) => activeJobsByArticle.has(item.id)),
    [topics, activeJobsByArticle],
  );

  const openDrafts = useMemo(() => {
    const list = drafts.filter((d) => !publishedDraftIds.has(d.id));
    list.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return draftFilter === 'all' ? list : list.filter((d) => d.status === draftFilter);
  }, [drafts, publishedDraftIds, draftFilter]);
  const publishedCards = useMemo(() => {
    const list = drafts.filter((d) => publishedDraftIds.has(d.id));
    list.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return list;
  }, [drafts, publishedDraftIds]);

  const counts: Record<string, number> = {
    review: reviewTotal,
    pool: poolCards.length,
    generating: generatingCards.length,
    drafts: openDrafts.length,
    published: publishedCards.length,
  };

  return (
    // 经典看板轨道：固定列宽一行排开，窗口放不下左右滑；高度由父级 flex 链给满
    // （StudioConsole main flex-1 → 此处 flex-1），底部与页面/客户端探底，每列内部独立滚动
    <div
      data-testid="topic-kanban-board"
      className="kanban-track flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-1"
    >
      {COLUMNS.map((col) => (
        <section
          key={col.id}
          id={`ffw-kcol-${col.id}`}
          aria-label={col.name}
          className={cn(
            'flex h-full w-[286px] flex-none flex-col rounded-[1.25rem] border bg-card/50',
            activeSection != null && col.sectionId === activeSection
              ? 'border-primary/50 ring-1 ring-primary/30'
              : 'border-border/60',
          )}
        >
          <header
            className={cn(
              'flex flex-none items-center gap-2 px-4 pb-1.5 pt-3.5 text-left',
              col.sectionId ? 'cursor-pointer' : null,
            )}
            onClick={col.sectionId && onStageSelect ? () => onStageSelect(col.sectionId as string) : undefined}
          >
            <span aria-hidden="true" className={cn('h-2 w-2 flex-none rounded-full', col.dotClass)} />
            <h3 className="flex-1 truncate text-xs font-semibold text-foreground">{col.name}</h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-secondary-foreground">
              {counts[col.id]}
            </span>
          </header>
          <p className="flex-none px-4 pb-2 text-[10.5px] text-muted-foreground">{col.hint}</p>

          {col.id === 'drafts' && openDrafts.length > 0 ? (
            <div role="group" aria-label="草稿状态筛选" className="flex flex-none flex-wrap gap-1 px-4 pb-2">
              {DRAFT_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setDraftFilter(f.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[10.5px] transition-colors duration-150',
                    draftFilter === f.id
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.name}
                </button>
              ))}
            </div>
          ) : null}

          <div
            ref={bodyRefSetters[col.id]}
            data-stage={col.id}
            onScroll={col.id === 'pool' ? handlePoolScroll : undefined}
            className="flex min-h-0 flex-1 flex-col space-y-2.5 overflow-y-auto overflow-x-hidden px-2.5 pb-3 pt-0.5"
          >
            {col.id === 'review'
              ? reviewItems.slice(0, COLUMN_RENDER_CAP).map((item) => (
                  <div key={item.id} data-card-id={item.id} data-stage="review" className="cursor-grab active:cursor-grabbing">
                    <ReviewCard
                      item={item}
                      onApprove={onReviewApprove}
                      onReject={onReviewReject}
                      onRedraft={onReviewRedraft}
                    />
                  </div>
                ))
              : null}
            {col.id === 'pool'
              ? poolCards.map((item) => (
                  <div key={item.id} data-card-id={item.id} data-stage="pool" className="cursor-grab active:cursor-grabbing">
                    <TopicPoolCard
                      item={item}
                      activeJobs={EMPTY_ACTIVE_JOBS}
                      onGenerate={onGenerate}
                      onOpenDetail={onOpenDetail}
                      footerNote={failedArticleIds.has(item.id) ? '上次生成失败，可重试' : undefined}
                    />
                  </div>
                ))
              : null}
            {col.id === 'generating'
              ? generatingCards.slice(0, COLUMN_RENDER_CAP).map((item) => (
                  <div key={item.id} data-card-id={item.id} data-stage="generating" className="cursor-grab active:cursor-grabbing">
                    <TopicPoolCard
                      item={item}
                      activeJobs={activeJobsByArticle.get(item.id) ?? []}
                      onGenerate={onGenerate}
                      onOpenDetail={onOpenDetail}
                    />
                  </div>
                ))
              : null}
            {col.id === 'drafts'
              ? openDrafts.slice(0, COLUMN_RENDER_CAP).map((draft) => (
                  <div key={draft.id} data-card-id={draft.id} data-stage="drafts" className="cursor-grab active:cursor-grabbing">
                    <DraftBoardCard draft={draft} published={false} onOpenDraft={onOpenDraft} />
                  </div>
                ))
              : null}
            {col.id === 'published'
              ? publishedCards.slice(0, COLUMN_RENDER_CAP).map((draft) => (
                  <div key={draft.id} data-card-id={draft.id} data-stage="published" className="cursor-grab active:cursor-grabbing">
                    <DraftBoardCard draft={draft} published={true} onOpenDraft={onOpenDraft} />
                  </div>
                ))
              : null}
            {counts[col.id] === 0 ? <p className="py-8 text-center text-[11px] text-muted-foreground">—</p> : null}
            {col.id === 'pool' && poolLoadingMore ? (
              <p className="pt-1 pb-2 text-center text-[10.5px] text-muted-foreground">加载中…</p>
            ) : null}
            {col.id === 'pool' && !poolLoadingMore && poolHasMore ? (
              <p className="pt-1 pb-2 text-center text-[10.5px] text-muted-foreground">下滑加载更多</p>
            ) : null}
            {col.id !== 'pool' && counts[col.id] > COLUMN_RENDER_CAP ? (
              <p className="pt-1 pb-2 text-center text-[10.5px] text-muted-foreground">
                仅显示最近 {COLUMN_RENDER_CAP} 条 / 共 {counts[col.id]} 条
              </p>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

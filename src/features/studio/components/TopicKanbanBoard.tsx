'use client';

import { useMemo, useState } from 'react';
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
  /** 选题池（archived，全量）。 */
  topics: GovernanceQueueItem[];
  topicsTotal: number;
  /** 进行中的改写任务（按 articleId 归组）。 */
  activeJobsByArticle: Map<string, PipelineJobItem[]>;
  /** 有失败任务且当前无活跃任务的选题（卡片标红提醒重试）。 */
  failedArticleIds: Set<string>;
  drafts: DraftItem[];
  publishedDraftIds: Set<string>;
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
  id: 'review' | 'pool' | 'generating' | 'drafts' | 'published';
  name: string;
  hint: string;
  /** 列头色点（从现有色板派生，不发明新色）。 */
  dotClass: string;
}

/** 全局状态流转：审批 → 选题池 → 生成中 → 草稿箱 → 已发布。 */
const COLUMNS: BoardColumn[] = [
  { id: 'review', name: '审批', hint: '审批台准奏后进入选题池', dotClass: 'bg-warning' },
  { id: 'pool', name: '选题池', hint: '点「生成稿件」开始改写', dotClass: 'bg-muted-foreground/50' },
  { id: 'generating', name: '生成中', hint: '流水线改写进行中', dotClass: 'bg-primary' },
  { id: 'drafts', name: '草稿箱', hint: '成稿待采纳 / 导出 / 发布', dotClass: 'bg-foreground/40' },
  { id: 'published', name: '已发布', hint: '已发布到平台', dotClass: 'bg-success' },
];

/** 审批卡：待审条目精简卡，点击看详情；审批动作仍在审批台完成。 */
function ReviewCard({ item, onOpenDetail }: {
  item: GovernanceQueueItem;
  onOpenDetail: (item: GovernanceQueueItem) => void;
}) {
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
      <button type="button" onClick={() => onOpenDetail(item)} className="mt-2 text-left">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground">{item.title}</h3>
        {item.summary ? (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-secondary-foreground">{item.summary}</p>
        ) : null}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="max-w-[9rem] truncate">{item.feedTitle}</span>
        {item.publishedAt ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={item.publishedAt} className="font-mono tabular-nums">{formatPublishedAt(item.publishedAt)}</time>
          </>
        ) : null}
      </div>
    </article>
  );
}

/** 草稿卡：平台徽章 + 状态徽章 + 相似度/原创度，点击进对比视图。 */
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
 * 创作全局看板：审批 → 选题池 → 生成中 → 草稿箱 → 已发布。
 * 一张卡 = 一条内容，按状态进度自动归列；草稿细分状态（草稿/已采纳/已导出）
 * 是卡片徽章 + 列内筛选，不作为列分类。数据全部来自 StudioConsole 已加载
 * 的治理队列/任务/草稿/发布记录，纯前端合成，零额外请求。
 */
export default function TopicKanbanBoard({
  reviewItems,
  reviewTotal,
  reviewLoadingMore,
  hasMoreReview,
  onLoadMoreReview,
  topics,
  topicsTotal,
  topicsLoadingMore,
  hasMoreTopics,
  onLoadMoreTopics,
  activeJobsByArticle,
  failedArticleIds,
  drafts,
  publishedDraftIds,
  onGenerate,
  onOpenDetail,
  onOpenDraft,
}: TopicKanbanBoardProps) {
  // 草稿箱列内筛选（卡片属性，不是列分类）
  const [draftFilter, setDraftFilter] = useState<DraftStatus | 'all'>('all');

  const columns = useMemo(() => {
    const draftsByArticle = new Map<string, DraftItem[]>();
    for (const draft of drafts) {
      const list = draftsByArticle.get(draft.articleId) ?? [];
      list.push(draft);
      draftsByArticle.set(draft.articleId, list);
    }

    const pool: GovernanceQueueItem[] = [];
    const generating: GovernanceQueueItem[] = [];
    for (const item of topics) {
      if (activeJobsByArticle.has(item.id)) generating.push(item);
      else if (!draftsByArticle.has(item.id)) pool.push(item);
      // 已产出草稿的选题进度已推进到草稿/发布列
    }

    const openDrafts: DraftItem[] = [];
    const published: DraftItem[] = [];
    for (const draft of drafts) {
      if (publishedDraftIds.has(draft.id)) published.push(draft);
      else openDrafts.push(draft);
    }
    openDrafts.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    published.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const filteredDrafts = draftFilter === 'all' ? openDrafts : openDrafts.filter((d) => d.status === draftFilter);

    return { filteredDrafts, published };
  }, [topics, activeJobsByArticle, drafts, publishedDraftIds, draftFilter]);

  const poolCards = useMemo(() => {
    const draftsByArticle = new Set(drafts.map((d) => d.articleId));
    return topics.filter((item) => !activeJobsByArticle.has(item.id) && !draftsByArticle.has(item.id));
  }, [topics, activeJobsByArticle, drafts]);
  const generatingCards = useMemo(
    () => topics.filter((item) => activeJobsByArticle.has(item.id)),
    [topics, activeJobsByArticle],
  );

  const counts: Record<BoardColumn['id'], number> = {
    review: reviewTotal,
    pool: poolCards.length,
    generating: generatingCards.length,
    drafts: columns.filteredDrafts.length,
    published: columns.published.length,
  };

  return (
    <div data-testid="topic-kanban-board" className="flex items-start gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => (
        <section
          key={col.id}
          aria-label={col.name}
          className="flex max-h-[calc(100vh-22rem)] w-72 flex-none flex-col rounded-[1.25rem] border border-border/60 bg-card/50"
        >
          <header className="flex items-center gap-2 px-4 pb-1.5 pt-3.5">
            <span aria-hidden="true" className={cn('h-2 w-2 flex-none rounded-full', col.dotClass)} />
            <h3 className="flex-1 truncate text-xs font-semibold text-foreground">{col.name}</h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-secondary-foreground">
              {counts[col.id]}
            </span>
          </header>
          <p className="px-4 pb-2 text-[10.5px] text-muted-foreground">{col.hint}</p>

          {col.id === 'drafts' && columns.filteredDrafts.length > 0 ? (
            <div role="group" aria-label="草稿状态筛选" className="flex flex-wrap gap-1 px-4 pb-2">
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

          <div className="flex flex-1 flex-col space-y-2.5 overflow-y-auto px-2.5 pb-3">
            {col.id === 'review'
              ? reviewItems.map((item) => <ReviewCard key={item.id} item={item} onOpenDetail={onOpenDetail} />)
              : null}
            {col.id === 'pool'
              ? poolCards.map((item) => (
                  <TopicPoolCard
                    key={item.id}
                    item={item}
                    activeJobs={[]}
                    onGenerate={onGenerate}
                    onOpenDetail={onOpenDetail}
                    footerNote={failedArticleIds.has(item.id) ? '上次生成失败，可重试' : undefined}
                  />
                ))
              : null}
            {col.id === 'generating'
              ? generatingCards.map((item) => (
                  <TopicPoolCard
                    key={item.id}
                    item={item}
                    activeJobs={activeJobsByArticle.get(item.id) ?? []}
                    onGenerate={onGenerate}
                    onOpenDetail={onOpenDetail}
                  />
                ))
              : null}
            {col.id === 'drafts'
              ? columns.filteredDrafts.map((draft) => (
                  <DraftBoardCard key={draft.id} draft={draft} published={false} onOpenDraft={onOpenDraft} />
                ))
              : null}
            {col.id === 'published'
              ? columns.published.map((draft) => (
                  <DraftBoardCard key={draft.id} draft={draft} published={true} onOpenDraft={onOpenDraft} />
                ))
              : null}
            {counts[col.id] === 0 ? <p className="py-8 text-center text-[11px] text-muted-foreground">—</p> : null}
          </div>

          {col.id === 'review' && hasMoreReview ? (
            <ColumnLoadMore
              loaded={reviewItems.length}
              total={reviewTotal}
              loading={reviewLoadingMore}
              onClick={onLoadMoreReview}
            />
          ) : null}
          {col.id === 'pool' && hasMoreTopics ? (
            <ColumnLoadMore
              loaded={topics.length}
              total={topicsTotal}
              loading={topicsLoadingMore}
              onClick={onLoadMoreTopics}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}

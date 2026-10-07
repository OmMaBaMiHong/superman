'use client';

import { useMemo } from 'react';
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
  topics: GovernanceQueueItem[];
  /** 该选题正在进行中的改写任务（活跃 job，按 articleId 归组）。 */
  activeJobsByArticle: Map<string, PipelineJobItem[]>;
  drafts: DraftItem[];
  publishedDraftIds: Set<string>;
  onGenerate: (item: GovernanceQueueItem) => void;
  onOpenDetail: (item: GovernanceQueueItem) => void;
  /** 打开草稿对比视图（与草稿箱行为一致）。 */
  onOpenDraft: (draft: DraftItem) => void;
}

const DRAFT_STATUS_META: Record<DraftStatus, { label: string; badgeClass: string }> = {
  draft: { label: '草稿', badgeClass: 'border-border bg-secondary text-secondary-foreground' },
  accepted: { label: '已采纳', badgeClass: 'border-primary/40 bg-primary/10 text-primary' },
  exported: { label: '已导出', badgeClass: 'border-success/40 bg-success/10 text-success' },
};

interface BoardColumn {
  id: string;
  name: string;
  hint: string;
  /** 列头色点（从现有色板派生，不发明新色）。 */
  dotClass: string;
}

const COLUMNS: BoardColumn[] = [
  { id: 'pool', name: '选题池', hint: '待生成稿件', dotClass: 'bg-muted-foreground/50' },
  { id: 'generating', name: '生成中', hint: '流水线改写进行中', dotClass: 'bg-primary' },
  { id: 'drafts', name: '草稿箱', hint: '成稿待采纳 / 导出 / 发布', dotClass: 'bg-warning' },
  { id: 'published', name: '已发布', hint: '已发布到平台', dotClass: 'bg-success' },
];

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
 * 创作看板：选题池 → 生成中 → 草稿箱 → 已发布 四列，卡片按状态进度自动归列。
 * 数据全部来自 StudioConsole 已加载的选题/任务/草稿/发布记录，纯前端合成，零额外请求。
 */
export default function TopicKanbanBoard({
  topics,
  activeJobsByArticle,
  drafts,
  publishedDraftIds,
  onGenerate,
  onOpenDetail,
  onOpenDraft,
}: TopicKanbanBoardProps) {
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
      // 已产出草稿的选题不再留在选题列（进度已推进到草稿/发布）
    }

    const openDrafts: DraftItem[] = [];
    const published: DraftItem[] = [];
    for (const draft of drafts) {
      if (publishedDraftIds.has(draft.id)) published.push(draft);
      else openDrafts.push(draft);
    }
    // 列内按更新时间倒序
    openDrafts.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    published.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

    return { pool, generating, openDrafts, published };
  }, [topics, activeJobsByArticle, drafts, publishedDraftIds]);

  const counts: Record<string, number> = {
    pool: columns.pool.length,
    generating: columns.generating.length,
    drafts: columns.openDrafts.length,
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
          <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3">
            {col.id === 'pool'
              ? columns.pool.map((item) => (
                  <TopicPoolCard
                    key={item.id}
                    item={item}
                    activeJobs={[]}
                    onGenerate={onGenerate}
                    onOpenDetail={onOpenDetail}
                  />
                ))
              : null}
            {col.id === 'generating'
              ? columns.generating.map((item) => (
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
              ? columns.openDrafts.map((draft) => (
                  <DraftBoardCard key={draft.id} draft={draft} published={false} onOpenDraft={onOpenDraft} />
                ))
              : null}
            {col.id === 'published'
              ? columns.published.map((draft) => (
                  <DraftBoardCard key={draft.id} draft={draft} published={true} onOpenDraft={onOpenDraft} />
                ))
              : null}
            {counts[col.id] === 0 ? (
              <p className="py-8 text-center text-[11px] text-muted-foreground">—</p>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

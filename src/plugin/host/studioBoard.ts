/**
 * Superman DSH 插件 · 创作看板读模型组装（/studio/board 的源库重建路径）。
 *
 * 面板要"一次查全量做分类"：审批/选题池/草稿箱/已发布/任务五片，除已发布外
 * 都按后端单页封顶 100 条翻全——首页拿到 total 后其余页**并行**拉（串行翻页
 * 曾是看板首屏卡顿的主因）。结果按片落 SQLite 缓存（boardCache.ts），
 * 面板首屏读缓存直出，refresh 时整片重建——用户的增删改天然反映。
 */
import { listGovernanceQueue } from '@/core/governance/repository'
import { listDrafts, listPipelineJobs } from '@/core/pipelines/repository'
import { listPublishedPostsWithMetrics } from '@/core/publish-tracking/repository'

/** 后端单页封顶（与治理/草稿仓储的 pageSize 上限一致）。 */
const PAGE_SIZE = 100

/** 首页拿 total 后其余页并行拉，拼成全量。 */
async function allPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; total: number }> {
  const first = await fetchPage(1)
  if (first.items.length >= first.total) return { items: first.items, total: first.total }
  const pageCount = Math.ceil(first.total / PAGE_SIZE)
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(index + 2)),
  )
  return { items: rest.reduce<T[]>((acc, part) => acc.concat(part.items), first.items), total: first.total }
}

export interface StudioBoardSlices {
  review: { items: unknown[]; total: number }
  topics: { items: unknown[]; total: number }
  drafts: { items: unknown[] }
  published: { items: Array<{ draftId: string }> }
  jobs: { items: unknown[] }
}

export async function buildStudioBoardSlices(db: unknown, userId: string): Promise<StudioBoardSlices> {
  const [topics, review, drafts, publishedRows, jobs] = await Promise.all([
    allPages((page) =>
      listGovernanceQueue(db as never, { userId, statuses: ['archived'], page, pageSize: PAGE_SIZE })),
    allPages((page) =>
      listGovernanceQueue(db as never, { userId, statuses: ['candidate', 'pending'], page, pageSize: PAGE_SIZE })),
    allPages((page) => listDrafts(db as never, { userId, page, pageSize: PAGE_SIZE })),
    listPublishedPostsWithMetrics(db as never, { userId }),
    listPipelineJobs(db as never, { userId, kind: 'rewrite', pageSize: 50, page: 1 }),
  ])
  return {
    topics: { items: topics.items, total: topics.total },
    review: { items: review.items, total: review.total },
    drafts: { items: drafts.items },
    published: {
      items: publishedRows
        .map((row) => (row as { draftId: string | null }).draftId)
        .filter((draftId): draftId is string => draftId !== null)
        .map((draftId) => ({ draftId })),
    },
    jobs: { items: jobs.items },
  }
}

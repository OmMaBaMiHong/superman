/**
 * Superman DSH 插件 · agent 工具集（K4：AI 指挥台）。
 *
 * 全部工具走 src/core 的事务/服务函数（与 K2 的 /s/api 路由同一套服务层），
 * 不允许绕过 core 直接 SQL 写库。userId 固定取初始管理员 '1'——单用户内核
 * 场景（Superman 是单人工作台；多用户是 K5+ 的事），此决策同步标注在
 * superman 技能正文里。
 *
 * 命名纪律：下划线命名（superman_xxx），不用点号（部分 LLM wire 格式不允许）。
 * 连通性测试工具（原 K1 superman.ping，点号在 LLM wire 非法，已改下划线）。
 *
 * 错误约定：领域失败（参数非法/状态不允许/不存在）返回 { ok: false, error }
 * 规范值；只有基础设施故障（数据库断连等）才抛异常（注册表转为 isError）。
 */
import { AppError } from '@/server/infra/http/errors'
import { isGovernanceStatus, type GovernanceStatus } from '@/core/governance/stateMachine'
import { getGovernanceItemDetail, getGovernanceStats, listGovernanceQueue } from '@/core/governance/repository'
import {
  approveGovernanceItem,
  redraftGovernanceItem,
  rejectGovernanceItem,
} from '@/core/governance/services/governanceActionsService'
import { listTrendRadarItemsByDate } from '@/core/trendradar/repository'
import { promoteTrendRadarItem } from '@/core/trendradar/promote'
import { isRewritePlatform, type RewritePlatform } from '@/core/pipelines/rewriteProfiles'
import { createRewriteJobs } from '@/core/pipelines/services/pipelineService'
import { getDraftDetail, listDrafts } from '@/core/pipelines/repository'
import type { Queryable } from './db.js'
import { PLUGIN_NAME, type MinimalContext } from './routes.js'

/** 单用户内核：agent 工具一律以初始管理员身份操作。 */
const AGENT_USER_ID = '1'

export interface ToolsDeps {
  readonly db: Queryable | null
  /** 手动触发一轮到期订阅源抓取（插件调度器的手动入口；不改变互斥开关）。 */
  fetchTrigger?: (scope?: string) => Promise<{ feeds: number; inserted: number }>
  pluginName?: string
}

interface ToolsScope {
  tools: {
    register(definition: Record<string, unknown>): () => void
  }
  effect(fn: () => () => void, reason?: string): unknown
}

type Json = Record<string, unknown>

/** 截断长文本，防爆 token。 */
function cut(text: string | null | undefined, max: number): string {
  const t = (text ?? '').trim()
  return t.length > max ? `${t.slice(0, max)}…[截断，全文用 superman_item_detail 分段查看]` : t
}

/** 领域错误转规范值；未知错误上抛（基础设施故障）。 */
function fail(err: unknown): Json {
  if (err instanceof AppError) return { ok: false, error: err.message, code: err.code }
  throw err
}

function requireDb(deps: ToolsDeps): Queryable {
  if (!deps.db) throw new Error('superman 插件数据库未连接（检查 DSH 日志里的 Postgres 告警）')
  return deps.db
}

function requireId(value: unknown, label = 'id'): string {
  const id = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+$/.test(id)) throw new Error(`${label} 必须为正整数，收到: ${JSON.stringify(value)}`)
  return id
}

/** 每个工具的注册骨架：name/description/parameters/execute(+render)。 */
interface ToolDef {
  name: string
  description: string
  parameters: Json
  execute: (args: Json) => Promise<Json>
  render?: (args: Json, value: Json) => { type: 'text'; text: string }[]
}

function text(text: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text }]
}

/** 工具表（导出供单测遍历：每个工具都必须有 schema 与 render）。 */
export function buildSupermanTools(deps: ToolsDeps): ToolDef[] {
  return [
    {
      name: 'superman_ping',
      description: 'Superman 插件连通性测试：返回 pong、服务端当前时间与 Postgres 连接状态。',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ pong: true, time: new Date().toISOString(), db: deps.db !== null }),
      render: (_a, v) => text(`superman pong @ ${v.time ?? '?'}（数据库：${v.db ? '已连接' : '未连接'}）`),
    },
    {
      name: 'superman_queue_list',
      description:
        '查看治理队列（待批 candidate / 重拟 pending / 已归档 archived / 已驳回 rejected）。返回条目 id/标题/质量分/摘要/来源，供审批决策。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'candidate/pending/archived/rejected/used，逗号分隔可多选；缺省 candidate' },
          limit: { type: 'number', description: '返回条数上限（1-50，缺省 20）' },
          keyword: { type: 'string', description: '标题关键词过滤（可选）' },
        },
      },
      execute: async (args) => {
        try {
          const db = requireDb(deps)
          const statusRaw = typeof args.status === 'string' ? args.status : ''
          const statuses = statusRaw.split(',').map((s) => s.trim()).filter(Boolean)
          if (statuses.some((s) => !isGovernanceStatus(s))) {
            return { ok: false, error: `status 取值非法: ${statusRaw}（仅支持 candidate/pending/archived/rejected/used）` }
          }
          const limit = typeof args.limit === 'number' && args.limit >= 1 ? Math.min(Math.floor(args.limit), 50) : 20
          const result = await listGovernanceQueue(db as never, {
            userId: AGENT_USER_ID,
            statuses: statuses.length > 0 ? (statuses as GovernanceStatus[]) : undefined,
            keyword: typeof args.keyword === 'string' && args.keyword.trim() ? args.keyword.trim() : undefined,
            page: 1,
            pageSize: limit,
          })
          return {
            ok: true,
            total: result.total,
            items: result.items.map((it) => ({
              id: it.id,
              title: cut(it.title, 80),
              qualityScore: it.qualityScore,
              summary: cut(it.summary, 160),
              source: it.feedTitle ?? null,
              status: it.governanceStatus,
              publishedAt: it.publishedAt,
            })),
          }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => {
        const items = (v.items as { id: string; title: string }[] | undefined) ?? []
        return text(
          v.ok
            ? `治理队列（共 ${String(v.total)} 条）：\n${items.map((i) => `#${i.id} ${i.title}`).join('\n') || '（空）'}`
            : `查询失败：${String(v.error)}`,
        )
      },
    },
    {
      name: 'superman_item_approve',
      description: '批准治理条目（candidate/pending → archived 归档，进入可洗稿选题池）。一次只批一条；没有批量批准工具。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '条目 id（正整数）' } },
        required: ['id'],
      },
      execute: async (args) => {
        try {
          const item = await approveGovernanceItem(requireDb(deps) as never, {
            id: requireId(args.id),
            userId: AGENT_USER_ID,
          })
          return { ok: true, item: { id: item.id, status: item.governanceStatus } }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => text(v.ok ? `已批准 #${String((v.item as Json)?.id)} → archived` : `批准失败：${String(v.error)}`),
    },
    {
      name: 'superman_item_reject',
      description: '驳回治理条目（→ rejected，进 7 天驳回记忆参与去重）。reason 必填，写清楚驳回原因。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '条目 id（正整数）' },
          reason: { type: 'string', description: '驳回原因（必填，最长 1000 字）' },
        },
        required: ['id', 'reason'],
      },
      execute: async (args) => {
        try {
          const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
          if (!reason) return { ok: false, error: 'reason 必填：驳回必须写原因（进驳回记忆，影响后续去重）' }
          const item = await rejectGovernanceItem(requireDb(deps) as never, {
            id: requireId(args.id),
            reason,
            userId: AGENT_USER_ID,
          })
          return { ok: true, item: { id: item.id, status: item.governanceStatus } }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => text(v.ok ? `已驳回 #${String((v.item as Json)?.id)}` : `驳回失败：${String(v.error)}`),
    },
    {
      name: 'superman_item_redraft',
      description: '退回重拟（→ pending，AI 按 reason 重拟标题/摘要后回到待批）。reason 必填，说明要改什么。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '条目 id（正整数）' },
          reason: { type: 'string', description: '重拟要求（必填，最长 1000 字）' },
        },
        required: ['id', 'reason'],
      },
      execute: async (args) => {
        try {
          const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
          if (!reason) return { ok: false, error: 'reason 必填：说明希望重拟成什么样' }
          const result = await redraftGovernanceItem(requireDb(deps) as never, {
            id: requireId(args.id),
            reason,
            userId: AGENT_USER_ID,
          })
          return { ok: true, result }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => text(v.ok ? '已退回重拟（pending）' : `重拟失败：${String(v.error)}`),
    },
    {
      name: 'superman_item_detail',
      description: '查看治理条目全文（标题/摘要/正文截断到约 2000 字/来源链接/治理状态），审批或改写前先看它。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '条目 id（正整数）' } },
        required: ['id'],
      },
      execute: async (args) => {
        try {
          const detail = await getGovernanceItemDetail(requireDb(deps) as never, {
            id: requireId(args.id),
            userId: AGENT_USER_ID,
          })
          if (!detail) return { ok: false, error: '条目不存在或不属于当前用户' }
          return {
            ok: true,
            item: {
              id: detail.id,
              title: detail.title,
              summary: cut(detail.summary, 400),
              content: cut(detail.content, 2000),
              link: detail.sourceUrl ?? null,
              publishedAt: detail.publishedAt ?? null,
            },
          }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => {
        const it = v.item as Json | undefined
        return text(v.ok && it ? `#${String(it.id)} ${String(it.title)}\n\n${String(it.content ?? '')}` : `查询失败：${String(v.error)}`)
      },
    },
    {
      name: 'superman_trending_today',
      description: '看当日热榜（各平台 top N，可按平台过滤）。用于发现选题素材；看中的条目用 superman_trending_promote 转成待批选题。',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: '平台过滤（如 weibo/baidu/douyin，可选）' },
          top: { type: 'number', description: '每平台返回条数（1-20，缺省 5）' },
          date: { type: 'string', description: 'YYYY-MM-DD，缺省今天' },
        },
      },
      execute: async (args) => {
        try {
          const date = typeof args.date === 'string' ? args.date.trim() : ''
          if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'date 需要 YYYY-MM-DD' }
          const top = typeof args.top === 'number' && args.top >= 1 ? Math.min(Math.floor(args.top), 20) : 5
          const items = await listTrendRadarItemsByDate(requireDb(deps) as never, {
            userId: AGENT_USER_ID,
            date: date || undefined,
          })
          const byPlatform = new Map<string, typeof items>()
          for (const item of items) {
            if (typeof args.platform === 'string' && args.platform.trim() && item.platform !== args.platform.trim()) continue
            const list = byPlatform.get(item.platform) ?? []
            if (list.length < top) list.push(item)
            byPlatform.set(item.platform, list)
          }
          return {
            ok: true,
            date: date || items[0]?.sourceDate || new Date().toISOString().slice(0, 10),
            platforms: [...byPlatform.entries()].map(([platform, list]) => ({
              platform,
              platformName: list[0]?.platformName || platform,
              items: list.map((it) => ({ id: it.id, rank: it.rank, title: cut(it.title, 80), url: it.url })),
            })),
          }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => {
        const platforms = (v.platforms as { platformName: string; items: { id: string; title: string }[] }[] | undefined) ?? []
        return text(
          v.ok
            ? platforms.map((p) => `${p.platformName}：\n${p.items.map((i) => `  #${i.id} ${i.title}`).join('\n')}`).join('\n') || '（当日无热榜数据）'
            : `查询失败：${String(v.error)}`,
        )
      },
    },
    {
      name: 'superman_trending_promote',
      description: '把热榜条目转为待批选题（治理 candidate）。幂等：已转过的返回原 articleId，不重复进审批台。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '热榜条目 id（正整数）' } },
        required: ['id'],
      },
      execute: async (args) => {
        try {
          const result = await promoteTrendRadarItem(requireDb(deps) as never, {
            id: requireId(args.id),
            userId: AGENT_USER_ID,
          })
          if (!result.ok) return { ok: false, error: '热榜条目不存在或不属于当前用户' }
          return { ok: true, articleId: result.articleId, alreadyPromoted: result.alreadyPromoted }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) =>
        text(v.ok ? `已转为选题 articleId=${String(v.articleId)}${v.alreadyPromoted ? '（此前已转过，幂等返回）' : ''}` : `失败：${String(v.error)}`),
    },
    {
      name: 'superman_rewrite_start',
      description:
        '对一篇已归档（archived）选题发起洗稿流水线（每平台一个任务）。platforms 仅支持 wechat/xhs/novel。原创度红线：相似度>0.5 会自动降重重写，仍超则落 needs_review 必须人工终审。',
      parameters: {
        type: 'object',
        properties: {
          articleId: { type: 'string', description: '选题文章 id（正整数，必须已归档）' },
          platforms: { type: 'array', items: { type: 'string' }, description: '目标平台数组：wechat/xhs/novel' },
        },
        required: ['articleId', 'platforms'],
      },
      execute: async (args) => {
        try {
          const platforms = Array.isArray(args.platforms) ? args.platforms.map(String) : []
          if (platforms.length === 0) return { ok: false, error: 'platforms 至少一个（wechat/xhs/novel）' }
          if (!platforms.every(isRewritePlatform)) return { ok: false, error: `platforms 仅支持 wechat/xhs/novel，收到: ${platforms.join(',')}` }
          const results = await createRewriteJobs(requireDb(deps) as never, {
            articleId: requireId(args.articleId, 'articleId'),
            platforms: platforms as RewritePlatform[],
            userId: AGENT_USER_ID,
          })
          return {
            ok: true,
            jobs: results.map(({ job, reused }) => ({
              id: job.id, platform: job.platform, status: job.status, reused,
            })),
          }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => {
        const jobs = (v.jobs as { id: string; platform: string; reused: boolean }[] | undefined) ?? []
        return text(
          v.ok
            ? `已发起 ${jobs.length} 个洗稿任务：${jobs.map((j) => `${j.platform}#${j.id}${j.reused ? '(复用进行中任务)' : ''}`).join('、')}`
            : `发起失败：${String(v.error)}`,
        )
      },
    },
    {
      name: 'superman_drafts_list',
      description: '列洗稿草稿（成稿箱），可按平台过滤。返回 id/标题/平台/状态/相似度/原创度标记。',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: '平台过滤（wechat/xhs/novel，可选）' },
          limit: { type: 'number', description: '返回条数上限（1-50，缺省 20）' },
        },
      },
      execute: async (args) => {
        try {
          const limit = typeof args.limit === 'number' && args.limit >= 1 ? Math.min(Math.floor(args.limit), 50) : 20
          const result = await listDrafts(requireDb(deps) as never, {
            userId: AGENT_USER_ID,
            platform: typeof args.platform === 'string' && args.platform.trim() ? args.platform.trim() : undefined,
            page: 1,
            pageSize: limit,
          })
          return {
            ok: true,
            total: result.total,
            items: result.items.map((d) => ({
              id: d.id,
              title: cut(d.title, 80),
              platform: d.platform,
              status: d.status,
              similarityScore: d.similarityScore,
              originalityFlag: d.originalityFlag,
              createdAt: d.createdAt,
            })),
          }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => {
        const items = (v.items as { id: string; title: string; originalityFlag: string }[] | undefined) ?? []
        return text(
          v.ok
            ? `草稿箱（共 ${String(v.total)} 条）：\n${items.map((d) => `#${d.id} [${d.originalityFlag}] ${d.title}`).join('\n') || '（空）'}`
            : `查询失败：${String(v.error)}`,
        )
      },
    },
    {
      name: 'superman_draft_read',
      description: '读一篇草稿全文（截断到约 2000 字）。needs_review 标记的草稿必须提醒用户人工终审，不要直接当成品。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '草稿 id（正整数）' } },
        required: ['id'],
      },
      execute: async (args) => {
        try {
          const draft = await getDraftDetail(requireDb(deps) as never, requireId(args.id), AGENT_USER_ID)
          if (!draft) return { ok: false, error: '草稿不存在' }
          return {
            ok: true,
            draft: {
              id: draft.id,
              title: draft.title,
              platform: draft.platform,
              status: draft.status,
              similarityScore: draft.similarityScore,
              originalityFlag: draft.originalityFlag,
              body: cut(draft.body, 2000),
            },
          }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) => {
        const d = v.draft as Json | undefined
        return text(
          v.ok && d
            ? `#${String(d.id)} ${String(d.title)}（${String(d.platform)} · ${String(d.originalityFlag)} · 相似度 ${String(d.similarityScore ?? '?')}）\n\n${String(d.body ?? '')}`
            : `读取失败：${String(v.error)}`,
        )
      },
    },
    {
      name: 'superman_fetch_trigger',
      description:
        '手动触发一轮到期订阅源抓取（只触发一次，不改变调度器开关；与 Next.js worker 同时抓同一数据库会重复，触发前会检查互斥语义并在结果里提示）。新文章落库前会自动过治理管线（去重/AI 拟折/配额）。',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: '预留：all（缺省，全部到期源）' },
        },
      },
      execute: async (args) => {
        try {
          requireDb(deps)
          if (!deps.fetchTrigger) return { ok: false, error: '抓取入口未就绪（数据库未连接）' }
          const result = await deps.fetchTrigger(typeof args.scope === 'string' ? args.scope : undefined)
          return {
            ok: true,
            feeds: result.feeds,
            inserted: result.inserted,
            mutexNote: '本次为单次触发；常驻调度开关（SUPERMAN_SCHEDULER_ENABLED）未改变，仍与 Next.js worker 互斥。',
          }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) =>
        text(v.ok ? `已触发一轮抓取：${String(v.feeds)} 个到期源，新入库 ${String(v.inserted)} 篇` : `触发失败：${String(v.error)}`),
    },
    {
      name: 'superman_stats',
      description: '今日治理概览：待批/归档数量、采集成功失败计数、队列规模。适合作为「今日概况」类问题的第一步。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        try {
          const stats = await getGovernanceStats(requireDb(deps) as never, AGENT_USER_ID)
          return { ok: true, ...stats }
        } catch (err) {
          return fail(err)
        }
      },
      render: (_a, v) =>
        text(
          v.ok
            ? `今日：待批 ${String(v.todayPending)} · 归档 ${String(v.todayArchived)} · 采集成功 ${String(v.todayFetchSucceeded)} · 失败 ${String(v.todayFetchFailed)} · 队列 ${String(v.queueSize)}`
            : `查询失败：${String(v.error)}`,
        ),
    },
  ]
}

/** 注册全部 superman_* 工具（dispose 随 fiber 自动注销）。 */
export function registerTools(ctx: MinimalContext, deps: ToolsDeps): void {
  const tag = deps.pluginName ?? PLUGIN_NAME
  ctx.inject(['tools'], (scope: ToolsScope) => {
    for (const tool of buildSupermanTools(deps)) {
      scope.effect(
        () =>
          scope.tools.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: {
              schema: { type: 'object' },
              render: (args: Json, value: Json) =>
                tool.render ? tool.render(args, value) : text(JSON.stringify(value)),
            },
            execute: tool.execute,
          }),
        `${tag}: tool ${tool.name}`,
      )
    }
  })
}

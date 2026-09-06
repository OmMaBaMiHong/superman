/**
 * Superman DSH 插件 · 业务 API 路由（K2 批次 2）。
 *
 * 从 src/app/api/ 的 Next.js 路由逐条翻译为裸 node:http handler：
 * 前缀 /s/api，全部过 auth.ts session 校验，userId 从 session 取。
 * 响应信封与 Next.js 版一致：{ ok: true, data } / { ok: false, error: { code, message, fields? } }。
 * 路由匹配用「模式 → 正则」前缀表，不引框架。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/infra/http/errors'
import { isGovernanceStatus, type GovernanceStatus } from '@/core/governance/stateMachine'
import {
  createDirectionStrategy,
  deleteDirectionStrategy,
  listDirectionStrategies,
  updateDirectionStrategy,
  DIRECTION_KEY_PATTERN,
} from '@/core/governance/directions'
import { backfillDirections } from '@/core/governance/backfill'
import {
  deletePublishedPost,
  getPublishedPost,
  listPublishedPostsWithMetrics,
  listSnapshotsSince,
  setPublishedPostTracking,
} from '@/core/publish-tracking/repository'
import {
  evaluateHot,
  refreshPublishedPost,
  registerPublishedPost,
} from '@/core/publish-tracking/service'
import {
  createPlatformAccount,
  deletePlatformAccount,
  getPlatformAccount,
  listPlatformAccounts,
  markAccountVerified,
} from '@/core/platform-accounts/repository'
import {
  publishDraftToWechat,
  verifyWechatAccount,
} from '@/core/platform-accounts/wechat/publishService'
import { WechatMpError } from '@/core/platform-accounts/wechat/mpClient'
import {
  getDouyinLoginSession,
  startDouyinLoginSession,
} from '@/core/platform-accounts/douyin/douyinProvider'
import {
  confirmDouyinLoginSession,
  handleDouyinLoginCallback,
  verifyDouyinAccount,
  type DouyinCallbackPayload,
} from '@/core/platform-accounts/douyin/douyinService'
import { publishDraftToDouyin } from '@/core/platform-accounts/douyin/douyinPublishService'
import { normalizePersistedSettings } from '@/features/settings/settingsSchema'
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo'
import { isAiRuntimeConfigComplete, resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig'
import {
  getGovernanceItemDetail,
  getGovernanceStats,
  listGovernanceQueue,
} from '@/core/governance/repository'
import {
  approveGovernanceItem,
  redraftGovernanceItem,
  rejectGovernanceItem,
  requeueGovernanceItem,
  restoreGovernanceItem,
} from '@/core/governance/services/governanceActionsService'
import { isSafeExternalUrl } from '@/server/integrations/rss/ssrfGuard'
import { isRssHubUrl } from '@/lib/rsshub/url'
import { createFeedWithCategoryResolution } from '@/server/domains/feeds/services/feedCategoryLifecycleService'
import {
  FALLBACK_RECOMMENDED_FEEDS,
  inferFeedPlatform,
} from '@/core/feeds/recommendedFallback'
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/core/notify/repository'
import { notify } from '@/core/notify/service'
import { listTrendRadarItemsByDate, type TrendRadarItemRow } from '@/core/trendradar/repository'
import { promoteTrendRadarItem } from '@/core/trendradar/promote'
import { isRewritePlatform, type RewritePlatform } from '@/core/pipelines/rewriteProfiles'
import { createRewriteJobs, retryPipelineJob } from '@/core/pipelines/services/pipelineService'
import {
  acceptDraft,
  getDraftDetail,
  listDrafts,
  listPipelineJobs,
} from '@/core/pipelines/repository'
import type { Auth, Session } from './auth.js'
import type { Queryable } from './db.js'
import { json, readJsonBody } from './routes.js'

export interface ApiDeps {
  auth: Auth
  db: Queryable | null
}

interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  session: Session
  db: Queryable
}

type RouteHandler = (ctx: RouteContext) => Promise<void>

interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  pattern: string
  re: RegExp
  keys: string[]
  handler: RouteHandler
  /** sauToken：vendor 执行器回调专用，校验 X-Sau-Token 共享密钥而非 session。 */
  authMode?: 'session' | 'sauToken'
}

/** '/governance/items/:id/approve' → 正则 + 参数名表。 */
function compile(pattern: string): { re: RegExp; keys: string[] } {
  const keys: string[] = []
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1))
        return '([^/]+)'
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { re: new RegExp(`^${source}/?$`), keys }
}

function route(method: RouteDef['method'], pattern: string, handler: RouteHandler, authMode?: RouteDef['authMode']): RouteDef {
  return { method, pattern, handler, authMode, ...compile(pattern) }
}

function parsePositiveInt(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireId(raw: string | undefined, label = 'ID'): string {
  if (!raw || !/^\d+$/.test(raw)) {
    throw new ValidationError(`${label}非法`, { id: '必须为正整数' })
  }
  return raw
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const JOB_KINDS = new Set(['rewrite', 'voiceover', 'video'])
const JOB_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed'])

function escapeFrontmatter(value: string): string {
  return value.replace(/"/g, '\\"')
}

/** 路由表：与 src/app/api/ 对应路由的行为保持一致（校验规则/错误语义/返回形状）。 */
const ROUTES: RouteDef[] = [
  // —— 治理 ——
  route('GET', '/governance/queue', async ({ res, query, session, db }) => {
    const statusParam = query.get('status')
    let statuses: GovernanceStatus[] | undefined
    if (statusParam) {
      const parts = statusParam.split(',').map((p) => p.trim()).filter(Boolean)
      if (!parts.every(isGovernanceStatus)) {
        throw new ValidationError('status 取值非法', { status: '仅支持 candidate/pending/archived/rejected/used' })
      }
      statuses = parts
    }
    const categoryId = query.get('categoryId')
    if (categoryId !== null && parsePositiveInt(categoryId) === null) {
      throw new ValidationError('categoryId 取值非法', { categoryId: '必须为正整数' })
    }
    const keyword = query.get('keyword')?.trim() || undefined
    if (keyword && keyword.length > 120) {
      throw new ValidationError('keyword 取值非法', { keyword: '最长 120 字符' })
    }
    const direction = query.get('direction')?.trim() || undefined
    if (direction && direction.length > 32) {
      throw new ValidationError('direction 取值非法', { direction: '最长 32 字符' })
    }
    const result = await listGovernanceQueue(db as never, {
      userId: session.userId,
      statuses,
      categoryId: categoryId ?? undefined,
      direction,
      keyword,
      page: parsePositiveInt(query.get('page')) ?? 1,
      pageSize: parsePositiveInt(query.get('pageSize')) ?? 20,
    })
    json(res, 200, { ok: true, data: result })
  }),

  // —— 方向策略模板（治理 v2 / P2b）——
  route('GET', '/directions', async ({ res, session, db }) => {
    const items = await listDirectionStrategies(db as never, { userId: session.userId, enabledOnly: true })
    json(res, 200, { ok: true, data: { items } })
  }),
  route('GET', '/directions/all', async ({ res, session, db }) => {
    const items = await listDirectionStrategies(db as never, { userId: session.userId })
    json(res, 200, { ok: true, data: { items } })
  }),
  route('POST', '/directions/backfill', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const withAi = body.withAi === true
    let aiConfig = null
    if (withAi) {
      const uiSettings = normalizePersistedSettings(await getUiSettings(db as never, session.userId))
      const aiApiKey = await getAiApiKey(db as never, session.userId)
      const resolved = resolveSharedAiConfig({ settings: { ai: uiSettings.ai }, aiApiKey })
      if (!isAiRuntimeConfigComplete(resolved)) {
        throw new ValidationError('AI 未配置，无法使用 withAi 回填', { withAi: '请先配置 AI 或改用关键词回填' })
      }
      aiConfig = resolved
    }
    const result = await backfillDirections(db as never, {
      userId: session.userId,
      withAi,
      aiConfig,
    })
    json(res, 200, { ok: true, data: result })
  }),
  route('POST', '/directions', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    if (!DIRECTION_KEY_PATTERN.test(key)) {
      throw new ValidationError('请求参数非法', { key: '小写字母开头，仅含小写字母/数字/下划线，最长 32' })
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new ValidationError('请求参数非法', { name: '名称不能为空' })
    const quotaWeight = typeof body.quotaWeight === 'number' ? body.quotaWeight : 0
    if (!Number.isInteger(quotaWeight) || quotaWeight < 0 || quotaWeight > 100) {
      throw new ValidationError('请求参数非法', { quotaWeight: '0-100 的整数' })
    }
    try {
      const item = await createDirectionStrategy(db as never, {
        key,
        name,
        color: typeof body.color === 'string' ? body.color.trim() : undefined,
        icon: typeof body.icon === 'string' ? body.icon.trim() : undefined,
        keywordsDsl: typeof body.keywordsDsl === 'string' ? body.keywordsDsl : undefined,
        aiHint: typeof body.aiHint === 'string' ? body.aiHint : undefined,
        quotaWeight,
        sort: typeof body.sort === 'number' && Number.isInteger(body.sort) ? body.sort : undefined,
        userId: session.userId,
      })
      json(res, 200, { ok: true, data: { item } })
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
        throw new ConflictError('该 key 已存在', { key: '方向标识重复' })
      }
      throw err
    }
  }),
  route('PUT', '/directions/:key', async ({ req, res, params, session, db }) => {
    const key = params.key ?? ''
    if (!DIRECTION_KEY_PATTERN.test(key)) {
      throw new ValidationError('方向标识非法', { key: '小写字母开头，仅含小写字母/数字/下划线' })
    }
    const body = await readJsonBody(req)
    const patch: Parameters<typeof updateDirectionStrategy>[2] = { userId: session.userId }
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (typeof body.color === 'string') patch.color = body.color.trim()
    if (typeof body.icon === 'string') patch.icon = body.icon.trim()
    if (typeof body.keywordsDsl === 'string') patch.keywordsDsl = body.keywordsDsl
    if (typeof body.aiHint === 'string') patch.aiHint = body.aiHint
    if (typeof body.quotaWeight === 'number') {
      if (!Number.isInteger(body.quotaWeight) || body.quotaWeight < 0 || body.quotaWeight > 100) {
        throw new ValidationError('请求参数非法', { quotaWeight: '0-100 的整数' })
      }
      patch.quotaWeight = body.quotaWeight
    }
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.sort === 'number' && Number.isInteger(body.sort)) patch.sort = body.sort
    const item = await updateDirectionStrategy(db as never, key, patch)
    if (!item) throw new NotFoundError('方向模板不存在或没有可更新字段')
    json(res, 200, { ok: true, data: { item } })
  }),
  route('DELETE', '/directions/:key', async ({ res, params, session, db }) => {
    const key = params.key ?? ''
    const result = await deleteDirectionStrategy(db as never, key, session.userId)
    if (result === 'not_found') throw new NotFoundError('方向模板不存在')
    if (result === 'builtin') throw new ConflictError('内置方向模板可改不可删', { key: 'builtin 模板' })
    json(res, 200, { ok: true, data: { deleted: true, key } })
  }),
  route('GET', '/governance/stats', async ({ res, session, db }) => {
    const stats = await getGovernanceStats(db as never, session.userId)
    json(res, 200, { ok: true, data: stats })
  }),
  route('GET', '/governance/items/:id', async ({ res, params, session, db }) => {
    const detail = await getGovernanceItemDetail(db as never, {
      id: requireId(params.id, '条目 ID'),
      userId: session.userId,
    })
    if (!detail) throw new NotFoundError('条目不存在或不属于当前用户')
    json(res, 200, { ok: true, data: detail })
  }),
  route('POST', '/governance/items/:id/approve', async ({ res, params, session, db }) => {
    const item = await approveGovernanceItem(db as never, { id: requireId(params.id, '条目 ID'), userId: session.userId })
    json(res, 200, { ok: true, data: { item } })
  }),
  route('POST', '/governance/items/:id/reject', async ({ req, res, params, session, db }) => {
    const body = await readJsonBody(req)
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length > 1000) {
      throw new ValidationError('驳回理由非法', { reason: 'reason 必须为不超过 1000 字的字符串' })
    }
    const item = await rejectGovernanceItem(db as never, {
      id: requireId(params.id, '条目 ID'),
      reason,
      userId: session.userId,
    })
    json(res, 200, { ok: true, data: { item } })
  }),
  route('POST', '/governance/items/:id/redraft', async ({ req, res, params, session, db }) => {
    const body = await readJsonBody(req)
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length > 1000) {
      throw new ValidationError('重拟理由非法', { reason: 'reason 必须为不超过 1000 字的字符串' })
    }
    const result = await redraftGovernanceItem(db as never, {
      id: requireId(params.id, '条目 ID'),
      reason,
      userId: session.userId,
    })
    // P2a 事件：重拟完成 → 消息中心（静默失败）
    void notify(db as never, {
      userId: session.userId,
      kind: 'redraft_done',
      title: `「${result.item.title}」已重新拟稿`,
      body: reason ? `重拟意见：${reason.slice(0, 200)}` : 'AI 已按默认方向重新拟稿。',
      link: '/studio?tab=queue',
    }).catch(() => {})
    json(res, 200, { ok: true, data: result })
  }),
  route('POST', '/governance/items/:id/restore', async ({ res, params, session, db }) => {
    const item = await restoreGovernanceItem(db as never, { id: requireId(params.id, '条目 ID'), userId: session.userId })
    json(res, 200, { ok: true, data: { item } })
  }),

  // —— 热点 ——
  route('GET', '/trend-radar/today', async ({ res, query, session, db }) => {
    const dateParam = query.get('date')?.trim()
    if (dateParam && !DATE_PATTERN.test(dateParam)) {
      throw new ValidationError('date 取值非法', { date: '需要 YYYY-MM-DD' })
    }
    const items = await listTrendRadarItemsByDate(db as never, {
      userId: session.userId,
      date: dateParam || undefined,
    })
    const groups: { platform: string; platformName: string; items: TrendRadarItemRow[] }[] = []
    const byPlatform = new Map<string, (typeof groups)[number]>()
    for (const item of items) {
      let group = byPlatform.get(item.platform)
      if (!group) {
        group = { platform: item.platform, platformName: item.platformName || item.platform, items: [] }
        byPlatform.set(item.platform, group)
        groups.push(group)
      }
      group.items.push(item)
    }
    json(res, 200, {
      ok: true,
      data: {
        date: dateParam || items[0]?.sourceDate || new Date().toISOString().slice(0, 10),
        total: items.length,
        platforms: groups,
      },
    })
  }),
  route('POST', '/trend-radar/items/:id/promote', async ({ res, params, session, db }) => {
    const id = requireId(params.id, 'id')
    const result = await promoteTrendRadarItem(db as never, { id, userId: session.userId })
    if (!result.ok) throw new NotFoundError('热榜条目不存在或不属于当前用户')
    json(res, 200, {
      ok: true,
      data: { itemId: id, articleId: result.articleId, alreadyPromoted: result.alreadyPromoted },
    })
  }),

  // —— 洗稿流水线 ——
  route('POST', '/pipelines/rewrite', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const articleId = typeof body.articleId === 'string' || typeof body.articleId === 'number'
      ? String(body.articleId)
      : ''
    if (!/^\d+$/.test(articleId)) {
      throw new ValidationError('请求参数非法', { articleId: '必须为正整数' })
    }
    const platforms = Array.isArray(body.platforms) ? body.platforms.map(String) : []
    if (platforms.length === 0) {
      throw new ValidationError('请求参数非法', { platforms: 'platforms 至少一个' })
    }
    if (!platforms.every(isRewritePlatform)) {
      throw new ValidationError('请求参数非法', { platforms: 'platforms 仅支持 wechat/xhs/novel' })
    }
    const results = await createRewriteJobs(db as never, {
      articleId,
      platforms: platforms as RewritePlatform[],
      userId: session.userId,
    })
    json(res, 200, {
      ok: true,
      data: {
        jobs: results.map(({ job, reused, enqueued, queueJobId }) => ({
          id: job.id,
          articleId: job.articleId,
          kind: job.kind,
          platform: job.platform,
          status: job.status,
          reused,
          enqueued,
          queueJobId,
          createdAt: job.createdAt,
        })),
      },
    })
  }),
  route('GET', '/pipelines/jobs', async ({ res, query, session, db }) => {
    const kind = query.get('kind')
    if (kind !== null && !JOB_KINDS.has(kind)) {
      throw new ValidationError('kind 取值非法', { kind: '仅支持 rewrite/voiceover/video' })
    }
    const status = query.get('status')
    if (status !== null && !JOB_STATUSES.has(status)) {
      throw new ValidationError('status 取值非法', { status: '仅支持 queued/running/succeeded/failed' })
    }
    const result = await listPipelineJobs(db as never, {
      userId: session.userId,
      kind: (kind as 'rewrite' | 'voiceover' | 'video' | null) ?? undefined,
      status: (status as 'queued' | 'running' | 'succeeded' | 'failed' | null) ?? undefined,
      page: parsePositiveInt(query.get('page')) ?? 1,
      pageSize: parsePositiveInt(query.get('pageSize')) ?? 20,
    })
    json(res, 200, { ok: true, data: result })
  }),
  route('POST', '/pipelines/jobs/:id/retry', async ({ res, params, session, db }) => {
    const result = await retryPipelineJob(db as never, { id: requireId(params.id, '任务 ID'), userId: session.userId })
    json(res, 200, { ok: true, data: { job: result.job, queueJobId: result.queueJobId } })
  }),

  // —— 草稿 ——
  route('GET', '/drafts', async ({ res, query, session, db }) => {
    const articleId = query.get('articleId')
    if (articleId !== null && parsePositiveInt(articleId) === null) {
      throw new ValidationError('articleId 取值非法', { articleId: '必须为正整数' })
    }
    const result = await listDrafts(db as never, {
      userId: session.userId,
      articleId: articleId ?? undefined,
      platform: query.get('platform')?.trim() || undefined,
      page: parsePositiveInt(query.get('page')) ?? 1,
      pageSize: parsePositiveInt(query.get('pageSize')) ?? 20,
    })
    json(res, 200, { ok: true, data: result })
  }),
  route('GET', '/drafts/:id', async ({ res, params, session, db }) => {
    const draft = await getDraftDetail(db as never, requireId(params.id, '草稿 ID'), session.userId)
    if (!draft) throw new NotFoundError('草稿不存在')
    json(res, 200, { ok: true, data: { draft } })
  }),
  route('POST', '/drafts/:id/accept', async ({ res, params, session, db }) => {
    const id = requireId(params.id, '草稿 ID')
    const draft = await acceptDraft(db as never, id, session.userId)
    if (!draft) {
      // 区分「不存在」与「状态不允许」，先读一次详情（同 Next.js 版语义）。
      const existing = await getDraftDetail(db as never, id, session.userId)
      if (!existing) throw new NotFoundError('草稿不存在')
      throw new ConflictError(`当前状态（${existing.status}）不允许确认`)
    }
    json(res, 200, { ok: true, data: { draft } })
  }),
  route('GET', '/drafts/:id/export', async ({ res, params, session, db }) => {
    const draft = await getDraftDetail(db as never, requireId(params.id, '草稿 ID'), session.userId)
    if (!draft) throw new NotFoundError('草稿不存在')
    const frontmatter = [
      '---',
      `title: "${escapeFrontmatter(draft.title)}"`,
      `platform: "${escapeFrontmatter(draft.platform)}"`,
      `original_title: "${escapeFrontmatter(draft.articleTitle)}"`,
      draft.articleLink ? `original_url: "${escapeFrontmatter(draft.articleLink)}"` : null,
      draft.similarityScore !== null ? `similarity_score: ${draft.similarityScore}` : null,
      `originality_flag: "${draft.originalityFlag}"`,
      `exported_at: "${new Date().toISOString()}"`,
      '---',
    ]
      .filter((line): line is string => line !== null)
      .join('\n')
    const markdown = `${frontmatter}\n\n# ${draft.title}\n\n${draft.body}\n`
    const data = Buffer.from(markdown, 'utf8')
    res.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="draft-${draft.id}.md"`,
      'content-length': String(data.length),
    })
    res.end(data)
  }),

  // —— 治理补充：送回审批台（P1-A，archived → candidate）——
  route('POST', '/governance/items/:id/requeue', async ({ res, params, session, db }) => {
    const item = await requeueGovernanceItem(db as never, {
      id: requireId(params.id, '条目 ID'),
      userId: session.userId,
    })
    json(res, 200, { ok: true, data: { item } })
  }),

  // —— 发布后表现追踪（P2d）——
  route('POST', '/published-posts', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const postUrl = typeof body.postUrl === 'string' ? body.postUrl : ''
    const post = await registerPublishedPost(db as never, {
      postUrl,
      title: typeof body.title === 'string' ? body.title : undefined,
      platform: typeof body.platform === 'string' ? body.platform : undefined,
      accountName: typeof body.accountName === 'string' ? body.accountName : undefined,
      draftId: typeof body.draftId === 'string' || typeof body.draftId === 'number' ? String(body.draftId) : null,
      articleId: typeof body.articleId === 'string' || typeof body.articleId === 'number' ? String(body.articleId) : null,
      publishedAt: typeof body.publishedAt === 'string' ? body.publishedAt : null,
      userId: session.userId,
    })
    json(res, 200, { ok: true, data: { post } })
  }),
  route('GET', '/published-posts', async ({ res, session, db }) => {
    const rows = await listPublishedPostsWithMetrics(db as never, { userId: session.userId })
    const items = rows.map(({ latestSnapshot, baselineSnapshot, ...post }) => {
      const delta = latestSnapshot && baselineSnapshot
        ? {
            views: latestSnapshot.views !== null && baselineSnapshot.views !== null
              ? latestSnapshot.views - baselineSnapshot.views
              : null,
            likes: latestSnapshot.likes !== null && baselineSnapshot.likes !== null
              ? latestSnapshot.likes - baselineSnapshot.likes
              : null,
            comments: latestSnapshot.comments !== null && baselineSnapshot.comments !== null
              ? latestSnapshot.comments - baselineSnapshot.comments
              : null,
          }
        : null
      const hot = latestSnapshot && baselineSnapshot
        ? evaluateHot(baselineSnapshot, latestSnapshot)
        : { hot: false, reasons: [] as string[] }
      return { ...post, latestSnapshot, delta24h: delta, hot: hot.hot, hotReasons: hot.reasons }
    })
    json(res, 200, { ok: true, data: { items } })
  }),
  route('GET', '/published-posts/:id', async ({ res, params, session, db }) => {
    const id = requireId(params.id, '帖子 ID')
    const post = await getPublishedPost(db as never, id, session.userId)
    if (!post) throw new NotFoundError('帖子不存在')
    const snapshots = await listSnapshotsSince(db as never, { postId: id, days: 7 })
    json(res, 200, { ok: true, data: { post, snapshots } })
  }),
  route('POST', '/published-posts/:id/refresh', async ({ res, params, session, db }) => {
    const result = await refreshPublishedPost(db as never, {
      postId: requireId(params.id, '帖子 ID'),
      userId: session.userId,
    })
    if (!result.ok && result.error === '帖子不存在或不属于当前用户') {
      throw new NotFoundError('帖子不存在')
    }
    json(res, 200, { ok: true, data: result })
  }),
  route('POST', '/published-posts/:id/tracking', async ({ req, res, params, session, db }) => {
    const body = await readJsonBody(req)
    if (typeof body.trackingEnabled !== 'boolean') {
      throw new ValidationError('请求参数非法', { trackingEnabled: '必须为布尔值' })
    }
    const post = await setPublishedPostTracking(db as never, {
      id: requireId(params.id, '帖子 ID'),
      trackingEnabled: body.trackingEnabled,
      userId: session.userId,
    })
    if (!post) throw new NotFoundError('帖子不存在')
    json(res, 200, { ok: true, data: { post } })
  }),
  route('DELETE', '/published-posts/:id', async ({ res, params, session, db }) => {
    const deleted = await deletePublishedPost(db as never, requireId(params.id, '帖子 ID'), session.userId)
    if (!deleted) throw new NotFoundError('帖子不存在')
    json(res, 200, { ok: true, data: { deleted: true } })
  }),

  // —— 平台授权中心（P2e-1）——
  route('GET', '/platform-accounts', async ({ res, query, session, db }) => {
    const platform = query.get('platform')?.trim() || undefined
    const items = await listPlatformAccounts(db as never, {
      userId: session.userId,
      platform: platform as 'wechat' | 'douyin' | 'xhs' | 'bilibili' | 'channels' | undefined,
    })
    json(res, 200, { ok: true, data: { items } })
  }),
  route('POST', '/platform-accounts', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const platform = typeof body.platform === 'string' ? body.platform.trim() : ''
    if (!['wechat', 'douyin', 'xhs', 'bilibili', 'channels'].includes(platform)) {
      throw new ValidationError('请求参数非法', { platform: '仅支持 wechat/douyin/xhs/bilibili/channels' })
    }
    const credKind = typeof body.credKind === 'string' ? body.credKind.trim() : ''
    if (!['app_secret', 'cookie', 'oauth'].includes(credKind)) {
      throw new ValidationError('请求参数非法', { credKind: '仅支持 app_secret/cookie/oauth' })
    }
    const credential = typeof body.credential === 'object' && body.credential !== null
      ? body.credential as Record<string, unknown>
      : null
    if (!credential || Object.keys(credential).length === 0) {
      throw new ValidationError('请求参数非法', { credential: '凭据不能为空' })
    }
    if (credKind === 'app_secret') {
      const appid = typeof credential.appid === 'string' ? credential.appid.trim() : ''
      const secret = typeof credential.secret === 'string' ? credential.secret.trim() : ''
      if (!appid || !secret) {
        throw new ValidationError('请求参数非法', { credential: 'app_secret 需要 appid 与 secret 字段' })
      }
    }
    try {
      const account = await createPlatformAccount(db as never, {
        platform: platform as 'wechat',
        accountName: typeof body.accountName === 'string' ? body.accountName.trim() : '',
        credKind: credKind as 'app_secret',
        // 明文只在加密封装内存在，落库即密文。
        credentialPlaintext: JSON.stringify(credential),
        metaJson: typeof body.metaJson === 'object' && body.metaJson !== null
          ? body.metaJson as Record<string, unknown>
          : null,
        userId: session.userId,
      })
      json(res, 200, { ok: true, data: { account } })
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
        throw new ConflictError('该平台账号已存在', { accountName: '同平台同名账号重复' })
      }
      throw err
    }
  }),
  route('DELETE', '/platform-accounts/:id', async ({ res, params, session, db }) => {
    const deleted = await deletePlatformAccount(db as never, requireId(params.id, '账号 ID'), session.userId)
    if (!deleted) throw new NotFoundError('平台账号不存在')
    json(res, 200, { ok: true, data: { deleted: true } })
  }),
  route('POST', '/platform-accounts/:id/verify', async ({ res, params, session, db }) => {
    const account = await getPlatformAccount(db as never, requireId(params.id, '账号 ID'), session.userId)
    if (!account) throw new NotFoundError('平台账号不存在')

    // 抖音 cookie 账号：执行器对账验证（P2e-2）
    if (account.platform === 'douyin' && account.credKind === 'cookie') {
      const result = await verifyDouyinAccount(account)
      await markAccountVerified(db as never, {
        id: account.id,
        ok: result.verified,
        failStatus: 'expired',
        userId: session.userId,
      })
      json(res, 200, { ok: true, data: result })
      return
    }

    if (account.platform !== 'wechat' || account.credKind !== 'app_secret') {
      json(res, 200, { ok: true, data: { verified: false, reason: '该平台验证待 P2e-3 接入' } })
      return
    }
    try {
      await verifyWechatAccount(db as never, account)
      await markAccountVerified(db as never, { id: account.id, ok: true, userId: session.userId })
      json(res, 200, { ok: true, data: { verified: true } })
    } catch (err) {
      const reason = err instanceof WechatMpError ? err.message : '验证失败'
      await markAccountVerified(db as never, {
        id: account.id,
        ok: false,
        failStatus: 'error',
        userId: session.userId,
      })
      json(res, 200, { ok: true, data: { verified: false, reason } })
    }
  }),

  // —— 抖音扫码授权流（P2e-2）——
  route('POST', '/platform-accounts/douyin/login-session', async ({ req, res, session }) => {
    const body = await readJsonBody(req)
    const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : ''
    if (!accountName) {
      throw new ValidationError('请求参数非法', { accountName: '账号备注名不能为空' })
    }
    const loginSession = startDouyinLoginSession({
      userId: session.userId,
      accountName,
    })
    json(res, 200, { ok: true, data: { sessionId: loginSession.id } })
  }),
  route('GET', '/platform-accounts/douyin/login-session/:id/qr', async ({ res, params, session }) => {
    const loginSession = getDouyinLoginSession(params.id ?? '')
    if (!loginSession || loginSession.userId !== session.userId) {
      throw new NotFoundError('扫码会话不存在')
    }
    json(res, 200, {
      ok: true,
      data: {
        status: loginSession.status,
        qrSrc: loginSession.qrSrc,
      },
    })
  }),
  route('POST', '/platform-accounts/douyin/login-session/:id/confirm', async ({ res, params, session, db }) => {
    const account = await confirmDouyinLoginSession(db as never, {
      sessionId: params.id ?? '',
      userId: session.userId,
    })
    json(res, 200, { ok: true, data: { account } })
  }),
  // vendor 执行器回调（共享密钥鉴权，不走 session）
  route('POST', '/platform-accounts/douyin/callback', async ({ req, res, db }) => {
    const body = await readJsonBody(req)
    const payload: DouyinCallbackPayload = {
      type: Number(body.type),
      userName: typeof body.userName === 'string' ? body.userName : '',
      filePath: typeof body.filePath === 'string' ? body.filePath : '',
      storageState:
        typeof body.storageState === 'object' && body.storageState !== null
          ? (body.storageState as Record<string, unknown>)
          : {},
    }
    if (payload.type !== 3 || !payload.userName || !payload.filePath) {
      throw new ValidationError('回调报文非法', { payload: 'type/userName/filePath 缺失' })
    }
    const result = await handleDouyinLoginCallback(db as never, payload)
    json(res, 200, { ok: true, data: result })
  }, 'sauToken'),

  route('POST', '/drafts/:id/publish', async ({ req, res, params, session, db }) => {
    const body = await readJsonBody(req)
    const platform = typeof body.platform === 'string' ? body.platform.trim() : ''
    const accountId = typeof body.accountId === 'string' || typeof body.accountId === 'number'
      ? String(body.accountId)
      : ''
    if (!/^\d+$/.test(accountId)) {
      throw new ValidationError('请求参数非法', { accountId: '必须为正整数' })
    }

    if (platform === 'douyin') {
      const result = await publishDraftToDouyin(db as never, {
        draftId: requireId(params.id, '草稿 ID'),
        accountId,
        videoPath: typeof body.videoPath === 'string' ? body.videoPath : undefined,
        videoUrl: typeof body.videoUrl === 'string' ? body.videoUrl : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
        userId: session.userId,
      })
      json(res, 200, { ok: true, data: result })
      return
    }

    if (platform !== 'wechat') {
      throw new ValidationError('请求参数非法', { platform: '当前仅支持 wechat（公众号草稿箱）/ douyin（抖音视频）' })
    }
    const result = await publishDraftToWechat(db as never, {
      draftId: requireId(params.id, '草稿 ID'),
      accountId,
      userId: session.userId,
    })
    json(res, 200, { ok: true, data: result })
  }),

  // —— 订阅源（P1-A）——
  route('GET', '/feeds', async ({ res, session, db }) => {
    const { rows } = await db.query(
      `
        select
          f.id::text as "id",
          f.title,
          f.url,
          f.site_url as "siteUrl",
          f.kind,
          f.view,
          f.enabled,
          f.category_id as "categoryId",
          c.name as "categoryTitle",
          f.last_fetch_status as "lastFetchStatus",
          f.last_fetch_error as "lastFetchError",
          f.last_fetched_at as "lastFetchedAt",
          (select count(*)::int from articles a where a.feed_id = f.id and a.user_id = f.user_id) as "articleCount"
        from feeds f
        left join categories c on c.id = f.category_id and c.user_id = f.user_id
        where f.user_id = $1
        order by f.created_at desc, f.id desc
      `,
      [session.userId],
    )
    json(res, 200, { ok: true, data: { items: rows } })
  }),

  route('POST', '/feeds', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : undefined
    const categoryName = typeof body.categoryName === 'string' && body.categoryName.trim() ? body.categoryName.trim() : undefined
    const siteUrl = typeof body.siteUrl === 'string' && body.siteUrl.trim() ? body.siteUrl.trim() : undefined

    if (!title) throw new ValidationError('请求参数非法', { title: '标题不能为空' })
    if (!url) throw new ValidationError('请求参数非法', { url: '链接不能为空' })
    if (categoryId && parsePositiveInt(categoryId) === null) {
      throw new ValidationError('请求参数非法', { categoryId: '必须为正整数' })
    }

    // rsshub:// 协议走本地 RSSHub，跳过 SSRF 外呼校验；http(s) 必须过安全校验
    if (isRssHubUrl(url)) {
      // 合法 rsshub 路由直接放行
    } else {
      if (!/^https?:\/\//i.test(url)) {
        throw new ValidationError('请求参数非法', { url: '链接必须以 http(s):// 或 rsshub:// 开头' })
      }
      const safe = await isSafeExternalUrl(url, { allowUnresolvedHostname: true })
      if (!safe) {
        throw new ValidationError('请求参数非法', { url: '链接不安全或无法解析' })
      }
    }

    try {
      const feed = await createFeedWithCategoryResolution(db as never, {
        title,
        url,
        siteUrl: siteUrl ?? null,
        categoryId: categoryId ?? null,
        categoryName: categoryName ?? null,
        userId: session.userId,
      })
      json(res, 200, { ok: true, data: feed })
    } catch (err) {
      // 唯一约束：同用户同 URL 重复订阅
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
        throw new ConflictError('该链接已订阅', { url: '重复订阅' })
      }
      throw err
    }
  }),

  route('GET', '/feeds/recommended', async ({ res, db }) => {
    const { rows: rawBuiltinRows } = await db.query(
      `
        select id::text, title, url, site_url as "siteUrl", icon_url as "iconUrl", description
        from recommended_feeds
        order by position asc, id asc
      `,
      [],
    )

    const builtinRows = rawBuiltinRows as Array<{
      id: string; title: string; url: string; siteUrl: string | null; iconUrl: string | null; description: string | null
    }>
    const builtinUrls = new Set(builtinRows.map((r) => r.url))
    const { rows: rawAggregatedRows } = await db.query(
      `
        select url, title, site_url as "siteUrl", icon_url as "iconUrl",
               count(distinct user_id)::int as "subscriberCount"
        from feeds
        where provider = 'local_rss' and kind = 'rss'
        group by url, title, site_url, icon_url
        order by "subscriberCount" desc, url asc
      `,
      [],
    )

    const aggregatedRows = rawAggregatedRows as Array<{
      url: string; title: string; siteUrl: string | null; iconUrl: string | null; subscriberCount: number
    }>
    const items = [
      ...builtinRows.map((row) => ({
        id: `builtin-${row.id}`,
        title: row.title,
        url: row.url,
        siteUrl: row.siteUrl ?? null,
        iconUrl: row.iconUrl ?? null,
        description: row.description ?? null,
        subscriberCount: 0,
        source: 'builtin',
        platform: inferFeedPlatform(row.url),
      })),
      ...aggregatedRows
        .filter((row) => !builtinUrls.has(row.url))
        .map((row) => ({
          id: `agg-${row.url}`,
          title: row.title,
          url: row.url,
          siteUrl: row.siteUrl ?? null,
          iconUrl: row.iconUrl ?? null,
          description: null,
          subscriberCount: row.subscriberCount,
          source: 'aggregated',
          platform: inferFeedPlatform(row.url),
        })),
    ]

    // 表空时的内置精选兜底（科技/AI/B站头部）
    if (items.length === 0) {
      items.push(
        ...FALLBACK_RECOMMENDED_FEEDS.map((entry, index) => ({
          id: `fallback-${index}`,
          title: entry.title,
          url: entry.url,
          siteUrl: entry.siteUrl ?? null,
          iconUrl: null,
          description: entry.description ?? null,
          subscriberCount: 0,
          source: 'builtin',
          platform: entry.platform,
        })),
      )
    }

    json(res, 200, { ok: true, data: items })
  }),

  // —— 消息中心（P2a）——
  route('GET', '/notifications', async ({ res, query, session, db }) => {
    const unreadOnly = query.get('unreadOnly') === 'true'
    const result = await listNotifications(db as never, {
      userId: session.userId,
      unreadOnly,
      page: parsePositiveInt(query.get('page')) ?? 1,
      pageSize: parsePositiveInt(query.get('pageSize')) ?? 30,
    })
    json(res, 200, { ok: true, data: result })
  }),
  // 注意：须在 /notifications/:id/read 之前注册（'unread-count' 会命中 :id）
  route('GET', '/notifications/unread-count', async ({ res, session, db }) => {
    const count = await countUnreadNotifications(db as never, session.userId)
    json(res, 200, { ok: true, data: { count } })
  }),
  route('POST', '/notifications/:id/read', async ({ res, params, session, db }) => {
    const item = await markNotificationRead(db as never, {
      id: requireId(params.id, '通知 ID'),
      userId: session.userId,
    })
    if (!item) throw new NotFoundError('通知不存在')
    json(res, 200, { ok: true, data: { item } })
  }),
  route('POST', '/notifications/read-all', async ({ res, session, db }) => {
    const result = await markAllNotificationsRead(db as never, session.userId)
    json(res, 200, { ok: true, data: result })
  }),
]

/** 错误 → 响应（镜像 Next.js 版 fail() 的信封与状态码）。 */
export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    const error: { code: string; message: string; fields?: Record<string, string> } = {
      code: err.code,
      message: err.message,
    }
    if (err.fields) error.fields = err.fields
    json(res, err.status, { ok: false, error })
    return
  }
  json(res, 500, { ok: false, error: { code: 'internal_error', message: '服务暂时不可用，请稍后重试' } })
}

/**
 * /s/api 业务路由总入口。返回 true 表示已处理；未命中返回 false（交给调用方 404）。
 * 所有业务路由要求 session + 数据库；鉴权失败 401、库未连接 503。
 */
export async function handleBusinessApi(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const sub = url.pathname.replace(/^\/s\/api/, '') || '/'
  const method = ['GET', 'POST', 'PUT', 'DELETE'].includes(req.method ?? '')
    ? (req.method as RouteDef['method'])
    : null

  for (const def of ROUTES) {
    if (method !== def.method) continue
    const m = def.re.exec(sub)
    if (!m) continue

    try {
      let session: Session
      if (def.authMode === 'sauToken') {
        // vendor 执行器回调：共享密钥鉴权（SAU_TOKEN 未配置时一律拒绝，避免裸奔）。
        const expected = (process.env.SAU_TOKEN ?? '').trim()
        const provided = String(req.headers['x-sau-token'] ?? '')
        if (!expected || provided !== expected) {
          throw new UnauthorizedError('回调鉴权失败')
        }
        // 回调的用户绑定由扫码会话表完成，此处只占位。
        session = { userId: '0', role: 'member', sessionVersion: 0, username: 'sau-callback' }
      } else {
        const authenticated = await deps.auth.authenticate(req)
        if (!authenticated) throw new UnauthorizedError('请先登录后再继续')
        session = authenticated
      }
      if (!deps.db) {
        json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
        return true
      }
      const params: Record<string, string> = {}
      def.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1] ?? '')
      })
      await def.handler({ req, res, params, query: url.searchParams, session, db: deps.db })
    } catch (err) {
      sendError(res, err)
    }
    return true
  }
  return false
}

/** 自检用：已翻译的 API 清单（/s/api/health 与 H5 自检页展示）。 */
export const BUSINESS_API_LIST = ROUTES.map((r) => `${r.method} /s/api${r.pattern}`)

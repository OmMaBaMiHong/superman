/**
 * Superman DSH 插件 · 业务 API 路由（K2 批次 2）。
 *
 * 从 src/app/api/ 的 Next.js 路由逐条翻译为裸 node:http handler：
 * 前缀 /s/api，全部过 auth.ts session 校验，userId 从 session 取。
 * 响应信封与 Next.js 版一致：{ ok: true, data } / { ok: false, error: { code, message, fields? } }。
 * 路由匹配用「模式 → 正则」前缀表，不引框架。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { addSubscriptionCandidate, getSubscriptionVideoSource, getSubscriptionWork, listSubscriptionFeeds, listSubscriptionWorks, markSubscriptionWorkRead } from '@/core/reader/service'
import { streamSubscriptionVideo } from './video.js'
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
  getSauLoginSession,
  isSauPlatform,
  sauPlatformFromType,
  startSauLoginSession,
  type SauPlatform,
} from '@/core/platform-accounts/sau/sauProvider'
import {
  confirmSauLoginSession,
  handleSauLoginCallback,
  verifySauAccount,
  type SauCallbackPayload,
} from '@/core/platform-accounts/sau/sauService'
import { publishDraftVideoToSau } from '@/core/platform-accounts/sau/sauPublishService'
import { runTrendRadarSync } from '@/core/trendradar/sync'
import {
  relayLoginWithPassword, relayLogout, getRelayStatus, syncMembership,
  selectRelayKey, selectRelayModel, getRelayRuntimeConfig, saveRelayRuntimeConfig,
  resolveRelayAiCredential,
} from '@/core/relay/service'
import { ENTITLEMENTS, requireEntitled, type Entitlement } from '@/core/relay/entitlements'
import { listRelayModels } from '@/core/relay/client'
import { relayBridgeApi } from './relayHostBridge.js'
import { readChaosChannels, readChaosMaterials, readChaosRankings, readPlatformConfig, platform, readChaosHotBoard } from '@/server/integrations/chaos/client'
import { startChaosAuthorization, exchangeChaosHandoff, linkedChaosUser, readChaosMe, unlinkChaosUser } from '@/server/integrations/chaos/account'
import { readBoardSlices, writeBoardSlices, boardCacheInfo } from './boardCache.js'
import { buildStudioBoardSlices, pickBoardSlices, unwrapBoardSlices } from './studioBoard.js'
import {
  getServicesConfig,
  getTrendRadarRunState,
  markTrendRadarRunDate,
  normalizeServicesConfig,
  saveServicesConfig,
  todayLocalDateString,
} from '@/core/services/serviceConfig'
import {
  isSauExecutorAlive,
  isTrendRadarAlive,
  spawnTrendRadar,
} from './servicesKeeper.js'
import { hybridSearch } from '@/core/knowledge/search'
import { createOpenAIClient } from '@/server/integrations/ai/openaiClient'
import { getArticleById, updateArticleUserNote } from '@/server/domains/articles/repositories/articlesRepo'
import { getAppSettings } from '@/server/domains/settings/repositories/settingsRepo'
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
import {
  clearRssHubCookie,
  isProvider as isRssHubCookieProvider,
  listRssHubCookieViews,
  saveRssHubCookie,
} from '@/server/domains/rsshubCookie/services/rssHubCookieService'
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
import { getTrendRadarItem } from '@/server/domains/trendradar/repository'
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
import { getAiModelSettings, listFreeModels, saveAiModelSettings, testFreeModel } from '@/core/ai/freeModels'
import {
  createManualProductPlan,
  createProductPlanFromArticle,
  resolveProductPlanAiConfig,
  runProductPlanPipeline,
  scanProductPlanCandidates,
} from '@/core/product-plans/service'
import {
  deleteProductPlan,
  getProductPlan,
  getProductPlanStats,
  isProductPlanSourceType,
  isProductPlanStatus,
  listProductPlans,
  updateProductPlan,
  type ProductPlanSourceType,
  type ProductPlanStatus,
  type UpdateProductPlanPatch,
} from '@/core/product-plans/repository'

export interface ApiDeps {
  /** 洗稿执行即踢（index 传入 scheduler.kickPipeline）。 */
  pipelineKick?: () => void
  auth: Auth
  db: Queryable | null
  /** P2e-5 服务面板：调度器热切换句柄（index.ts 注入）。 */
  schedulerControl?: { isRunning(): boolean; setRunning(enabled: boolean): void }
  /** P2e-5 服务面板：项目根（keeper 重启脚本路径解析）。 */
  projectRoot?: string
}

interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  session: Session
  db: Queryable
  /** 洗稿执行即踢（deps.pipelineKick 透传；测试/未注入时缺省跳过）。 */
  pipelineKick?: () => void
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

/** '/governance/items/:id/approve' → 正则 + 参数名表。'*' 作为通配符保留。 */
function compile(pattern: string): { re: RegExp; keys: string[] } {
  const keys: string[] = []
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg === '*') {
        keys.push('*')
        return '(.*)'
      }
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

/**
 * 允许 ?access_token= 查询串鉴权的媒体流路由（白名单，勿扩大）：
 * 这些 URL 由 <video> 标签直接发起，带不了 Authorization 头，
 * 且 DSH 桌面壳里 cookie 会被主进程剥掉（见 host/auth.ts 头注）。
 */
const MEDIA_TOKEN_ROUTES = new Set<string>([
  '/reader/items/:id/video',
  '/video/serve/:articleId',
])

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

const VIDEO_MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
}

/** 流式返回本地视频文件，支持 HTTP Range（<video> 拖动进度必需）。 */
async function streamLocalVideo(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  fileName: string | null,
): Promise<void> {
  const { createReadStream, statSync } = await import('node:fs')
  const nodePath = await import('node:path')
  const { pipeline } = await import('node:stream/promises')

  const total = statSync(filePath).size
  const ext = nodePath.extname(fileName || filePath).slice(1).toLowerCase()
  const mime = VIDEO_MIME_MAP[ext] ?? 'video/mp4'
  const range = req.headers.range

  try {
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      const start = match?.[1] ? Number(match[1]) : 0
      const end = match?.[2] ? Number(match[2]) : total - 1
      if (!Number.isFinite(start) || start >= total) {
        res.writeHead(416, { 'content-range': `bytes */${total}`, 'accept-ranges': 'bytes' })
        res.end()
        return
      }
      const chunkEnd = Math.min(end, total - 1)
      res.writeHead(206, {
        'content-type': mime,
        'content-range': `bytes ${start}-${chunkEnd}/${total}`,
        'accept-ranges': 'bytes',
        'content-length': String(chunkEnd - start + 1),
        'cache-control': 'private, no-store',
      })
      await pipeline(createReadStream(filePath, { start, end: chunkEnd }), res)
    } else {
      res.writeHead(200, {
        'content-type': mime,
        'accept-ranges': 'bytes',
        'content-length': String(total),
        'cache-control': 'private, no-store',
      })
      await pipeline(createReadStream(filePath), res)
    }
  } catch (error) {
    if (res.headersSent || res.destroyed) res.destroy()
    else throw error
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 知识问答三种助手人设（与 src/app/api/knowledge/ask/route.ts 保持字面一致）。 */
const KNOWLEDGE_SYSTEM_PROMPTS: Record<string, string> = {
  personal_assistant: `你是 Superman 智能助手，基于用户订阅的 RSS 文章知识库回答问题。
请根据提供的上下文信息，给出准确、简洁的回答。如果上下文不足以回答问题，请明确说明。
引用来源时请标注文章标题。回答使用 Markdown 格式。`,
  content_creation: `你是 Superman 内容创作助手，帮助用户从订阅源中快速检索素材、引用和灵感。
请根据提供的上下文，提炼关键信息、数据、观点，并以结构化方式呈现。
提供可引用的原文片段，标注来源文章标题。`,
  information_filtering: `你是 Superman 信息筛选助手，帮助用户从大量订阅内容中提炼精华。
请根据问题，从提供的上下文中筛选最相关的信息，生成摘要式的回答。
按主题归类，突出重点，帮助用户减少信息过载。`,
}

/** 知识检索的向量化函数：从 settings 解析配置；未配置时靠 core 的 FTS 降级。 */
function knowledgeEmbeddingFn(userId: string) {
  return async (question: string): Promise<number[]> => {
    const { getPool } = await import('@/server/infra/db/pool')
    const { generateEmbedding } = await import('@/core/knowledge/embedding')
    const pool = getPool()
    const [appSettings, aiApiKey] = await Promise.all([
      getAppSettings(pool),
      getAiApiKey(pool, userId),
    ])
    const config = resolveSharedAiConfig({
      settings: { ai: { model: appSettings.aiModel, apiBaseUrl: appSettings.aiApiBaseUrl } },
      aiApiKey,
    })
    return generateEmbedding(question, { config })
  }
}
const JOB_KINDS = new Set(['rewrite', 'voiceover', 'video'])
const JOB_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed'])

function escapeFrontmatter(value: string): string {
  return value.replace(/"/g, '\\"')
}

/** 路由表：与 src/app/api/ 对应路由的行为保持一致（校验规则/错误语义/返回形状）。 */
const ROUTES: RouteDef[] = [
  route('GET', '/ai/settings', async ({ res, session, db }) => {
    json(res, 200, { ok: true, data: await getAiModelSettings(db as never, session.userId) })
  }),
  route('PUT', '/ai/settings', async ({ req, res, session, db }) => {
    json(res, 200, { ok: true, data: await saveAiModelSettings(db as never, session.userId, await readJsonBody(req)) })
  }),
  route('GET', '/ai/free-models', async ({ res }) => {
    json(res, 200, { ok: true, data: { items: await listFreeModels() } })
  }),
  route('POST', '/ai/free-models/test', async ({ req, res }) => {
    const body = await readJsonBody(req)
    json(res, 200, { ok: true, data: await testFreeModel(body.freeModel) })
  }),
  // —— 治理 ——
  // —— 创作看板读模型：本地 SQLite 缓存直出 + refresh=1 从源库按片重建（Phase A）——
  // 面板要"一次查全量做分类"，首屏先读本机缓存立即可渲染；刷新按片整段重建，
  // 用户的增删改（含手动删除）在下一次刷新天然反映，后续再演进行级水位增量。
  route('GET', '/studio/board', async ({ res, query, session, db }) => {
    const refresh = query.get('refresh') === '1'
    const sliceKeys = ['review', 'topics', 'drafts', 'published', 'jobs']
    if (!refresh) {
      const cached = readBoardSlices(sliceKeys)
      if (cached && sliceKeys.every((key) => cached[key])) {
        json(res, 200, { ok: true, data: { source: 'cache', cache: boardCacheInfo(), slices: unwrapBoardSlices(cached, sliceKeys) } })
        return
      }
    }
    const built = (await buildStudioBoardSlices(db as never, session.userId)) as unknown as Record<string, unknown>
    writeBoardSlices(built)
    json(res, 200, {
      ok: true,
      data: { source: 'db', cache: boardCacheInfo(), slices: pickBoardSlices(built, sliceKeys) },
    })
  }),

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
  // —— Chaos 数据中台（/open/v1 消费，OpenSkoob 同模式；中台不可用时降级，不阻塞面板）——
  route('GET', '/chaos/status', async ({ res, db }) => {
    const config = await readPlatformConfig(db as never)
    if (!config) return json(res, 200, { ok: true, data: { configured: false } })
    const started = Date.now()
    try {
      await platform('/open/v1/channels', { open: true }, db as never)
      json(res, 200, { ok: true, data: { configured: true, ready: true, latencyMs: Date.now() - started } })
    } catch (error) {
      json(res, 200, { ok: true, data: { configured: true, ready: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : 'unavailable' } })
    }
  }),
  // Chaos 用户绑定（双身份：产品 Key + Chaos User ID）——订阅等用户行为的规范身份链
  route('GET', '/chaos/auth/start', async ({ req, res, query, session, db }) => {
    // 回调地址按请求的 origin 拼（H5 在 /s/app 下，知道自己 origin）
    const host = String(req.headers.host ?? '127.0.0.1:19387')
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim()
    const returnTo = query.get('returnTo')?.trim() || `${proto}://${host}/s/api/chaos/auth/callback`
    const authorizationUrl = await startChaosAuthorization(db as never, returnTo)
    json(res, 200, { ok: true, data: { authorizationUrl } })
  }),
  route('GET', '/chaos/auth/callback', async ({ req, res, query, session, db }) => {
    const code = query.get('code')?.trim() || ''
    const host = String(req.headers.host ?? '127.0.0.1:19387')
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim()
    if (!code) {
      res.writeHead(302, { location: `${proto}://${host}/s/app/#/profile?chaos=failed` })
      res.end()
      return
    }
    const linked = await exchangeChaosHandoff(db as never, session.userId, code)
    // H5 是 hash 路由：落回我的页并带结果标记
    res.writeHead(302, { location: `${proto}://${host}/s/app/#/profile?chaos=linked&chaosUserId=${encodeURIComponent(linked.chaosUserId)}` })
    res.end()
  }),
  route('GET', '/chaos/auth/me', async ({ res, session, db }) => {
    const linked = await linkedChaosUser(db as never, session.userId)
    if (!linked) return json(res, 200, { ok: true, data: { linked: false } })
    const me = await readChaosMe(db as never, session.userId)
    json(res, 200, { ok: true, data: { linked: true, chaosUserId: linked.chaosUserId, linkedAt: linked.linkedAt, profile: me } })
  }),
  route('POST', '/chaos/auth/disconnect', async ({ res, session, db }) => {
    await unlinkChaosUser(db as never, session.userId)
    json(res, 200, { ok: true, data: { linked: false } })
  }),
  route('GET', '/chaos/hotboard', async ({ res, db }) => {
    const result = await readChaosHotBoard(db as never)
    json(res, 200, { ok: true, data: result.data })
  }),
  route('GET', '/chaos/materials', async ({ res, query, db }) => {
    const limit = parsePositiveInt(query.get('limit')) ?? 20
    const before = query.get('before')?.trim() || undefined
    const tag = query.get('tag')?.trim() || undefined
    const result = await readChaosMaterials(db as never, { limit, before, tag })
    json(res, 200, { ok: true, data: result })
  }),
  route('GET', '/chaos/channels', async ({ res, db }) => {
    const result = await readChaosChannels(db as never)
    json(res, 200, { ok: true, data: result })
  }),
  route('GET', '/chaos/rankings', async ({ res, query, db }) => {
    const entityType = query.get('entityType')?.trim() || undefined
    const result = await readChaosRankings(db as never, { entityType })
    json(res, 200, { ok: true, data: result })
  }),

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
  // 热榜条目详情（行字段 + payload_json 全量）：详情 sheet 的数据源，与 Next 版同构
  route('GET', '/trend-radar/items/:id', async ({ res, params, session, db }) => {
    const id = requireId(params.id, 'id')
    const item = await getTrendRadarItem(db as never, id, session.userId)
    if (!item) throw new NotFoundError('热榜条目不存在或不属于当前用户')
    json(res, 200, { ok: true, data: item })
  }),
  // 热榜条目原文抓取（二创素材）：按条目 url 现抓正文，与剪藏同源（article-extractor）。
  // TrendRadar 只聚合标题+链接，原文必须现抓；视频类条目由前端引导走原链接。
  route('POST', '/trend-radar/items/:id/extract', async ({ req, res, params, session, db }) => {
    const id = requireId(params.id, 'id')
    const item = await getTrendRadarItem(db as never, id, session.userId)
    if (!item) throw new NotFoundError('热榜条目不存在或不属于当前用户')
    if (!/^https?:\/\//.test(item.url)) {
      throw new ValidationError('该条目没有可抓取的原文链接', { url: '条目缺少 http(s) 链接' })
    }
    const { extract } = await import('@extractus/article-extractor')
    let article: { title?: string; content?: string } | null = null
    try {
      article = await extract(item.url)
    } catch {
      article = null
    }
    if (!article?.content) {
      throw new AppError('未能抓取到原文（源页面可能反爬或不是文章页）', 'extract_failed', 502)
    }
    const text = article.content.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12_000)
    json(res, 200, { ok: true, data: { title: article.title ?? null, text, url: item.url } })
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
  route('POST', '/pipelines/rewrite', async ({ req, res, session, db, pipelineKick }) => {
    // 权益示范点（P2e-6）：洗稿是会员权益；未订阅时 403 membership_required 引导授权
    await requireEntitled(db as never, session.userId, 'rewrite.execute')
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
    pipelineKick?.()
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
  route('POST', '/pipelines/jobs/:id/retry', async ({ res, params, session, db, pipelineKick }) => {
    const result = await retryPipelineJob(db as never, { id: requireId(params.id, '任务 ID'), userId: session.userId })
    pipelineKick?.()
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
    const purposeParam = query.get('purpose')?.trim() || undefined
    const items = await listPlatformAccounts(db as never, {
      userId: session.userId,
      platform: platform as never,
      purpose: purposeParam as never,
    })
    json(res, 200, { ok: true, data: { items } })
  }),
  route('POST', '/platform-accounts', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const platform = typeof body.platform === 'string' ? body.platform.trim() : ''
    if (!['wechat', 'douyin', 'xhs', 'bilibili', 'channels', 'kuaishou', 'weibo'].includes(platform)) {
      throw new ValidationError('请求参数非法', { platform: '仅支持 wechat/douyin/xhs/bilibili/channels/kuaishou/weibo' })
    }
    const credKind = typeof body.credKind === 'string' ? body.credKind.trim() : ''
    if (!['app_secret', 'cookie', 'oauth'].includes(credKind)) {
      throw new ValidationError('请求参数非法', { credKind: '仅支持 app_secret/cookie/oauth' })
    }
    const purpose = typeof body.purpose === 'string' && ['publish', 'collect', 'oauth'].includes(body.purpose)
      ? (body.purpose as 'publish' | 'collect' | 'oauth')
      : 'publish'
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
        purpose,
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

    // SAU cookie 账号（抖音/小红书/视频号/快手）：执行器对账验证（P2e-2/3/4）
    if (isSauPlatform(account.platform) && account.credKind === 'cookie') {
      const result = await verifySauAccount(account.platform, account)
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

  // —— SAU 扫码授权流（P2e-2 抖音 / P2e-3 小红书 / P2e-4 视频号+快手）——
  ...(['douyin', 'xhs', 'channels', 'kuaishou'] as const).flatMap((platform: SauPlatform) => [
    route('POST', `/platform-accounts/${platform}/login-session`, async ({ req, res, session }) => {
      const body = await readJsonBody(req)
      const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : ''
      if (!accountName) {
        throw new ValidationError('请求参数非法', { accountName: '账号备注名不能为空' })
      }
      const loginSession = startSauLoginSession({
        platform,
        userId: session.userId,
        accountName,
      })
      json(res, 200, { ok: true, data: { sessionId: loginSession.id } })
    }),
    route('GET', `/platform-accounts/${platform}/login-session/:id/qr`, async ({ res, params, session }) => {
      const loginSession = getSauLoginSession(params.id ?? '')
      if (!loginSession || loginSession.userId !== session.userId || loginSession.platform !== platform) {
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
    route('POST', `/platform-accounts/${platform}/login-session/:id/confirm`, async ({ res, params, session, db }) => {
      const account = await confirmSauLoginSession(db as never, {
        sessionId: params.id ?? '',
        userId: session.userId,
      })
      json(res, 200, { ok: true, data: { account } })
    }),
  ]),
  // vendor 执行器回调（共享密钥鉴权，不走 session；payload.type 区分平台：1=xhs / 3=douyin）
  route('POST', '/platform-accounts/sau/callback', async ({ req, res, db }) => {
    const body = await readJsonBody(req)
    const payload: SauCallbackPayload = {
      type: Number(body.type),
      userName: typeof body.userName === 'string' ? body.userName : '',
      filePath: typeof body.filePath === 'string' ? body.filePath : '',
      storageState:
        typeof body.storageState === 'object' && body.storageState !== null
          ? (body.storageState as Record<string, unknown>)
          : {},
    }
    if (!payload.userName || !payload.filePath || sauPlatformFromType(payload.type) === null) {
      throw new ValidationError('回调报文非法', { payload: 'type/userName/filePath 缺失或平台不支持' })
    }
    const result = await handleSauLoginCallback(db as never, payload)
    json(res, 200, { ok: true, data: result })
  }, 'sauToken'),
  /** @deprecated 保留 P2e-2 旧路径兼容（等价于 sau/callback type=3），新部署请用 /sau/callback。 */
  route('POST', '/platform-accounts/douyin/callback', async ({ req, res, db }) => {
    const body = await readJsonBody(req)
    const payload: SauCallbackPayload = {
      type: 3,
      userName: typeof body.userName === 'string' ? body.userName : '',
      filePath: typeof body.filePath === 'string' ? body.filePath : '',
      storageState:
        typeof body.storageState === 'object' && body.storageState !== null
          ? (body.storageState as Record<string, unknown>)
          : {},
    }
    if (!payload.userName || !payload.filePath) {
      throw new ValidationError('回调报文非法', { payload: 'userName/filePath 缺失' })
    }
    const result = await handleSauLoginCallback(db as never, payload)
    json(res, 200, { ok: true, data: result })
  }, 'sauToken'),

  // —— 手动同步（「立即抓取/立即同步」按钮）：与调度器 tick 同一实现，不等周期 ——

  route('POST', '/feeds/refresh-now', async ({ res, db }) => {
    if (!db) return json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
    // 动态 import：scheduler 的传递依赖会破坏测试的模块 mock（懒加载到调用时）
    const { fetchDueFeedsOnce } = await import('./jobs/scheduler.js')
    const result = await fetchDueFeedsOnce(db as never, {
      log: (msg: string) => console.log(`[superman:feeds-now] ${msg}`),
      warn: (msg: unknown) => console.warn(`[superman:feeds-now] ${msg}`),
    })
    json(res, 200, { ok: true, data: result })
  }),

  route('POST', '/trendradar/sync-now', async ({ res, session, db }) => {
    if (!db) return json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
    try {
      const result = await runTrendRadarSync({ pool: db as never, userId: session.userId })
      json(res, 200, { ok: true, data: result })
    } catch (err) {
      // TrendRadar 当日 SQLite 不存在等场景：明确告诉用户源头没数据
      json(res, 200, {
        ok: false,
        error: { code: 'sync_failed', message: err instanceof Error ? err.message : String(err) },
      })
    }
  }),

  // —— 服务面板（P2e-5）：状态/开关/重启 ———

  route('GET', '/services/status', async ({ res }) => {
    const deps = currentDeps
    const config = deps?.db ? await getServicesConfig(deps.db as never) : null
    const runState = deps?.db ? await getTrendRadarRunState(deps.db as never) : null
    const trendRadar = isTrendRadarAlive()
    const sauOnline = await isSauExecutorAlive()
    json(res, 200, {
      ok: true,
      data: {
        scheduler: { enabled: config?.schedulerEnabled ?? false, running: deps?.schedulerControl?.isRunning() ?? false },
        trendRadar: {
          runMode: config?.trendRadarRunMode ?? 'off',
          runTime: config?.trendRadarRunTime ?? '09:00',
          lastRunDate: runState?.lastRunDate ?? null,
          alive: trendRadar.alive,
          pid: trendRadar.pid,
        },
        sau: {
          keeperEnabled: config?.sauKeeper ?? true,
          online: sauOnline,
        },
      },
    })
  }),

  route('POST', '/services/config', async ({ req, res, db }) => {
    const body = await readJsonBody(req)
    const current = db ? await getServicesConfig(db as never) : (await import('@/core/services/serviceConfig')).DEFAULT_SERVICES_CONFIG
    // 归一化兜底（runMode 非法值 / runTime 非 HH:mm 一律回落当前值或默认值）
    const next = normalizeServicesConfig({
      schedulerEnabled:
        typeof body.schedulerEnabled === 'boolean' ? body.schedulerEnabled : current.schedulerEnabled,
      trendRadarRunMode:
        body.trendRadarRunMode === 'daily' || body.trendRadarRunMode === 'off'
          ? body.trendRadarRunMode
          : current.trendRadarRunMode,
      trendRadarRunTime:
        typeof body.trendRadarRunTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.trendRadarRunTime.trim())
          ? body.trendRadarRunTime.trim()
          : current.trendRadarRunTime,
      sauKeeper: typeof body.sauKeeper === 'boolean' ? body.sauKeeper : current.sauKeeper,
    })
    if (db) await saveServicesConfig(db as never, next)
    // 调度器热切换：立即生效，免重启（trendradar 定时 tick 独立于它，每轮读 DB）
    if (typeof body.schedulerEnabled === 'boolean') currentDeps?.schedulerControl?.setRunning(next.schedulerEnabled)
    json(res, 200, { ok: true, data: next })
  }),

  route('POST', '/services/trendradar/restart', async ({ res, db }) => {
    // 杀旧 pid（若在）再拉新：一次性抓取程序，重启 = 立即手动跑一轮。
    // 记 lastRunDate：当天已手动跑过就不再重复定时拉起，跑后同步也随之跟进。
    const before = isTrendRadarAlive()
    if (before.alive && before.pid) {
      try { process.kill(before.pid); } catch { /* 已退出 */ }
    }
    const spawned = spawnTrendRadar()
    if (spawned && db) await markTrendRadarRunDate(db as never, todayLocalDateString())
    json(res, 200, {
      ok: spawned,
      data: { restarted: spawned, alive: isTrendRadarAlive().alive },
      ...(spawned ? {} : { error: { code: 'spawn_failed', message: '拉起失败：请确认 TrendRadar .venv 已部署' } }),
    })
  }),

  route('POST', '/services/sau/restart', async ({ res }) => {
    const root = currentDeps?.projectRoot ?? process.cwd()
    // 统一走脚本 stop → start（start 幂等；在线重启 = 开新一轮会话）
    const { spawn } = await import('node:child_process')
    const child = spawn('bash', ['-c', `bash '${root}/scripts/sau-executor.sh' stop >/dev/null 2>&1; sleep 1; bash '${root}/scripts/sau-executor.sh' start`], { stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    json(res, 200, { ok: true, data: { restarting: true } })
  }),

  // —— 中转站会员（P2e-6 relay 一期）：账密授权 / 会员状态 / Key 与模型选择 / 对账 ——

  route('POST', '/relay/login', async ({ req, res, session, db }) => {
    if (!db) return json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
    const body = await readJsonBody(req)
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) throw new ValidationError('请求参数非法', { email: '邮箱与密码必填' })
    const result = await relayLoginWithPassword(db as never, session.userId, { email, password })
    // 授权成功 → Key 同步进宿主凭据缝（DSH 模型页的中转站路由即时可用，免手填）。
    try {
      const cred = await resolveRelayAiCredential(db as never, session.userId)
      await relayBridgeApi.syncKeyToHost(cred.apiKey)
    } catch { /* 未选 Key 等场景：模型页仍可手填 */ }
    json(res, 200, { ok: true, data: result })
  }),

  route('POST', '/relay/logout', async ({ res, session, db }) => {
    if (db) await relayLogout(db as never, session.userId)
    await relayBridgeApi.clearHostKey()
    json(res, 200, { ok: true })
  }),

  route('GET', '/relay/status', async ({ res, session, db }) => {
    if (!db) return json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
    const status = await getRelayStatus(db as never, session.userId)
    json(res, 200, { ok: true, data: { ...status, entitlementCatalog: ENTITLEMENTS } })
  }),

  route('POST', '/relay/sync', async ({ res, session, db }) => {
    if (!db) return json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
    const result = await syncMembership(db as never, session.userId)
    json(res, 200, { ok: true, data: result })
  }),

  route('POST', '/relay/keys/select', async ({ req, res, session, db }) => {
    if (!db) return json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
    const body = await readJsonBody(req)
    const keyId = typeof body.keyId === 'string' ? body.keyId.trim() : ''
    if (!keyId) throw new ValidationError('请求参数非法', { keyId: '必填' })
    await selectRelayKey(db as never, session.userId, keyId)
    // 换绑 Key → 同步进宿主凭据缝（覆盖上一个）。
    try {
      const cred = await resolveRelayAiCredential(db as never, session.userId)
      await relayBridgeApi.syncKeyToHost(cred.apiKey)
    } catch { /* 保持宿主侧原值 */ }
    json(res, 200, { ok: true })
  }),

  route('POST', '/relay/model/select', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) throw new ValidationError('请求参数非法', { model: '必填' })
    await selectRelayModel(db as never, session.userId, model)
    json(res, 200, { ok: true })
  }),

  route('GET', '/relay/models', async ({ res, session, db }) => {
    if (!db) return json(res, 503, { ok: false, error: { code: 'service_unavailable', message: '数据库未连接' } })
    const endpoints = await getRelayRuntimeConfig(db as never)
    let apiKey = ''
    try {
      apiKey = (await resolveRelayAiCredential(db as never, session.userId)).apiKey
    } catch { apiKey = '' }
    const models = await listRelayModels(endpoints, apiKey)
    json(res, 200, { ok: true, data: { items: models } })
  }),

  route('POST', '/relay/config', async ({ req, res, db }) => {
    const body = await readJsonBody(req)
    const saved = await saveRelayRuntimeConfig(db as never, {
      ...(typeof body.apiUrl === 'string' ? { apiUrl: body.apiUrl } : {}),
      ...(typeof body.llmBaseUrl === 'string' ? { llmBaseUrl: body.llmBaseUrl } : {}),
      ...(typeof body.defaultModel === 'string' ? { defaultModel: body.defaultModel } : {}),
    })
    // H5 侧改了中转站地址/默认模型 → 重跑预配（只覆盖仍为预配值的字段，不动编辑器手改）。
    if (db) await relayBridgeApi.reprovision().catch(() => undefined)
    json(res, 200, { ok: true, data: saved })
  }),

  route('POST', '/drafts/:id/publish', async ({ req, res, params, session, db }) => {
    const body = await readJsonBody(req)
    const platform = typeof body.platform === 'string' ? body.platform.trim() : ''
    const accountId = typeof body.accountId === 'string' || typeof body.accountId === 'number'
      ? String(body.accountId)
      : ''
    if (!/^\d+$/.test(accountId)) {
      throw new ValidationError('请求参数非法', { accountId: '必须为正整数' })
    }

    if (platform === 'douyin' || platform === 'xhs') {
      const result = await publishDraftVideoToSau(db as never, {
        platform,
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
      throw new ValidationError('请求参数非法', { platform: '当前仅支持 wechat（公众号草稿箱）/ douyin（抖音视频）/ xhs（小红书视频笔记）' })
    }
    const result = await publishDraftToWechat(db as never, {
      draftId: requireId(params.id, '草稿 ID'),
      accountId,
      userId: session.userId,
    })
    json(res, 200, { ok: true, data: result })
  }),

  // 订阅阅读独立于治理队列，所有查询和动作使用登录用户。
  route('GET', '/reader/feeds', async ({ res, session, db }) => {
    json(res, 200, { ok: true, data: { items: await listSubscriptionFeeds(db as never, session.userId) } })
  }),
  route('GET', '/reader/items', async ({ res, query, session, db }) => {
    const type = query.get('type') ?? 'all'
    if (type !== 'all' && type !== 'article' && type !== 'video') throw new ValidationError('作品类型无效', { type: '仅支持 all/article/video' })
    const result = await listSubscriptionWorks(db as never, {
      userId: session.userId,
      feedId: query.has('feedId') ? requireId(query.get('feedId') ?? undefined, '订阅 ID') : undefined,
      type, cursor: query.get('cursor') ?? undefined, limit: parsePositiveInt(query.get('limit')) ?? 30,
    })
    json(res, 200, { ok: true, data: result })
  }),
  route('GET', '/reader/items/:id', async ({ res, params, session, db }) => {
    const item = await getSubscriptionWork(db as never, session.userId, requireId(params.id))
    json(res, 200, { ok: true, data: { item } })
  }),
  route('GET', '/reader/items/:id/video', async ({ req, res, params, session, db }) => {
    const source = await getSubscriptionVideoSource(db as never, session.userId, requireId(params.id))
    await streamSubscriptionVideo(req, res, source)
  }),
  route('POST', '/reader/items/:id/read', async ({ res, params, session, db }) => {
    await markSubscriptionWorkRead(db as never, session.userId, requireId(params.id))
    json(res, 200, { ok: true, data: { updated: true } })
  }),
  route('POST', '/reader/items/:id/candidate', async ({ res, params, session, db }) => {
    await addSubscriptionCandidate(db as never, session.userId, requireId(params.id))
    json(res, 200, { ok: true, data: { inCandidatePool: true } })
  }),

  // —— 订阅源（P1-A）——
  route('GET', '/rsshub/resolve', async ({ res, query }) => {
    const url = query.get('url') ?? ''
    const { resolveRssHubSourceUrl } = await import('@/server/integrations/rsshub/sourceResolver')
    const result = await resolveRssHubSourceUrl(url)
    json(res, 200, { ok: true, data: result })
  }),
  // —— 平台采集 Cookie（RSSHub 抓取 + yt-dlp 文案提取）——
  route('GET', '/rsshub/cookies', async ({ res, session, db }) => {
    json(res, 200, { ok: true, data: await listRssHubCookieViews(db as never, session.userId) })
  }),
  route('PUT', '/rsshub/cookies/:provider', async ({ req, res, params, session, db }) => {
    const provider = params.provider ?? ''
    if (!isRssHubCookieProvider(provider)) {
      throw new ValidationError('不支持的平台', { provider: '仅支持 douyin/xiaohongshu/weibo' })
    }
    const body = await readJsonBody(req)
    const cookie = typeof body.cookie === 'string' ? body.cookie : ''
    if (cookie.length > 8192) throw new ValidationError('请求参数非法', { cookie: '最长 8192 字符' })
    const remark = typeof body.remark === 'string' ? body.remark.slice(0, 64) : undefined
    const view = await saveRssHubCookie(db as never, session.userId, {
      provider,
      cookie,
      ...(remark === undefined ? {} : { remark }),
    })
    json(res, 200, { ok: true, data: view })
  }),
  route('DELETE', '/rsshub/cookies/:provider', async ({ res, params, session, db }) => {
    const provider = params.provider ?? ''
    if (!isRssHubCookieProvider(provider)) {
      throw new ValidationError('不支持的平台', { provider: '仅支持 douyin/xiaohongshu/weibo' })
    }
    json(res, 200, { ok: true, data: await clearRssHubCookie(db as never, session.userId, provider) })
  }),
  // —— 授权与凭证中心（按平台聚合发布授权 + 采集 Cookie）——
  route('GET', '/credential-center', async ({ res, session, db }) => {
    const { listCredentialCenter } = await import('@/core/credentials/center')
    json(res, 200, { ok: true, data: await listCredentialCenter(db as never, session.userId) })
  }),
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

  // —— 知识库检索与问答（P2f-A3；语义对齐 src/app/api/knowledge/*）——
  route('GET', '/knowledge/search', async ({ res, query, session, db }) => {
    const q = query.get('q')
    if (!q || !q.trim()) {
      json(res, 200, { ok: true, data: { items: [] } })
      return
    }
    const items = await hybridSearch(db as never, q.trim(), 10, {
      embeddingFn: knowledgeEmbeddingFn(session.userId),
    })
    json(res, 200, { ok: true, data: { items } })
  }),

  route('POST', '/knowledge/ask', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) {
      throw new ValidationError('请求参数非法', { question: '请输入问题' })
    }
    const mode = typeof body.mode === 'string' ? body.mode : 'personal_assistant'
    const articleId = typeof body.articleId === 'number' ? body.articleId : null

    // 1. 构建上下文：指定 articleId 直读全文，否则混合检索
    let context: string
    let sources: { title: string; articleId: number }[]
    if (articleId !== null) {
      const article = await getArticleById(db as never, String(articleId), session.userId)
      if (!article) throw new NotFoundError('文章不存在')
      const content = article.contentFullHtml || article.contentHtml || article.summary || ''
      context = `[来源: ${article.title}]\n${content}`
      sources = [{ title: article.title, articleId: Number(article.id) }]
    } else {
      const results = await hybridSearch(db as never, question, 8, {
        embeddingFn: knowledgeEmbeddingFn(session.userId),
      })
      context = results.map((r) => `[来源: ${r.title}]\n${r.chunkText}`).join('\n\n---\n\n')
      sources = results.map((r) => ({ title: r.title, articleId: r.articleId }))
    }

    // 2. 采用用户选择的免费模式；原配置继续兼容 app_settings。
    const appSettings = await getAppSettings(db as never)
    const userAi = normalizePersistedSettings(await getUiSettings(db as never, session.userId)).ai
    const aiApiKey = await getAiApiKey(db as never, session.userId)
    const config = resolveSharedAiConfig({
      settings: { ai: { providerMode: userAi.providerMode, freeModel: userAi.freeModel, model: appSettings.aiModel, apiBaseUrl: appSettings.aiApiBaseUrl } },
      aiApiKey,
    })
    if (!isAiRuntimeConfigComplete(config)) {
      throw new ValidationError('未配置 AI（模型/接口地址/API Key），无法回答', { ai: 'not_configured' })
    }
    const client = createOpenAIClient({
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      source: 'plugin/knowledge',
      requestLabel: 'knowledge_ask',
    })
    const systemPrompt = KNOWLEDGE_SYSTEM_PROMPTS[mode] || KNOWLEDGE_SYSTEM_PROMPTS.personal_assistant

    // 3. SSE 流式回答（data: {content} → data: {done, sources} → data: [DONE]）
    const stream = await client.chat.completions.create({
      model: config.model,
      stream: true,
      messages: [
        { role: 'system', content: `${systemPrompt}\n\n当前时间: ${new Date().toISOString()}` },
        { role: 'user', content: `基于以下知识库内容回答问题：\n\n${context}\n\n---\n\n问题：${question}` },
      ],
    })
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const payload = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || ''
      if (content) payload({ content })
    }
    payload({ done: true, sources })
    res.end('data: [DONE]\n\n')
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

  // —— 剪贴板快速收藏 ——
  route('POST', '/clips', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req);
    const { createClip } = await import('@/core/clips/service');
    const result = await createClip(db as never, {
      userId: session.userId,
      title: typeof body.title === 'string' ? body.title : undefined,
      contentText: typeof body.contentText === 'string' ? body.contentText : '',
      contentHtml: typeof body.contentHtml === 'string' ? body.contentHtml : undefined,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      sourceTitle: typeof body.sourceTitle === 'string' ? body.sourceTitle : null,
      imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : undefined,
      note: typeof body.note === 'string' ? body.note : null,
    });
    json(res, 200, { ok: true, data: result });
  }),
  route('GET', '/clips', async ({ res, query, session, db }) => {
    const { listClips } = await import('@/core/clips/repository');
    const limit = parsePositiveInt(query.get('limit')) ?? 20;
    const offset = parsePositiveInt(query.get('offset')) ?? 0;
    const result = await listClips(db as never, session.userId, { limit, offset });
    json(res, 200, { ok: true, data: result });
  }),

  // —— 内容详情：文章 + 收藏快照 + 视频素材/文案（收藏/选题池点进去看）——
  route('GET', '/contents/:id', async ({ res, params, session, db }) => {
    const id = requireId(params.id, '内容 ID');
    interface DetailRow {
      id: string; title: string | null; summary: string | null; sourceUrl: string | null;
      origin: string | null; publishedAt: string | null; previewImageUrl: string | null;
      directionKey: string | null; directionReason: string | null; qualityScore: number | null;
      governanceStatus: string | null; contentHtml: string | null;
      clipRawContent: string | null; clipNote: string | null; clipImageUrls: string[] | null;
      videoUrl: string | null; videoTitle: string | null; videoProvider: string | null;
      transcriptText: string | null; transcriptSource: string | null; transcriptLanguage: string | null;
      transcriptExtractedAt: string | null; transcriptStatus: string | null; transcriptError: string | null;
      videoFilePath: string | null; videoFileName: string | null; videoFileSize: number | null;
    }
    const { rows } = await db.query(
      `select
         a.id::text as "id",
         a.title,
         a.summary,
         a.link as "sourceUrl",
         a.origin,
         a.published_at as "publishedAt",
         a.preview_image_url as "previewImageUrl",
         a.direction_key as "directionKey",
         a.direction_reason as "directionReason",
         a.quality_score as "qualityScore",
         a.governance_status as "governanceStatus",
         a.content_html as "contentHtml",
         c.raw_content as "clipRawContent",
         c.note as "clipNote",
         c.image_urls as "clipImageUrls",
         vm.video_url as "videoUrl",
         vm.video_title as "videoTitle",
         vm.provider as "videoProvider",
         vm.transcript_text as "transcriptText",
         vm.transcript_source as "transcriptSource",
         vm.transcript_language as "transcriptLanguage",
         vm.transcript_extracted_at as "transcriptExtractedAt",
         vm.transcript_status as "transcriptStatus",
         vm.transcript_error as "transcriptError",
         vm.video_file_path as "videoFilePath",
         vm.video_file_name as "videoFileName",
         vm.video_file_size as "videoFileSize"
       from articles a
       left join clips c on c.article_id = a.id and c.user_id = a.user_id
       left join video_materials vm on vm.article_id = a.id and vm.user_id = a.user_id
       where a.id = $1 and a.user_id = $2`,
      [id, session.userId],
    );
    const row = rows[0] as unknown as DetailRow | undefined;
    if (!row) throw new NotFoundError('内容不存在');
    const hasClip = row.clipRawContent !== null || row.clipNote !== null || row.clipImageUrls !== null;

    type VideoBlock = {
      videoUrl: string | null; videoTitle: string | null; provider: string | null;
      transcriptText: string | null; transcriptSource: string | null; transcriptLanguage: string | null;
      transcriptExtractedAt: string | null; transcriptStatus: string; transcriptError: string | null;
      videoFilePath: string | null; videoFileName: string | null; videoFileSize: number | null;
    };
    let video: VideoBlock | null = null;
    if (row.videoUrl !== null || row.transcriptText !== null || row.transcriptStatus !== null) {
      video = {
        videoUrl: row.videoUrl ?? null,
        videoTitle: row.videoTitle ?? null,
        provider: row.videoProvider ?? null,
        transcriptText: row.transcriptText ?? null,
        transcriptSource: row.transcriptSource ?? null,
        transcriptLanguage: row.transcriptLanguage ?? null,
        transcriptExtractedAt: row.transcriptExtractedAt ?? null,
        transcriptStatus: row.transcriptStatus ?? 'none',
        transcriptError: row.transcriptError ?? null,
        videoFilePath: row.videoFilePath ?? null,
        videoFileName: row.videoFileName ?? null,
        videoFileSize: row.videoFileSize ?? null,
      };
    } else if (typeof row.sourceUrl === 'string' && /douyin\.com|iesdouyin\.com/i.test(row.sourceUrl)) {
      // 无素材行，但来源是抖音链接 → 解析作品 ID，合成 video 对象供「提取文案」
      const { resolveVideoIdFromShareUrl } = await import('@/server/integrations/rsshub/douyinAuthorResolver');
      const videoId = await resolveVideoIdFromShareUrl(row.sourceUrl).catch(() => null);
      if (videoId) {
        video = {
          videoUrl: `https://www.douyin.com/video/${videoId}`,
          videoTitle: row.title ?? null,
          provider: 'douyin',
          transcriptText: null, transcriptSource: null, transcriptLanguage: null,
          transcriptExtractedAt: null, transcriptStatus: 'none', transcriptError: null,
          videoFilePath: null, videoFileName: null, videoFileSize: null,
        };
      }
    }

    json(res, 200, {
      ok: true,
      data: {
        id: row.id,
        title: row.title,
        summary: row.summary,
        sourceUrl: row.sourceUrl,
        origin: row.origin,
        publishedAt: row.publishedAt,
        previewImageUrl: row.previewImageUrl,
        directionKey: row.directionKey,
        directionReason: row.directionReason,
        qualityScore: row.qualityScore,
        governanceStatus: row.governanceStatus,
        contentHtml: row.contentHtml,
        clip: hasClip
          ? { rawContent: row.clipRawContent ?? '', note: row.clipNote ?? null, imageUrls: row.clipImageUrls ?? [] }
          : null,
        video,
      },
    });
  }),

  // —— 我的页统计 ——
  route('GET', '/me/stats', async ({ res, session, db }) => {
    const userId = session.userId;
    // 收藏 = ⭐标记 或 剪贴板收藏（origin='clipboard'）
    const favoritedRes = await db.query(
      "select count(*)::int as count from articles where user_id = $1 and (is_favorited = true or origin = 'clipboard')",
      [userId],
    );
    const worksRes = await db.query(
      "select count(*)::int as count from drafts where user_id = $1",
      [userId],
    );
    const publishedRes = await db.query(
      "select count(*)::int as count from published_posts where user_id = $1",
      [userId],
    );
    json(res, 200, {
      ok: true,
      data: {
        favorites: favoritedRes.rows[0]?.count ?? 0,
        works: worksRes.rows[0]?.count ?? 0,
        published: publishedRes.rows[0]?.count ?? 0,
      },
    });
  }),

  // —— 我的页 · 收藏列表（⭐标记 或 剪贴板收藏）——
  route('GET', '/me/favorites', async ({ res, query, session, db }) => {
    const limit = Math.min(parsePositiveInt(query.get('limit')) ?? 50, 100);
    const offset = parsePositiveInt(query.get('offset')) ?? 0;
    const { rows } = await db.query(
      `select
         id::text as "id",
         title,
         link as "sourceUrl",
         origin,
         is_favorited as "isFavorited",
         preview_image_url as "previewImageUrl",
         summary,
         user_note as "userNote",
         direction_key as "directionKey",
         direction_reason as "directionReason",
         fetched_at as "createdAt"
       from articles
       where user_id = $1 and (origin = 'clipboard' or is_favorited = true)
       order by fetched_at desc, id desc
       limit $2 offset $3`,
      [session.userId, limit, offset],
    );
    const totalRes = await db.query(
      "select count(*)::int as count from articles where user_id = $1 and (origin = 'clipboard' or is_favorited = true)",
      [session.userId],
    );
    json(res, 200, { ok: true, data: { items: rows, total: totalRes.rows[0]?.count ?? 0 } });
  }),

  // —— 收藏备注 / 想法（可编辑；参与「生成稿件」提示词）——
  route('PUT', '/articles/:id/note', async ({ req, res, params, session, db }) => {
    const body = await readJsonBody(req)
    const note = typeof body.note === 'string' ? body.note : undefined
    const title = typeof body.title === 'string' ? body.title : undefined
    if (note === undefined && title === undefined) {
      throw new ValidationError('请求参数非法', { note: '至少提供 note 或 title' })
    }
    const updated = await updateArticleUserNote(db as never, {
      id: requireId(params.id, '收藏 ID'),
      userId: session.userId,
      note,
      title,
    })
    if (!updated) throw new NotFoundError('收藏不存在或不属于当前用户')
    json(res, 200, { ok: true, data: { updated: true } })
  }),

  // —— 剪贴板收藏（图片/视频文件上传）——
  route('POST', '/clipboard/image', async ({ req, res, session, db }) => {
    const { saveUploads } = await import('@/server/infra/storage/localFileStore');
    const { createClip } = await import('@/core/clips/service');
    const busboy = (await import('busboy')).default;

    const bb = busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024, files: 10 } });
    const files: File[] = [];
    let sourceUrl = '';

    bb.on('file', (_name: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      const chunks: Buffer[] = [];
      stream.on('data', (d: Buffer) => chunks.push(d));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        files.push(new File([buf], info.filename, { type: info.mimeType }));
      });
    });
    bb.on('field', (name: string, val: string) => {
      if (name === 'sourceUrl') sourceUrl = val;
    });

    await new Promise<void>((resolve, reject) => {
      bb.on('close', () => resolve());
      bb.on('error', (err: Error) => reject(err));
      req.pipe(bb);
    });

    if (files.length === 0) throw new ValidationError('请选择图片', { images: '至少选择一张图片' });

    const savedFiles = await saveUploads(files);
    const imageUrls = savedFiles.map((f) => f.url);

    const result = await createClip(db as never, {
      userId: session.userId,
      title: `${files.length} 张图片收藏`,
      contentText: `从外部收藏的 ${files.length} 张图片素材`,
      contentHtml: imageUrls.map((u) => `<img src="${u}" />`).join('\n'),
      sourceUrl: sourceUrl || null,
      sourceTitle: `${files.length} 张图片收藏`,
      imageUrls,
    });

    json(res, 200, { ok: true, data: { articleId: result.articleId, imageUrls, alreadyExists: result.alreadyExists } });
  }),

  route('POST', '/clipboard/video', async ({ req, res, session, db }) => {
    const { saveUpload } = await import('@/server/infra/storage/localFileStore');
    const { createClip } = await import('@/core/clips/service');
    const busboy = (await import('busboy')).default;

    const bb = busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
    const holder: { videoFile: File | null; sourceUrl: string } = { videoFile: null, sourceUrl: '' };

    bb.on('file', (_name: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      const chunks: Buffer[] = [];
      stream.on('data', (d: Buffer) => chunks.push(d));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        holder.videoFile = new File([buf], info.filename, { type: info.mimeType });
      });
    });
    bb.on('field', (name: string, val: string) => {
      if (name === 'sourceUrl') holder.sourceUrl = val;
    });

    await new Promise<void>((resolve, reject) => {
      bb.on('close', () => resolve());
      bb.on('error', (err: Error) => reject(err));
      req.pipe(bb);
    });

    const videoFile = holder.videoFile as File | null;
    if (!videoFile) throw new ValidationError('请选择视频', { video: '请选择一个视频文件' });

    const saved = await saveUpload(videoFile);

    // 存 video_materials 表
    const videoResult = await db.query(
      `insert into video_materials (article_id, user_id, video_url, video_title, provider, video_file_path, video_file_name, video_file_size)
       values (0, $1, $2, $3, 'clipboard', $4, $5, $6) returning id`,
      [session.userId, saved.url, videoFile.name, saved.filePath, saved.fileName, saved.fileSize],
    );
    const videoMaterialId = videoResult.rows[0]?.id as number | undefined;

    const result = await createClip(db as never, {
      userId: session.userId,
      title: videoFile.name.replace(/\.[^.]+$/, '').slice(0, 28),
      contentText: `视频素材：${videoFile.name}`,
      contentHtml: `<video src="${saved.url}" controls preload="metadata"></video>`,
      sourceUrl: holder.sourceUrl || null,
      sourceTitle: videoFile.name,
    });

    if (videoMaterialId) {
      await db.query('update video_materials set article_id = $1 where id = $2', [result.articleId, videoMaterialId]);
    }

    json(res, 200, { ok: true, data: { articleId: result.articleId, videoUrl: saved.url, fileName: saved.fileName, alreadyExists: result.alreadyExists } });
  }),

  route('POST', '/clipboard/url', async ({ req, res, session, db }) => {
    const { createClip } = await import('@/core/clips/service');
    const { extract } = await import('@extractus/article-extractor');

    const body = await readJsonBody(req);
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) throw new ValidationError('请输入链接', { url: '链接不能为空' });

    const article = await extract(url);
    if (!article?.content) throw new ValidationError('抓取失败', { url: '无法提取页面内容' });

    const result = await createClip(db as never, {
      userId: session.userId,
      title: (article.title || '').slice(0, 80),
      contentText: article.content.replace(/<[^>]+>/g, '').trim(),
      contentHtml: article.content,
      sourceUrl: url,
      sourceTitle: article.title || null,
    });

    json(res, 200, { ok: true, data: { articleId: result.articleId, title: (article.title || '').slice(0, 80), summary: result.summary, alreadyExists: result.alreadyExists } });
  }),

  // —— 智能收藏：从杂乱分享文本提取链接 → 收藏作品 + 识别博主 ——
  route('POST', '/clipboard/smart', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req);
    const rawText = typeof body.text === 'string' ? body.text
      : typeof body.url === 'string' ? body.url : '';

    const { extractFirstUrl } = await import('@/lib/url/extractUrl');
    const url = extractFirstUrl(rawText) ?? (typeof body.url === 'string' ? body.url.trim() : '');
    if (!url) throw new ValidationError('未找到链接', { text: '请粘贴包含链接的内容' });

    const { createClip } = await import('@/core/clips/service');
    const { resolveVideoIdFromShareUrl, resolveDouyinVideo } = await import('@/server/integrations/rsshub/douyinAuthorResolver');
    const { enrichArticleWithTranscript } = await import('@/server/services/video/enrich');

    // 1) 抖音作品 → 浏览器解析作品元数据 + 作者
    const videoId = await resolveVideoIdFromShareUrl(url);
    if (videoId) {
      const info = await resolveDouyinVideo(videoId);
      if (info.success) {
        const title = (info.desc || `抖音作品 ${videoId}`).replace(/\s+/g, ' ').trim().slice(0, 80);
        const clip = await createClip(db as never, {
          userId: session.userId,
          title,
          contentText: info.desc || title,
          contentHtml: info.cover ? `<img src="${info.cover}" alt="" />` : undefined,
          sourceUrl: url,
          sourceTitle: title,
          imageUrls: info.cover ? [info.cover] : [],
        });

        // 后台提取视频文案 → 回填文章内容（供二创流水线使用），不阻塞响应
        if (!clip.alreadyExists) {
          void enrichArticleWithTranscript(db as never, {
            articleId: clip.articleId,
            userId: session.userId,
            videoUrl: `https://www.douyin.com/video/${videoId}`,
            videoTitle: title,
            provider: 'douyin',
          }).catch((err) => console.error('[clipboard/smart] 视频文案提取失败:', err));
        }

        json(res, 200, {
          ok: true,
          data: {
            articleId: clip.articleId,
            title,
            kind: 'douyin-video',
            cover: info.cover ?? null,
            transcriptPending: !clip.alreadyExists,
            alreadyExists: clip.alreadyExists,
            creator: info.secUid
              ? { rssHubUrl: `rsshub://douyin/user/${info.secUid}`, nickname: info.nickname ?? null, secUid: info.secUid }
              : null,
          },
        });
        return;
      }
      // 浏览器解析失败：继续走下面的通用流程（可能还能识别为订阅源）
    }

    // 2) 识别为订阅源（博主主页等）→ 返回 creator
    const { resolveRssHubSourceUrl } = await import('@/server/integrations/rsshub/sourceResolver');
    let resolved: Awaited<ReturnType<typeof resolveRssHubSourceUrl>> = { resolved: false, inputUrl: url };
    try {
      resolved = await resolveRssHubSourceUrl(url);
    } catch {
      // 忽略
    }
    const creator = resolved.resolved && resolved.rssHubUrl
      ? { rssHubUrl: resolved.rssHubUrl, nickname: resolved.title ?? null, secUid: null }
      : null;

    // 3) 抓网页正文
    let article: { title?: string; content?: string } | null = null;
    try {
      const { extract } = await import('@extractus/article-extractor');
      article = await extract(url);
    } catch {
      // 抓取失败，退回只存链接
    }

    if (article?.content) {
      const title = (article.title || resolved.title || url).slice(0, 80);
      const clip = await createClip(db as never, {
        userId: session.userId,
        title,
        contentText: article.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        contentHtml: article.content,
        sourceUrl: url,
        sourceTitle: article.title || null,
      });
      json(res, 200, { ok: true, data: { articleId: clip.articleId, title, kind: 'article', alreadyExists: clip.alreadyExists, creator } });
      return;
    }

    // 4) 博主主页等「无正文」链接：只返回 creator 供关注，不建空收藏
    if (creator) {
      json(res, 200, {
        ok: true,
        data: { articleId: null, title: creator.nickname ?? '订阅源', kind: 'creator', creator },
      });
      return;
    }

    // 5) 兜底：只存链接 + 文本
    const fallbackTitle = (resolved.title || rawText.trim() || url).replace(/\s+/g, ' ').slice(0, 80);
    const clip = await createClip(db as never, {
      userId: session.userId,
      title: fallbackTitle,
      contentText: rawText.trim() || url,
      sourceUrl: url,
      sourceTitle: resolved.title || null,
    });
    json(res, 200, { ok: true, data: { articleId: clip.articleId, title: fallbackTitle, kind: 'link', alreadyExists: clip.alreadyExists, creator } });
  }),

  // —— 视频文案提取（手动触发/重试；后台跑，立即返回）——
  route('POST', '/video/transcript', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req);
    const articleId = typeof body.articleId === 'number' ? String(body.articleId)
      : typeof body.articleId === 'string' ? body.articleId : '';
    const videoUrl = typeof body.url === 'string' ? body.url.trim() : '';
    if (!articleId || !videoUrl) {
      throw new ValidationError('缺少参数', { articleId: 'articleId 与 url 必填' });
    }

    const { enrichArticleWithTranscript } = await import('@/server/services/video/enrich');
    void enrichArticleWithTranscript(db as never, {
      articleId,
      userId: session.userId,
      videoUrl,
      videoTitle: typeof body.videoTitle === 'string' ? body.videoTitle : undefined,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
    }).catch((err) => console.error('[video/transcript] 文案提取失败:', err));

    json(res, 200, { ok: true, data: { started: true } });
  }),

  // —— 视频下载（yt-dlp → 存到 video_materials，供站内播放/剪辑）——
  route('POST', '/video/download', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req);
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const articleId = typeof body.articleId === 'number' ? String(body.articleId)
      : typeof body.articleId === 'string' ? body.articleId : '';
    if (!url) throw new ValidationError('缺少参数', { url: '必须提供有效的视频 URL' });

    const { downloadVideo } = await import('@/server/services/video/download');
    try {
      const result = await downloadVideo(url, articleId ? Number(articleId) : undefined, Number(session.userId));
      json(res, 200, {
        ok: true,
        data: {
          fileName: result.fileName,
          fileSize: result.fileSize,
          articleId: articleId || null,
        },
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/Fresh cookies|403|Forbidden/i.test(raw)) {
        throw new ValidationError('抖音 Cookie 已失效', { url: '请到「设置 → 授权与凭证」重新授权后再试' });
      }
      throw err;
    }
  }),

  // —— 站内播放本地已下载视频（支持 Range，供 <video> 拖动进度）——
  route('GET', '/video/serve/:articleId', async ({ req, res, params, session, db }) => {
    const id = requireId(params.articleId, '内容 ID');
    const { rows } = await db.query(
      `select video_file_path, video_file_name from video_materials where article_id = $1 and user_id = $2 limit 1`,
      [id, session.userId],
    );
    const row = rows[0] as unknown as { video_file_path: string | null; video_file_name: string | null } | undefined;
    const filePath = row?.video_file_path ?? null;
    if (!filePath || !existsSync(filePath)) throw new NotFoundError('视频文件不存在，请先下载');
    await streamLocalVideo(req, res, filePath, row?.video_file_name ?? null);
  }),

  // —— 产品计划（商业决策 MVP 规划）——
  // 注意：/product-plans/stats|scan|generate 须先于 /product-plans/:id 注册（:id 会命中单段路径）。
  route('GET', '/product-plans', async ({ res, query, session, db }) => {
    const statusParam = query.get('status')?.trim() || undefined
    if (statusParam && !isProductPlanStatus(statusParam)) {
      throw new ValidationError('status 取值非法', { status: '仅支持 idea/validating/building/launched/archived' })
    }
    const sourceParam = query.get('source')?.trim() || undefined
    if (sourceParam && !isProductPlanSourceType(sourceParam)) {
      throw new ValidationError('source 取值非法', { source: '仅支持 manual/ai_inferred' })
    }
    const offsetRaw = Number(query.get('offset') ?? 0)
    const result = await listProductPlans(db as never, {
      userId: session.userId,
      status: statusParam as ProductPlanStatus | undefined,
      sourceType: sourceParam as ProductPlanSourceType | undefined,
      keyword: query.get('keyword')?.trim() || undefined,
      limit: parsePositiveInt(query.get('limit')) ?? 50,
      offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0,
    })
    json(res, 200, { ok: true, data: result })
  }),
  route('GET', '/product-plans/stats', async ({ res, session, db }) => {
    json(res, 200, { ok: true, data: await getProductPlanStats(db as never, session.userId) })
  }),
  route('POST', '/product-plans', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const rawIdea = typeof body.rawIdea === 'string' ? body.rawIdea.trim() : ''
    if (!rawIdea) throw new ValidationError('请求参数非法', { rawIdea: '想法内容不能为空' })
    if (rawIdea.length > 20000) throw new ValidationError('请求参数非法', { rawIdea: '最长 20000 字符' })
    const aiConfig = await resolveProductPlanAiConfig(db as never, session.userId)
    const result = await createManualProductPlan(db as never, {
      userId: session.userId,
      rawIdea,
      note: typeof body.note === 'string' ? body.note : null,
      aiConfig,
    })
    json(res, 200, { ok: true, data: result })
  }),
  route('POST', '/product-plans/scan', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : 10
    const aiConfig = await resolveProductPlanAiConfig(db as never, session.userId)
    const result = await scanProductPlanCandidates(db as never, {
      userId: session.userId,
      limit,
      aiConfig,
    })
    json(res, 200, { ok: true, data: result })
  }),
  route('POST', '/product-plans/generate', async ({ req, res, session, db }) => {
    const body = await readJsonBody(req)
    const articleId = typeof body.articleId === 'string' || typeof body.articleId === 'number'
      ? String(body.articleId)
      : ''
    if (!/^\d+$/.test(articleId)) {
      throw new ValidationError('请求参数非法', { articleId: '必须为正整数' })
    }
    const aiConfig = await resolveProductPlanAiConfig(db as never, session.userId)
    const result = await createProductPlanFromArticle(db as never, {
      userId: session.userId,
      articleId,
      aiConfig,
    })
    if (!result) throw new NotFoundError('文章不存在或不属于当前用户')
    json(res, 200, { ok: true, data: result })
  }),
  // 补齐/重跑流水线（source→transcript→analysis→remix）；body.force=true 全部重跑
  route('POST', '/product-plans/:id/run', async ({ req, res, params, session, db }) => {
    const body = await readJsonBody(req)
    const aiConfig = await resolveProductPlanAiConfig(db as never, session.userId)
    const result = await runProductPlanPipeline(db as never, {
      userId: session.userId,
      planId: requireId(params.id, '产品计划 ID'),
      aiConfig,
      force: body.force === true,
    })
    if (!result) throw new NotFoundError('产品计划不存在')
    json(res, 200, { ok: true, data: result })
  }),
  route('GET', '/product-plans/:id', async ({ res, params, session, db }) => {
    const plan = await getProductPlan(db as never, requireId(params.id, '产品计划 ID'), session.userId)
    if (!plan) throw new NotFoundError('产品计划不存在')
    json(res, 200, { ok: true, data: { plan } })
  }),
  route('PUT', '/product-plans/:id', async ({ req, res, params, session, db }) => {
    const id = requireId(params.id, '产品计划 ID')
    const body = await readJsonBody(req)
    const patch: UpdateProductPlanPatch = {}
    const textFields = [
      'title', 'oneLiner', 'productDesc', 'targetUsers', 'approach',
      'businessModel', 'risks', 'competitors', 'pricing', 'milestones', 'validationPlan',
      'direction', 'remixIdeas',
    ] as const
    for (const field of textFields) {
      const value = body[field]
      if (typeof value === 'string') patch[field] = value
    }
    if (typeof body.status === 'string') {
      if (!isProductPlanStatus(body.status)) {
        throw new ValidationError('status 取值非法', { status: '仅支持 idea/validating/building/launched/archived' })
      }
      patch.status = body.status
    }
    const plan = await updateProductPlan(db as never, id, patch, session.userId)
    if (!plan) throw new NotFoundError('产品计划不存在')
    json(res, 200, { ok: true, data: { plan } })
  }),
  route('DELETE', '/product-plans/:id', async ({ res, params, session, db }) => {
    const deleted = await deleteProductPlan(db as never, requireId(params.id, '产品计划 ID'), session.userId)
    if (!deleted) throw new NotFoundError('产品计划不存在')
    json(res, 200, { ok: true, data: { deleted: true } })
  }),

  // —— 媒体文件服务（上传的图片/视频）——
  route('GET', '/media/*', async ({ res, params }) => {
    const { resolveMediaPath } = await import('@/server/infra/storage/localFileStore');
    const { createReadStream, stat } = await import('node:fs');
    const { promisify } = await import('node:util');

    const relPath = params['*'] ?? '';
    if (!relPath || relPath.includes('..')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: '文件不存在' } }));
      return;
    }

    const filePath = resolveMediaPath(`/s/app/media/${relPath}`);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: '文件不存在' } }));
      return;
    }

    try {
      const stats = await promisify(stat)(filePath);
      if (!stats.isFile()) throw new Error('not a file');

      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
      };
      const contentType = mimeMap[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'public, max-age=86400',
      });
      const stream = createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => { res.destroy(); });
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: '文件不存在' } }));
    }
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
/** 模块级 deps 快照：handleBusinessApi 每次调用刷新，供服务面板路由读取注入项。 */
let currentDeps: ApiDeps | null = null

export async function handleBusinessApi(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<boolean> {
  currentDeps = deps
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
        let authenticated = await deps.auth.authenticate(req)
        // DSH 壳里 cookie 进不来、<video>/<img> 等媒体标签又带不了 Authorization 头：
        // 媒体流路由允许 ?access_token= 携带会话令牌（webserver 仅本机回环伺服）。
        if (!authenticated && MEDIA_TOKEN_ROUTES.has(def.pattern)) {
          const mediaToken = url.searchParams.get('access_token')?.trim() ?? ''
          if (mediaToken) authenticated = await deps.auth.authenticateToken(mediaToken)
        }
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
      await def.handler({ req, res, params, query: url.searchParams, session, db: deps.db, pipelineKick: deps.pipelineKick })
    } catch (err) {
      sendError(res, err)
    }
    return true
  }
  return false
}

/** 自检用：已翻译的 API 清单（/s/api/health 与 H5 自检页展示）。 */
export const BUSINESS_API_LIST = ROUTES.map((r) => `${r.method} /s/api${r.pattern}`)

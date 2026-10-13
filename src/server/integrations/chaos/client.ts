/**
 * Chaos 平台网关（Superman C 端消费，对齐榜天下 app/lib/platform.server.ts 规范）。
 *
 * 中台规范（以榜天下为基准，它是最早的 C 端产品）：
 * - 单一网关函数 `platform()`，三种身份轴：
 *   open     → Bearer CONSUMER_API_KEY，读 /open/v1 开放数据面（feed/channels/rankings/materials）
 *   token    → Bearer <Chaos 用户会话>，/api/v1 用户交互（点赞/评论/我的记录——P3 接线）
 *   consumer → X-Consumer-Key + 用户 token 并用，/api/v1 产品内深读（多视角/历史，P3）
 * - 401 的未授权用户 GET 可降级为匿名重放（产品授权与写入不重放）；
 * - 形状深校验：响应字段不符抛 PlatformError（中文用户可读），C 端不排榜不修数；
 * - 12s 超时（可被调用方 signal 提前打断）、cache no-store、redirect: error；
 * - 环境变量对齐榜天下命名：PLATFORM_API_URL / CONSUMER_API_KEY
 *   （env 优先，回退 service_config 的 platform_api_url / consumer_api_key——设置页热改）。
 *
 * Superman 差异（允许的本地化）：网关异常在包装层被转成 ChaosResult 降级态——插件面板
 * 要求中台不可用时不阻塞本地功能（等价 OpenSkoob 的 status 分支渲染）；形状校验保持
 * 榜天下级别的严格度。不做二次评分/排序（排榜在中台）。
 */
import type { Queryable } from '@/plugin/host/db'

export class PlatformError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface PlatformConfig {
  apiUrl: string
  consumerKey: string
}

const DEFAULT_TIMEOUT_MS = 12_000

/** env 优先（榜天下同名变量），回退 service_config（设置页热改）。 */
export async function readPlatformConfig(db: Queryable | null): Promise<PlatformConfig | null> {
  let base = process.env.PLATFORM_API_URL?.trim()
  let key = process.env.CONSUMER_API_KEY?.trim()
  if ((!base || !key) && db) {
    try {
      const { rows } = await db.query(
        `select key, value from service_config where key in ('platform_api_url','consumer_api_key')`,
      )
      const map = Object.fromEntries(rows.map((r) => [r.key as string, r.value as string]))
      base = base || map.platform_api_url?.trim() || ''
      key = key || map.consumer_api_key?.trim() || ''
    } catch {
      // 配置读不到 = 未接入
    }
  }
  if (!base || !key) return null
  try {
    const origin = new URL(base)
    if (!['http:', 'https:'].includes(origin.protocol)) return null
  } catch {
    return null
  }
  return { apiUrl: base.replace(/\/$/, ''), consumerKey: key }
}

export interface PlatformOptions {
  /** Bearer CONSUMER_API_KEY（/open/v1 开放读）。 */
  open?: boolean
  /** Chaos 用户会话令牌（/api/v1 用户交互，P3 接线时传入）。 */
  token?: string
  /** 产品 Key + 用户 token 并用（/api/v1 产品内深读，P3）。 */
  consumer?: boolean
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** 401 的用户 GET 是否降为匿名重放（榜天下同款；默认允许）。 */
  anonymousFallback?: boolean
}

/** 单一平台网关（榜天下 platform() 同构）。失败抛 PlatformError。 */
export async function platform<T>(path: string, options: PlatformOptions = {}, db?: Queryable | null): Promise<T> {
  const config = await readPlatformConfig(db ?? null)
  const base = config?.apiUrl ?? process.env.PLATFORM_API_URL?.trim() ?? ''
  const productKey = config?.consumerKey ?? process.env.CONSUMER_API_KEY?.trim() ?? ''
  const token = options.open ? productKey : options.token
  if (!base || (options.open && !token)) throw new PlatformError(503, 'configuration', '数据中台尚未接入')
  const consumerKey = !options.open && (options.token || options.consumer) ? productKey : undefined
  if (!options.open && (options.token || options.consumer) && !consumerKey) {
    throw new PlatformError(503, 'configuration', '产品授权尚未接入')
  }
  const origin = new URL(base)
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || new URL(path, origin).origin !== origin.origin) {
    throw new PlatformError(503, 'configuration', '中台地址配置无效')
  }
  let response: Response
  try {
    response = await fetch(new URL(path, origin), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(consumerKey ? { 'X-Consumer-Key': consumerKey } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)])
        : AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
  } catch {
    throw new PlatformError(503, 'unavailable', '数据中台暂时不可用，请重试')
  }
  // 只有明确未授权的用户读请求可降为匿名；产品授权和写入不重放。
  if (
    response.status === 401 &&
    options.token &&
    !options.open &&
    options.anonymousFallback !== false &&
    (!options.method || options.method === 'GET')
  ) {
    return platform<T>(path, { ...options, token: undefined }, db)
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new PlatformError(502, 'invalid_response', '中台返回异常，请重试')
  }
  if (!response.ok) {
    const err = value as { message?: string; error?: { message?: string; code?: string } | string }
    throw new PlatformError(
      response.status,
      typeof err.error === 'object' ? err.error?.code ?? 'platform' : 'platform',
      (typeof err.error === 'object' ? err.error?.message : err.message) ?? '请求未完成，请重试',
    )
  }
  if (!value || typeof value !== 'object') throw new PlatformError(502, 'invalid_response', '中台返回异常，请重试')
  return value as T
}

// —— Superman 现役消费面（open 轴）：网关 + 降级包装（插件面板要求中台故障不阻塞本地功能）——

export type ChaosStatus = 'ready' | 'unconfigured' | 'unavailable' | 'missing' | 'forbidden'

export interface ChaosResult<T> {
  data: T | null
  status: ChaosStatus
  error?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

async function degrade<T>(db: Queryable | null, path: string, unwrap: (payload: unknown) => T): Promise<ChaosResult<T>> {
  const config = await readPlatformConfig(db ?? null)
  if (!config) return { data: null, status: 'unconfigured' }
  try {
    const payload = await platform<T>(path, { open: true }, db)
    return { data: unwrap(payload), status: 'ready' }
  } catch (error) {
    if (error instanceof PlatformError) {
      if (error.status === 404) return { data: null, status: 'missing' }
      if (error.status === 401 || error.status === 403) return { data: null, status: 'forbidden', error: error.message }
      return { data: null, status: 'unavailable', error: error.message }
    }
    return { data: null, status: 'unavailable', error: error instanceof Error ? error.message : String(error) }
  }
}

export interface ChaosChannel {
  key: string
  name: string
}

export interface ChaosMaterial {
  id: string
  title: string
  summary: string | null
  url: string | null
  publishedAt: string | null
  tags: string[]
}

export interface ChaosRankingEntry {
  rank: number
  entityId: string
  name: string
}

function toChannel(value: unknown): ChaosChannel | null {
  const r = asRecord(value)
  if (typeof r.key !== 'string' || !r.key) return null
  return { key: r.key, name: typeof r.name === 'string' ? r.name : r.key }
}

function toMaterial(value: unknown): ChaosMaterial | null {
  const r = asRecord(value)
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null
  return {
    id: r.id,
    title: r.title,
    summary: typeof r.summary === 'string' ? r.summary : null,
    url: typeof r.url === 'string' ? r.url : null,
    publishedAt: typeof r.publishedAt === 'string' ? r.publishedAt : null,
    tags: asArray(r.tags).filter((t): t is string => typeof t === 'string'),
  }
}

function toRankingEntry(value: unknown): ChaosRankingEntry | null {
  const r = asRecord(value)
  if (typeof r.entityId !== 'string' || typeof r.name !== 'string') return null
  const rank = Number(r.rank)
  return { rank: Number.isFinite(rank) ? rank : 0, entityId: r.entityId, name: r.name }
}

/** 产品已授权频道（菜单来自中台授权，过滤静态与个人频道——榜天下 channels() 同款）。路径均带 /open/v1 全前缀（网关不做拼接，榜天下同款）。 */
export async function readChaosChannels(db: Queryable | null): Promise<ChaosResult<ChaosChannel[]>> {
  return degrade(db, '/open/v1/channels', (payload) =>
    asArray(asRecord(payload).items)
      .map(toChannel)
      .filter((c): c is ChaosChannel => c !== null)
      .filter((c) => !c.key.startsWith('/me') && !c.key.startsWith('/following')))
}

/** 素材列表（游标分页轻量字段；正文走详情）。 */
export async function readChaosMaterials(
  db: Queryable | null,
  options: { limit?: number; before?: string; tag?: string } = {},
): Promise<ChaosResult<ChaosMaterial[]>> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20), junk: 'false' })
  if (options.before) query.set('before', options.before)
  if (options.tag) query.set('tag', options.tag)
  return degrade(db, `/open/v1/materials?${query}`, (payload) =>
    asArray(asRecord(payload).items)
      .map(toMaterial)
      .filter((m): m is ChaosMaterial => m !== null))
}

/** 榜单目录。 */
export async function readChaosRankings(
  db: Queryable | null,
  options: { entityType?: string; limit?: number } = {},
): Promise<ChaosResult<Array<Record<string, unknown>>>> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) })
  if (options.entityType) query.set('entityType', options.entityType)
  return degrade(db, `/open/v1/rankings?${query}`, (payload) => asArray(asRecord(payload).items).map(asRecord))
}

/** 榜单条目（按 slug；slug 白名单前置校验）。 */
export async function readChaosRankingEntries(
  db: Queryable | null,
  slug: string,
  options: { limit?: number } = {},
): Promise<ChaosResult<ChaosRankingEntry[]>> {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return { data: null, status: 'missing' }
  return degrade(db, `/open/v1/rankings/${encodeURIComponent(slug)}?limit=${options.limit ?? 20}`, (payload) =>
    asArray(asRecord(payload).items)
      .map(toRankingEntry)
      .filter((e): e is ChaosRankingEntry => e !== null))
}

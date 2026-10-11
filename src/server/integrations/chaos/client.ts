/**
 * Chaos 数据中台开放数据面客户端（对齐 OpenSkoob apps/web/src/lib/chaos.ts 的消费模式）。
 *
 * 中台 = hotspot-tracking-system（Chaos），开放接口 `/open/v1/*`，产品侧用
 * ConsumerApp API Key（Bearer）鉴权。Superman 已在中台注册为 C 端产品
 * （见 chaos-consumer-onboarding 文档 §2：注册了 Superman/DSH/APP/GitHub/商城）。
 *
 * 消费原则（沿 OpenSkoob 范式，勿改）：
 * - 每次请求现读远端（cache: no-store），保留上游撤销/私密权限的即时性；
 * - 超时 2.5s、redirect: error、校验 URL 形状——中台不可用时走本端降级路径，
 *   绝不阻塞插件主功能；
 * - 200ms 目标是中台读"已准备结果"的承诺，本端不做二次加工（评分/排序在中台）。
 * - 'server-only' 由 Next 端负责；本模块同时被插件（Node）使用，故不加该 import，
 *   由调用方保证不在浏览器 bundle 中引入。
 */
import type { Queryable } from '@/plugin/host/db'

/** 配置解析：env 优先（SUPERMAN_CHAOS_*），回退 service_config 表（设置页可改）。 */
export interface ChaosConfig {
  apiUrl: string
  apiKey: string
  productSlug: string
  defaultChannel: string
}

const DEFAULT_TIMEOUT_MS = 2_500

export function parseChaosConfigFromEnv(): ChaosConfig | null {
  const raw = process.env.SUPERMAN_CHAOS_API_URL?.trim()
  const apiKey = process.env.SUPERMAN_CHAOS_API_KEY?.trim()
  if (!raw || !apiKey) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return null
    }
  } catch {
    return null
  }
  return {
    apiUrl: raw.replace(/\/$/, ''),
    apiKey,
    productSlug: process.env.SUPERMAN_CHAOS_PRODUCT_SLUG?.trim() || 'superman',
    defaultChannel: process.env.SUPERMAN_CHAOS_DEFAULT_CHANNEL?.trim() || '/',
  }
}

export async function readChaosConfig(db: { query(text: string, params?: readonly unknown[]): Promise<{ rows: any[] }> }): Promise<ChaosConfig | null> {
  const fromEnv = parseChaosConfigFromEnv()
  if (fromEnv) return fromEnv
  try {
    const { rows } = await db.query(
      `select key, value from service_config where key in ('chaos_api_url','chaos_api_key','chaos_product_slug','chaos_default_channel')`,
    )
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    if (!map.chaos_api_url?.trim() || !map.chaos_api_key?.trim()) return null
    const url = new URL(map.chaos_api_url.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return {
      apiUrl: map.chaos_api_url.trim().replace(/\/$/, ''),
      apiKey: map.chaos_api_key.trim(),
      productSlug: map.chaos_product_slug?.trim() || 'superman',
      defaultChannel: map.chaos_default_channel?.trim() || '/',
    }
  } catch {
    return null
  }
}

export type ChaosStatus = 'ready' | 'unconfigured' | 'unavailable' | 'missing' | 'forbidden'

export interface ChaosResult<T> {
  data: T | null
  status: ChaosStatus
  error?: string
}

/** 单次开放接口读（与 OpenSkoob readChaos 同语义）。 */
export async function readChaos(config: ChaosConfig, path: string): Promise<unknown> {
  const base = config.apiUrl.endsWith('/open/v1') ? config.apiUrl : `${config.apiUrl}/open/v1`
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    redirect: 'error',
  })
  if (response.status === 404) throw new Error('missing')
  if (response.status === 401 || response.status === 403) throw new Error('forbidden')
  if (!response.ok) throw new Error('unavailable')
  return response.json()
}

async function call<T>(
  db: Queryable | null,
  path: string,
  unwrap: (payload: unknown) => T,
): Promise<ChaosResult<T>> {
  const config = db ? await readChaosConfig(db) : parseChaosConfigFromEnv()
  if (!config) return { data: null, status: 'unconfigured' }
  try {
    const payload = await readChaos(config, path)
    return { data: unwrap(payload), status: 'ready' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'missing' || message === 'forbidden') {
      return { data: null, status: message as ChaosStatus }
    }
    return { data: null, status: 'unavailable', error: message }
  }
}

// —— 开放接口的最小投影（形状防御：字段缺失落默认值，绝不让中台数据炸插件面板） ——

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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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

/** 产品已授权频道（菜单数据来自中台授权，不写死目录）。 */
export async function readChaosChannels(db: Queryable | null): Promise<ChaosResult<ChaosChannel[]>> {
  return call(db, '/channels', (payload) =>
    asArray(asRecord(payload).items).map(toChannel).filter((c): c is ChaosChannel => c !== null))
}

/** 素材列表（游标分页，轻量字段；正文走详情）。 */
export async function readChaosMaterials(
  db: Queryable | null,
  options: { limit?: number; before?: string; tag?: string } = {},
): Promise<ChaosResult<ChaosMaterial[]>> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20), junk: 'false' })
  if (options.before) query.set('before', options.before)
  if (options.tag) query.set('tag', options.tag)
  return call(db, `/materials?${query}`, (payload) =>
    asArray(asRecord(payload).items).map(toMaterial).filter((m): m is ChaosMaterial => m !== null))
}

/** 榜单目录（entryType 可选过滤）。 */
export async function readChaosRankings(
  db: Queryable | null,
  options: { entityType?: string; limit?: number } = {},
): Promise<ChaosResult<Array<Record<string, unknown>>>> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) })
  if (options.entityType) query.set('entityType', options.entityType)
  return call(db, `/rankings?${query}`, (payload) =>
    asArray(asRecord(payload).items).map(asRecord))
}

/** 榜单条目（按 slug）。 */
export async function readChaosRankingEntries(
  db: Queryable | null,
  slug: string,
  options: { limit?: number } = {},
): Promise<ChaosResult<ChaosRankingEntry[]>> {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return { data: null, status: 'missing' }
  return call(db, `/rankings/${encodeURIComponent(slug)}?limit=${options.limit ?? 20}`, (payload) =>
    asArray(asRecord(payload).items).map(toRankingEntry).filter((e): e is ChaosRankingEntry => e !== null))
}

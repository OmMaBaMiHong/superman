/**
 * Superman DSH 插件 · 中转站模型注入 DSH（P2e-6 relay 二期）。
 *
 * 用户在中转站授权登录后，把中转站注册为 DSH 宿主的一个模型 provider：
 * DSH 模型列表 / agent 会话里出现「中转站」路由（provider id = superman-relay），
 * 流式与工具调用由宿主自带的 DeepSeek 协议适配器承担（中转站是 OpenAI 兼容网关，
 * 协议同族）。注册走与宿主 llm-deepseek-account 同一条官方缝：
 * `@deepseek-ai/dsh-llm-deepseek` 的 registerDeepSeekProvider。
 *
 * 运行时：该包由 DSH 插件加载器的依赖树解析（~/.dsh/profiles/node_modules），
 * 构建期 external 不打包；解析失败（旧宿主）静默降级并写日志，插件其余功能不受影响。
 * 鉴权：每次请求现读最新一条中转站授权行——用户退出授权后路由立即失效，重新授权即恢复。
 */
import { getRelayRuntimeConfig, resolveRelayAiCredential, type RelayRuntimeConfig } from '@/core/relay/service'
import { listRelayModels, resolveRelayEndpoints, type RelayEndpointConfig } from '@/core/relay/client'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** relayLlm 注册状态（health 端点上报，用户无需看日志）。 */
export type RelayLlmState = 'registered' | 'import_failed' | 'failed' | 'pending'
let relayLlmState: RelayLlmState = 'pending'
let relayLlmError: string | null = null
export function getRelayLlmState(): { state: RelayLlmState; error: string | null } {
  return { state: relayLlmState, error: relayLlmError }
}

/**
 * 双解析路径：普通 ESM 解析（仓库真实路径）失败时，
 * 退到 DSH 运行时平面（~/.dsh/profiles/node_modules）直引。
 */
async function importDeepSeekLlm(): Promise<typeof import('@deepseek-ai/dsh-llm-deepseek')> {
  try {
    return await import('@deepseek-ai/dsh-llm-deepseek')
  } catch {
    const req = createRequire(pathToFileURL(join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'package.json')))
    return req('@deepseek-ai/dsh-llm-deepseek')
  }
}

/** cordis 插件上下文的运行时形状（真实宿主 ctx 的窄投影）。 */
interface RelayLlmContext {
  inject?(deps: string[], cb: (scope: never) => void): unknown
  logger?: { info?(msg: string): void; warn?(msg: unknown): void }
}

const RELAY_PROVIDER_ID = 'superman-relay'
/** 中转站未知模型的占位上下文窗（真实目录走 discoverModels 动态发现）。 */
const RELAY_MODEL_CONTEXT_WINDOW = 131_072

/** 最近一次读取到的端点快照（options() 是同步回调，端点由异步配置刷新进这里）。 */
let cachedEndpoints: RelayRuntimeConfig = { ...resolveRelayEndpoints(), defaultModel: process.env.RELAY_DEFAULT_MODEL?.trim() || 'deepseek-chat' }

export function registerRelayLlm(
  ctx: RelayLlmContext,
  deps: {
    getDb: () => unknown
    /** apply 捕获的 config.relay 快照（可含手填 apiKey / baseURL；未配置时为 null） */
    getRelayConnection: () => Record<string, unknown> | null
    getDefaultModel: () => string
  },
): void {
  if (typeof ctx.inject !== 'function') return

  getRelayConnectionSnapshot = deps.getRelayConnection
  getDbSnapshot = deps.getDb

  ctx.inject(['llm'], ((scope: unknown) => {
    relayLlmState = 'pending'
    void (async () => {
      let mod: typeof import('@deepseek-ai/dsh-llm-deepseek')
      try {
        mod = await importDeepSeekLlm()
      } catch (err) {
        relayLlmState = 'import_failed'
        relayLlmError = err instanceof Error ? err.message : String(err)
        ctx.logger?.warn?.(`[superman] 中转站模型注入不可用（宿主缺少 dsh-llm-deepseek，不影响其他功能）: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      try {
        const refresh = async () => {
          const db = deps.getDb()
          cachedEndpoints = await (async () => {
            if (!db) return { ...resolveRelayEndpoints(), defaultModel: deps.getDefaultModel() }
            const fromDb = await getRelayRuntimeConfig(db as never)
            const conn = (deps.getRelayConnection() ?? {}) as { baseURL?: string }
            return conn.baseURL ? { ...fromDb, llmBaseUrl: String(conn.baseURL).replace(/\/+$/, '') } : fromDb
          })()
          return cachedEndpoints
        }
        cachedEndpoints = await refresh()

        const options = mod.Config({
          baseURL: cachedEndpoints.llmBaseUrl,
          models: [
            { id: cachedEndpoints.defaultModel, name: cachedEndpoints.defaultModel, contextWindow: RELAY_MODEL_CONTEXT_WINDOW, inputModalities: ['text'] },
          ],
        })
        const resolved = mod.resolveAdapterOptions(mod.plainOptions(options))

        // 目录注册：让 DSH 的模型配置界面（设置 → 模型）能看到「中转站」这个 provider。
        // 与 registerDeepSeekProvider 成对使用（宿主 llm-deepseek-account 同款组合）。
        const llmSvc = (scope as { llm?: { registerConfigurableProviders?: (entries: unknown[]) => unknown } }).llm
        llmSvc?.registerConfigurableProviders?.([
          { provider: RELAY_PROVIDER_ID, displayName: '中转站 (Superman)', settingsNs: 'superman', settingsPath: ['relay'] },
        ])

        mod.registerDeepSeekProvider(scope, RELAY_PROVIDER_ID, {
          providerName: '中转站 (Superman)',
          options: () => resolved,
          resolveAuth: async () => {
            return { headers: { authorization: `Bearer ${await resolveRelayKey()}` } }
          },
          discoverModels: async (provider: string) => {
            const db = deps.getDb()
            if (!db) return []
            const endpoints = await refresh()
            let apiKey = ''
            try {
              apiKey = await resolveRelayKey()
            } catch {
              return [] // 未授权且无手填 Key：目录留空（模型列表不显示中转站模型）
            }
            const models = await listRelayModels(endpoints, apiKey)
            return models.map((m) => ({
              id: m.id,
              name: m.name ?? m.id,
              contextWindow: RELAY_MODEL_CONTEXT_WINDOW,
              inputModalities: ['text'],
            }))
          },
        })
        relayLlmState = 'registered'
        ctx.logger?.info?.(`[superman] 中转站已注册进 DSH 模型列表（provider: ${RELAY_PROVIDER_ID}）`)
      } catch (err) {
        relayLlmState = 'failed'
        relayLlmError = err instanceof Error ? err.message : String(err)
        ctx.logger?.warn?.(`[superman] 中转站模型注入失败（不影响其他功能）: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
  }) as never)
}

import { openRelayToken } from '@/core/relay/client'

/**
 * Key 解析链：①设置/patch 显式手填的 relay.apiKey（未授权用户也可用，来自 config.relay 快照）
 * → ②中转站授权登录自动关联的 Key（relay_auth 最新一条，桌面单用户形态）。
 */
async function resolveRelayKey(): Promise<string> {
  const manual = String((getRelayConnectionSnapshot() as { apiKey?: unknown } | null)?.apiKey ?? '').trim()
  if (manual) return manual
  const db = getDbSnapshot()
  if (!db) throw new Error('数据库未连接')
  await refresh()
  const cred = await resolveNewestRelayCredential(db as never)
  return cred.apiKey
}

/** 闭包外共享的取数函数位（registerRelayLlm 注入后赋值；保持实时读取 config.relay）。 */
let getRelayConnectionSnapshot: () => Record<string, unknown> | null = () => null
let getDbSnapshot: () => unknown = () => null

/** resolveAuth 无用户上下文：取最新授权行的凭据（桌面单用户形态）。 */
async function resolveNewestRelayCredential(db: Parameters<typeof openRelayToken>[0]) {
  const { rows } = await db.query<{ user_id: string }>(
    `select user_id from relay_auth where access_token_encrypted <> '' order by updated_at desc limit 1`,
  )
  const userId = rows[0]?.user_id
  if (!userId) throw new Error('尚未授权登录中转站')
  return resolveRelayAiCredential(db as never, userId)
}

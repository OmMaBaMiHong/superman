/**
 * Superman DSH 插件 · 中转站 ↔ DSH 模型体系桥（relay 二期）。
 *
 * 不自带适配器：中转站是 OpenAI 兼容网关，宿主自带的 dsh-llm-pi-ai 插件原生服务
 * 这类路由——它的 providers 配置字典就是模型页目录（设置 → 模型）的来源，编辑器
 * （地址 / Key / 协议 / 模型列表）与模型发现（GET {baseURL}/models）全部由宿主承担。
 * 本桥只做两件事：
 * ①启动时把 superman-relay 路由补写进 llm-pi-ai 的配置（只补缺失字段，不覆盖
 *   用户在模型页编辑器里的修改）；H5 侧改中转站地址时重跑一次，仅覆盖仍为预配值的字段。
 * ②中转站授权登录成功后把 Key 写进宿主凭据缝（SUPERMAN_RELAY_API_KEY）；
 *   用户在模型页手填的 Key 也落在同一个引用上——两条通道殊途同归，pi-ai 每次请求
 *   现场解析，改 Key 即时生效无需重启。
 *
 * 运行时依赖（settings / credentials 服务）经 cordis inject 注入，桌面 profile 缺
 * 任一服务时整条通道静默降级，插件其余功能不受影响。不静态 import @deepseek-ai/*。
 */
import { getRelayRuntimeConfig } from '@/core/relay/service'
import { resolveRelayEndpoints, type RelayEndpointConfig } from '@/core/relay/client'

/** 写进 llm-pi-ai 配置的路由名（= 模型页目录行 / 会话里的 provider id）。 */
const RELAY_ROUTE = 'superman-relay'
/** 路由 Key 的凭据引用：授权同步与模型页手填共用（deriveKeyRef 同名）。 */
const RELAY_KEY_REF = 'SUPERMAN_RELAY_API_KEY'
/** 预配模型的占位上下文窗（真实容量以模型页「同步模型列表」拉取为准）。 */
const FALLBACK_CONTEXT_WINDOW = 131_072

export type RelayBridgeProvisionState = 'pending' | 'done' | 'failed' | 'unavailable'

let provisionState: RelayBridgeProvisionState = 'pending'
let provisionError: string | null = null
let credentialLinked = false
/** 最近一次预配进路由的地址：H5 侧重跑预配时只覆盖仍等于该值的字段。 */
let lastProvisionedBaseURL: string | null = null

export function getRelayHostBridgeState(): {
  provision: RelayBridgeProvisionState
  error: string | null
  credentialLinked: boolean
} {
  return { provision: provisionState, error: provisionError, credentialLinked }
}

/** cordis 插件上下文的最小投影（真实宿主 ctx 的运行时形状）。 */
interface RelayBridgeContext {
  inject?(deps: string[], cb: (scope: never) => void): unknown
  logger?: { info?(msg: string): void; warn?(msg: unknown): void }
}

interface SettingsLike {
  describe?(): Array<{ ns?: string; value?: unknown }>
  mutate?(ns: string, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>): Promise<void>
}

interface CredentialsLike {
  set?(ref: string, value: string): Promise<void>
  unset?(ref: string): Promise<void>
}

export function registerRelayHostBridge(
  ctx: RelayBridgeContext,
  deps: { getDb: () => unknown },
): void {
  if (typeof ctx.inject !== 'function') return

  let settings: SettingsLike | null = null
  let credentials: CredentialsLike | null = null

  ctx.inject(['settings'], ((svc: unknown) => {
    settings = svc as SettingsLike
    void provisionRelayRoute({ settings, getDb: deps.getDb, log: ctx.logger }).catch(() => undefined)
  }) as never)

  ctx.inject(['credentials'], ((svc: unknown) => {
    credentials = svc as CredentialsLike
  }) as never)

  // 供 api.ts 中转站路由调用的同步/清除/重预配入口（服务未就绪时静默降级）。
  relayBridgeApi.syncKeyToHost = async (apiKey: string) => {
    if (!credentials?.set) return false
    await credentials.set(RELAY_KEY_REF, apiKey)
    credentialLinked = true
    return true
  }
  relayBridgeApi.clearHostKey = async () => {
    credentialLinked = false
    if (!credentials?.unset) return false
    await credentials.unset(RELAY_KEY_REF)
    return true
  }
  relayBridgeApi.reprovision = async () => {
    if (!settings) return false
    await provisionRelayRoute({ settings, getDb: deps.getDb, log: ctx.logger })
    return true
  }
}

/** api.ts（插件路由层）与桥之间的松耦合接口；registerRelayHostBridge 时装配。 */
export const relayBridgeApi: {
  syncKeyToHost(apiKey: string): Promise<boolean>
  clearHostKey(): Promise<boolean>
  reprovision(): Promise<boolean>
} = {
  syncKeyToHost: async () => false,
  clearHostKey: async () => false,
  reprovision: async () => false,
}

async function relayEndpoints(getDb: () => unknown): Promise<RelayEndpointConfig & { defaultModel: string }> {
  const db = getDb()
  const runtime = db ? await getRelayRuntimeConfig(db as never) : null
  const fallback = resolveRelayEndpoints()
  const defaultModel = process.env.RELAY_DEFAULT_MODEL?.trim() || 'deepseek-chat'
  return {
    ...fallback,
    ...runtime,
    defaultModel: runtime?.defaultModel?.trim() || defaultModel,
  }
}

/** 预配模型（models 列表非空是 pi-ai 承接自定路由的硬性要求；模型页可同步真实目录覆盖）。 */
function fallbackModels(defaultModel: string): Array<Record<string, unknown>> {
  const models = new Set<string>([defaultModel, 'deepseek-chat', 'deepseek-reasoner'])
  return [...models].map((id) => ({ id, name: id, contextWindow: FALLBACK_CONTEXT_WINDOW }))
}

async function provisionRelayRoute(io: {
  settings: SettingsLike
  getDb: () => unknown
  log?: { info?(msg: string): void; warn?(msg: unknown): void }
}): Promise<void> {
  const { settings, getDb, log } = io
  provisionState = 'pending'

  // llm-pi-ai 命名空间要等宿主插件树装载完成：每 2s 轮询，最多约 60s。
  let ns: { ns?: string; value?: unknown } | undefined
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const list = typeof settings.describe === 'function' ? settings.describe() : []
    ns = list.find((entry) => entry?.ns === 'llm-pi-ai')
    if (ns) break
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  if (!ns || typeof settings.mutate !== 'function') {
    provisionState = 'unavailable'
    log?.warn?.('[superman] 中转站预配跳过：宿主无 llm-pi-ai 配置面（不影响其他功能）')
    return
  }

  try {
    const endpoints = await relayEndpoints(getDb)
    const baseURL = endpoints.llmBaseUrl.replace(/\/+$/, '')
    const providers = (ns.value as { providers?: Record<string, unknown> } | undefined)?.providers ?? {}
    const existing = providers[RELAY_ROUTE] as Record<string, unknown> | undefined
    const ops: Array<{ op: 'set'; path: string[]; value: unknown }> = []

    if (!existing || typeof existing !== 'object') {
      // 首次预配：整段写入（地址默认预配，Key 走凭据引用，模型给可用兜底目录）。
      ops.push({
        op: 'set',
        path: ['providers', RELAY_ROUTE],
        value: {
          displayName: '中转站 (Superman)',
          api: 'openai-completions',
          baseURL,
          apiKeyEnv: RELAY_KEY_REF,
          models: fallbackModels(endpoints.defaultModel),
        },
      })
    } else {
      // 只补缺失字段；H5 侧重跑时仅覆盖仍为上次预配值的地址（尊重编辑器里的手改）。
      const fill = (key: string, value: unknown) => {
        if (existing[key] === undefined || existing[key] === null || existing[key] === '') {
          ops.push({ op: 'set', path: ['providers', RELAY_ROUTE, key], value })
        }
      }
      fill('displayName', '中转站 (Superman)')
      fill('api', 'openai-completions')
      fill('apiKeyEnv', RELAY_KEY_REF)
      const staleBase = lastProvisionedBaseURL !== null && existing.baseURL === lastProvisionedBaseURL
      if (existing.baseURL === undefined || existing.baseURL === '' || staleBase) {
        ops.push({ op: 'set', path: ['providers', RELAY_ROUTE, 'baseURL'], value: baseURL })
      }
      const models = existing.models
      if (!Array.isArray(models) || models.length === 0) {
        ops.push({ op: 'set', path: ['providers', RELAY_ROUTE, 'models'], value: fallbackModels(endpoints.defaultModel) })
      }
    }

    if (ops.length > 0) await settings.mutate('llm-pi-ai', ops)
    lastProvisionedBaseURL = baseURL
    provisionState = 'done'
    provisionError = null
    log?.info?.(`[superman] 中转站路由已预配进宿主模型配置（${RELAY_ROUTE} → ${baseURL}）`)
  } catch (err) {
    provisionState = 'failed'
    provisionError = err instanceof Error ? err.message : String(err)
    log?.warn?.(`[superman] 中转站路由预配失败（不影响其他功能）: ${provisionError}`)
  }
}

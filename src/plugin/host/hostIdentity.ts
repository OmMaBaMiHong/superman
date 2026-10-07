/**
 * Superman DSH 插件 · 宿主身份直通（免登录通道）。
 *
 * 桌面 DSH 客户端登录 DeepSeek 账号后，插件可在进程内读到账号身份
 * （cordis 服务 `deepseekAccount`），用它自动建号/绑定 users 表并签发
 * Superman 会话——「登上 DSH 即用，无登录注册」。浏览器/Web 宿主拿不到
 * 该服务，本通道自动降级为不可用，原口令登录不受影响。
 *
 * 层级纪律：本文件属于 plugin/host 层，允许感知 DSH；core 不 import 本文件，
 * core/auth/usersRepo 只提供不感知宿主的 ensureHostUser / findUserByDshAccount。
 *
 * 依赖纪律：不直接 import @deepseek-ai/dsh-deepseek-account（alpha、钉版本），
 * 按服务名 inject + 本地最小接口断言。宿主侧凭据接口（getPlatformSession /
 * resolveToken 等）刻意不声明——身份三件套之外不多要一个字节。
 */
import { bumpDshAccountSessions } from '@/core/auth/usersRepo'

/** 宿主账号服务暴露给消费方的最小形状（平台请求标注元数据见 getProfile 入参）。 */
interface DeepSeekAccountLike {
  getProfile(client: { version: string; locale: string; timezoneOffsetSeconds: number }): Promise<
    { status: 'ready'; value: { id: string | null; name: string | null } } | { status: 'failed' } | null
  >
  watch?(signal: AbortSignal): AsyncIterable<{ status: 'signed-out' | 'credential-stored' }>
}

export interface HostIdentity {
  /** DSH 侧稳定账号 ID（Platform current-user 端点颁发的 profile.id）。 */
  dshAccountId: string
  /** 展示昵称，可能为 null（只影响 username 观感，不影响绑定）。 */
  displayName: string | null
}

interface BridgeContext {
  inject(deps: string[], cb: (scope: never) => void): unknown
}

interface BridgeDeps {
  log?(msg: string): void
  warn?(msg: unknown): void
  /** 插件数据库句柄 getter（就绪前为 null；登出监听需要它作废会话）。 */
  getDb(): unknown
}

let account: DeepSeekAccountLike | null = null
/** 最近一次成功解析的账号 ID：登出事件到达时身份已不可读，只能靠它定位要作废谁。 */
let lastAccountId: string | null = null

/** 路由层取当前宿主身份；服务缺席 / 未登录 / 拿不到账号 ID 时返回 null。 */
export async function getHostIdentity(): Promise<HostIdentity | null> {
  if (!account) return null
  try {
    // AccountClientMetadata 三件套只用于平台请求标注，不参与鉴权。
    const profile = await account.getProfile({
      version: '0.4.0',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
    const value = profile?.status === 'ready' ? profile.value : null
    if (!value?.id) return null
    lastAccountId = value.id
    return { dshAccountId: value.id, displayName: value.name ?? null }
  } catch {
    return null
  }
}

/**
 * 注入宿主账号服务并启动登出监听：用户在 DSH 退出登录（credential-stored →
 * signed-out 跳变）时，立即作废其绑定的 Superman 用户全部会话。
 * 返回停止函数（中止 watcher），由入口的 dispose 统一调用。
 */
export function registerHostIdentityBridge(ctx: BridgeContext, deps: BridgeDeps): () => void {
  const abort = new AbortController()
  if (typeof ctx.inject !== 'function') return () => abort.abort()

  ctx.inject(['deepseekAccount'], ((scope: { deepseekAccount?: DeepSeekAccountLike }) => {
    account = scope.deepseekAccount ?? null
    if (!account) return
    deps.log?.('已接入 DSH 宿主账号服务（免登录通道可用）')
    if (typeof account.watch !== 'function') return

    let previous: string | null = null
    void (async () => {
      try {
        for await (const state of account.watch!(abort.signal)) {
          const status = state?.status ?? null
          // 只在「已登录 → 退出」跳变时打库，其余快照忽略。
          if (previous === 'credential-stored' && status === 'signed-out' && lastAccountId) {
            const db = deps.getDb() as { query: (text: string, params?: readonly unknown[]) => Promise<unknown> } | null
            if (db) {
              try {
                await bumpDshAccountSessions(db as never, lastAccountId)
                deps.log?.(`宿主账号 ${lastAccountId} 已退出登录，其 Superman 会话已全部作废`)
              } catch (err) {
                deps.warn?.(`[superman] 作废宿主账号会话失败: ${err instanceof Error ? err.message : String(err)}`)
              }
            }
            lastAccountId = null
          }
          previous = status
        }
      } catch {
        // watcher 断开即止：dispose / 宿主卸载，属正常生命周期。
      }
    })()
  }) as never)

  return () => abort.abort()
}

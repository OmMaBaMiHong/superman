/**
 * @deepseek-ai/dsh-llm-deepseek 的最小类型面（该包运行时由 DSH 宿主
 * node_modules 提供，构建期 external 不打包）。只声明中转站注册用到的表面，
 * 真实实现以运行时包为准。
 */
declare module '@deepseek-ai/dsh-llm-deepseek' {
  export interface DeepSeekCatalogModel {
    id: string
    name?: string
    contextWindow?: number
    inputModalities?: readonly string[]
    [key: string]: unknown
  }
  export interface DeepSeekRequestAuth {
    headers: Readonly<Record<string, string>>
    onRequestError?: (error: unknown) => Promise<unknown>
  }
  export const Config: (value?: unknown) => Record<string, unknown>
  export function plainOptions(config: unknown): Record<string, unknown>
  export function resolveAdapterOptions(options: Record<string, unknown>, environment?: unknown): Record<string, unknown>
  export function catalogModelInfo(provider: string, model: unknown): unknown
  export const DEFAULT_CONTEXT_WINDOW: number
  export const deepSeekConfigFields: Record<string, unknown>
  export function registerDeepSeekProvider(
    ctx: unknown,
    provider: string,
    deps: {
      options: () => unknown
      resolveAuth: (connection: unknown) => Promise<DeepSeekRequestAuth>
      providerName?: string
      discoverModels?: (provider: string) => Promise<unknown[]>
    },
  ): void
}

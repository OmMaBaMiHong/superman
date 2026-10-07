import { describe, expect, it } from 'vitest'
import { registerRelayHostBridge, relayBridgeApi, getRelayHostBridgeState } from '../../plugin/host/relayHostBridge'

describe('relayHostBridge 预配', () => {
  it('首次整段写入路由；二次只补缺失、不动用户手改', async () => {
    const calls: Array<{ ns: string; ops: unknown }> = []
    const seen = [
      [{ ns: 'llm-deepseek', value: {} }, { ns: 'llm-pi-ai', value: { providers: {} } }],
      [{ ns: 'llm-pi-ai', value: { providers: { 'superman-relay': { displayName: '已改名', baseURL: 'https://user-edited.example/v1', apiKeyEnv: 'SUPERMAN_RELAY_API_KEY', models: [{ id: 'x' }] } } } }],
    ]
    let round = 0
    const ctx = {
      inject: (deps: string[], cb: (s: never) => void) => {
        if (deps[0] === 'settings') cb({ describe: () => seen[round], mutate: async (ns: string, ops: unknown) => { calls.push({ ns, ops }) } } as never)
        if (deps[0] === 'credentials') cb({ set: async () => {}, unset: async () => {} } as never)
      },
      logger: { info: () => {}, warn: () => {} },
    }
    registerRelayHostBridge(ctx as never, { getDb: () => null })
    await new Promise((r) => setTimeout(r, 300))
    const first = calls[0]
    expect(first.ns).toBe('llm-pi-ai')
    const profile = (first.ops as Array<{ op: string; path: string[]; value: Record<string, unknown> }>).find((o) => o.path.length === 2)?.value
    expect(profile).toMatchObject({ displayName: '中转站 (Superman)', api: 'openai-completions', apiKeyEnv: 'SUPERMAN_RELAY_API_KEY' })
    expect(String(profile?.baseURL)).toMatch(/^https?:/)
    expect(Array.isArray(profile?.models) && (profile!.models as unknown[]).length > 0).toBe(true)

    // 第二轮：用户已手改 displayName/baseURL —— 不得覆盖；缺的 api 字段按设计补齐
    round = 1
    await relayBridgeApi.reprovision()
    expect(calls.length).toBe(2)
    const ops2 = calls[1].ops as Array<{ op: string; path: string[] }>
    expect(ops2.length).toBe(1)
    expect(ops2[0].path).toEqual(['providers', 'superman-relay', 'api'])
    expect(getRelayHostBridgeState().provision).toBe('done')
  })

  it('授权 Key 同步走凭据缝；清除走 unset', async () => {
    const ops: string[] = []
    const ctx = {
      inject: (deps: string[], cb: (s: never) => void) => {
        if (deps[0] === 'settings') cb({ describe: () => [], mutate: async () => {} } as never)
        if (deps[0] === 'credentials') cb({ set: async (ref: string) => { ops.push(`set:${ref}`) }, unset: async (ref: string) => { ops.push(`unset:${ref}`) } } as never)
      },
    }
    registerRelayHostBridge(ctx as never, { getDb: () => null })
    expect(await relayBridgeApi.syncKeyToHost('sk-test')).toBe(true)
    expect(await relayBridgeApi.clearHostKey()).toBe(true)
    expect(ops).toEqual(['set:SUPERMAN_RELAY_API_KEY', 'unset:SUPERMAN_RELAY_API_KEY'])
  })
})

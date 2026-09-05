/**
 * Superman DSH 插件 · agent 工具注册。
 *
 * K1 只注册一个连通性测试工具 superman.ping；K4 起在这里挂审批/驳回/
 * 发起流水线/触发抓取等领域工具（见 docs/plans/2026-09-05-dsh-kernel-topology.md）。
 */
import type { Queryable } from './db.js'
import { PLUGIN_NAME, type MinimalContext } from './routes.js'

export interface ToolsDeps {
  readonly db: Queryable | null
  pluginName?: string
}

interface ToolsScope {
  tools: {
    register(definition: Record<string, unknown>): () => void
  }
  effect(fn: () => () => void, reason?: string): unknown
}

/** 注册 superman.ping：返回 pong、当前时间与数据库连通状态。 */
export function registerTools(ctx: MinimalContext, deps: ToolsDeps): void {
  const tag = deps.pluginName ?? PLUGIN_NAME
  ctx.inject(['tools'], (scope: ToolsScope) => {
    scope.effect(
      () =>
        scope.tools.register({
          name: 'superman.ping',
          description:
            'Superman 插件连通性测试：返回 pong、服务端当前时间与 Postgres 连接状态。用于确认 DSH agent 能调到 Superman 插件。',
          parameters: { type: 'object', properties: {} },
          output: {
            schema: {
              type: 'object',
              properties: {
                pong: { type: 'boolean', description: '插件存活' },
                time: { type: 'string', description: '服务端 ISO 时间' },
                db: { type: 'boolean', description: 'Postgres 是否已连接' },
              },
              required: ['pong', 'time'],
            },
            render: (_args: unknown, value: { time?: string; db?: boolean }) => [
              { type: 'text', text: `superman pong @ ${value.time ?? '?'}（数据库：${value.db ? '已连接' : '未连接'}）` },
            ],
          },
          async execute() {
            return { pong: true, time: new Date().toISOString(), db: deps.db !== null }
          },
        }),
      `${tag}: tool superman.ping`,
    )
  })
}

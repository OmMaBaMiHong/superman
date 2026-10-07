/**
 * Superman 插件 cordis config schema（P2e-6 relay 二期）。
 *
 * 声明 Config 之后：①DSH 设置服务的命名空间镜像里出现 `superman`，
 * 模型设置页的目录条目（settingsNs = 'superman'）才会渲染；
 * ②`relay` 段承载中转站的 DeepSeek 协议连接配置（baseURL/模型目录等），
 * 与宿主 llm-deepseek-account 的 Config 同构（字段直接取 deepSeekConfigFields）。
 *
 * ⚠️ 本文件绝不允许对 @deepseek-ai/* 做静态 import——裸引用从插件真实路径
 * （仓库 node_modules 链）解析不到宿主包，会让整个插件加载失败（/s/api 全 404）。
 * 所以用「顶层 await + createRequire 锚定 DSH 运行时平面」解析；
 * 宿主缺包时退化为最小本地 schema，插件照常加载（模型页只是不显示中转站编辑器）。
 */
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/* eslint-disable @typescript-eslint/no-explicit-any */
function dshRequire(id: string): any {
  const anchor = createRequire(join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  return anchor(id)
}

// 顶层 await：Config 必须在模块求值期就绪（插件入口静态 re-export 它）
const z: any = dshRequire('@deepseek-ai/schemastery')
const dshLlm: any = dshRequire('@deepseek-ai/dsh-llm-deepseek')

const protocolFields: Record<string, unknown> =
  dshLlm?.deepSeekConfigFields ??
  // 宿主包缺失时的最小兜底段（仅保证 schema 可声明；正常环境不会走到）
  {
    baseURL: z.string(),
    models: z.array(z.object({ id: z.string(), name: z.string() })).required(false),
    maxTokens: z.number().required(false),
    defaultContextWindow: z.number().required(false),
    streamIdleTimeoutMs: z.number().required(false),
  }

export const Config = z.object({
  // —— Superman 自有字段（required(false) = 可缺省，缺省走 env/默认值）——
  databaseUrl: z.string().required(false),
  heartbeatIntervalMs: z.number().required(false),
  schedulerEnabled: z.boolean().required(false),
  keeperIntervalMs: z.number().required(false),
  projectRoot: z.string().required(false),
  trendradarIntervalMs: z.number().required(false),
  feedRefreshIntervalMs: z.number().required(false),
  pipelinePollIntervalMs: z.number().required(false),
  publishTrackingIntervalMs: z.number().required(false),
  commentIntelIntervalMs: z.number().required(false),
  knowledgeBackfillIntervalMs: z.number().required(false),
  productPlanScanIntervalMs: z.number().required(false),

  // —— 中转站（DeepSeek 协议段，模型设置页编辑器渲染这一段）——
  relay: z.object(protocolFields),
})

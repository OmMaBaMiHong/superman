/**
 * GitHub 仓库描述中文翻译（热点 GitHub tab 数据治理）。
 *
 * - 翻译是展示层增强：译文按「repo + 描述哈希」记在 SQLite 看板缓存里，命中直接回；
 *   未命中的由路由层在响应之后异步回填（fire-and-forget，在途去重 + 失败冷却），
 *   接口本身永不等翻译（200ms 纪律）。
 * - LLM 配置走全局解析：用户显式配置 → DSH 宿主模型兜底；都不可用就静默跳过，
 *   卡片继续显示英文原文，不影响主流程。
 */
import { createHash } from 'node:crypto'
import { readBoardSlices, writeBoardSlices } from '@/plugin/host/boardCache'
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo'
import { normalizePersistedSettings } from '@/features/settings/settingsSchema'
import { createOpenAIClient } from '@/server/integrations/ai/openaiClient'
import { isAiRuntimeConfigComplete, resolveSharedAiConfig, type AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig'

const CACHE_KEY = 'chaos_github_zh'
/** 单次 LLM 请求打包的行数；一次回填最多 MAX_BATCHES 批，防失控。 */
const BATCH_SIZE = 16
const MAX_BATCHES = 6
const FAILURE_COOLDOWN_MS = 5 * 60_000

export interface GhTranslationTarget {
  repo: string
  text: string
}

/** 译文缓存键：repo + 描述哈希（描述变了自动重译）。 */
export function ghZhKey(repo: string, text: string): string {
  return `${repo}#${createHash('sha1').update(text).digest('hex').slice(0, 10)}`
}

function loadZhMap(): Record<string, string> {
  const cached = readBoardSlices([CACHE_KEY])
  const payload = cached?.[CACHE_KEY]?.payload
  return payload && typeof payload === 'object' ? (payload as Record<string, string>) : {}
}

/** 把缓存的中文译文贴到仓库卡片上，返回仍缺译文的条目。 */
export function applyZhDescriptions<T extends { repo: string; description: string | null; descriptionZh: string | null }>(
  repos: T[],
): { items: T[]; pending: GhTranslationTarget[] } {
  const zhMap = loadZhMap()
  const pending: GhTranslationTarget[] = []
  const items = repos.map((repo) => {
    if (!repo.description) return repo
    const zh = zhMap[ghZhKey(repo.repo, repo.description)]
    if (typeof zh === 'string' && zh.trim()) return { ...repo, descriptionZh: zh }
    pending.push({ repo: repo.repo, text: repo.description })
    return repo
  })
  return { items, pending }
}

async function loadAiConfig(db: unknown, userId?: string): Promise<AiRuntimeConfig | null> {
  try {
    const uiSettings = normalizePersistedSettings(await getUiSettings(db as never, userId))
    const aiApiKey = await getAiApiKey(db as never, userId)
    return resolveSharedAiConfig({ settings: { ai: uiSettings.ai }, aiApiKey })
  } catch {
    return null
  }
}

function parseNumberedZh(reply: string, expected: number): string[] {
  const out = new Array<string>(expected).fill('')
  for (const line of reply.split('\n')) {
    const match = /^\s*(\d+)\s*\|\s*(.+)$/.exec(line.trim())
    if (!match) continue
    const index = Number(match[1]) - 1
    if (index >= 0 && index < expected) out[index] = match[2].trim()
  }
  return out
}

async function translateBatch(
  client: ReturnType<typeof createOpenAIClient>,
  model: string,
  batch: GhTranslationTarget[],
): Promise<string[]> {
  const listing = batch.map((t, i) => `${i + 1}|${t.text.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          '你是技术文档翻译。用户给出编号行（格式 `N|英文`），把每行英文翻译成简体中文，按原格式 `N|中文` 逐行输出全部行，不要增删行、不要解释。项目名、命令、专有技术名词保留英文。',
      },
      { role: 'user', content: listing },
    ],
  })
  const content = completion.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : '';
  if (!text.trim()) throw new Error('Invalid translation response: empty content')
  return parseNumberedZh(text, batch.length)
}

let inFlight = false
let lastFailureAt = 0

/** 回填运行状态（写入看板缓存，sqlite3 可直接读——翻译是静默后台任务，必须自带可观测性）。 */
interface GhTranslationStatus {
  lastAttemptAt?: string
  lastFinishedAt?: string
  translatedTotal?: number
  lastError?: string
}

function writeStatus(patch: GhTranslationStatus): void {
  const cached = readBoardSlices([`${CACHE_KEY}_status`])
  const current = (cached?.[`${CACHE_KEY}_status`]?.payload ?? {}) as GhTranslationStatus
  writeBoardSlices({ [`${CACHE_KEY}_status`]: { ...current, ...patch } })
}

async function runBackfill(db: unknown, userId: string | undefined, targets: GhTranslationTarget[]): Promise<number> {
  writeStatus({ lastAttemptAt: new Date().toISOString() })
  const config = await loadAiConfig(db, userId)
  if (!config || !isAiRuntimeConfigComplete(config)) {
    lastFailureAt = Date.now()
    writeStatus({ lastFinishedAt: new Date().toISOString(), lastError: 'AI 配置不可用（未显式配置且 DSH 模型桥未注册）' })
    return 0
  }
  const client = createOpenAIClient({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    source: 'server/chaos/githubTranslate',
    requestLabel: 'GitHub 描述中文翻译回填',
  })
  const zhMap = loadZhMap()
  let translated = 0
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE)
    try {
      const results = await translateBatch(client, config.model, batch)
      results.forEach((zh, index) => {
        if (!zh) return
        zhMap[ghZhKey(batch[index]!.repo, batch[index]!.text)] = zh
        translated += 1
      })
      // 每批落一次盘：中断也已译部分可用
      writeBoardSlices({ [CACHE_KEY]: zhMap })
    } catch (error) {
      lastFailureAt = Date.now()
      writeStatus({
        lastFinishedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
        translatedTotal: translated,
      })
      break
    }
  }
  writeStatus({ lastFinishedAt: new Date().toISOString(), translatedTotal: translated, ...(translated > 0 ? { lastError: undefined } : {}) })
  return translated
}

/**
 * 响应后异步回填缺失译文；返回本次受理的条数（0 = 未受理：在途/冷却/无缺项）。
 * 永不抛错、永不阻塞调用方。
 */
export function scheduleGhTranslation(db: unknown, userId: string | undefined, targets: GhTranslationTarget[]): number {
  if (inFlight || targets.length === 0) return 0
  if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) return 0
  const bounded = targets.slice(0, BATCH_SIZE * MAX_BATCHES)
  inFlight = true
  void runBackfill(db, userId, bounded)
    .catch((error) => {
      lastFailureAt = Date.now()
      writeStatus({
        lastFinishedAt: new Date().toISOString(),
        lastError: `backfill crashed: ${error instanceof Error ? error.message : String(error)}`,
      })
    })
    .finally(() => {
      inFlight = false
    })
  return bounded.length
}

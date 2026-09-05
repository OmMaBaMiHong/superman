/**
 * feedfuse-workbench host 半（自包含）。
 *
 * 相比于 v0.1.0（HTTP 代理到本地 FeedFuse 9559），本版本把全部能力内联进
 * DSH 进程：RSS 抓取/解析/存储由 rss-store.js 负责，视频下载/文案提取由
 * video.js 负责，抖音等平台博主源的作品抓取由 douyin-browser.js 负责，
 * 均通过 node 原生能力 + 系统可执行文件（yt-dlp/ffmpeg/whisper）+ 本机浏览器，
 * 不依赖任何外部常驻服务。数据落在 config.dataDir（默认 ./feedfuse-data）。
 *
 * 承载的链路：订阅博主（平台源或普通 RSS）→ 作品/文章列表 → 详情播放 →
 * 文案提取（yt-dlp 字幕优先、Whisper 回退，抖音需浏览器 Cookie）→
 * AI 语义分析（类型标签 + 爆款评分，走 ctx.llm 一次性调用）→ 加工台队列。
 *
 * /feedfuse/* HTTP 路由契约与 v0.1.0 兼容，新增端点见 README。
 */
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { createRssModule } from './rss-store.js'
import { createMediaModule } from './media-store.js'
import { downloadVideo, extractTranscript, binariesStatus } from './video.js'
import { defaultProfileDir, exportCookieFile, findBrowser, openSession } from './douyin-browser.js'
import { createKnowledgeStore, initKnowledgeStore } from './knowledge-store.js'
import { createStrategiesEngine } from './strategies.js'
import { createScheduler } from './scheduler.js'

export const name = 'feedfuse-workbench'
export const inject = ['shell']

const NAME = 'feedfuse-workbench'

/**
 * FeedFuse 插件的设置命名空间。Client 半设置卡片以它为 key 配对；卡片编辑的字段
 * 与 cordis.yml `config` 同源，保存后写入用户设置文档，可被本插件热读取并重建数据层。
 */
const FEEDFUSE_NS = settingsNamespace('feedfuse')

/** 用户可在设置卡片编辑的配置子集（schemastery schema，缺省与 cordis.yml config 一致）。 */
const FeedfuseSettingsSchema = z.object({
  // 存储：内置 SQLite 库文件名（相对 dataDir，库文件位于 dataDir/dbFilePath）
  dbFilePath: z.string().default('feedfuse.sqlite'),
  // RSS 抓取参数
  rssUserAgent: z.string().default('FeedFuse/1.0'),
  rssTimeoutMs: z.number().default(10000),
  fetchIntervalMinutes: z.number().min(1).default(30),
  // 数据目录与资产
  dataDir: z.string().default('feedfuse-data'),
  autoInstallAssets: z.boolean().default(true),
  // PostgreSQL 连接（可选，配置后启用知识库：策略分析 + 定时任务 + pgvector 语义搜索）
  databaseUrl: z.string(),
  // 自媒体（抖音）配置 —— rsshubBase + douyinUid 与 douyinFeedUrl 二选一
  douyinUid: z.string(),
  rsshubBase: z.string().default('https://rsshub.app'),
  douyinFeedUrl: z.string(),
  // 抖音取数来源：auto 优先用插件内建的浏览器抓取，其次 RSSHub；可显式锁定
  // （取值 auto / browser / rsshub，非法值按 auto 处理）
  douyinSource: z.string().default('auto'),
  // 登录态来源之一：浏览器复制的抖音 Cookie（留空则用插件 profile 的扫码登录态）
  douyinCookie: z.string(),
  // Chrome/Chromium 路径覆盖（缺省自动探测本机浏览器与 playwright 缓存）
  chromePath: z.string(),
  // 单次抓取的作品数上限
  douyinMaxWorks: z.number().min(1).max(500).default(100),
  // AI 语义分析（加工台的标签与评分）走宿主模型的单次调用；
  // 留空则跟随用户的默认模型（agentDefaultModel）。
  analyzeProvider: z.string(),
  analyzeModel: z.string(),
  analyzeMaxTokens: z.number().min(256).max(4096).default(1024),
  // 工具路径（可覆盖自动探测结果）
  ytDlpPath: z.string(),
  ffmpegPath: z.string(),
  ffprobePath: z.string(),
  whisperPath: z.string(),
  // 已有本地 GGML 模型时直接指路径，跳过下载
  whisperModelPath: z.string(),
  // 缺省自动下载；huggingface.co 不可达时会先试同名 hf-mirror 镜像
  whisperModelUrl: z.string(),
})

/** 「视频 → 下载/提取/改写/口播」工作流技能正文。 */
const SKILL_CONTENT = `# FeedFuse 视频工作流

当用户要求「下载视频 / 提取文案 / 改写文案 / 生成口播脚本」时，按下面流程执行。

## 可用工具
- feedfuse_extract_transcript：提取视频文案（优先字幕，否则语音识别）
- feedfuse_download_video：下载视频到本地工作区

## 流程
1. 提取文案：调用 feedfuse_extract_transcript（传入视频链接），拿到原文案。
2. 下载视频：当用户需要本地素材或后续去剪辑时，调用 feedfuse_download_video。
3. 改写文案：把原文案改写成适合口播的版本——口语化、有节奏、去掉书面语与冗余、保留核心信息点和情绪。
4. 生成口播脚本：按下面的口播模板输出最终脚本。

## 口播模板
- 【钩子】前 3 秒抓住注意力：一个反常识结论、一个提问、或一个痛点场景。
- 【主体】2-3 个要点，每点一个信息 + 一句解释/例子，短句、口语化。
- 【结尾】一句总结 + 行动号召（关注/点赞/评论）。

## 输出格式
1. 改写后的文案（口语化正文）
2. 口播脚本（带【钩子】【主体】【结尾】标注）
`

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(data.length) })
  res.end(data)
}

/** 从当前 config 组装视频/工具子配置。 */
function buildToolCfg(config) {
  return {
    dataDir: config.dataDir || 'feedfuse-data',
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    whisperPath: config.whisperPath,
    whisperModelPath: config.whisperModelPath,
    whisperModelUrl: config.whisperModelUrl,
    autoInstallAssets: config.autoInstallAssets,
  }
}

/** 读取 POST body 为 JSON（失败返回 {}）。 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

export function apply(ctx, config = {}) {
  // 配置源：入口 config 在首次启动时使用；设置卡片保存后指向用户文档快照。
  let configSource = () => config
  const currentConfig = () => configSource() || {}

  // 将 DATABASE_URL 注入环境变量（知识库连接用）。
  const cfg0 = currentConfig()
  if (cfg0.databaseUrl && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = cfg0.databaseUrl
  }

  let rss = createRssModule(currentConfig())
  let media = createMediaModule(currentConfig())
  let cfg = buildToolCfg(currentConfig())

  // 设置卡片保存后重建数据层与工具配置，使新配置立即生效（无需重启）。
  installSettingsSection(ctx, FEEDFUSE_NS, FeedfuseSettingsSchema, config, {
    validate: () => {
      // 抖音字段为可选：首次运行可不配置，稍后在设置卡片中补齐。
      // 注册期的 validate 对缺失值抛错会令整个 settings namespace 注册失败，
      // 并在设置页表现为主界面遮罩报错，故不在注册期做强制交叉校验。
    },
    setSource: (current) => { configSource = current },
    onChange: () => {
      const newCfg = currentConfig()
      if (newCfg.databaseUrl && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = newCfg.databaseUrl
      }
      rss = createRssModule(newCfg)
      media = createMediaModule(newCfg)
      cfg = buildToolCfg(newCfg)
    },
  })

  // —— 加工台服务端：浏览器 Cookie 供给 + AI 语义分析 ——

  // 宿主模型服务按可用性注入（未就绪时分析端点明确报错，不影响其它功能）。
  let llmScope = null
  ctx.inject(['llm'], (scope) => { llmScope = scope })

  /**
   * 导出（或复用一小时内导出的）插件浏览器 profile 的抖音 Cookie，
   * 供 yt-dlp `--cookies` 使用：抖音的字幕轨与音频轨在无 Cookie 时一律取不到。
   * @returns {Promise<string|null>} cookies.txt 路径，无浏览器或无 Cookie 时 null。
   */
  async function ensureCookieFile() {
    const c = currentConfig()
    const dataDir = c.dataDir || 'feedfuse-data'
    const browser = findBrowser(c)
    if (!browser) return null
    const file = join(dataDir, 'cookies', 'douyin.txt')
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 3600_000) return file
    mkdirSync(join(dataDir, 'cookies'), { recursive: true })
    const r = await exportCookieFile({ chromePath: browser, profileDir: defaultProfileDir(dataDir), outFile: file })
    if (r.ok) return file
    return existsSync(file) ? file : null
  }

  /** 给下载/文案工具的配置挂上 Cookie 文件（拿不到则原样返回）。 */
  async function toolConfig() {
    const cookieFile = await ensureCookieFile()
    return cookieFile ? { ...cfg, cookieFile } : cfg
  }

  /**
   * 用浏览器取一个视频的可播直链（解决 CDN URL 过期问题）。
   * 导航到视频详情页，拦截 network 拿到新的 play_addr。
   * @param {string} awemeId - 抖音视频 ID。
   * @returns {Promise<string|null>} 新的可播直链或 null。
   */
  async function fetchFreshVideoUrl(awemeId) {
    const c = currentConfig()
    const browser = findBrowser(c)
    if (!browser) return null
    const profileDir = defaultProfileDir(c.dataDir || 'feedfuse-data')
    let session
    try {
      session = await openSession({ chromePath: browser, profileDir, headless: true })
    } catch (e) {
      console.error(`[feedfuse-workbench] 启动浏览器失败: ${e.message}`)
      return null
    }
    let freshUrl = null
    try {
      // 拦截 network response，找 play_addr / playurl / mp4
      session.onEvent((msg) => {
        if (msg.method === 'Network.responseReceived') {
          const url = msg.params?.response?.url || ''
          if (url.includes('play_addr') || url.includes('playurl') || (url.includes('.mp4') && url.includes('douyin'))) {
            if (!freshUrl) freshUrl = url
          }
        }
      })
      await session.send('Page.navigate', { url: `https://www.douyin.com/video/${awemeId}` })
      // 等待页面加载 + 视频资源请求
      await new Promise((r) => setTimeout(r, 8000))
      // 也尝试从 video 元素拿 src
      try {
        const { root } = await session.send('DOM.getDocument', { depth: -1 })
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'video' })
        if (nodeId) {
          const { outerHTML } = await session.send('DOM.getOuterHTML', { nodeId })
          const srcMatch = /src="(https?:\/\/[^"]+\.mp4[^"]*)"/.exec(outerHTML)
          if (srcMatch) freshUrl = srcMatch[1]
        }
      } catch { /* 忽略 */ }
    } catch (e) {
      console.error(`[feedfuse-workbench] 刷新视频 URL 失败 (${awemeId}):`, e.message)
    } finally {
      session.close()
    }
    return freshUrl
  }

  // —— PostgreSQL 知识库 + 策略引擎 + 调度器 ——

  /** PostgreSQL 知识库存储句柄（DATABASE_URL 未配置时为 null）。 */
  let knowledgeStore = null
  /** 策略引擎句柄。 */
  let strategiesEngine = null
  /** 调度器句柄。 */
  let scheduler = null
  /** 是否使用 PostgreSQL 后端。 */
  let usingPostgres = false

  // 异步初始化 PostgreSQL 知识库（不阻塞启动）。
  initKnowledgeStore().then(async (ok) => {
    if (!ok) {
      console.log('[feedfuse-workbench] DATABASE_URL 未配置，使用 SQLite 后端')
      return
    }
    knowledgeStore = await createKnowledgeStore()
    usingPostgres = true
    console.log('[feedfuse-workbench] PostgreSQL 知识库已连接')

    // 创建策略引擎
    strategiesEngine = createStrategiesEngine({
      knowledgeStore,
      llmScope,
      config: currentConfig(),
      ctx,
    })

    // 创建调度器
    scheduler = createScheduler({
      knowledgeStore,
      strategiesEngine,
      rssModule: rss,
      videoModule: media,
      config: currentConfig(),
      transcriptFn: async (url, title) => {
        const tc = await toolConfig()
        return extractTranscript(tc, url, title)
      },
    })

    // 启动调度器
    scheduler.start()
  })

  /** 分析提示词：输出多维度结构化标签 JSON（方向/用途/钩子/价值 + 基础维度）。 */
  const ANALYZE_SYSTEM = `你是短视频内容分析师。对给定的短视频（标题 + 文案 + 平台数据）做多维度结构化分析，只输出一个 JSON 对象，不要任何解释文字或 Markdown 代码块。

JSON 字段：
- category: 内容类型，从「赚钱分析/商业拆解、知识分享/技能教学、热点评论/时事解读、情绪共鸣/励志鸡汤、生活记录/Vlog、产品种草/带货测评、资讯播报、其他」中选一个
- tags: 3-6 个内容标签（字符串数组，具体到话题，如"副业项目"、"AI工具"、"留学"）
- sentiment: "positive" | "neutral" | "negative"
- priority: 1-5 整数，对用户二次创作的参考价值（5=值得立刻跟进改编）
- score: 0-100 整数，爆款潜力评分（钩子强度、信息密度、情绪曲线、可复制性综合判断）
- hook: 该视频开头 3 秒的钩子手法（一句话）
- reason: 打分理由（两句话内）
- rewrite: 若值得二次创作，给一个改编角度（否则空字符串）
// 以下为多维度结构化标签（供二次创作与检索复用）：
- structured: 对象，含以下字段：
  - direction: 内容方向，从「赚钱搞钱、知识学习、娱乐消遣、情绪价值、生活实用、技术工具、时事热点、其他」中选一个
  - topics: 2-4 个具体话题标签（字符串数组，如"副业项目"、"AI成本"、"向量数据库"）
  - use_cases: 该内容可用的二次创作形态（字符串数组，从「口播脚本、分镜短剧、图文笔记、混剪素材、知识卡片、标题党、漫剧」中选）
  - value_to_me: 一句话说明这条内容对创作者自己的价值（如"了解AI成本结构、指导技术选型避坑"）
  - audience: 目标受众一句话（如"AI开发者、独立开发者"）
  - one_liner: 用一句话概括这条视频讲了什么（20字内）`

  /** 从模型输出里取出第一个 JSON 对象（容忍包裹的多余文字）。 */
  function extractJson(text) {
    const start = String(text || '').indexOf('{')
    const end = String(text || '').lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try { return JSON.parse(String(text).slice(start, end + 1)) } catch { return null }
  }

  /**
   * 分析用的模型路由：显式配置优先，否则跟随宿主默认模型（agentDefaultModel）。
   * @param {object} c - 当前配置。
   * @returns {{provider: string, model: string}} provider 路由与模型 id。
   */
  function resolveAnalyzeRoute(c) {
    const provider = String(c.analyzeProvider || '').trim()
    const model = String(c.analyzeModel || '').trim()
    if (provider && model) return { provider, model }
    const defaults = ctx.get('agentDefaultModel')
    const current = defaults && typeof defaults.currentSelection === 'function' ? defaults.currentSelection() : null
    if (current && current.provider && current.model) {
      return { provider: provider || current.provider, model: model || current.model }
    }
    throw new Error('未确定分析模型：在设置里填 analyzeProvider / analyzeModel，或先在应用里设置默认模型')
  }

  /**
   * 对一条作品/文章做一次 AI 语义分析并写回标签与评分。
   * @param {object} a - 文章 dto（含 transcript / summary / stats）。
   * @returns {Promise<object>} 写回的字段。
   */
  async function analyzeArticle(a) {
    if (!llmScope) throw new Error('宿主模型服务未就绪，无法进行 AI 分析')
    const c = currentConfig()
    const route = resolveAnalyzeRoute(c)
    const body = String(a.transcript || a.summary || a.title || '').slice(0, 6000)
    const stats = a.stats
      ? `点赞 ${a.stats.likes}／评论 ${a.stats.comments}／分享 ${a.stats.shares}／收藏 ${a.stats.collects}`
      : '无统计数据'
    const messages = [createUserMessage({
      content: [{ type: 'text', text: `标题：${a.title}\n作者：${a.author || '未知'}\n数据：${stats}\n文案：\n${body}` }],
      source: { kind: 'plugin', plugin: 'feedfuse-workbench' },
    })]
    const assembler = new BlockAssembler()
    for await (const chunk of llmScope.llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      system: ANALYZE_SYSTEM,
      maxTokens: Number(c.analyzeMaxTokens) || 1024,
    })) assembler.push(chunk)
    const out = assembler.blocks()
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const parsed = extractJson(out)
    if (!parsed) {
      const finish = assembler.finish
      const detail = finish && finish.failure ? JSON.stringify(finish.failure).slice(0, 300) : ''
      throw new Error(`模型调用未产出文本（${finish?.kind || '未知终止'}）${detail ? '：' + detail : ''}${out ? '｜输出：' + String(out).slice(0, 160) : ''}`)
    }
    const st = parsed.structured || {}
    const structured_tags = {
      direction: st.direction || '',
      topics: Array.isArray(st.topics) ? st.topics : [],
      use_cases: Array.isArray(st.use_cases) ? st.use_cases : [],
      value_to_me: st.value_to_me || '',
      audience: st.audience || '',
      one_liner: st.one_liner || '',
    }
    const patch = {
      category: parsed.category || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      sentiment: parsed.sentiment || 'neutral',
      priority: Math.max(1, Math.min(5, Number(parsed.priority) || 3)),
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      note: `${parsed.hook ? `钩子：${parsed.hook}｜` : ''}${parsed.reason || ''}`,
      structured_tags,
    }
    rss.updateArticle(a.id, patch)
    return { ...patch, structured_tags }
  }

  // —— 二创工作区：多形态内容改写（口播/分镜/短剧/图文/标题），按版本保存 ——

  /** 二创提示词：依据原文案 + 目标形态 + 参数，输出对应内容。 */
  const REMIX_SYSTEM = `你是短视频二次创作专家。基于用户提供的原文案（可能是视频字幕或摘要），按指定的内容形态与参数，改写出可直接使用的成品内容。只输出正文，不要任何解释、Markdown 代码块标记或额外提示。

要求：
- 严格贴合原文的信息与观点，不虚构事实、不新增原文没有的数据。
- 口吻、篇幅严格按用户参数执行。
- 标题要抓人；口播要顺口、有节奏、有钩子；分镜要有画面描述；短剧要有冲突；图文要有分段小标题。`

  // 二创形态 → 用户提示模板片段
  const REMIX_SPECS = {
    oral: { label: '口播脚本', user: '请把原文案改写成一段口播脚本。要求：开头 3 秒有钩子，语速自然、口语化，结尾有行动号召。' },
    storyboard: { label: '分镜表', user: '请把原文案拆解成分镜脚本。逐行输出「镜头 / 画面描述 / 台词 / 时长秒数」，用分隔行排版。' },
    drama: { label: '短剧脚本', user: '请把原文案改写成一段短剧脚本。包含场景、人物对话、冲突与反转，适合 30-60 秒演绎。' },
    post: { label: '图文笔记', user: '请把原文案改写成一篇图文笔记。加 3-5 个分段小标题，语气接地气，适合小红书/公众号排版。' },
    title: { label: '标题', user: '请基于原文案生成 8 个高点击率的标题，每行一个，风格覆盖悬念、数字、对立、共鸣。' },
  }

  /** 版本存储：<dataDir>/remixes.json，结构 { [articleId]: [ {id, contentType, params, text, createdAt} ] }。 */
  function remixesFile() {
    const c = currentConfig()
    return join(c.dataDir || 'feedfuse-data', 'remixes.json')
  }
  function loadRemixes() {
    try { return JSON.parse(readFileSync(remixesFile(), 'utf8')) } catch { return {} }
  }
  function saveRemixes(map) {
    try { mkdirSync(dirname(remixesFile()), { recursive: true }); writeFileSync(remixesFile(), JSON.stringify(map, null, 2)) } catch (e) { console.error('[feedfuse-workbench] 保存二创版本失败:', e.message) }
  }

  /**
   * 二创：生成一版目标形态内容并追加保存。
   * @param {object} body - { articleId, contentType, params: {style, length, hook} }
   * @returns {Promise<object>} { ok, version, versions }
   */
  async function remixArticle(body) {
    const articleId = body && body.articleId
    const contentType = (body && body.contentType) || 'oral'
    const params = (body && body.params) || {}
    if (!articleId) return { ok: false, error: '缺少 articleId' }
    if (!llmScope) return { ok: false, error: '宿主模型服务未就绪，无法进行二创生成' }
    const spec = REMIX_SPECS[contentType] || REMIX_SPECS.oral
    const a = rss.article(articleId)
    if (!a.ok) return { ok: false, error: '文章不存在' }
    const article = a.article
    const srcText = String(article.transcript || article.summary || article.title || '').slice(0, 6000)
    if (!srcText.trim()) return { ok: false, error: '该作品暂无文案/摘要，请先提取文案' }

    const c = currentConfig()
    const route = resolveAnalyzeRoute(c)
    const paramLine = [
      params.style ? `风格：${params.style}` : '',
      params.length ? `篇幅：${params.length}` : '',
      params.hook ? `钩子：${params.hook}` : '',
    ].filter(Boolean).join('；')

    const userText = `原文案：\n${srcText}\n\n${spec.user}${paramLine ? '\n参数：' + paramLine : ''}`
    const messages = [createUserMessage({
      content: [{ type: 'text', text: userText }],
      source: { kind: 'plugin', plugin: 'feedfuse-workbench' },
    })]
    const assembler = new BlockAssembler()
    for await (const chunk of llmScope.llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      system: REMIX_SYSTEM,
      maxTokens: Number(c.analyzeMaxTokens) || 2048,
    })) assembler.push(chunk)
    const out = assembler.blocks()
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!out) {
      const finish = assembler.finish
      const detail = finish && finish.failure ? JSON.stringify(finish.failure).slice(0, 300) : ''
      return { ok: false, error: `模型调用未产出文本（${finish?.kind || '未知终止'}）${detail ? '：' + detail : ''}` }
    }

    // 追加版本
    const version = {
      id: Date.now().toString(36),
      contentType,
      params,
      text: out,
      createdAt: Date.now(),
    }
    const map = loadRemixes()
    const arr = map[articleId] || []
    arr.push(version)
    map[articleId] = arr
    saveRemixes(map)

    return { ok: true, version, versions: map[articleId] || [] }
  }

  // —— 流水线引擎：步骤编排 + 执行 + 历史 ——

  function pipelinesFile() {
    const c = currentConfig()
    return join(c.dataDir || 'feedfuse-data', 'pipelines.json')
  }
  function loadPipelines() {
    try { return JSON.parse(readFileSync(pipelinesFile(), 'utf8')) } catch { return { definitions: [], runs: [] } }
  }
  function savePipelines(data) {
    try { mkdirSync(dirname(pipelinesFile()), { recursive: true }); writeFileSync(pipelinesFile(), JSON.stringify(data, null, 2)) } catch (e) { console.error('[feedfuse-workbench] 保存流水线失败:', e.message) }
  }

  // 内置模板流水线（首次使用引导）
  const PIPELINE_TEMPLATES = [
    {
      id: 'tpl_full',
      name: '完整处理流水线',
      description: '提取文案 → 自动打标 → 二创口播脚本',
      builtin: true,
      filter: { mediaType: 'video', untranscribed: true },
      steps: [
        { type: 'transcribe', label: '提取文案' },
        { type: 'auto_tag', label: '自动打标' },
        { type: 'remix', label: '二创口播', params: { contentType: 'oral' } },
      ],
    },
    {
      id: 'tpl_tag_only',
      name: '仅打标',
      description: '对已有文案的视频自动打标',
      builtin: true,
      filter: { mediaType: 'video', transcribed: true, untagged: true },
      steps: [{ type: 'auto_tag', label: '自动打标' }],
    },
    {
      id: 'tpl_remix_only',
      name: '仅二创',
      description: '对已打标视频批量生成口播脚本',
      builtin: true,
      filter: { mediaType: 'video', tagged: true },
      steps: [{ type: 'remix', label: '二创口播', params: { contentType: 'oral' } }],
    },
  ]

  /**
   * 执行一条流水线。
   * @param {object} pipe - 流水线定义（含 filter + steps）。
   * @param {function} onLog - 日志回调。
   * @returns {Promise<object>} { ok, stats, error }
   */
  async function runPipeline(pipe, onLog) {
    const log = (level, msg) => { if (onLog) onLog({ time: Date.now(), level, msg }); console.log(`[pipeline:${pipe.name}] ${msg}`) }
    const stats = { total: 0, done: 0, error: 0, byStep: {} }
    try {
      // 1. 筛选目标文章
      const filter = pipe.filter || { mediaType: 'video' }
      let targets = rss.listArticles({ ...filter, limit: '1000' })
      stats.total = targets.length
      log('info', `开始执行「${pipe.name}」，目标 ${targets.length} 条，${pipe.steps.length} 个步骤`)
      if (targets.length === 0) return { ok: true, stats }

      // 2. 逐步骤执行
      for (const step of pipe.steps) {
        const stepKey = step.label || step.type
        stats.byStep[stepKey] = { done: 0, error: 0 }
        log('info', `步骤：${stepKey}`)
        for (const a of targets) {
          try {
            if (step.type === 'transcribe') {
              if (a.transcript) { stats.byStep[stepKey].done++; continue }
              if (a.videoUrl) {
                const tc = await toolConfig()
                let tr = null
                try { tr = await extractTranscript(tc, a.videoUrl, a.title) } catch {}
                if (!tr || !tr.text) {
                  let awemeId = a.guid
                  if (!awemeId && a.link) { const m = /\/video\/(\d+)/.exec(a.link); if (m) awemeId = m[1] }
                  if (awemeId) { const fresh = await fetchFreshVideoUrl(awemeId); if (fresh) { rss.updateArticle(a.id, { videoUrl: fresh }); a.videoUrl = fresh } }
                  if (a.videoUrl) { try { tr = await extractTranscript(tc, a.videoUrl, a.title) } catch {} }
                }
                if (tr && tr.text) { rss.updateArticle(a.id, { transcript: tr.text, transcriptSource: tr.source }); a.transcript = tr.text }
              }
            } else if (step.type === 'auto_tag') {
              if (!a.transcript && !a.summary) continue
              await analyzeArticle(a)
              if (a.structured_tags) rss.updateArticle(a.id, { structured_tags: a.structured_tags })
            } else if (step.type === 'remix') {
              if (!a.transcript && !a.summary) continue
              const remixRes = await remixArticle({ articleId: a.id, contentType: step.params && step.params.contentType || 'oral', params: step.params || {} })
              if (!remixRes.ok) throw new Error(remixRes.error || '二创失败')
            } else if (step.type === 'download') {
              if (a.videoUrl) {
                const tc = await toolConfig()
                const r = await downloadVideo(tc, a.videoUrl)
                media.addMaterial({ title: r.title, fileName: r.fileName, filePath: r.filePath, fileSize: r.fileSize })
              }
            }
            stats.byStep[stepKey].done++
            stats.done++
          } catch (e) {
            stats.byStep[stepKey].error++
            stats.error++
            log('error', `条目 ${a.id} 步骤 ${stepKey} 失败: ${e.message}`)
          }
        }
      }
      log('info', `完成：成功 ${stats.done} / 失败 ${stats.error}`)
      return { ok: true, stats }
    } catch (e) {
      log('error', `流水线异常: ${e.message}`)
      return { ok: false, stats, error: e.message }
    }
  }

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() =>
      scope.webServer.register({
        kind: 'prefix',
        path: '/feedfuse',
        handler: async (req, res) => {
          try {
            const url = new URL(req.url, 'http://localhost')
            const op = url.pathname.replace(/^\/feedfuse\/?/, '') || 'status'
            const q = url.searchParams

            if (req.method === 'POST') {
              const body = await readJsonBody(req)
              if (op === 'transcript') {
                // 抖音需要浏览器 Cookie，否则字幕与音频轨都取不到
                const toolCfg = await toolConfig()
                const r = await extractTranscript(toolCfg, body.url, body.videoTitle)
                if (body.articleId) rss.updateArticle(body.articleId, { transcript: r.text, transcriptSource: r.source })
                json(res, 200, { ok: true, text: r.text, source: r.source })
                return
              }
              if (op === 'analyze') {
                // 单条 articleId / 批量 ids / all=true（取未分析的条目，默认 20 条）
                let targets = []
                if (body.articleId) targets = [rss.article(body.articleId).article]
                else if (Array.isArray(body.ids)) {
                  targets = body.ids.map((id) => rss.article(id).article).filter(Boolean)
                } else if (body.all) {
                  const list = rss.listArticles({ mediaType: 'video', untagged: true, limit: Number(body.limit) || 20 })
                  targets = list.map((a) => rss.article(a.id).article).filter(Boolean)
                }
                const results = []
                for (const a of targets) {
                  if (!a) { results.push({ ok: false, error: '条目不存在' }); continue }
                  try {
                    const patch = await analyzeArticle(a)
                    results.push({ ok: true, id: a.id, ...patch })
                  } catch (e) {
                    results.push({ ok: false, id: a.id, error: e instanceof Error ? e.message : String(e) })
                  }
                }
                json(res, 200, { ok: true, results })
                return
              }
              // 自动打标：先确保有文案（缺则提取），再做 AI 结构化分析，写入多维度标签
              if (op === 'auto-tag') {
                const targets = []
                if (body.articleId) {
                  const a = rss.article(body.articleId).article
                  if (a) targets.push(a)
                } else if (Array.isArray(body.ids)) {
                  for (const id of body.ids) { const a = rss.article(id).article; if (a) targets.push(a) }
                } else if (body.all) {
                  targets.push(...rss.listArticles({ mediaType: 'video', untagged: true, limit: Number(body.limit) || 50 }))
                }
                const results = []
                for (const a of targets) {
                  try {
                    // 缺文案则先提取（直链过期时先刷新）；提取失败则降级用 summary/title
                    if (!a.transcript && a.videoUrl) {
                      const tc = await toolConfig()
                      let tr = null
                      try { tr = await extractTranscript(tc, a.videoUrl, a.title) } catch (e) { /* 直链过期，尝试刷新后再取 */ }
                      if (!tr || !tr.text) {
                        // 刷新过期直链：从 link 提取 awemeId → 浏览器取新链接
                        let awemeId = a.guid
                        if (!awemeId && a.link) { const m = /\/video\/(\d+)/.exec(a.link); if (m) awemeId = m[1] }
                        if (awemeId) {
                          const freshUrl = await fetchFreshVideoUrl(awemeId)
                          if (freshUrl) { rss.updateArticle(a.id, { videoUrl: freshUrl }); a.videoUrl = freshUrl }
                        }
                        if (a.videoUrl) {
                          try { tr = await extractTranscript(tc, a.videoUrl, a.title) } catch (e) { /* 仍失败则降级 */ }
                        }
                      }
                      if (tr && tr.text) { rss.updateArticle(a.id, { transcript: tr.text, transcriptSource: tr.source }); a.transcript = tr.text }
                    }
                    if (!a.transcript && !a.summary) { results.push({ ok: false, id: a.id, error: '无文案/摘要可分析' }); continue }
                    const patch = await analyzeArticle(a)
                    results.push({ ok: true, id: a.id, structured_tags: patch.structured_tags, score: patch.score })
                  } catch (e) {
                    results.push({ ok: false, id: a.id, error: e instanceof Error ? e.message : String(e) })
                  }
                }
                json(res, 200, { ok: true, results })
                return
              }
              if (op === 'download') {
                try {
                  const toolCfg = await toolConfig()
                  const r = await downloadVideo(toolCfg, body.url)
                  // 登记为工作区素材（仅视频；原 HTML 端点本就直接发文件流）
                  media.addMaterial({ title: r.title, fileName: r.fileName, filePath: r.filePath, fileSize: r.fileSize })
                  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}` })
                  res.end()
                } catch (e) {
                  json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
                }
                return
              }
              // 打开可见浏览器窗口扫码登录抖音（本请求阻塞到登录完成或超时）
              if (op === 'douyin/login') {
                const r = await media.douyinLogin()
                json(res, 200, { ok: !!r.ok, reason: r.reason || null, detail: r.detail || null })
                return
              }
              // 刷新订阅：body.feedId 存在只抓该源，否则并发抓全部（UI 刷新按钮 + agent 工具）
              if (op === 'refresh') {
                const results = body.feedId === undefined || body.feedId === null
                  ? await rss.refreshAll()
                  : [await rss.refresh(body.feedId)]
                json(res, 200, { ok: true, results })
                return
              }
              // 新增订阅源（含校验后新增；重复 URL 返回 409）
              if (op === 'feeds') {
                const r = await rss.addFeed(body)
                if (!r.ok) return json(res, r.code || 500, { ok: false, error: r.error })
                // 新增后立即抓取拉取首批文章
                const ref = await rss.refresh(r.feed.id).catch(() => ({ ok: false }))
                json(res, 200, { ok: true, feed: { ...r.feed, lastError: ref.ok ? null : (ref.error || '初始抓取失败') } })
                return
              }
              // 二创：对一条作品生成多形态内容（口播/分镜/短剧/图文/标题），按版本保存
              if (op === 'remix') {
                const r = await remixArticle(body)
                json(res, 200, r)
                return
              }
              // 流水线：创建 / 更新 / 删除 / 手动执行
              if (op === 'pipelines/save') {
                const data = loadPipelines()
                const def = body.definition
                if (!def || !def.name) return json(res, 400, { ok: false, error: '缺少流水线定义' })
                if (def.id) {
                  const idx = data.definitions.findIndex((d) => d.id === def.id)
                  if (idx >= 0) { data.definitions[idx] = { ...data.definitions[idx], ...def, updatedAt: Date.now() } }
                  else { data.definitions.push({ ...def, createdAt: Date.now(), updatedAt: Date.now() }) }
                } else {
                  def.id = 'pipe_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
                  def.createdAt = Date.now(); def.updatedAt = Date.now()
                  data.definitions.push(def)
                }
                savePipelines(data)
                json(res, 200, { ok: true, definition: def })
                return
              }
              if (op === 'pipelines/delete') {
                const data = loadPipelines()
                const id = body.id || q.get('id')
                data.definitions = data.definitions.filter((d) => d.id !== id && !d.builtin)
                savePipelines(data)
                json(res, 200, { ok: true })
                return
              }
              if (op === 'pipelines/run') {
                const data = loadPipelines()
                const id = body.id || q.get('id')
                const def = data.definitions.find((d) => d.id === id)
                if (!def) return json(res, 404, { ok: false, error: '流水线不存在' })
                const run = { id: 'run_' + Date.now().toString(36), pipelineId: def.id, pipelineName: def.name, status: 'running', startedAt: Date.now(), log: [], stats: {} }
                data.runs = data.runs || []
                data.runs.push(run)
                savePipelines(data)
                // 异步执行（不阻塞 HTTP 响应）
                setTimeout(async () => {
                  const result = await runPipeline(def, (entry) => { run.log.push(entry); savePipelines(data) })
                  run.status = result.ok ? 'done' : 'error'
                  run.finishedAt = Date.now()
                  run.stats = result.stats
                  run.error = result.error
                  savePipelines(data)
                }, 100)
                json(res, 200, { ok: true, run })
                return
              }
              json(res, 405, { ok: false, error: `不支持 POST ${op}` })
              return
            }

            if (req.method !== 'GET') {
              json(res, 405, { ok: false, error: '仅支持 GET/POST' })
              return
            }

            if (op === 'status') {
              json(res, 200, {
                ok: true,
                selfContained: true,
                backend: usingPostgres ? 'postgresql' : 'sqlite',
                hasKnowledgeStore: !!knowledgeStore,
                hasScheduler: !!scheduler,
                binaries: binariesStatus(cfg),
                media: media.status(),
                douyin: media.sourceStatus(),
              })
              return
            }
            if (op === 'snapshot') {
              const view = q.get('view') || 'all'
              const limit = q.get('limit') || '80'
              try {
                const s = await rss.snapshot(view, limit)
                json(res, 200, { ok: true, categories: s.categories, feeds: s.feeds, articles: s.articles })
              } catch (e) {
                json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
              }
              return
            }
            if (op === 'article') {
              const id = q.get('id')
              if (!id) return json(res, 400, { ok: false, error: '缺少 id' })
              const r = rss.article(id)
              if (!r.ok) return json(res, 404, r)
              const article = r.article
              // 平台源抓取时已存可播直链；普通 RSS 才从正文里兜底提取。
              let videoUrl = article.videoUrl || null
              if (!videoUrl && article && typeof article.contentHtml === 'string') {
                const m = /href="([^"]*(?:play_url|aweme\/v1\/play|video\/|\.mp4)[^"]*)"/i.exec(article.contentHtml)
                if (m) videoUrl = m[1].replace(/&amp;/g, '&')
              }
              json(res, 200, { ok: true, imageProxy: false, article, videoUrl })
              return
            }
            // 加工台队列：订阅来的视频条目 + 文案与标签完成度
            if (op === 'workbench') {
              const all = rss.listArticles({ mediaType: 'video', limit: '1000' })
              const limit = Number(q.get('limit')) || 200
              json(res, 200, {
                ok: true,
                items: all.slice(0, limit),
                stats: {
                  total: all.length,
                  transcribed: all.filter((a) => a.transcript).length,
                  analyzed: all.filter((a) => a.tags && a.tags.length).length,
                },
              })
              return
            }
            // 加工台仪表盘：处理进度 + 方向分布 + 热点话题 + 7 日趋势
            if (op === 'workbench-stats') {
              const all = rss.listArticles({ mediaType: 'video', limit: '5000' })
              const now = Date.now()
              const dayMs = 86400000
              const todayStart = new Date().setHours(0, 0, 0, 0)
              // 方向分布（从结构化标签）
              const dirMap = {}
              // 话题计数
              const topicMap = {}
              // 7 日每日新增
              const trend = []
              for (let i = 6; i >= 0; i--) {
                const d = new Date(now - i * dayMs)
                trend.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 })
              }
              var tagged = 0, transcribed = 0, scoredSum = 0, scoredCnt = 0
              for (const a of all) {
                if (a.transcript) transcribed++
                if (a.structured_tags) {
                  tagged++
                  const st = a.structured_tags
                  if (st.direction) dirMap[st.direction] = (dirMap[st.direction] || 0) + 1
                  if (Array.isArray(st.topics)) for (const t of st.topics) topicMap[t] = (topicMap[t] || 0) + 1
                }
                if (a.score != null) { scoredSum += a.score; scoredCnt++ }
                if (a.publishedAt) {
                  const age = now - a.publishedAt
                  if (age >= 0 && age < 7 * dayMs) {
                    trend[6 - Math.floor(age / dayMs)].count++
                  }
                }
              }
              // 话题排序取 TOP10
              const topics = Object.entries(topicMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(function (e) { return { topic: e[0], count: e[1] } })
              const directions = Object.entries(dirMap).sort((a, b) => b[1] - a[1]).map(function (e) { return { direction: e[0], count: e[1] } })
              json(res, 200, {
                ok: true,
                overview: {
                  total: all.length,
                  today: all.filter((a) => a.publishedAt >= todayStart).length,
                  transcribed: transcribed,
                  tagged: tagged,
                  avgScore: scoredCnt ? Math.round(scoredSum / scoredCnt) : 0,
                },
                directions: directions,
                topics: topics,
                trend: trend,
              })
              return
            }
            // 分栏工作区：打开文章详情浮层
            if (op === 'workspace/open') {
              const id = q.get('id')
              if (!id) return json(res, 400, { ok: false, error: '缺少 id' })
              const r = rss.article(id)
              if (!r.ok) return json(res, 404, r)
              // 通知浮层打开
              if (globalThis.__feedfuseOpenWorkspace) {
                globalThis.__feedfuseOpenWorkspace(r.article)
              }
              json(res, 200, { ok: true, article: r.article })
              return
            }
            // 分栏工作区：获取文章列表
            if (op === 'workspace/articles') {
              const filter = q.get('filter') || 'all'
              const limit = Number(q.get('limit')) || 200
              let articles = rss.listArticles({ mediaType: 'video', limit: String(limit) })
              if (filter === 'untranscribed') articles = articles.filter((a) => !a.transcript)
              else if (filter === 'untagged') articles = articles.filter((a) => !a.analysisCount)
              else if (filter === 'analyzed') articles = articles.filter((a) => a.analysisCount > 0)
              if (globalThis.__feedfuseUpdateArticles) {
                globalThis.__feedfuseUpdateArticles(articles)
              }
              json(res, 200, { ok: true, articles })
              return
            }
            // 读取某作品已保存的二创版本
            if (op === 'remixes') {
              const id = q.get('id')
              if (!id) return json(res, 400, { ok: false, error: '缺少 id' })
              const map = loadRemixes()
              json(res, 200, { ok: true, versions: map[id] || [] })
              return
            }
            // —— 流水线：读取定义 + 模板 + 执行历史 ——
            if (op === 'pipelines') {
              const data = loadPipelines()
              if (!data.definitions || !data.definitions.length) {
                // 首次：注入内置模板
                data.definitions = PIPELINE_TEMPLATES.map((t) => ({ ...t, id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), updatedAt: Date.now() }))
                savePipelines(data)
              }
              json(res, 200, { ok: true, definitions: data.definitions, templates: PIPELINE_TEMPLATES, runs: (data.runs || []).slice(-20).reverse() })
              return
            }
            // 流水线执行历史
            if (op === 'pipelines/runs') {
              const data = loadPipelines()
              const limit = Number(q.get('limit')) || 30
              json(res, 200, { ok: true, runs: (data.runs || []).slice(-limit).reverse() })
              return
            }
            // 播放代理：按条目现取直链并透传 Range，屏蔽 CDN 直链的时效与请求头差异
            if (op === 'video') {
              const id = q.get('id')
              const r = id ? rss.article(id) : { ok: false, error: '缺少 id' }
              let src = r.ok && r.article.videoUrl
              if (!src) { json(res, 404, { ok: false, error: '该条目没有可播地址（请刷新订阅源）' }); return }

              // 尝试播放，403 时自动刷新 URL
              let retryWithFresh = false
              let upstream = null
              try {
                const headers = {
                  // 抖音 CDN 校验来源：不带浏览器 UA 与 Referer 时直链会被 403 拒绝
                  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                  referer: 'https://www.douyin.com/',
                }
                if (req.headers.range) headers.range = req.headers.range
                // 超时只约束「取响应头」阶段。响应体一旦开始 pipe，再让信号触发
                // 中止，会以 error 事件打断 Readable —— 未处理的流错误会打挂整个进程。
                const ac = new AbortController()
                const headerTimer = setTimeout(() => ac.abort(), 20000)
                try {
                  upstream = await fetch(src, { headers, signal: ac.signal })
                } finally {
                  clearTimeout(headerTimer)
                }
                // CDN 直链过期（403）：自动用浏览器取新链接后重试
                if (upstream.status === 403) {
                  retryWithFresh = true
                }
                if (!retryWithFresh && !upstream.ok && upstream.status !== 206) { json(res, 502, { ok: false, error: `上游 HTTP ${upstream.status}` }); return }
              } catch (e) {
                if (res.headersSent) { res.destroy(); return }
                json(res, 502, { ok: false, error: e instanceof Error ? e.message : String(e) })
                return
              }

              // 自动刷新：用浏览器取新的可播直链
              if (retryWithFresh) {
                // guid 可能为空；从分享链接里兜底提取抖音视频 ID（awemeId）
                let awemeId = r.ok && r.article.guid
                if (r.ok && !awemeId && r.article.link) {
                  const m = /\/video\/(\d+)/.exec(r.article.link)
                  if (m) awemeId = m[1]
                }
                if (awemeId) {
                  const freshUrl = await fetchFreshVideoUrl(awemeId)
                  if (freshUrl) {
                    // 更新数据库里的 URL（下次不用重新取）
                    rss.updateArticle(id, { videoUrl: freshUrl })
                    src = freshUrl
                    // 重新 fetch
                    const headers = {
                      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                      referer: 'https://www.douyin.com/',
                    }
                    if (req.headers.range) headers.range = req.headers.range
                    const ac = new AbortController()
                    const headerTimer = setTimeout(() => ac.abort(), 20000)
                    try {
                      upstream = await fetch(src, { headers, signal: ac.signal })
                    } finally {
                      clearTimeout(headerTimer)
                    }
                  }
                }
                // 刷新后仍然 403 或无新链接
                if (!upstream || upstream.status === 403 || (!upstream.ok && upstream.status !== 206)) {
                  json(res, 403, { ok: false, stale: true, error: '可播直链已过期，自动刷新失败，请稍后重试或手动刷新订阅源' })
                  return
                }
              }

              res.writeHead(upstream.status, {
                'content-type': upstream.headers.get('content-type') || 'video/mp4',
                'accept-ranges': 'bytes',
                ...(upstream.headers.get('content-length') ? { 'content-length': upstream.headers.get('content-length') } : {}),
                ...(upstream.headers.get('content-range') ? { 'content-range': upstream.headers.get('content-range') } : {}),
              })
              const stream = Readable.fromWeb(upstream.body)
              // 任一侧断开都要收回另一侧；流错误必须就地消化，不得冒泡为未捕获 error。
              stream.on('error', () => { res.destroy() })
              res.on('error', () => { stream.destroy() })
              res.on('close', () => { stream.destroy() })
              stream.pipe(res)
              return
            }

            // —— 订阅源校验 / 分类 / 发现 ——
            if (op === 'feeds/validate') {
              const url = q.get('url') || ''
              if (!url) return json(res, 400, { ok: false, error: '缺少 url' })
              try {
                const r = await rss.validateFeed(url)
                json(res, 200, { ok: true, title: r.title, siteUrl: r.siteUrl })
              } catch (e) {
                json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) })
              }
              return
            }
            if (op === 'categories') {
              json(res, 200, { ok: true, categories: rss.categories() })
              return
            }

            // —— 自媒体「我的作品」＆素材（自包含：内建浏览器抓取 + 本地 SQLite）——
            if (op === 'myworks') {
              const force = q.get('force') === '1'
              const r = await media.myWorks(force)
              if (r.error && !r.items.length) {
                json(res, 200, { ok: true, items: [], summary: null, feedId: r.feedId || null, error: r.error, reason: r.reason || null, needLogin: !!r.needLogin, configHint: r.configHint || null })
              } else {
                json(res, 200, { ok: true, items: r.items, summary: r.summary, feedId: r.feedId })
              }
              return
            }
            // 抖音取数来源诊断（secUid / 来源类型 / 浏览器 / profile / RSSHub 地址 / Cookie）
            if (op === 'douyin/status') {
              json(res, 200, { ok: true, source: media.sourceStatus() })
              return
            }
            // 查询插件 profile 里是否已有抖音登录态
            if (op === 'douyin/login-status') {
              const r = await media.douyinLoginStatus()
              json(res, 200, { ok: !!r.ok, loggedIn: !!r.loggedIn, reason: r.reason || null, detail: r.detail || null })
              return
            }
            if (op === 'materials') {
              json(res, 200, { ok: true, materials: media.materials() })
              return
            }
            if (op === 'overview') {
              json(res, 200, { ok: true, overview: media.status() })
              return
            }

            // —— 原 FeedFuse 依赖端点：自包含模式下返回空集（兼容 client）——
            if (op === 'repos') { json(res, 200, { ok: true, repos: [] }); return }
            if (op === 'recommended') { json(res, 200, { ok: true, items: rss.recommended() }); return }
            if (op === 'accounts') { json(res, 200, { ok: true, accounts: [] }); return }
            if (op === 'material') { json(res, 200, { ok: true, material: null }); return }
            if (op === 'media') { json(res, 404, { ok: false, error: '自包含模式下无图片代理' }); return }

            // —— 新增：调度器 / 策略 / 知识库 ——

            // 调度器状态
            if (op === 'scheduler/status') {
              if (!scheduler) return json(res, 200, { ok: true, enabled: false, reason: 'DATABASE_URL 未配置' })
              json(res, 200, { ok: true, enabled: true, ...scheduler.status() })
              return
            }
            // 调度器控制：start / stop
            if (op === 'scheduler/start') {
              if (!scheduler) return json(res, 503, { ok: false, error: '调度器未就绪（DATABASE_URL 未配置）' })
              scheduler.start()
              json(res, 200, { ok: true, message: '调度器已启动' })
              return
            }
            if (op === 'scheduler/stop') {
              if (!scheduler) return json(res, 503, { ok: false, error: '调度器未就绪' })
              scheduler.stop()
              json(res, 200, { ok: true, message: '调度器已停止' })
              return
            }
            // 手动触发任务
            if (op === 'scheduler/run') {
              if (!scheduler) return json(res, 503, { ok: false, error: '调度器未就绪' })
              const jobName = (body && body.job) || q.get('job')
              if (!jobName) return json(res, 400, { ok: false, error: '缺少 job 参数' })
              try {
                const r = await scheduler.runJob(jobName, 'manual')
                json(res, 200, { ok: true, ...r })
              } catch (e) {
                json(res, 500, { ok: false, error: e.message })
              }
              return
            }
            // 调度器执行历史
            if (op === 'scheduler/runs') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const jobType = q.get('type') || undefined
              const limit = Number(q.get('limit')) || 20
              const runs = await knowledgeStore.listSchedulerRuns(jobType, limit)
              json(res, 200, { ok: true, runs })
              return
            }

            // 策略列表
            if (op === 'strategies') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const strategies = await knowledgeStore.listStrategies()
              json(res, 200, { ok: true, strategies })
              return
            }
            // 创建策略
            if (op === 'strategies/create') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const { name, slug, description, systemPrompt, userPromptTemplate, outputSchema, modelProvider, modelName, maxTokens } = body
              if (!name || !slug || !systemPrompt || !userPromptTemplate) {
                return json(res, 400, { ok: false, error: '缺少必填字段: name, slug, systemPrompt, userPromptTemplate' })
              }
              const s = await knowledgeStore.createStrategy({ name, slug, description, systemPrompt, userPromptTemplate, outputSchema, modelProvider, modelName, maxTokens })
              json(res, 200, { ok: true, strategy: s })
              return
            }
            // 删除策略
            if (op === 'strategies/delete') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const id = (body && body.id) || q.get('id')
              const r = await knowledgeStore.deleteStrategy(id)
              if (!r.ok) return json(res, 400, r)
              json(res, 200, { ok: true })
              return
            }
            // 对指定文章执行策略
            if (op === 'strategies/run') {
              if (!strategiesEngine || !knowledgeStore) return json(res, 503, { ok: false, error: '策略引擎未就绪' })
              const articleId = (body && body.articleId) || q.get('articleId')
              const strategySlug = (body && body.strategySlug) || q.get('strategySlug') || 'monetization'
              if (!articleId) return json(res, 400, { ok: false, error: '缺少 articleId' })
              const article = await knowledgeStore.getArticle(articleId)
              if (!article) return json(res, 404, { ok: false, error: '文章不存在' })
              const strategy = await knowledgeStore.getStrategyBySlug(strategySlug)
              if (!strategy) return json(res, 404, { ok: false, error: `策略 ${strategySlug} 不存在` })
              try {
                const r = await strategiesEngine.analyzeArticle(article, strategy)
                json(res, 200, { ok: true, ...r })
              } catch (e) {
                json(res, 500, { ok: false, error: e.message })
              }
              return
            }

            // 分析端点（兼容旧接口 + 支持策略）
            if (op === 'analyze-new') {
              if (!strategiesEngine || !knowledgeStore) return json(res, 503, { ok: false, error: '策略引擎未就绪' })
              const articleId = (body && body.articleId) || q.get('articleId')
              const strategySlug = (body && body.strategySlug) || q.get('strategySlug')
              if (articleId) {
                const article = await knowledgeStore.getArticle(articleId)
                if (!article) return json(res, 404, { ok: false, error: '文章不存在' })
                if (strategySlug) {
                  const strategy = await knowledgeStore.getStrategyBySlug(strategySlug)
                  if (!strategy) return json(res, 404, { ok: false, error: `策略 ${strategySlug} 不存在` })
                  const r = await strategiesEngine.analyzeArticle(article, strategy)
                  json(res, 200, { ok: true, results: [r] })
                } else {
                  const r = await strategiesEngine.analyzeWithAllStrategies(article)
                  json(res, 200, { ok: true, results: r })
                }
              } else if (body && body.all) {
                const r = await strategiesEngine.analyzePending({ limit: Number(body.limit) || 20, strategySlug })
                json(res, 200, { ok: true, ...r })
              } else {
                json(res, 400, { ok: false, error: '缺少 articleId 或 all=true' })
              }
              return
            }

            // 知识库搜索
            if (op === 'knowledge/search') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const query = q.get('q') || (body && body.q) || ''
              const limit = Number(q.get('limit')) || 10
              if (!query) return json(res, 400, { ok: false, error: '缺少搜索词 q' })
              // 全文检索（当前版本，embedding 未接入时走全文）
              const results = await knowledgeStore.fullTextSearch(query, limit)
              json(res, 200, { ok: true, results, mode: 'fulltext' })
              return
            }
            // 知识库统计
            if (op === 'knowledge/stats') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const stats = await knowledgeStore.getStats()
              json(res, 200, { ok: true, stats })
              return
            }
            // 知识库文章列表（支持筛选）
            if (op === 'knowledge/articles') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const filter = {
                feedId: q.get('feedId') || undefined,
                mediaType: q.get('mediaType') || undefined,
                category: q.get('category') || undefined,
                minScore: q.get('minScore') || undefined,
                limit: q.get('limit') || 50,
              }
              const articles = await knowledgeStore.listArticles(filter)
              json(res, 200, { ok: true, articles })
              return
            }
            // 文章分析结果
            if (op === 'knowledge/analysis') {
              if (!knowledgeStore) return json(res, 503, { ok: false, error: '知识库未就绪' })
              const articleId = q.get('articleId') || (body && body.articleId)
              if (!articleId) return json(res, 400, { ok: false, error: '缺少 articleId' })
              const results = await knowledgeStore.getArticleAnalysis(articleId)
              json(res, 200, { ok: true, results })
              return
            }

            // 知识库端点（兼容旧接口）
            if (op === 'knowledge') { json(res, 200, { ok: true, items: [] }); return }

            json(res, 404, { ok: false, error: `未知端点 ${op}` })
          } catch (error) {
            json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      `${NAME}: feedfuse HTTP route`,
    )
  })

  // —— 模型工具：agent 可调度「下载视频 / 提取文案 / 刷新 RSS」 ——
  ctx.inject(['tools'], (scope) => {
    scope.effect(() => scope.tools.register({
      name: 'feedfuse_extract_transcript',
      description: '提取抖音/快手/B站/YouTube 视频的文案（优先字幕，否则语音识别）。传入视频链接，返回文案全文与来源。用于「提取文案→改写→口播」工作流的第一步。',
      parameters: {
        type: 'object',
        properties: {
          link: { type: 'string', description: '视频链接（必填）' },
          title: { type: 'string', description: '视频标题（可选）' },
        },
        required: ['link'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '提取到的视频文案全文' },
            source: { type: 'string', description: '来源：subtitle(字幕) 或 whisper(语音识别)' },
          },
          required: ['text'],
        },
        render: (_args, value) => [{ type: 'text', text: '已提取文案（来源：' + (value.source || '未知') + '）\n\n' + value.text }],
      },
      async execute(args) {
        const r = await extractTranscript(await toolConfig(), args.link, args.title)
        if (!r.text) throw new Error('未能提取到文案（可能无字幕，需语音识别或稍后重试）')
        return { text: r.text, source: r.source }
      },
    }), `${NAME}: tool feedfuse_extract_transcript`)

    scope.effect(() => scope.tools.register({
      name: 'feedfuse_download_video',
      description: '下载抖音/快手/B站/YouTube 视频到本地工作区。传入视频链接，返回是否成功与文件名。用于需要本地素材或去剪辑前的下载步骤。',
      parameters: {
        type: 'object',
        properties: {
          link: { type: 'string', description: '视频链接（必填）' },
        },
        required: ['link'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            downloaded: { type: 'boolean', description: '是否下载成功' },
            fileName: { type: 'string', description: '下载后的文件名' },
          },
          required: ['downloaded'],
        },
        render: (_args, value) => [{ type: 'text', text: value.downloaded ? '视频已下载：' + (value.fileName || '') : '下载失败' }],
      },
      async execute(args) {
        const r = await downloadVideo(await toolConfig(), args.link)
        media.addMaterial({ title: r.title, fileName: r.fileName, filePath: r.filePath, fileSize: r.fileSize })
        return { downloaded: true, fileName: r.fileName }
      },
    }), `${NAME}: tool feedfuse_download_video`)

    scope.effect(() => scope.tools.register({
      name: 'feedfuse_refresh_myworks',
      description: '强制刷新「我的作品」订阅，拉取最新的抖音作品与统计（播放/点赞/评论）。返回作品数量。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          properties: { count: { type: 'number', description: '拉到多少个作品' }, error: { type: 'string', description: '配置缺失或抓取失败时的错误' } },
        },
        render: (_args, value) => [{ type: 'text', text: value.error ? ('我的作品刷新失败：' + value.error) : ('我的作品已刷新，共 ' + value.count + ' 个作品') }],
      },
      async execute() {
        const r = await media.myWorks(true)
        if (r.error && !r.items.length) return { count: 0, error: r.error }
        return { count: r.items.length }
      },
    }), `${NAME}: tool feedfuse_refresh_myworks`)

    scope.effect(() => scope.tools.register({
      name: 'feedfuse_refresh_feeds',
      description: '刷新所有 RSS 订阅源，拉取最新文章。返回每个源的成功/失败情况。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          properties: { results: { type: 'array', description: '每个源的刷新结果' } },
        },
        render: (_args, value) => [{ type: 'text', text: 'RSS 刷新完成：' + JSON.stringify(value.results) }],
      },
      async execute() {
        return { results: await rss.refreshAll() }
      },
    }), `${NAME}: tool feedfuse_refresh_feeds`)
  })

  // —— 技能：视频工作流 ——
  ctx.inject(['skills'], (scope) => {
    scope.effect(() => scope.skills.register({
      name: 'feedfuse-video-workflow',
      description: '下载视频、提取文案、改写成口播脚本（自媒体视频创作工作流）',
      whenToUse: '当用户要求下载视频、提取视频文案、改写文案、生成口播脚本，或输入以 /feedfuse 开头时',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      content: SKILL_CONTENT,
    }), `${NAME}: skill feedfuse-video-workflow`)
  })

  // 分栏工作区浮层已迁移至客户端半（client.js 的 WorkspaceOverlay 组件）
}
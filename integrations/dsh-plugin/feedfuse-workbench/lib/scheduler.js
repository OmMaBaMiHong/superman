/**
 * feedfuse-workbench 定时任务引擎。
 *
 * 自研轻量 cron 调度器，内置 4 个任务：
 *   - fetch：抓取所有订阅源新视频
 *   - transcribe：提取未解析视频的文案
 *   - analyze：对未分析视频执行策略分析
 *   - embed：对新分析结果生成向量嵌入
 *
 * 任务通过 setInterval + cron 表达式匹配实现，不依赖第三方 cron 库。
 * 执行日志写入 scheduler_runs 表。
 */

/**
 * 解析简化 cron 表达式（仅支持 分 时 * * * 格式）。
 * 返回 { minute, hour } 或 null。
 */
function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length < 2) return null
  const minute = parts[0] === '*' ? null : parseInt(parts[0], 10)
  const hour = parts[1] === '*' ? null : parseInt(parts[1], 10)
  return { minute, hour }
}

/**
 * 检查 cron 是否在当前分钟匹配。
 */
function cronMatches(cron, now) {
  if (cron.minute != null && cron.minute !== now.getMinutes()) return false
  if (cron.hour != null && cron.hour !== now.getHours()) return false
  return true
}

/**
 * 创建调度器。
 * @param {object} deps - 依赖：knowledgeStore + strategiesEngine + rssModule + config + transcriptFn。
 */
export function createScheduler({ knowledgeStore, strategiesEngine, rssModule, config, transcriptFn }) {
  /** 任务注册表。 */
  const jobs = new Map()
  /** 调度器运行中。 */
  let running = false
  /** 定时检查句柄。 */
  let tickHandle = null
  /** 任务是否正在执行（防并发）。 */
  const jobRunning = new Map()

  // —— 内置任务定义 ——

  /**
   * fetch 任务：抓取所有订阅源。
   */
  async function jobFetch() {
    if (!rssModule) throw new Error('RSS 模块未就绪')
    const feeds = await knowledgeStore.listFeeds()
    const results = []
    for (const feed of feeds) {
      if (!feed.enabled) continue
      try {
        const r = await rssModule.refresh(feed.id)
        results.push({ feedId: feed.id, ok: r.ok, added: r.added || 0, error: r.error || null })
        await knowledgeStore.updateFeedFetchStatus(feed.id, { status: r.ok ? 200 : 500, error: r.error })
      } catch (e) {
        results.push({ feedId: feed.id, ok: false, error: e.message })
        await knowledgeStore.updateFeedFetchStatus(feed.id, { status: 500, error: e.message })
      }
    }
    return results
  }

  /**
   * transcribe 任务：对未提取文案的视频提取文案。
   */
  async function jobTranscribe() {
    const pending = await knowledgeStore.listArticles({ mediaType: 'video', untranscribed: true, limit: 20 })
    const results = []
    for (const article of pending) {
      if (!article.video_url) continue
      try {
        const r = await transcriptFn(article.video_url, article.title)
        if (r.text) {
          await knowledgeStore.updateArticle(article.id, {
            transcript: r.text,
            transcript_source: r.source,
            transcript_extracted_at: new Date().toISOString(),
          })
          results.push({ articleId: article.id, ok: true, source: r.source })
        } else {
          results.push({ articleId: article.id, ok: false, error: '未提取到文案' })
        }
      } catch (e) {
        results.push({ articleId: article.id, ok: false, error: e.message })
      }
    }
    return results
  }

  /**
   * analyze 任务：对未分析的文章执行策略分析。
   */
  async function jobAnalyze() {
    return strategiesEngine.analyzePending({ limit: 20 })
  }

  /**
   * embed 任务：对有文案但无 embedding 的文章生成向量嵌入。
   * 当前版本：将文案切片写入 knowledge_embeddings（embedding 字段留空，等接入 embedding API）。
   */
  async function jobEmbed() {
    const pending = await knowledgeStore.listArticles({ untranscribed: false, limit: 10 })
    const results = []
    for (const article of pending) {
      if (!article.transcript) continue
      const chunks = splitIntoChunks(article.transcript, 500)
      for (let i = 0; i < chunks.length; i++) {
        await knowledgeStore.insertEmbedding({
          articleId: article.id,
          chunkIndex: i,
          chunkText: chunks[i],
          chunkType: 'transcript',
          embedding: null,
        })
      }
      results.push({ articleId: article.id, chunks: chunks.length })
    }
    return results
  }

  /**
   * 将文本按最大字符数切片。
   */
  function splitIntoChunks(text, maxChars) {
    const str = String(text || '')
    if (str.length <= maxChars) return str ? [str] : []
    const chunks = []
    let pos = 0
    while (pos < str.length) {
      let end = Math.min(pos + maxChars, str.length)
      if (end < str.length) {
        const lastBreak = str.lastIndexOf('。', end)
        const lastNewline = str.lastIndexOf('\n', end)
        const breakAt = Math.max(lastBreak, lastNewline)
        if (breakAt > pos) end = breakAt + 1
      }
      chunks.push(str.slice(pos, end).trim())
      pos = end
    }
    return chunks.filter(Boolean)
  }

  // —— 注册内置任务 ——

  registerJob('fetch', '0 8 * * *', jobFetch, '抓取所有订阅源新视频')
  registerJob('transcribe', '0 9 * * *', jobTranscribe, '提取未解析视频的文案')
  registerJob('analyze', '0 10 * * *', jobAnalyze, '策略分析未分析的视频')
  registerJob('embed', '0 11 * * *', jobEmbed, '生成向量嵌入')

  /**
   * 注册一个任务。
   */
  function registerJob(name, cron, handler, description) {
    jobs.set(name, { name, cron: parseCron(cron), cronExpr: cron, handler, description, lastRun: null })
    jobRunning.set(name, false)
  }

  /**
   * 执行单个任务（带日志 + 防并发）。
   */
  async function runJob(name, triggeredBy = 'manual') {
    const job = jobs.get(name)
    if (!job) throw new Error(`未知任务: ${name}`)
    if (jobRunning.get(name)) throw new Error(`任务 ${name} 正在执行中`)

    jobRunning.set(name, true)
    const runRecord = await knowledgeStore.logSchedulerRun({
      jobType: name,
      status: 'running',
      triggeredBy,
    })

    try {
      const results = await job.handler()
      const succeeded = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok).length
      const skipped = results.length - succeeded - failed

      await knowledgeStore.updateSchedulerRun(runRecord.id, {
        status: failed > 0 && succeeded > 0 ? 'partial' : (failed > 0 ? 'failed' : 'succeeded'),
        totalCount: results.length,
        succeededCount: succeeded,
        failedCount: failed,
        skippedCount: skipped,
        details: results.slice(0, 50),
      })

      job.lastRun = Date.now()
      return { ok: true, succeeded, failed, results }
    } catch (e) {
      await knowledgeStore.updateSchedulerRun(runRecord.id, {
        status: 'failed',
        errorMessage: e.message,
      })
      throw e
    } finally {
      jobRunning.set(name, false)
    }
  }

  /**
   * 每分钟检查一次 cron 触发。
   */
  function tick() {
    if (!running) return
    const now = new Date()
    for (const [name, job] of jobs) {
      if (!job.cron) continue
      if (jobRunning.get(name)) continue
      if (!cronMatches(job.cron, now)) continue
      // 防止同一分钟重复触发
      if (job.lastRun && now.getTime() - job.lastRun < 60_000) continue
      job.lastRun = now.getTime()
      runJob(name, 'scheduler').catch((e) => {
        console.error(`[scheduler] 任务 ${name} 执行失败:`, e.message)
      })
    }
  }

  /**
   * 启动调度器。
   */
  function start() {
    if (running) return
    running = true
    tickHandle = setInterval(tick, 60_000)
    tick()
  }

  /**
   * 停止调度器。
   */
  function stop() {
    running = false
    if (tickHandle) {
      clearInterval(tickHandle)
      tickHandle = null
    }
  }

  /**
   * 获取任务列表与状态。
   */
  function status() {
    return {
      running,
      jobs: [...jobs.values()].map((j) => ({
        name: j.name,
        cron: j.cronExpr,
        description: j.description,
        running: jobRunning.get(j.name) || false,
        lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
      })),
    }
  }

  return {
    start,
    stop,
    status,
    runJob,
    registerJob,
  }
}

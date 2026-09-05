/**
 * feedfuse-workbench 策略模板引擎。
 *
 * 策略模板定义了如何对一篇文章/视频做 AI 分析：
 *   - system_prompt：给 LLM 的系统提示词
 *   - user_prompt_template：用户提示词模板（支持 {{title}} {{transcript}} 等变量）
 *   - output_schema：期望输出的 JSON Schema（用于校验）
 *
 * 策略存储在 strategy_templates 表，支持内置 + 用户自定义。
 * 执行结果写入 analysis_results 表，并更新文章的标签/评分。
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

/**
 * 创建策略引擎。
 * @param {object} deps - 依赖：knowledgeStore + llmScope + config + ctx。
 */
export function createStrategiesEngine({ knowledgeStore, llmScope, config, ctx }) {
  /**
   * 从模板变量构建实际 prompt。
   * @param {string} template - 模板字符串。
   * @param {object} vars - 变量映射。
   */
  function fillTemplate(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = vars[key]
      if (val == null) return ''
      if (typeof val === 'object') return JSON.stringify(val)
      return String(val)
    })
  }

  /**
   * 从模型输出中提取第一个 JSON 对象。
   * @param {string} text - 模型输出文本。
   */
  function extractJson(text) {
    const str = String(text || '')
    const start = str.indexOf('{')
    const end = str.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try { return JSON.parse(str.slice(start, end + 1)) } catch { return null }
  }

  /**
   * 简易 JSON Schema 校验（只检查 required 字段）。
   * @param {object} data - 解析后的数据。
   * @param {object} schema - JSON Schema。
   */
  function validateOutput(data, schema) {
    if (!schema || !schema.required) return { ok: true }
    const missing = schema.required.filter((key) => data[key] === undefined)
    if (missing.length > 0) return { ok: false, error: `缺少必填字段: ${missing.join(', ')}` }
    return { ok: true }
  }

  /**
   * 解析模型路由：显式配置优先，否则跟随宿主默认模型。
   * @param {object} strategy - 策略模板。
   * @returns {{provider: string, model: string}} 路由。
   */
  function resolveModelRoute(strategy) {
    const provider = String(strategy?.model_provider || config?.analyzeProvider || '').trim()
    const model = String(strategy?.model_name || config?.analyzeModel || '').trim()
    if (provider && model) return { provider, model }
    // 跟随宿主默认模型
    const defaults = ctx?.get?.('agentDefaultModel')
    const current = defaults && typeof defaults.currentSelection === 'function' ? defaults.currentSelection() : null
    if (current && current.provider && current.model) {
      return { provider: provider || current.provider, model: model || current.model }
    }
    throw new Error('未确定分析模型：在设置里填 analyzeProvider / analyzeModel，或先在应用里设置默认模型')
  }

  /**
   * 对一篇文章执行指定策略的分析。
   * @param {object} article - 文章对象（含 transcript / title / stats 等）。
   * @param {object} strategy - 策略模板对象。
   * @returns {Promise<object>} 分析结果。
   */
  async function analyzeArticle(article, strategy) {
    if (!llmScope) throw new Error('宿主模型服务未就绪，无法进行 AI 分析')
    if (!article) throw new Error('文章不存在')

    const body = String(article.transcript || article.summary || article.title || '').slice(0, 6000)
    const stats = article.stats
      ? `点赞 ${article.stats.likes || 0}／评论 ${article.stats.comments || 0}／分享 ${article.stats.shares || 0}／收藏 ${article.stats.collects || 0}`
      : '无统计数据'

    const vars = {
      title: article.title || '',
      author: article.author || '未知',
      platform: article.platform || '未知',
      stats,
      transcript: body,
      summary: article.summary || '',
      category: article.category || '',
    }

    const userPrompt = fillTemplate(strategy.user_prompt_template, vars)
    const route = resolveModelRoute(strategy)

    const messages = [createUserMessage({
      content: [{ type: 'text', text: userPrompt }],
      source: { kind: 'plugin', plugin: 'feedfuse-workbench' },
    })]

    const startTime = Date.now()
    const assembler = new BlockAssembler()
    for await (const chunk of llmScope.llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      system: strategy.system_prompt,
      maxTokens: Number(strategy.max_tokens) || 2048,
    })) assembler.push(chunk)

    const output = assembler.blocks()
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const parsed = extractJson(output)
    if (!parsed) {
      throw new Error('模型输出无法解析为 JSON')
    }

    const validation = validateOutput(parsed, strategy.output_schema)
    if (!validation.ok) {
      throw new Error(`输出校验失败: ${validation.error}`)
    }

    const durationMs = Date.now() - startTime

    // 写入分析结果
    const result = await knowledgeStore.createAnalysisResult({
      articleId: article.id,
      strategyId: strategy.id,
      result: parsed,
      category: parsed.content_category || parsed.primary_category || null,
      tags: parsed.secondary_tags || parsed.key_selling_points || [],
      score: parsed.monetization_score || parsed.practical_value || null,
      priority: parsed.priority || null,
      sentiment: parsed.sentiment || null,
      modelProvider: route.provider,
      modelName: route.model,
      durationMs,
    })

    // 更新文章冗余字段（便于查询）
    await knowledgeStore.updateArticle(article.id, {
      category: parsed.content_category || parsed.primary_category || article.category,
      tags: parsed.secondary_tags || parsed.key_selling_points || article.tags,
      score: parsed.monetization_score || parsed.practical_value || article.score,
      priority: parsed.priority || article.priority,
      sentiment: parsed.sentiment || article.sentiment,
      note: parsed.rewrite_suggestion || parsed.monetization_path || article.note,
    })

    return { id: result.id, result: parsed, durationMs }
  }

  /**
   * 对一篇文章执行所有活跃策略。
   * @param {object} article - 文章对象。
   * @returns {Promise<object[]>} 各策略的分析结果。
   */
  async function analyzeWithAllStrategies(article) {
    const strategies = await knowledgeStore.listStrategies()
    const results = []
    for (const strategy of strategies) {
      try {
        const r = await analyzeArticle(article, strategy)
        results.push({ ok: true, strategy: strategy.slug, ...r })
      } catch (e) {
        results.push({ ok: false, strategy: strategy.slug, error: e.message })
      }
    }
    return results
  }

  /**
   * 批量分析：对所有未分析的文章执行策略。
   * @param {object} [options] - { limit, strategySlug }。
   * @returns {Promise<object>} 统计。
   */
  async function analyzePending({ limit = 20, strategySlug } = {}) {
    const unanalyzed = await knowledgeStore.listArticles({ untagged: true, limit })
    const strategies = strategySlug
      ? [await knowledgeStore.getStrategyBySlug(strategySlug)].filter(Boolean)
      : await knowledgeStore.listStrategies()

    let succeeded = 0
    let failed = 0
    const details = []

    for (const article of unanalyzed) {
      for (const strategy of strategies) {
        try {
          await analyzeArticle(article, strategy)
          succeeded++
        } catch (e) {
          failed++
          details.push({ articleId: article.id, strategy: strategy.slug, error: e.message })
        }
      }
    }

    return { total: unanalyzed.length, succeeded, failed, details }
  }

  return {
    fillTemplate,
    extractJson,
    analyzeArticle,
    analyzeWithAllStrategies,
    analyzePending,
  }
}

/**
 * feedfuse-workbench PostgreSQL 知识库存储层。
 *
 * 用 PostgreSQL + pgvector 替代 SQLite，提供：
 *   - 订阅源/文章/分类的完整 CRUD
 *   - 策略模板管理
 *   - AI 分析结果存储与查询
 *   - pgvector 向量语义搜索
 *   - 全文检索
 *   - 聚合统计
 *   - 调度器日志
 *
 * 连接通过 DATABASE_URL 环境变量配置，格式：
 *   postgresql://user:pass@host:5432/dbname
 *
 * 当 DATABASE_URL 未配置或连接失败时，返回 null，调用方回退到 SQLite。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** PostgreSQL 连接池（懒加载）。 */
let pool = null

/** 是否已初始化（表结构就绪）。 */
let initialized = false

/**
 * 获取 PostgreSQL 连接池。未配置或连接失败返回 null。
 * @returns {Promise<object|null>} pg Pool 或 null。
 */
async function getPool() {
  if (pool) return pool
  const url = process.env.DATABASE_URL
  if (!url) return null
  try {
    const { default: pg } = await import('pg')
    pool = new pg.Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
    })
    pool.on('error', (err) => {
      console.error('[knowledge-store] pool error:', err.message)
    })
    // 验证连接
    await pool.query('SELECT 1')
    return pool
  } catch (e) {
    console.error('[knowledge-store] PostgreSQL 不可用，回退 SQLite:', e.message)
    pool = null
    return null
  }
}

/**
 * 执行单条 SQL（无返回行）。
 * @param {object} p - pg Pool。
 * @param {string} sql - SQL 语句。
 * @param {[]} params - 参数。
 */
async function exec(p, sql, params = []) {
  await p.query(sql, params)
}

/**
 * 执行查询，返回所有行。
 * @param {object} p - pg Pool。
 * @param {string} sql - SQL 语句。
 * @param {[]} params - 参数。
 */
async function query(p, sql, params = []) {
  const r = await p.query(sql, params)
  return r.rows
}

/**
 * 执行查询，返回单行。
 * @param {object} p - pg Pool。
 * @param {string} sql - SQL 语句。
 * @param {[]} params - 参数。
 */
async function queryOne(p, sql, params = []) {
  const rows = await query(p, sql, params)
  return rows[0] || null
}

/** 读取并执行 migrations 目录下的所有 SQL 文件。 */
async function runMigrations(p) {
  const migrationsDir = join(__dirname, '..', 'migrations')
  if (!existsSync(migrationsDir)) return
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  // 记录已执行的迁移
  await exec(p, `CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  const applied = new Set((await query(p, 'SELECT filename FROM _migrations')).map((r) => r.filename))
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    try {
      await p.query(sql)
      await exec(p, 'INSERT INTO _migrations (filename) VALUES (ON CONFLICT DO NOTHING)', [file])
    } catch (e) {
      console.error(`[knowledge-store] 迁移 ${file} 失败:`, e.message)
      throw e
    }
  }
}

/**
 * 初始化 PostgreSQL 知识库：建表 + 迁移。
 * @returns {Promise<boolean>} 是否成功。
 */
export async function initKnowledgeStore() {
  if (initialized) return true
  const p = await getPool()
  if (!p) return false
  try {
    await runMigrations(p)
    initialized = true
    return true
  } catch (e) {
    console.error('[knowledge-store] 初始化失败:', e.message)
    return false
  }
}

/**
 * 创建完整的知识库存储句柄。
 * 在已初始化的基础上封装所有 CRUD。
 * @returns {Promise<object|null>} 存储句柄或 null。
 */
export async function createKnowledgeStore() {
  const p = await getPool()
  if (!p) return null
  if (!initialized) {
    const ok = await initKnowledgeStore()
    if (!ok) return null
  }

  /**
   * 获取当前用户 ID（单用户场景取第一个用户，兼容原 FeedFuse 的 user_id 约束）。
   * @returns {Promise<number|null>} 用户 ID 或 null。
   */
  async function getCurrentUserId() {
    const row = await queryOne(p, 'SELECT id FROM users ORDER BY id LIMIT 1')
    return row?.id || null
  }

  // —— 订阅源 ——

  async function listFeeds() {
    return query(p, 'SELECT * FROM feeds ORDER BY id')
  }

  async function getFeed(id) {
    return queryOne(p, 'SELECT * FROM feeds WHERE id = $1', [id])
  }

  async function addFeed({ title, url, siteUrl, iconUrl, platform, categoryId }) {
    const userId = await getCurrentUserId()
    const row = await queryOne(p, `
      INSERT INTO feeds (title, url, site_url, icon_url, platform, category_id, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
      RETURNING *
    `, [title, url, siteUrl || null, iconUrl || null, platform || null, categoryId || null, userId])
    return row
  }

  async function deleteFeed(id) {
    await exec(p, 'DELETE FROM feeds WHERE id = $1', [id])
    return { ok: true }
  }

  async function updateFeedFetchStatus(id, { status, error }) {
    await exec(p, `
      UPDATE feeds SET last_fetched_at = NOW(), last_fetch_status = $2, last_fetch_error = $3, updated_at = NOW()
      WHERE id = $1
    `, [id, status, error || null])
  }

  // —— 文章/视频条目 ——

  async function listArticles(filter = {}) {
    let sql = 'SELECT * FROM articles WHERE 1=1'
    const params = []
    if (filter.feedId) { params.push(filter.feedId); sql += ` AND feed_id = $${params.length}` }
    if (filter.mediaType) { params.push(filter.mediaType); sql += ` AND media_type = $${params.length}` }
    if (filter.category) { params.push(filter.category); sql += ` AND category = $${params.length}` }
    if (filter.untranscribed) { sql += ' AND transcript IS NULL' }
    if (filter.untagged) { sql += ' AND analysis_count = 0' }
    if (filter.minScore) { params.push(filter.minScore); sql += ` AND score >= $${params.length}` }
    sql += ' ORDER BY published_at DESC NULLS LAST'
    if (filter.limit) { params.push(Number(filter.limit)); sql += ` LIMIT $${params.length}` }
    return query(p, sql, params)
  }

  async function getArticle(id) {
    return queryOne(p, 'SELECT * FROM articles WHERE id = $1', [id])
  }

  async function getArticleByDedupe(feedId, dedupeKey) {
    return queryOne(p, 'SELECT * FROM articles WHERE feed_id = $1 AND dedupe_key = $2', [feedId, dedupeKey])
  }

  async function upsertArticle({ feedId, dedupeKey, title, link, author, publishedAt, contentHtml, summary, mediaType, videoUrl, durationSec, stats }) {
    const userId = await getCurrentUserId()
    const row = await queryOne(p, `
      INSERT INTO articles (feed_id, dedupe_key, title, link, author, published_at, content_html, summary, media_type, video_url, duration_sec, stats, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (feed_id, dedupe_key) DO UPDATE SET
        title = EXCLUDED.title, link = EXCLUDED.link, content_html = EXCLUDED.content_html,
        summary = EXCLUDED.summary, media_type = EXCLUDED.media_type, video_url = EXCLUDED.video_url,
        duration_sec = EXCLUDED.duration_sec, stats = EXCLUDED.stats, updated_at = NOW()
      RETURNING *
    `, [feedId, dedupeKey, title, link || null, author || null, publishedAt || null, contentHtml || null, summary || null, mediaType || 'article', videoUrl || null, durationSec || 0, stats ? JSON.stringify(stats) : null, userId])
    return row
  }

  async function updateArticle(id, patch) {
    const allowed = ['transcript', 'transcript_source', 'transcript_extracted_at', 'category', 'tags', 'score', 'priority', 'sentiment', 'note', 'is_read', 'last_analyzed_at', 'analysis_count']
    const sets = []
    const params = []
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        params.push(patch[key])
        sets.push(`${key} = $${params.length}`)
      }
    }
    if (sets.length === 0) return getArticle(id)
    params.push(id)
    const row = await queryOne(p, `UPDATE articles SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params)
    return row
  }

  async function batchIngestArticles(feedId, items) {
    let added = 0
    let updated = 0
    for (const item of items) {
      const existing = await getArticleByDedupe(feedId, item.guid || item.link)
      if (existing) {
        await upsertArticle({ feedId, ...item })
        updated++
      } else {
        await upsertArticle({ feedId, ...item })
        added++
      }
    }
    return { added, updated }
  }

  // —— 策略模板 ——

  async function listStrategies() {
    return query(p, 'SELECT * FROM strategy_templates WHERE is_active = TRUE ORDER BY is_builtin DESC, name')
  }

  async function getStrategy(id) {
    return queryOne(p, 'SELECT * FROM strategy_templates WHERE id = $1', [id])
  }

  async function getStrategyBySlug(slug) {
    return queryOne(p, 'SELECT * FROM strategy_templates WHERE slug = $1', [slug])
  }

  async function createStrategy({ name, slug, description, systemPrompt, userPromptTemplate, outputSchema, modelProvider, modelName, maxTokens }) {
    const row = await queryOne(p, `
      INSERT INTO strategy_templates (name, slug, description, system_prompt, user_prompt_template, output_schema, model_provider, model_name, max_tokens)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, system_prompt = EXCLUDED.system_prompt,
        user_prompt_template = EXCLUDED.user_prompt_template, output_schema = EXCLUDED.output_schema,
        model_provider = EXCLUDED.model_provider, model_name = EXCLUDED.model_name, max_tokens = EXCLUDED.max_tokens,
        updated_at = NOW()
      RETURNING *
    `, [name, slug, description || null, systemPrompt, userPromptTemplate, JSON.stringify(outputSchema), modelProvider || null, modelName || null, maxTokens || 2048])
    return row
  }

  async function deleteStrategy(id) {
    const strat = await getStrategy(id)
    if (!strat || strat.is_builtin) return { ok: false, error: '内置策略不可删除' }
    await exec(p, 'DELETE FROM strategy_templates WHERE id = $1', [id])
    return { ok: true }
  }

  // —— 分析结果 ——

  async function createAnalysisResult({ articleId, strategyId, result, category, tags, score, priority, sentiment, modelProvider, modelName, tokensUsed, durationMs }) {
    const row = await queryOne(p, `
      INSERT INTO analysis_results (article_id, strategy_id, result, category, tags, score, priority, sentiment, model_provider, model_name, tokens_used, duration_ms)
      VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [articleId, strategyId, JSON.stringify(result), category || null, tags || [], score || null, priority || null, sentiment || null, modelProvider || null, modelName || null, tokensUsed || null, durationMs || null])
    // 更新文章分析计数
    await exec(p, 'UPDATE articles SET analysis_count = analysis_count + 1, last_analyzed_at = NOW() WHERE id = $1', [articleId])
    return row
  }

  async function listAnalysisResults(filter = {}) {
    let sql = `
      SELECT ar.*, a.title as article_title, a.link as article_link, s.name as strategy_name
      FROM analysis_results ar
      JOIN articles a ON a.id = ar.article_id
      JOIN strategy_templates s ON s.id = ar.strategy_id
      WHERE 1=1
    `
    const params = []
    if (filter.articleId) { params.push(filter.articleId); sql += ` AND ar.article_id = $${params.length}` }
    if (filter.strategyId) { params.push(filter.strategyId); sql += ` AND ar.strategy_id = $${params.length}` }
    if (filter.category) { params.push(filter.category); sql += ` AND ar.category = $${params.length}` }
    if (filter.minScore) { params.push(filter.minScore); sql += ` AND ar.score >= $${params.length}` }
    sql += ' ORDER BY ar.created_at DESC'
    if (filter.limit) { params.push(Number(filter.limit)); sql += ` LIMIT $${params.length}` }
    return query(p, sql, params)
  }

  async function getArticleAnalysis(articleId) {
    return query(p, 'SELECT ar.*, s.name as strategy_name, s.slug as strategy_slug FROM analysis_results ar JOIN strategy_templates s ON s.id = ar.strategy_id WHERE ar.article_id = $1 ORDER BY ar.created_at DESC', [articleId])
  }

  // —— 知识库向量（pgvector）——

  async function insertEmbedding({ articleId, strategyId, chunkIndex, chunkText, chunkType, embedding, metadata }) {
    const row = await queryOne(p, `
      INSERT INTO knowledge_embeddings (article_id, strategy_id, chunk_index, chunk_text, chunk_type, embedding, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
      RETURNING id, article_id, chunk_index, chunk_text, chunk_type, created_at
    `, [articleId, strategyId || null, chunkIndex, chunkText, chunkType || 'transcript', embedding ? `[${embedding.join(',')}]` : null, metadata ? JSON.stringify(metadata) : null])
    return row
  }

  async function semanticSearch(queryEmbedding, limit = 10) {
    const rows = await query(p, `
      SELECT ke.*, a.title as article_title, a.link as article_link,
             1 - (ke.embedding <=> $1::vector) AS similarity
      FROM knowledge_embeddings ke
      JOIN articles a ON a.id = ke.article_id
      WHERE ke.embedding IS NOT NULL
      ORDER BY ke.embedding <=> $1::vector
      LIMIT $2
    `, [`[${queryEmbedding.join(',')}]`, limit])
    return rows
  }

  async function fullTextSearch(searchQuery, limit = 20) {
    const rows = await query(p, `
      SELECT ke.*, a.title as article_title, a.link as article_link,
             ts_rank(to_tsvector('simple', ke.chunk_text), plainto_tsquery('simple', $1)) AS rank
      FROM knowledge_embeddings ke
      JOIN articles a ON a.id = ke.article_id
      WHERE to_tsvector('simple', ke.chunk_text) @@ plainto_tsquery('simple', $1)
      ORDER BY rank DESC
      LIMIT $2
    `, [searchQuery, limit])
    return rows
  }

  // —— 调度器日志 ——

  async function logSchedulerRun({ jobType, status, triggeredBy, totalCount, succeededCount, failedCount, skippedCount, details, errorMessage }) {
    const row = await queryOne(p, `
      INSERT INTO scheduler_runs (job_type, status, triggered_by, total_count, succeeded_count, failed_count, skipped_count, details, error_message, finished_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $2 != 'running' THEN NOW() ELSE NULL END)
      RETURNING *
    `, [jobType, status, triggeredBy || 'scheduler', totalCount || 0, succeededCount || 0, failedCount || 0, skippedCount || 0, details ? JSON.stringify(details) : null, errorMessage || null])
    return row
  }

  async function updateSchedulerRun(id, { status, totalCount, succeededCount, failedCount, skippedCount, details, errorMessage }) {
    const row = await queryOne(p, `
      UPDATE scheduler_runs SET status = $2, total_count = $3, succeeded_count = $4, failed_count = $5, skipped_count = $6, details = $7, error_message = $8, finished_at = CASE WHEN $2 != 'running' THEN NOW() ELSE NULL END
      WHERE id = $1 RETURNING *
    `, [id, status, totalCount, succeededCount, failedCount, skippedCount, details ? JSON.stringify(details) : null, errorMessage || null])
    return row
  }

  async function listSchedulerRuns(jobType, limit = 20) {
    if (jobType) {
      return query(p, 'SELECT * FROM scheduler_runs WHERE job_type = $1 ORDER BY started_at DESC LIMIT $2', [jobType, limit])
    }
    return query(p, 'SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT $1', [limit])
  }

  // —— 聚合统计 ——

  async function getStats() {
    const [articleCount, feedCount, analysisCount, categoryBreakdown, tagBreakdown] = await Promise.all([
      queryOne(p, 'SELECT COUNT(*)::int AS c FROM articles'),
      queryOne(p, 'SELECT COUNT(*)::int AS c FROM feeds'),
      queryOne(p, 'SELECT COUNT(*)::int AS c FROM analysis_results'),
      query(p, 'SELECT category, COUNT(*)::int AS count FROM analysis_results WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC'),
      query(p, 'SELECT unnest(tags) AS tag, COUNT(*)::int AS count FROM analysis_results GROUP BY tag ORDER BY count DESC LIMIT 20'),
    ])
    return {
      articles: articleCount?.c || 0,
      feeds: feedCount?.c || 0,
      analyses: analysisCount?.c || 0,
      categories: categoryBreakdown,
      tags: tagBreakdown,
    }
  }

  // —— 分类 ——

  async function listCategories() {
    return query(p, 'SELECT * FROM categories ORDER BY position, id')
  }

  async function createCategory(name) {
    const userId = await getCurrentUserId()
    const row = await queryOne(p, 'INSERT INTO categories (name, user_id) VALUES ($1, $2) RETURNING *', [name, userId])
    return row
  }

  return {
    // 订阅源
    listFeeds, getFeed, addFeed, deleteFeed, updateFeedFetchStatus,
    // 文章
    listArticles, getArticle, getArticleByDedupe, upsertArticle, updateArticle, batchIngestArticles,
    // 策略
    listStrategies, getStrategy, getStrategyBySlug, createStrategy, deleteStrategy,
    // 分析
    createAnalysisResult, listAnalysisResults, getArticleAnalysis,
    // 知识库向量
    insertEmbedding, semanticSearch, fullTextSearch,
    // 调度器
    logSchedulerRun, updateSchedulerRun, listSchedulerRuns,
    // 聚合
    getStats, listCategories, createCategory,
    // 底层
    get pool() { return p },
  }
}

/** 检查 PostgreSQL 是否可用。 */
export async function isPostgresAvailable() {
  return !!(await getPool())
}

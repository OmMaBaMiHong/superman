/**
 * FeedFuse 分栏工作区浮层组件。
 * 在 shell.overlay slot 中渲染，提供类 FeedFuse 原项目的三栏布局：
 *   - 中栏：文章列表（可筛选/搜索）
 *   - 右栏：文章详情（视频/文案/分析/操作）
 * 
 * 使用纯 DOM 操作 + CSS，不依赖 React（与 dsh-worktable 的 React 方案不同，
 * 保持与现有插件架构一致）。
 */

import { splitStore } from './split-store.js'

// ── 样式注入 ──
const STYLE_ID = 'ff-split-overlay-styles'
const CSS = `
.ff-split-overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex; flex-direction: column;
  background: var(--background, #fff);
  color: var(--foreground, #111);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.ff-split-overlay_dark { background: #0a0a0a; color: #fafafa; }

.ff-split-header {
  display: flex; align-items: center; gap: 12px;
  height: 48px; padding: 0 16px;
  border-bottom: 1px solid var(--border, #e5e5e5);
  background: var(--card, #fafafa);
  flex-shrink: 0;
}
.ff-split-overlay_dark .ff-split-header { border-color: #262626; background: #141414; }

.ff-split-header-title { font-size: 14px; font-weight: 600; }
.ff-split-header-spacer { flex: 1; }
.ff-split-header-close {
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: transparent; cursor: pointer; font-size: 18px; line-height: 1;
  color: var(--muted-foreground, #737373);
}
.ff-split-header-close:hover { background: var(--accent, #f5f5f5); }

.ff-split-body { display: flex; flex: 1; overflow: hidden; }

/* ── 中栏：文章列表 ── */
.ff-split-list-pane {
  width: 320px; min-width: 260px; max-width: 420px;
  border-right: 1px solid var(--border, #e5e5e5);
  display: flex; flex-direction: column; overflow: hidden;
}
.ff-split-overlay_dark .ff-split-list-pane { border-color: #262626; }

.ff-split-list-header {
  padding: 10px 12px; border-bottom: 1px solid var(--border, #e5e5e5);
}
.ff-split-overlay_dark .ff-split-list-header { border-color: #262626; }

.ff-split-list-filter {
  width: 100%; padding: 6px 10px; border-radius: 6px;
  border: 1px solid var(--border, #e5e5e5);
  background: var(--background, #fff); color: var(--foreground, #111);
  font-size: 13px; outline: none;
}
.ff-split-list-filter:focus { border-color: var(--ring, #3b82f6); }

.ff-split-list-tabs { display: flex; gap: 4px; margin-top: 8px; }
.ff-split-list-tab {
  padding: 4px 10px; border-radius: 4px; border: none;
  background: transparent; cursor: pointer; font-size: 12px;
  color: var(--muted-foreground, #737373);
}
.ff-split-list-tab_active { background: var(--accent, #f5f5f5); color: var(--foreground, #111); }

.ff-split-list { flex: 1; overflow-y: auto; padding: 4px; }

.ff-split-list-item {
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent; margin-bottom: 2px;
}
.ff-split-list-item:hover { background: var(--accent, #f5f5f5); }
.ff-split-list-item_active { border-color: var(--ring, #3b82f6); background: var(--accent, #f5f5f5); }

.ff-split-list-item-title {
  font-size: 13px; font-weight: 500; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.ff-split-list-item-meta {
  display: flex; gap: 8px; margin-top: 4px; font-size: 11px;
  color: var(--muted-foreground, #737373);
}
.ff-split-list-item-tag {
  padding: 1px 6px; border-radius: 3px; font-size: 10px;
  background: var(--secondary, #f5f5f5); color: var(--secondary-foreground, #404040);
}

/* ── 右栏：文章详情 ── */
.ff-split-detail-pane { flex: 1; overflow-y: auto; padding: 20px 24px; }

.ff-split-detail-empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: var(--muted-foreground, #737373); font-size: 14px;
}

.ff-split-detail-title { font-size: 18px; font-weight: 600; line-height: 1.4; margin-bottom: 8px; }
.ff-split-detail-meta { font-size: 12px; color: var(--muted-foreground, #737373); margin-bottom: 16px; }

.ff-split-detail-video {
  width: 100%; max-width: 480px; border-radius: 8px; margin-bottom: 16px;
  background: #000;
}

.ff-split-detail-section { margin-bottom: 20px; }
.ff-split-detail-section-title {
  font-size: 13px; font-weight: 600; margin-bottom: 8px;
  color: var(--muted-foreground, #737373); text-transform: uppercase; letter-spacing: 0.5px;
}
.ff-split-detail-transcript {
  font-size: 14px; line-height: 1.7; white-space: pre-wrap;
  padding: 12px; border-radius: 8px; background: var(--card, #fafafa);
  border: 1px solid var(--border, #e5e5e5);
}
.ff-split-overlay_dark .ff-split-detail-transcript { background: #141414; border-color: #262626; }

.ff-split-detail-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ff-split-detail-btn {
  padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border, #e5e5e5);
  background: var(--background, #fff); cursor: pointer; font-size: 13px;
  color: var(--foreground, #111);
}
.ff-split-detail-btn:hover { background: var(--accent, #f5f5f5); }
.ff-split-detail-btn_primary { background: var(--primary, #3b82f6); color: #fff; border-color: transparent; }
.ff-split-detail-btn_primary:hover { opacity: 0.9; }

.ff-split-detail-analysis {
  padding: 12px; border-radius: 8px; background: var(--card, #fafafa);
  border: 1px solid var(--border, #e5e5e5); font-size: 13px; line-height: 1.6;
}
.ff-split-overlay_dark .ff-split-detail-analysis { background: #141414; border-color: #262626; }

.ff-split-detail-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.ff-split-detail-tag {
  padding: 3px 10px; border-radius: 12px; font-size: 12px;
  background: var(--secondary, #f5f5f5); color: var(--secondary-foreground, #404040);
}
`

// ── 工具函数 ──
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function isDark() {
  return document.documentElement.classList.contains('dark') ||
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatStats(stats) {
  if (!stats) return ''
  const parts = []
  if (stats.plays) parts.push(`▶ ${stats.plays.toLocaleString()}`)
  if (stats.likes) parts.push(`❤ ${stats.likes.toLocaleString()}`)
  if (stats.comments) parts.push(`💬 ${stats.comments.toLocaleString()}`)
  if (stats.shares) parts.push(`🔄 ${stats.shares.toLocaleString()}`)
  return parts.join('  ')
}

// ── 组件状态 ──
let rootEl = null
let listData = []
let filterText = ''
let activeFilter = 'all' // all | untranscribed | untagged | analyzed
let currentListener = null
let onCloseCallback = null

// ── 渲染 ──
function render() {
  if (!rootEl) return
  const dark = isDark()
  rootEl.className = 'ff-split-overlay' + (dark ? ' ff-split-overlay_dark' : '')
  rootEl.innerHTML = ''

  rootEl.appendChild(renderHeader())
  rootEl.appendChild(renderBody())
}

function renderHeader() {
  const header = document.createElement('div')
  header.className = 'ff-split-header'

  const title = document.createElement('span')
  title.className = 'ff-split-header-title'
  title.textContent = 'FeedFuse 工作台'
  header.appendChild(title)

  const spacer = document.createElement('div')
  spacer.className = 'ff-split-header-spacer'
  header.appendChild(spacer)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'ff-split-header-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', '关闭')
  closeBtn.onclick = () => {
    splitStore.close()
    if (onCloseCallback) onCloseCallback()
  }
  header.appendChild(closeBtn)

  return header
}

function renderBody() {
  const body = document.createElement('div')
  body.className = 'ff-split-body'
  body.appendChild(renderListPane())
  body.appendChild(renderDetailPane())
  return body
}

function renderListPane() {
  const pane = document.createElement('div')
  pane.className = 'ff-split-list-pane'

  // 筛选头部
  const listHeader = document.createElement('div')
  listHeader.className = 'ff-split-list-header'

  const filterInput = document.createElement('input')
  filterInput.className = 'ff-split-list-filter'
  filterInput.placeholder = '搜索文章标题...'
  filterInput.value = filterText
  filterInput.oninput = (e) => {
    filterText = e.target.value
    renderList()
  }
  listHeader.appendChild(filterInput)

  const tabs = document.createElement('div')
  tabs.className = 'ff-split-list-tabs'
  const tabDefs = [
    { id: 'all', label: '全部' },
    { id: 'untranscribed', label: '待提取' },
    { id: 'untagged', label: '待分析' },
    { id: 'analyzed', label: '已分析' },
  ]
  for (const t of tabDefs) {
    const tab = document.createElement('button')
    tab.className = 'ff-split-list-tab' + (activeFilter === t.id ? ' ff-split-list-tab_active' : '')
    tab.textContent = t.label
    tab.onclick = () => { activeFilter = t.id; renderList() }
    tabs.appendChild(tab)
  }
  listHeader.appendChild(tabs)
  pane.appendChild(listHeader)

  // 列表
  const list = document.createElement('div')
  list.className = 'ff-split-list'
  list.id = 'ff-split-list'
  pane.appendChild(list)
  renderList(list)

  return pane
}

function renderList(targetEl) {
  const list = targetEl || document.getElementById('ff-split-list')
  if (!list) return
  list.innerHTML = ''

  const filtered = listData.filter((a) => {
    if (filterText && !a.title?.toLowerCase().includes(filterText.toLowerCase())) return false
    if (activeFilter === 'untranscribed') return !a.transcript
    if (activeFilter === 'untagged') return !a.analysisCount
    if (activeFilter === 'analyzed') return a.analysisCount > 0
    return true
  })

  if (filtered.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'ff-split-detail-empty'
    empty.textContent = '暂无文章'
    list.appendChild(empty)
    return
  }

  for (const article of filtered) {
    const item = document.createElement('div')
    item.className = 'ff-split-list-item' + (splitStore.articleId === article.id ? ' ff-split-list-item_active' : '')
    item.onclick = () => splitStore.switchTo(article)

    const title = document.createElement('div')
    title.className = 'ff-split-list-item-title'
    title.textContent = article.title || '(无标题)'
    item.appendChild(title)

    const meta = document.createElement('div')
    meta.className = 'ff-split-list-item-meta'
    if (article.publishedAt) {
      const date = document.createElement('span')
      date.textContent = formatDate(article.publishedAt)
      meta.appendChild(date)
    }
    if (article.stats) {
      const stats = document.createElement('span')
      stats.textContent = formatStats(article.stats)
      meta.appendChild(stats)
    }
    item.appendChild(meta)

    if (article.tags && article.tags.length) {
      const tags = document.createElement('div')
      tags.className = 'ff-split-list-item-meta'
      for (const tag of article.tags.slice(0, 3)) {
        const tagEl = document.createElement('span')
        tagEl.className = 'ff-split-list-item-tag'
        tagEl.textContent = tag
        tags.appendChild(tagEl)
      }
      item.appendChild(tags)
    }

    list.appendChild(item)
  }
}

function renderDetailPane() {
  const pane = document.createElement('div')
  pane.className = 'ff-split-detail-pane'

  const article = splitStore.article
  if (!article) {
    const empty = document.createElement('div')
    empty.className = 'ff-split-detail-empty'
    empty.textContent = '← 从左侧选择一篇文章查看详情'
    pane.appendChild(empty)
    return pane
  }

  // 标题
  const title = document.createElement('h2')
  title.className = 'ff-split-detail-title'
  title.textContent = article.title || '(无标题)'
  pane.appendChild(title)

  // 元信息
  const meta = document.createElement('div')
  meta.className = 'ff-split-detail-meta'
  const metaParts = []
  if (article.author) metaParts.push(`作者: ${article.author}`)
  if (article.publishedAt) metaParts.push(formatDate(article.publishedAt))
  if (article.platform) metaParts.push(`平台: ${article.platform}`)
  meta.textContent = metaParts.join(' · ')
  pane.appendChild(meta)

  // 视频播放
  if (article.videoUrl) {
    const video = document.createElement('video')
    video.className = 'ff-split-detail-video'
    video.controls = true
    video.src = `/feedfuse/video?id=${article.id}`
    video.preload = 'metadata'
    pane.appendChild(video)
  }

  // 操作按钮
  const actions = document.createElement('div')
  actions.className = 'ff-split-detail-actions'

  const extractBtn = document.createElement('button')
  extractBtn.className = 'ff-split-detail-btn'
  extractBtn.textContent = '提取文案'
  extractBtn.onclick = () => onExtractTranscript(article.id)
  actions.appendChild(extractBtn)

  const analyzeBtn = document.createElement('button')
  analyzeBtn.className = 'ff-split-detail-btn ff-split-detail-btn_primary'
  analyzeBtn.textContent = 'AI 分析'
  analyzeBtn.onclick = () => onAnalyze(article.id)
  actions.appendChild(analyzeBtn)

  const rewriteBtn = document.createElement('button')
  rewriteBtn.className = 'ff-split-detail-btn'
  rewriteBtn.textContent = '二创改写'
  rewriteBtn.onclick = () => onRewrite(article.id)
  actions.appendChild(rewriteBtn)

  pane.appendChild(actions)

  // 文案
  if (article.transcript) {
    const section = document.createElement('div')
    section.className = 'ff-split-detail-section'

    const sectionTitle = document.createElement('div')
    sectionTitle.className = 'ff-split-detail-section-title'
    sectionTitle.textContent = '文案内容'
    section.appendChild(sectionTitle)

    const transcript = document.createElement('div')
    transcript.className = 'ff-split-detail-transcript'
    transcript.textContent = article.transcript
    section.appendChild(transcript)

    pane.appendChild(section)
  }

  // 分析结果
  if (article.analysisResults && article.analysisResults.length > 0) {
    const section = document.createElement('div')
    section.className = 'ff-split-detail-section'

    const sectionTitle = document.createElement('div')
    sectionTitle.className = 'ff-split-detail-section-title'
    sectionTitle.textContent = '分析结果'
    section.appendChild(sectionTitle)

    for (const result of article.analysisResults) {
      const analysis = document.createElement('div')
      analysis.className = 'ff-split-detail-analysis'
      analysis.textContent = JSON.stringify(result.result, null, 2)
      section.appendChild(analysis)
    }

    pane.appendChild(section)
  }

  // 标签
  if (article.tags && article.tags.length) {
    const section = document.createElement('div')
    section.className = 'ff-split-detail-section'

    const sectionTitle = document.createElement('div')
    sectionTitle.className = 'ff-split-detail-section-title'
    sectionTitle.textContent = '标签'
    section.appendChild(sectionTitle)

    const tags = document.createElement('div')
    tags.className = 'ff-split-detail-tags'
    for (const tag of article.tags) {
      const tagEl = document.createElement('span')
      tagEl.className = 'ff-split-detail-tag'
      tagEl.textContent = tag
      tags.appendChild(tagEl)
    }
    section.appendChild(tags)

    pane.appendChild(section)
  }

  return pane
}

// ── 操作回调（由外部注入） ──
let handlers = {
  onExtractTranscript: async (id) => { console.warn('[split-overlay] onExtractTranscript 未设置', id) },
  onAnalyze: async (id) => { console.warn('[split-overlay] onAnalyze 未设置', id) },
  onRewrite: async (id) => { console.warn('[split-overlay] onRewrite 未设置', id) },
}

function onExtractTranscript(id) { handlers.onExtractTranscript(id) }
function onAnalyze(id) { handlers.onAnalyze(id) }
function onRewrite(id) { handlers.onRewrite(id) }

// ── 公开 API ──

/** 初始化并挂载分栏工作区 */
export function mountSplitOverlay(articles, options = {}) {
  injectStyles()
  onCloseCallback = options.onClose || null
  handlers.onExtractTranscript = options.onExtractTranscript || handlers.onExtractTranscript
  handlers.onAnalyze = options.onAnalyze || handlers.onAnalyze
  handlers.onRewrite = options.onRewrite || handlers.onRewrite

  listData = articles || []
  filterText = ''
  activeFilter = 'all'

  if (!rootEl) {
    rootEl = document.createElement('div')
    rootEl.id = 'ff-split-overlay'
  }
  document.body.appendChild(rootEl)

  render()

  // 订阅状态变化
  if (currentListener) currentListener()
  currentListener = splitStore.subscribe(() => {
    if (splitStore.active) {
      render()
    } else {
      unmountSplitOverlay()
    }
  })

  return rootEl
}

/** 更新文章列表数据 */
export function updateSplitArticles(articles) {
  listData = articles || []
  renderList()
}

/** 更新当前选中文章 */
export function updateSplitArticle(article) {
  if (splitStore.active && splitStore.articleId === article?.id) {
    splitStore.updateArticle(article)
    render()
  }
}

/** 卸载分栏工作区 */
export function unmountSplitOverlay() {
  if (currentListener) { currentListener(); currentListener = null }
  if (rootEl && rootEl.parentNode) {
    rootEl.parentNode.removeChild(rootEl)
  }
}

/** 打开文章详情工作区 */
export function openArticleWorkspace(article, articles, options) {
  if (!rootEl || !document.body.contains(rootEl)) {
    mountSplitOverlay(articles, options)
  }
  splitStore.open(article)
}

/** 兼容旧名 */
export function mountSplitArticles(articles, options = {}) {
  return mountSplitOverlay(articles, options)
}

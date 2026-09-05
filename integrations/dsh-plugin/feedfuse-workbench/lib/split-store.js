/**
 * FeedFuse 分栏工作区状态引擎。
 * 管理文章详情面板的打开/关闭/切换状态。
 * 仿 dsh-worktable 的 splitStore，简化为单文章详情模式。
 */

const listeners = new Set()

/** @type {{ active: boolean, articleId: null | string, article: null | object }} */
const state = {
  active: false,
  articleId: null,
  article: null,
}

export const splitStore = {
  get active() { return state.active },
  get articleId() { return state.articleId },
  get article() { return state.article },

  /** 打开文章详情工作区 */
  open(article) {
    if (!article || !article.id) return
    state.active = true
    state.articleId = article.id
    state.article = article
    listeners.forEach((fn) => { try { fn() } catch {} })
  },

  /** 关闭工作区 */
  close() {
    state.active = false
    state.articleId = null
    state.article = null
    listeners.forEach((fn) => { try { fn() } catch {} })
  },

  /** 切换到另一篇文章 */
  switchTo(article) {
    if (!article || !article.id) return
    state.articleId = article.id
    state.article = article
    listeners.forEach((fn) => { try { fn() } catch {} })
  },

  /** 更新当前文章数据（如分析完成后刷新） */
  updateArticle(article) {
    if (!article || !state.active || article.id !== state.articleId) return
    state.article = { ...state.article, ...article }
    listeners.forEach((fn) => { try { fn() } catch {} })
  },

  /** 订阅状态变化 */
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

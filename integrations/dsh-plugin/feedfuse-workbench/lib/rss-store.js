/**
 * feedfuse-workbench 自包含 RSS 存储与解析（零依赖，本地 JSON 落盘）。
 *
 * 原插件把 RSS 订阅/文章/分类都交给 FeedFuse 后端 9559 维护。本模块把该能力
 * 内联进 DSH 进程：用 Node 内置 fetch 抓取 RSS/Atom，手写 mini 解析器，把
 * 订阅源与文章快照存到插件私有 data 目录的 JSON 文件，彻底不依赖外部服务。
 *
 * 数据契约对齐原 client.js 消费方：
 *   - feed:    { id, title, url, platform, categoryId, unreadCount, iconUrl, lastError }
 *   - category: { id, name }
 *   - article: { id, title, link, publishedAt, previewImage, summary, author,
 *                mediaType('video'|'article'), videoUrl, durationSec, stats }
 *   - article 详情额外含 contentHtml
 *
 * 源分两类：普通 RSS/Atom 地址，以及「平台博主源」（`rsshub://douyin/user/<secUid>`
 * 或抖音主页地址）—— 后者用插件内建浏览器抓博主作品，产出同构条目，因此订阅列表、
 * 作品列表、详情、文案提取共用一条链路。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { openSqliteStore } from './sqlite-store.js'
import { findBrowser, captureWorks, defaultProfileDir } from './douyin-browser.js'

/** 订阅分类（内置，避免外部数据库）。 */
const CATEGORIES = [
  { id: 1, name: '短视频' },
  { id: 2, name: '自媒体' },
  { id: 3, name: '技术' },
]

/**
 * 内置订阅源默认为空，避免写入误导性的外部源。用户从 cordis.yml 通过
 * config.feeds 提供自己的订阅源即可；缺省时 RSS tab 展示「暂无订阅」引导。
 */
const DEFAULT_FEEDS = []

/**
 * 「发现订阅源」内置推荐（对齐原 FeedFuse `recommended_feeds` 种子数据，
 * 取自 Folo Discover 热门榜单）。后续接入 Postgres 后改读 `recommended_feeds` 表。
 */
const DEFAULT_RECOMMENDED = [
  { title: 'Trending repositories on GitHub today', url: 'https://rsshub.app/github/trending/daily/any', siteUrl: 'https://github.com/trending', description: 'GitHub 每日 Trending 仓库，46.6K 订阅者。' },
  { title: 'OpenAI News', url: 'https://openai.com/news/rss.xml', siteUrl: 'https://openai.com', description: 'OpenAI 官方新闻动态，46.6K 订阅者。' },
  { title: '36氪 - 24小时热榜', url: 'https://rsshub.app/36kr/hot-list', siteUrl: 'https://36kr.com', description: '36氪 24小时热榜，15.2K 订阅者。' },
  { title: '让小产品的独立变现更简单 - ezindie.com', url: 'https://www.ezindie.com/feed/rss.xml', siteUrl: 'https://www.ezindie.com', description: '独立开发者变现经验分享，3.0K 订阅者。' },
  { title: '科学网 - 精选博文', url: 'https://rsshub.app/sciencenet/blog', siteUrl: 'https://blog.sciencenet.cn', description: '科学网精选博文，2.9K 订阅者。' },
  { title: 'Anthropic Research', url: 'https://rsshub.app/anthropic/research', siteUrl: 'https://anthropic.com', description: 'Anthropic 最新研究成果，2.7K 订阅者。' },
  { title: '橘鸦AI早报', url: 'https://imjuya.github.io/juya-ai-daily/rss.xml', siteUrl: 'https://imjuya.github.io', description: 'AI 领域每日早报精选，2.7K 订阅者。' },
  { title: '华尔街日报', url: 'https://cn.wsj.com/rss-news/26/', siteUrl: 'https://cn.wsj.com', description: '华尔街日报中文网，2.5K 订阅者。' },
  { title: 'Hacker News', url: 'https://hnrss.org/frontpage', siteUrl: 'https://news.ycombinator.com', description: 'Hacker News 首页热帖，2.4K 订阅者。' },
  { title: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', siteUrl: 'https://www.ruanyifeng.com/blog', description: '科技爱好者周刊与技术分享，2.3K 订阅者。' },
  { title: 'sspai 少数派', url: 'https://sspai.com/feed', siteUrl: 'https://sspai.com', description: '数字生活与效率工具精选，2.2K 订阅者。' },
  { title: 'V2EX 最新主题', url: 'https://www.v2ex.com/index.xml', siteUrl: 'https://v2ex.com', description: 'V2EX 社区最新主题，2.0K 订阅者。' },
]

/** RSS 相关的 SQLite 表。 */
const RSS_TABLES = ['meta', 'categories', 'feeds', 'articles', 'recommended']

/** 旧 JSON 存储文件名（仅首次启动迁移用）。 */
const LEGACY_JSON_FILE = 'rss.json'

/** 「发现订阅源」内置推荐种子（对齐原 FeedFuse `recommended_feeds`）。 */
const DEFAULT_RECOMMENDED_DOCS = null

/**
 * 首次启动把旧 rss.json 迁入 SQLite。仅在库为空且历史 JSON 存在数据时执行，
 * 迁移后由 save() 落盘，故不会重复迁移。
 */
function migrateLegacyJson(store, legacyPath, defaultCategories) {
  if (!existsSync(legacyPath)) return
  let legacy
  try {
    legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
  } catch {
    return
  }
  if (!legacy || !(Array.isArray(legacy.feeds) || Array.isArray(legacy.articles) || Array.isArray(legacy.categories))) return
  for (const c of Array.isArray(legacy.categories) ? legacy.categories : defaultCategories) {
    store.set('categories', c.id, c)
  }
  for (const f of Array.isArray(legacy.feeds) ? legacy.feeds : []) store.set('feeds', f.id, f)
  for (const a of Array.isArray(legacy.articles) ? legacy.articles : []) store.set('articles', a.id, a)
  store.setMeta({
    nextId: legacy.nextId ?? 200,
    nextArticleId: legacy.nextArticleId ?? 1,
    nextCategoryId: legacy.nextCategoryId ?? 50,
  })
}

function createStore({ dataDir, dbFilePath }) {
  const store = openSqliteStore({ dataDir, dbFilePath, tables: RSS_TABLES })
  const defaultCategories = CATEGORIES.map((c) => ({ id: c.id, name: c.name }))
  const defaultRecommended = DEFAULT_RECOMMENDED.map((r) => ({ id: r.url, title: r.title, url: r.url, siteUrl: r.siteUrl, description: r.description }))

  // 首次启动迁移旧 rss.json（仅当库为空且历史 JSON 有数据）。
  if (store.count('feeds') === 0 && store.count('articles') === 0) {
    migrateLegacyJson(store, join(dataDir, LEGACY_JSON_FILE), defaultCategories)
  }

  const meta = store.getMeta({ nextId: 200, nextArticleId: 1, nextCategoryId: 50 })
  const data = {
    nextId: meta.nextId,
    nextArticleId: meta.nextArticleId,
    nextCategoryId: meta.nextCategoryId,
    categories: store.all('categories'),
    feeds: store.all('feeds'),
    articles: store.all('articles'),
    recommended: store.all('recommended'),
  }

  // 首次启动：写入内置分类与「发现」推荐种子，保证列表非空。
  if (data.categories.length === 0) { data.categories = defaultCategories }
  if (data.recommended.length === 0) {
    data.recommended = defaultRecommended
    // 立即落库：否则推荐种子只存在于内存，首次进入「发现订阅源」页为空。
    save()
  }

  function save() {
    store.clear('categories')
    for (const c of data.categories) store.set('categories', c.id, c)
    store.clear('feeds')
    for (const f of data.feeds) store.set('feeds', f.id, f)
    store.clear('articles')
    for (const a of data.articles) store.set('articles', a.id, a)
    store.clear('recommended')
    for (const r of data.recommended) store.set('recommended', r.id, r)
    store.setMeta({
      nextId: data.nextId,
      nextArticleId: data.nextArticleId,
      nextCategoryId: data.nextCategoryId,
    })
  }

  function nextFeedId() {
    // 复用内置源 id 范围外的新 id
    let id = data.nextId
    data.nextId += 1
    return id
  }

  function nextArticleId() {
    let id = data.nextArticleId
    data.nextArticleId += 1
    return id
  }

  /** 分类列表（含用户新增的分类）。 */
  function categories() {
    return data.categories
  }

  /** 校验/解析一个普通 RSS 地址：抓取并返回 { ok, title, siteUrl }；失败抛可读错误。 */
  async function validateFeed(url) {
    const u = String(url || '').trim()
    if (!u) throw new Error('缺少订阅地址')
    const r = await fetchFeed(u)
    return { ok: true, title: r.title, siteUrl: r.siteUrl }
  }

  /** 新增订阅源；重复 URL 返回 { ok:false, code:409 }。支持分类名自动创建。 */
  async function addFeed(input) {
    const rawUrl = String(input.url || '').trim()
    if (!rawUrl) return { ok: false, code: 400, error: '缺少订阅地址' }
    // 平台博主源归一化：裸 secUid / 主页地址统一存成 rsshub://douyin/user/<secUid>。
    const ref = parsePlatformRef(rawUrl)
    const url = ref ? `rsshub://douyin/user/${ref.secUid}` : rawUrl
    if (data.feeds.some((f) => f.url === url)) return { ok: false, code: 409, error: '该订阅源已存在' }

    let categoryId = null
    const rawCid = input.categoryId
    if (rawCid != null && rawCid !== '' && String(rawCid) !== 'null') {
      categoryId = Number(rawCid)
    } else if (input.categoryName) {
      const name = String(input.categoryName).trim()
      if (name && name !== '未分类') {
        const existing = data.categories.find((c) => c.name === name)
        if (existing) categoryId = existing.id
        else {
          categoryId = data.nextCategoryId
          data.nextCategoryId += 1
          data.categories.push({ id: categoryId, name })
        }
      }
    }

    const feed = {
      id: nextFeedId(),
      title: String(input.title || '').trim() || (ref ? '抖音博主' : feedTitleFromUrl(url)),
      url,
      platform: ref ? ref.platform : null,
      siteUrl: input.siteUrl || (ref ? ref.homeUrl : null),
      categoryId,
      iconUrl: null,
      lastError: null,
      needLogin: false,
    }
    data.feeds.push(feed)
    save()
    return { ok: true, feed: { id: feed.id, title: feed.title, url: feed.url, siteUrl: feed.siteUrl, platform: feed.platform, categoryId, iconUrl: feed.iconUrl } }
  }

  /** 取消订阅：删除源并级联删除其文章。 */
  function deleteFeed(id) {
    const fid = Number(id)
    const idx = data.feeds.findIndex((f) => f.id === fid)
    if (idx < 0) return { ok: false, error: '订阅源不存在' }
    data.feeds.splice(idx, 1)
    data.articles = data.articles.filter((a) => a.feedId !== fid)
    save()
    return { ok: true, feedId: fid }
  }

  /** 「发现订阅源」推荐列表。 */
  function recommended() {
    return data.recommended
  }

  return {
    data,
    save,
    nextFeedId,
    nextArticleId,
    categories,
    validateFeed,
    addFeed,
    deleteFeed,
    recommended,
  }
}

// —— mini RSS/Atom 解析 ——

function decodeXmlEntities(s) {
  return String(s == null ? '' : s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function stripHtml(s) {
  return decodeXmlEntities(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function extractHref(tag) {
  const m = /href="([^"]*)"/i.exec(tag)
  return m ? m[1] : ''
}

/**
 * 从条目块里找视频直链与时长：RSS 的 `<enclosure type="video/*">`、
 * `<media:content type="video/*" url>`、`<media:player url>`，时长取
 * `<media:content duration>` 或 `<itunes:duration>`。
 * @param {string} b - 单个 item/entry 的 XML 片段。
 * @returns {{videoUrl: string|null, durationSec: number}} 视频信息（无视频时 videoUrl 为 null）。
 */
function extractVideo(b) {
  const dec = decodeXmlEntities(b)
  let videoUrl = null
  const enc = /<enclosure[^>]*url="([^"]*)"[^>]*type="video[^"]*"/i.exec(b)
    || /<enclosure[^>]*type="video[^"]*"[^>]*url="([^"]*)"/i.exec(b)
  if (enc) videoUrl = enc[1]
  if (!videoUrl) {
    const mc = /<(?:media:content|media:player)[^>]*type="video[^"]*"[^>]*url="([^"]*)"/i.exec(b)
      || /<(?:media:content|media:player)[^>]*url="([^"]*)"[^>]*type="video[^"]*"/i.exec(b)
    if (mc) videoUrl = mc[1]
  }
  if (!videoUrl) {
    const src = /<video[^>]*src="([^"]*)"/i.exec(dec)
    if (src) videoUrl = src[1]
  }
  const dur = (/<(?:media:content|itunes:duration)[^>]*(?:duration="([^"]*)"|>([^<]*)<)/i.exec(b) || [])[1]
    || (/<(?:media:content|itunes:duration)[^>]*(?:duration="([^"]*)"|>([^<]*)<)/i.exec(b) || [])[2]
    || ''
  let durationSec = 0
  const text = String(dur).trim()
  if (/^\d+(\.\d+)?$/.test(text)) durationSec = Math.round(Number(text))
  else if (/^\d+:\d+(:\d+)?$/.test(text)) {
    durationSec = text.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
  }
  return { videoUrl: videoUrl || null, durationSec }
}

/**
 * 解析 RSS 2.0 / Atom XML 文本为 { title, siteUrl, items }。
 * items 每项含 guid/id、title、link、publishedAt(ISO)、summary、contentHtml、image，
 * 以及内容类型判定所需的 mediaType（'video' | 'article'）、videoUrl、durationSec。
 * 纯函数，独立导出以便测试与复用。
 */
export function parseFeedXml(xml) {
  const isAtom = /xmlns="[^"]*Atom"/i.test(xml) || /<feed\b/i.test(xml) && !/^<\?xml[\s\S]*<rss\b/i.test(xml)

  const titleMatch = isAtom
    ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(xml)
    : /<channel>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i.exec(xml)
  const feedTitle = titleMatch ? decodeXmlEntities(titleMatch[1]).trim() : '未命名源'

  const linkMatch = isAtom
    ? /<link[^>]*href="([^"]*)"[^>]*\/>/i.exec(xml) || /<link[^>]*rel="alternate"[^>]*href="([^"]*)"[^>]*>/i.exec(xml)
    : /<channel>[\s\S]*?<link>([\s\S]*?)<\/link>/i.exec(xml)
  const siteUrl = linkMatch ? (linkMatch[1] || linkMatch[2] || '').trim() : ''

  const tag = isAtom ? 'entry' : 'item'
  const blockRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
  const blocks = []
  let m
  while ((m = blockRe.exec(xml)) !== null) blocks.push(m[1])

  const items = blocks.map((b) => {
    const gid = (/<guid[^>]*>([\s\S]*?)<\/guid>/i.exec(b) || /<id[^>]*>([\s\S]*?)<\/id>/i.exec(b) || [])[1] || ''
    const title = (isAtom
      ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(b)
      : /<title[^>]*>([\s\S]*?)<\/title>/i.exec(b) || [])[1] || ''
    const rawLink = isAtom
      ? (extractHref((/<link[^>]*alt=["']alternate["'][^>]*>/i.exec(b) || [])[0]) || extractHref((/<link[^>]*>/i.exec(b) || [])[0]))
      : ((/<link[^>]*>([\s\S]*?)<\/link>/i.exec(b) || [])[1] || '').trim()
    const rawPub = (isAtom
      ? (/\<published[^>]*>([\s\S]*?)<\/published>/i.exec(b) || /\<updated[^>]*>([\s\S]*?)<\/updated>/i.exec(b) || [])[1]
      : (/\<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(b) || [])[1] || '') || ''
    const rawContent = (isAtom
      ? (/\<content[^>]*>([\s\S]*?)<\/content>/i.exec(b) || [])[1]
      : (/\<description[^>]*>([\s\S]*?)<\/description>/i.exec(b) || [])[1] || '') || ''

    let image = null
    const enc = /<enclosure[^>]*url="([^"]*)"[^>]*type="image[^"]*"/i.exec(b)
    if (enc) image = enc[1]
    if (!image) {
      const thumb = /<(media:thumbnail|media:content|itunes:image)[^>]*url="([^"]*)"[^>]*>/i.exec(b)
      if (thumb) image = thumb[2]
    }
    if (!image) {
      const img = /<img[^>]*src="([^"]*)"/i.exec(decodeXmlEntities(rawContent))
      if (img) image = img[1]
    }

    const video = extractVideo(b)

    return {
      guid: decodeXmlEntities(gid).trim(),
      title: stripHtml(title),
      link: decodeXmlEntities(rawLink),
      publishedAt: normalizeDate(rawPub),
      summary: stripHtml(rawContent),
      contentHtml: rawContent,
      image,
      videoUrl: video.videoUrl,
      durationSec: video.durationSec,
      mediaType: video.videoUrl ? 'video' : 'article',
    }
  })

  return { title: feedTitle, siteUrl, items }
}

function normalizeDate(v) {
  if (!v) return new Date().toISOString()
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return new Date().toISOString()
  return new Date(t).toISOString()
}

/** 抓取并解析一个源，返回 { feedMeta, items }；失败抛错（带可读原因）。 */
async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; feedfuse-workbench/0.4; +https://deepseek-harness)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
  const xml = await res.text()
  return parseFeedXml(xml)
}

/**
 * 识别「平台博主源」。支持三种写法，返回统一的 secUid 与主页地址：
 *   - `rsshub://douyin/user/<secUid>`（FeedFuse 风格的订阅串）
 *   - `https://www.douyin.com/user/<secUid>`（主页地址）
 *   - 裸 secUid（`MS4wLjABAAAA...`）
 * @param {string} url - 订阅地址。
 * @returns {{platform: string, secUid: string, homeUrl: string} | null} 非平台源返回 null。
 */
export function parsePlatformRef(url) {
  const raw = String(url || '').trim()
  if (!raw) return null
  const m = /(?:douyin[/\\]user[/\\]|douyin\.com[/\\]user[/\\])(MS4wLjABAAAA[\w-]+)/.exec(raw)
  if (m) return { platform: 'douyin', secUid: m[1], homeUrl: `https://www.douyin.com/user/${m[1]}` }
  if (/^MS4wLjABAAAA/.test(raw)) return { platform: 'douyin', secUid: raw, homeUrl: `https://www.douyin.com/user/${raw}` }
  return null
}

/**
 * 平台博主源的抓取：抖音走插件内建浏览器（拦截主页作品接口），产出与
 * `fetchFeed` 同构的 `{ title, siteUrl, items }`，因此订阅列表、作品列表、
 * 详情、文案提取全部复用普通 RSS 源那条链路。
 * @param {object} feed - 订阅源（用它的 url）。
 * @param {object} config - 插件配置（chromePath / douyinCookie / dataDir / douyinMaxWorks）。
 * @param {{light?: boolean}} [options] - light 用于新增源时的标题探测（只取首屏）。
 * @returns {Promise<{title: string|null, siteUrl: string, items: object[]}>}
 */
async function fetchPlatformFeed(feed, config, options = {}) {
  const ref = parsePlatformRef(feed.url)
  const browser = findBrowser(config)
  if (!browser) {
    const e = new Error('本机没有可用的 Chrome/Chromium，无法抓取抖音博主（可安装 Chrome 或在设置里配 chromePath / RSSHub 备用源）')
    e.reason = 'no-browser'
    throw e
  }
  const r = await captureWorks({
    secUid: ref.secUid,
    chromePath: browser,
    profileDir: defaultProfileDir(config.dataDir || 'feedfuse-data'),
    cookie: String(config.douyinCookie || '').trim() || undefined,
    maxWorks: options.light ? 12 : (Number(config.douyinMaxWorks) || 100),
    scrollRounds: options.light ? 0 : undefined,
  })
  if (!r.ok) {
    const e = new Error(r.detail || r.reason || '抖音作品抓取失败')
    e.reason = r.reason
    e.needLogin = r.reason === 'no-login' || r.reason === 'empty'
    throw e
  }
  const author = (r.user && r.user.nickname) || null
  return {
    title: author || feed.title,
    siteUrl: ref.homeUrl,
    items: r.works.map((w) => ({
      guid: w.awemeId,
      title: w.title,
      link: w.link,
      publishedAt: w.time ? new Date(w.time * 1000).toISOString() : new Date().toISOString(),
      summary: w.title,
      contentHtml: `<img src="${w.cover || ''}" /><p>${w.title}</p>`,
      image: w.cover || null,
      videoUrl: w.playUrl || null,
      durationSec: Math.round((w.duration || 0) / 1000),
      mediaType: 'video',
      stats: w.stats,
      author: author || '',
    })),
  }
}

/** 抓取一个源：平台博主源走内建浏览器，其余按 RSS 地址抓取。 */
async function fetchAnyFeed(feed, config) {
  return parsePlatformRef(feed.url) ? fetchPlatformFeed(feed, config) : fetchFeed(feed.url)
}

/** 把 items 落库为新 article 记录，返回本次新增条数。 */
function ingestArticles(st, feedId, items) {
  const existingKeys = new Set(st.data.articles.filter((a) => a.feedId === feedId).map((a) => a.guid))
  let added = 0
  for (const item of items) {
    const key = item.guid || item.link
    if (!key || existingKeys.has(key)) continue
    existingKeys.add(key)
    st.data.articles.push({
      id: st.nextArticleId(),
      feedId,
      guid: key,
      title: item.title || '无标题',
      link: item.link,
      publishedAt: item.publishedAt,
      summary: item.summary,
      contentHtml: item.contentHtml,
      previewImage: item.image || null,
      author: item.author || '',
      read: false,
      // 内容类型与视频信息：视频条目（抖音/B站等）带可播直链、时长与平台统计。
      mediaType: item.mediaType || (item.videoUrl ? 'video' : 'article'),
      videoUrl: item.videoUrl || null,
      durationSec: item.durationSec || 0,
      stats: item.stats || null,
    })
    added += 1
  }
  if (added > 0) st.save()
  return added
}

function unreadCount(st, feedId) {
  return st.data.articles.filter((a) => a.feedId === feedId && !a.read).length
}

export function rssStatus() {
  return { ok: true, feeds: activeStore ? activeStore.data.feeds.length : 0, articles: activeStore ? activeStore.data.articles.length : 0 }
}

// 记录最近一次创建的模块 store，供 rssStatus 读取（仅统计用途）。
let activeStore = null

/**
 * 初始化插件：注入 config.feeds（缺省为空），执行一次刷新。
 * 返回一个带方法与 state 的对象；dataDir 来自 config。
 */
export function createRssModule(config) {
  const dataDir = config.dataDir || 'feedfuse-data'
  const st = createStore({ dataDir, dbFilePath: config.dbFilePath })
  activeStore = st

  // 首次运行注入 config 提供的源（无则保持空，交 UI 展示引导）
  if (st.data.feeds.length === 0) {
    const builtins = (config.feeds && config.feeds.length ? config.feeds : DEFAULT_FEEDS)
    for (const f of builtins) {
      st.data.feeds.push({
        id: st.nextFeedId(),
        title: f.title || feedTitleFromUrl(f.url),
        url: f.url,
        categoryId: f.categoryId || 3,
        iconUrl: f.iconUrl || null,
        lastError: null,
      })
    }
    st.save()
  }

  async function refreshFeed(feed) {
    // 抓取时刻先行记录：慢源/失败源据此按 fetchIntervalMinutes 退避，不被每次视图进入打满。
    feed.lastFetchAt = Date.now()
    try {
      const { title, items } = await fetchAnyFeed(feed, config)
      feed.title = title || feed.title
      feed.siteUrl = feed.siteUrl || (parsePlatformRef(feed.url) || {}).homeUrl || null
      feed.lastError = null
      feed.needLogin = false
      ingestArticles(st, feed.id, items)
      return { ok: true, added: items.length }
    } catch (e) {
      feed.lastError = e instanceof Error ? e.message : String(e)
      feed.needLogin = !!(e && e.needLogin)
      return { ok: false, error: feed.lastError, reason: (e && e.reason) || null, needLogin: !!feed.needLogin }
    }
  }

  /** 刷新全部源（并发）。 */
  async function refreshAll() {
    const feeds = st.data.feeds
    const results = await Promise.all(feeds.map((f) => refreshFeed(f)))
    st.save()
    return results
  }

  /** 抓取间隔（毫秒），来自 config.fetchIntervalMinutes（缺省 30 分钟）。 */
  function refreshIntervalMs() {
    const minutes = Number(config.fetchIntervalMinutes)
    return (Number.isFinite(minutes) && minutes >= 1 ? minutes : 30) * 60_000
  }

  /**
   * 增量刷新：只抓超过抓取间隔未更新的源（从未抓取过一律视为过期）。
   * 视图进入时调用，使「打开就热更新」不必等重启；手动刷新按钮走 refreshAll/refresh。
   */
  async function refreshStale() {
    const maxAge = refreshIntervalMs()
    const now = Date.now()
    const stale = st.data.feeds.filter((f) => !f.lastFetchAt || now - f.lastFetchAt > maxAge)
    if (stale.length === 0) return []
    const results = await Promise.all(stale.map((f) => refreshFeed(f)))
    st.save()
    return results
  }

  /**
   * snapshot：view=all 返回全部分类+源；view=<feedId> 返回该源文章。
   * 结构对齐 client 期望 { categories, feeds, articles }。
   */
  async function snapshot(view, limit) {
    // 进入视图时按抓取间隔增量刷新（过期才真抓，避免频繁打网络）。
    await refreshStale()

    const out = {
      categories: st.categories(),
      feeds: st.data.feeds.map((f) => ({
        id: f.id,
        title: f.title,
        url: f.url,
        platform: f.platform || parsePlatformRef(f.url)?.platform || null,
        siteUrl: f.siteUrl || null,
        categoryId: f.categoryId,
        unreadCount: unreadCount(st, f.id),
        iconUrl: f.iconUrl,
        lastError: f.lastError,
        needLogin: !!f.needLogin,
        lastFetchAt: f.lastFetchAt || null,
      })),
      articles: [],
    }
    const feeds = st.data.feeds

    if (view && String(view) !== 'all') {
      const fid = Number(view)
      const list = st.data.articles
        .filter((a) => a.feedId === fid)
        .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
      out.articles = list.slice(0, Number(limit) || 200).map(toArticleDto)
      // 标记该源已读
      const changed = list.filter((a) => !a.read)
      if (changed.length) {
        changed.forEach((a) => { a.read = true })
        st.save()
      }
    } else {
      const list = st.data.articles.slice().sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
      out.articles = list.slice(0, Number(limit) || 200).map(toArticleDto)
    }

    return out
  }

  /** 文章详情。 */
  function article(id) {
    const a = st.data.articles.find((x) => String(x.id) === String(id))
    if (!a) return { ok: false, error: '文章不存在' }
    return { ok: true, article: toArticleDto(a, true) }
  }

  /**
   * 回写文章级字段（加工台产物：文案、标签、评分等），只接受白名单键。
   * @param {string|number} id - 文章 id。
   * @param {object} patch - 待写入字段。
   * @returns {{ok: boolean, article?: object, error?: string}} 结果。
   */
  function updateArticle(id, patch) {
    const a = st.data.articles.find((x) => String(x.id) === String(id))
    if (!a) return { ok: false, error: '文章不存在' }
    const allowed = ['transcript', 'transcriptSource', 'tags', 'score', 'category', 'sentiment', 'priority', 'note', 'read', 'structured_tags']
    for (const key of allowed) {
      if (patch[key] !== undefined) a[key] = patch[key]
    }
    a.processedAt = new Date().toISOString()
    st.save()
    return { ok: true, article: toArticleDto(a, true) }
  }

  /**
   * 按条件筛选文章（加工台队列）。
   * @param {object} filter - { mediaType, feedId, untranscribed, untagged, limit }
   * @returns {object[]} 文章 dto 列表（按发布时间倒序）。
   */
  function listArticles(filter = {}) {
    let list = st.data.articles.slice()
    if (filter.feedId) list = list.filter((a) => String(a.feedId) === String(filter.feedId))
    if (filter.mediaType) list = list.filter((a) => (a.mediaType || (a.videoUrl ? 'video' : 'article')) === filter.mediaType)
    if (filter.untranscribed) list = list.filter((a) => !a.transcript)
    if (filter.untagged) list = list.filter((a) => !a.tags)
    list.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    return list.slice(0, Number(filter.limit) || 200).map((a) => toArticleDto(a, false))
  }

  function toArticleDto(a, full) {
    const dto = {
      id: a.id,
      title: a.title,
      link: a.link,
      publishedAt: a.publishedAt,
      summary: a.summary,
      previewImage: a.previewImage,
      author: a.author,
      feedId: a.feedId,
      // 内容类型与视频信息（抖音/B站等平台源带可播直链、时长与平台统计）
      mediaType: a.mediaType || (a.videoUrl ? 'video' : 'article'),
      videoUrl: a.videoUrl || null,
      durationSec: a.durationSec || 0,
      stats: a.stats || null,
      // 二次加工状态：文案、标签、评分（由加工台写入）
      transcript: a.transcript || null,
      transcriptSource: a.transcriptSource || null,
      tags: a.tags || null,
      score: a.score == null ? null : a.score,
      category: a.category || null,
      sentiment: a.sentiment || null,
      priority: a.priority == null ? null : a.priority,
      note: a.note || null,
      structured_tags: a.structured_tags || null,
      processedAt: a.processedAt || null,
    }
    if (full) dto.contentHtml = a.contentHtml
    return dto
  }

  /** 刷新单个源（按 id）。 */
  async function refresh(id) {
    const feed = st.data.feeds.find((f) => f.id === Number(id))
    if (!feed) return { ok: false, error: '订阅源不存在' }
    const r = await refreshFeed(feed)
    st.save()
    return r
  }

  /**
   * 校验一个订阅 URL：平台博主源用内建浏览器轻量抓一次首屏（顺带拿博主昵称作源标题），
   * 其余按普通 RSS 抓取。
   * @param {string} url - 订阅地址。
   * @returns {Promise<{ok: boolean, title: string, siteUrl: string|null, platform: string|null}>}
   */
  async function validateFeed(url) {
    const u = String(url || '').trim()
    if (!u) throw new Error('缺少订阅地址')
    const ref = parsePlatformRef(u)
    if (ref) {
      const r = await fetchPlatformFeed({ url: u }, config, { light: true })
      return { ok: true, title: r.title, siteUrl: r.siteUrl, platform: ref.platform }
    }
    const r = await st.validateFeed(u)
    return { ok: true, title: r.title, siteUrl: r.siteUrl, platform: null }
  }

  return {
    get feeds() { return st.data.feeds },
    snapshot,
    article,
    refreshAll,
    refresh,
    validateFeed,
    updateArticle,
    listArticles,
    categories: st.categories,
    addFeed: st.addFeed,
    deleteFeed: st.deleteFeed,
    recommended: st.recommended,
  }
}

function feedTitleFromUrl(url) {
  let host = ''
  try { host = new URL(url).hostname } catch { /* ignore */ }
  return host || url
}
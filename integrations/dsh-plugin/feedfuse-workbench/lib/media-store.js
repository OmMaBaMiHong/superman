/**
 * feedfuse-workbench 自包含自媒体模块（抖音作品 + 视频素材）。
 *
 * 原 FeedFuse 的「我的作品」逻辑（myWorksService.ts）从 RSSHub 的 douyin/user
 * 订阅读取，解析正文里的 data-douyin-stats 标签拿到作品统计；素材表
 * (workspace_materials) 记录本地下载的文件。两者都依赖 FeedFuse 的 PostgreSQL。
 *
 * 本模块把它们内联化：
 *   - 我的作品：抓取 config.douyinFeedUrl（用户自己抖音主页的 RSSHub 订阅），
 *     从 contentHtml 解析 data-douyin-stats，得到「作品 + 统计」清单。
 *   - 视频素材：每次 downloadVideo 成功后登记一条记录。
 * 数据落在与 RSS 共用的 SQLite 库文件（config.dbFilePath，缺省 feedfuse-data/feedfuse.sqlite），
 * 用独立 metaKey 保存自身计数器，不依赖外部服务或数据库。
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { openSqliteStore } from './sqlite-store.js'
import { parseFeedXml } from './rss-store.js'
import { captureWorks, findBrowser, loginFlow, loginStatus, defaultProfileDir } from './douyin-browser.js'

const DOUYIN_HOSTS = ['douyin.com', 'iesdouyin.com']

/** 自媒体模块的 SQLite 表。 */
const MEDIA_TABLES = ['meta', 'works', 'materials']

/** 自媒体模块独立的元数据键（与 rss 的 `feedfuse:meta` 互不冲突）。 */
const MEDIA_META_KEY = 'feedfuse:media:meta'

/** 旧 JSON 存储文件名（仅首次启动迁移用）。 */
const LEGACY_JSON_FILE = 'media.json'

export function isDouyinUrl(url) {
  try {
    const host = new URL(url).hostname
    return DOUYIN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** 从 contentHtml 提取 data-douyin-stats 属性值（与 FeedFuse stats.ts 一致）。 */
function extractDouyinStatsTag(html) {
  const m = String(html || '').match(/<div\s+data-douyin-stats="([^"]+)"/)
  return m ? m[1] : null
}

/** 解析 data-douyin-stats 键值对（entity 编码的 &amp; → &）。 */
function parseDouyinStatsTag(tag) {
  const result = {}
  const decoded = String(tag || '').replace(/&amp;/g, '&')
  for (const pair of decoded.split('&')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = decodeURIComponent(pair.slice(0, idx))
    const val = decodeURIComponent(pair.slice(idx + 1))
    result[key] = val
  }
  return result
}

/** 从正文解析完整作品统计；无标记返回 null。 */
export function parseDouyinStatsFromHtml(html) {
  const tag = extractDouyinStatsTag(html)
  if (!tag) return null
  const raw = parseDouyinStatsTag(tag)
  const awemeId = raw.aweme_id || ''
  if (!awemeId) return null
  const durationSec = Number(raw.duration) || 0
  return {
    awemeId,
    createTime: Number(raw.create_time) || 0,
    duration: Math.round(durationSec * 1000),
    stats: {
      plays: Number(raw.play_count) || 0,
      likes: Number(raw.digg_count) || 0,
      comments: Number(raw.comment_count) || 0,
      shares: Number(raw.share_count) || 0,
      collects: Number(raw.collect_count) || 0,
    },
  }
}

/** 从正文提取第一张图片作为封面。 */
function extractCoverImage(html) {
  const m = String(html || '').match(/<img\s+[^>]*src="([^"]+)"[^>]*\/?>/i)
  return m ? m[1] : ''
}

/** 解析作品链接片段中的 aweme_id（通用兜底）。 */
function awemeIdFromLink(link) {
  const m = /(?:video|note)\/(\d+)/.exec(String(link || ''))
  return m ? m[1] : ''
}

function createStore({ dataDir, dbFilePath }) {
  const store = openSqliteStore({ dataDir, dbFilePath, metaKey: MEDIA_META_KEY, tables: MEDIA_TABLES })

  // 首次启动迁移旧 media.json（仅当库为空且历史 JSON 有数据）。
  if (store.count('works') === 0 && store.count('materials') === 0) {
    migrateLegacyJson(store, join(dataDir, LEGACY_JSON_FILE))
  }

  const meta = store.getMeta({ nextMaterialId: 1, lastFetchError: null, lastFeedId: null })
  const data = {
    works: store.all('works'),
    materials: store.all('materials'),
    nextMaterialId: meta.nextMaterialId,
    lastFetchError: meta.lastFetchError,
    lastFeedId: meta.lastFeedId,
  }

  function save() {
    store.clear('works')
    for (const w of data.works) store.set('works', w.awemeId, w)
    store.clear('materials')
    for (const m of data.materials) store.set('materials', m.id, m)
    store.setMeta({ nextMaterialId: data.nextMaterialId, lastFetchError: data.lastFetchError, lastFeedId: data.lastFeedId })
  }

  return { data, save }
}

/** 首次把旧 media.json 迁入 SQLite，仅当库为空时才执行。 */
function migrateLegacyJson(store, legacyPath) {
  if (!existsSync(legacyPath)) return
  let legacy
  try {
    legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
  } catch {
    return
  }
  if (!legacy) return
  for (const w of Array.isArray(legacy.works) ? legacy.works : []) {
    if (w && w.awemeId) store.set('works', w.awemeId, w)
  }
  for (const m of Array.isArray(legacy.materials) ? legacy.materials : []) {
    if (m && m.id != null) store.set('materials', m.id, m)
  }
  store.setMeta({
    ...(store.getMeta({})),
    nextMaterialId: legacy.nextMaterialId ?? 1,
    lastFetchError: legacy.lastFetchError ?? null,
  })
}

export function createMediaModule(config) {
  const dataDir = config.dataDir || 'feedfuse-data'
  const st = createStore({ dataDir, dbFilePath: config.dbFilePath })

  /**
   * 解析 secUid。接受四种写法，任一即可：
   *   1. 裸 secUid：`MS4wLjABAAAA...`；
   *   2. FeedFuse 风格的 RSSHub 订阅串：`rsshub://douyin/user/<secUid>`；
   *   3. RSSHub http 订阅地址：`https://<base>/douyin/user/<secUid>`；
   *   4. 抖音主页地址：`https://www.douyin.com/user/<secUid>`。
   * @returns {string | null} secUid，识别不出返回 null。
   */
  function resolveSecUid() {
    const raw = String(config.douyinUid || config.douyinFeedUrl || '').trim()
    if (!raw) return null
    const m = /(?:douyin[/\\]user[/\\]|douyin\.com[/\\]user[/\\])(MS4wLjABAAAA[\w-]+)/.exec(raw)
    if (m) return m[1]
    if (/^MS4wLjABAAAA/.test(raw)) return raw
    return null
  }

  /**
   * 备用来源：RSSHub 订阅地址。`rsshub://` 前缀按 `config.rsshubBase` 还原成 http 地址，
   * 未配 rsshubBase 时视为不可用（公共实例的 /douyin/user 需要服务端浏览器 + 登录 Cookie）。
   * @returns {string | null}
   */
  function resolveRssHubUrl(secUid) {
    const explicit = String(config.douyinFeedUrl || '').trim()
    if (explicit && !explicit.startsWith('rsshub://') && /^https?:\/\//.test(explicit)) return explicit
    const base = String(config.rsshubBase || '').trim()
    if (!base || !secUid) return null
    return `${base.replace(/\/+$/, '')}/douyin/user/${secUid}`
  }

  /** 当前配置的取数来源（browser 优先，rsshub 备用；douyinSource 可显式锁定）。 */
  function resolveSource(secUid) {
    const raw = String(config.douyinSource || 'auto')
    // 配置里写错来源不应静默改变取数路径，非法值一律按 auto。
    const want = raw === 'browser' || raw === 'rsshub' ? raw : 'auto'
    const browserPath = findBrowser(config)
    const rssUrl = resolveRssHubUrl(secUid)
    if (want === 'rsshub') return { kind: 'rsshub', url: rssUrl }
    if (secUid && browserPath) return { kind: 'browser', chromePath: browserPath, profileDir: defaultProfileDir(config.dataDir || 'feedfuse-data') }
    return { kind: 'rsshub', url: rssUrl }
  }

  /** 当前配置的取数来源标识（浏览器抓取为 douyin://user/<secUid>，否则为 RSSHub 订阅地址）。 */
  function feedUrl() {
    const secUid = resolveSecUid()
    if (!secUid) return config.douyinFeedUrl || null
    const source = resolveSource(secUid)
    return source.kind === 'browser' ? `douyin://user/${secUid}` : (source.url || `https://www.douyin.com/user/${secUid}`)
  }

  function configHint() {
    if (resolveSecUid()) return null
    return '未配置自媒体源。请在设置里填「抖音 secUid」（或「抖音作品订阅地址」，支持 rsshub://douyin/user/<secUid> 写法），也可以直接填你的抖音主页地址。'
  }

  /** 抓取来源诊断（供 /feedfuse/status 与界面提示）。 */
  function sourceStatus() {
    const secUid = resolveSecUid()
    const source = resolveSource(secUid)
    return {
      secUid,
      kind: secUid ? source.kind : 'none',
      browser: findBrowser(config),
      profileDir: defaultProfileDir(config.dataDir || 'feedfuse-data'),
      rssHubUrl: resolveRssHubUrl(secUid),
      cookieConfigured: !!String(config.douyinCookie || '').trim(),
    }
  }

  /** 走 RSSHub 订阅地址抓取（备用来源）。 */
  async function fetchViaRssHub(url) {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; feedfuse-workbench/0.4; +https://deepseek-harness)' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`RSSHub 抓取失败 HTTP ${res.status}`)
    const parsed = parseFeedXml(await res.text())
    const works = []
    for (const item of parsed.items) {
      const stats = parseDouyinStatsFromHtml(item.contentHtml)
      // 无 stats 标签也可能抓到普通作品，用链接里的 aweme_id 兜底，统计置 0
      const awemeId = stats ? stats.awemeId : awemeIdFromLink(item.link)
      if (!awemeId) continue
      works.push({
        awemeId,
        title: item.title || `视频 ${awemeId}`,
        time: stats ? stats.createTime : 0,
        duration: stats ? stats.duration : 0,
        cover: item.image || '',
        stats: stats ? stats.stats : { plays: 0, likes: 0, comments: 0, shares: 0, collects: 0 },
        link: item.link,
        publishedAt: item.publishedAt,
      })
    }
    return works
  }

  /** 落库一次成功抓取：作品、来源标识与错误清除一起提交。 */
  function commitWorks(works, sourceId) {
    st.data.works = works
    st.data.lastFeedId = sourceId
    st.data.lastFetchError = null
    st.save()
  }

  /**
   * 抓取「我的作品」（含统计）。优先插件内建的浏览器抓取，回退 RSSHub 订阅地址。
   * 失败时返回结构化 reason，界面据此给可执行提示（如「登录抖音」）。
   */
  async function fetchMyWorks() {
    const secUid = resolveSecUid()
    if (!secUid) return { ok: false, reason: 'unconfigured', error: configHint() }
    const source = resolveSource(secUid)

    if (source.kind === 'browser') {
      const r = await captureWorks({
        secUid,
        chromePath: source.chromePath,
        profileDir: source.profileDir,
        cookie: String(config.douyinCookie || '').trim() || undefined,
        maxWorks: Number(config.douyinMaxWorks) || 100,
      })
      if (r.ok) {
        const works = r.works.map((w) => ({ ...w, publishedAt: w.time ? new Date(w.time * 1000).toISOString() : null }))
        const browserId = `douyin://user/${secUid}`
        commitWorks(works, browserId)
        return { ok: true, feedId: browserId, items: works }
      }
      // 浏览器抓取失败：有 RSSHub 地址就再试一次，否则把原因交回界面
      const fallback = resolveRssHubUrl(secUid)
      if (fallback) {
        try {
          const works = await fetchViaRssHub(fallback)
          commitWorks(works, fallback)
          return { ok: true, feedId: fallback, items: works }
        } catch { /* 落到下面返回浏览器失败原因 */ }
      }
      st.data.lastFetchError = r.detail || r.reason
      st.save()
      return { ok: false, reason: r.reason, feedId: `douyin://user/${secUid}`, error: r.detail || '抖音作品抓取失败', needLogin: r.reason === 'no-login' || r.reason === 'empty' }
    }

    if (!source.url) {
      return { ok: false, reason: 'no-browser', error: '本机没有可用的 Chrome/Chromium，且未配置 RSSHub 订阅地址。装一个 Chrome，或在设置里填「RSSHub 基础地址」。' }
    }
    try {
      const works = await fetchViaRssHub(source.url)
      commitWorks(works, source.url)
      return { ok: true, feedId: source.url, items: works }
    } catch (e) {
      st.data.lastFetchError = e instanceof Error ? e.message : String(e)
      st.save()
      return { ok: false, reason: 'rsshub', feedId: source.url, error: st.data.lastFetchError }
    }
  }

  /**
   * 打开可见浏览器窗口让用户扫码登录抖音；登录态落在插件 profile 里复用。
   * @returns {Promise<{ ok: boolean, reason?: string, detail?: string }>}
   */
  async function douyinLogin() {
    const browser = findBrowser(config)
    if (!browser) return { ok: false, reason: 'no-browser', detail: '本机没有可用的 Chrome/Chromium，无法打开登录窗口。' }
    return loginFlow({ chromePath: browser, profileDir: defaultProfileDir(config.dataDir || 'feedfuse-data') })
  }

  /** 查询插件 profile 里是否已有抖音登录态。 */
  async function douyinLoginStatus() {
    const browser = findBrowser(config)
    if (!browser) return { ok: false, loggedIn: false, reason: 'no-browser', detail: '本机没有可用的 Chrome/Chromium。' }
    return loginStatus({ chromePath: browser, profileDir: defaultProfileDir(config.dataDir || 'feedfuse-data') })
  }

  return {
    /**
     * myworks 端点：返回 { feedId, items, summary }，对齐 client zmt tab 契约。
     * 缓存已拉取作品，避免每次刷新都打网络；可用 force 强制刷新。
     * 失败时额外带回 reason / needLogin，界面据此给出「登录抖音」等可执行入口。
     */
    async myWorks(force) {
      if (force || st.data.works.length === 0) {
        const r = await fetchMyWorks()
        if (!r.ok && st.data.works.length === 0) {
          return { feedId: r.feedId || feedUrl(), items: [], summary: null, error: r.error, reason: r.reason || null, needLogin: !!r.needLogin, configHint: configHint() }
        }
      }
      const items = st.data.works
      const summary = items.length > 0
        ? {
            total: items.length,
            totalPlays: items.reduce((s, v) => s + v.stats.plays, 0),
            totalLikes: items.reduce((s, v) => s + v.stats.likes, 0),
            totalComments: items.reduce((s, v) => s + v.stats.comments, 0),
            totalShares: items.reduce((s, v) => s + v.stats.shares, 0),
            totalCollects: items.reduce((s, v) => s + v.stats.collects, 0),
          }
        : null
      return { feedId: st.data.lastFeedId || feedUrl(), items, summary, error: st.data.lastFetchError || null, configHint: configHint() }
    },

    /** 取数来源诊断：secUid、来源类型、浏览器路径、profile、RSSHub 地址、Cookie 是否已配。 */
    sourceStatus,

    /** 打开可见浏览器窗口扫码登录抖音（登录态落在插件 profile 里长期复用）。 */
    douyinLogin,

    /** 查询插件 profile 是否已有抖音登录态。 */
    douyinLoginStatus,

    /** materials 端点：本地素材清单（下载视频后登记）。 */
    materials() {
      return st.data.materials.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    },

    /** 登记一条下载素材（downloadVideo 成功后调用）。 */
    addMaterial({ title, fileName, filePath, fileSize }) {
      let size = fileSize
      if (size == null) {
        try { size = statSync(filePath).size } catch { size = 0 }
      }
      const rec = {
        id: st.data.nextMaterialId++,
        kind: 'video',
        title: title || fileName || basename(filePath || ''),
        fileName,
        filePath,
        fileSize: size,
        mimeType: 'video/mp4',
        createdAt: new Date().toISOString(),
      }
      st.data.materials.push(rec)
      st.save()
      return rec
    },

    /** mediators 供 status 端点展示。 */
    status() {
      return { worksCount: st.data.works.length, materialsCount: st.data.materials.length, lastFetchError: st.data.lastFetchError, feedUrl: feedUrl(), configHint: configHint() }
    },
  }
}
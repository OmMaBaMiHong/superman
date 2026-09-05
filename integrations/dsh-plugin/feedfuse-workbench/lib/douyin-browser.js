/**
 * 抖音作品抓取（插件内建，零外部依赖）。
 *
 * RSSHub 的 `/douyin/user` 路由自己标注了 `requirePuppeteer: true / antiCrawler: true`：
 * 它在服务端开一个无头浏览器打开主页、拦截 `/aweme/v1/web/aweme/post/` 的响应，
 * 并且必须带抖音登录态才拿得到数据（实测无登录态时该接口回 200 空正文，页面显示
 * 「服务异常」）。公共实例因此普遍不可用。本模块把这条路由所需的能力内建进插件：
 * 用 Node 内置 `fetch` + 全局 `WebSocket` 直接驱动本机 Chrome/Chromium 的 DevTools
 * 协议，不引入 playwright/puppeteer，也不依赖任何外部常驻服务。
 *
 * 登录态有两条来源，按优先级：
 *   1. `config.douyinCookie` —— 用户从浏览器复制的 Cookie 串，逐条注入调试会话；
 *   2. 持久化 profile（`<dataDir>/douyin-profile`）—— 首次由 `loginFlow()` 开一个
 *      可见窗口让用户扫码，Cookie 留在该 profile 里，之后静默复用。
 *
 * 失败原因以结构化 `reason` 返回（no-browser / launch / no-login / empty / timeout），
 * 由调用方翻成界面提示，不在此处猜用户意图。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** 作品接口（RSSHub 的 douyin/user 路由拦截的是同一个接口）。 */
const POST_API_MARK = '/aweme/v1/web/aweme/post/'

/** 判定登录态的 Cookie 名：出现任一即认为已登录。 */
const LOGIN_COOKIE_NAMES = ['sessionid', 'sessionid_ss', 'sid_tt']

/** 候选浏览器路径（macOS / Linux / Windows）。 */
const BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

/** Playwright 缓存的 Chromium（本机已装过 playwright 浏览器时可直接复用）。 */
function playwrightChromiumCandidates() {
  const roots = [
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ]
  const out = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    let names = []
    try { names = readdirSync(root) } catch { continue }
    for (const n of names.filter((x) => x.startsWith('chromium')).sort().reverse()) {
      out.push(join(root, n, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
      out.push(join(root, n, 'chrome-linux', 'chrome'))
    }
  }
  return out
}

/**
 * 找到可用的浏览器可执行文件。
 * @param {object} config - 插件配置，读 `chromePath`。
 * @returns {string | null} 绝对路径，找不到返回 null。
 */
export function findBrowser(config = {}) {
  if (config.chromePath && existsSync(config.chromePath)) return config.chromePath
  for (const p of [...BROWSER_CANDIDATES, ...playwrightChromiumCandidates()]) {
    if (existsSync(p)) return p
  }
  return null
}

/** 挑一个空闲调试端口（避免复用 profile 时读到上一次留下的 DevToolsActivePort）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 把用户粘贴的 Cookie 串（`a=1; b=2` 或原始请求头）拆成 setCookie 参数。 */
function splitCookie(cookieHeader, url) {
  return String(cookieHeader || '')
    .split(/;\s*/)
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes('='))
    .map((pair) => {
      const idx = pair.indexOf('=')
      return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim(), url }
    })
}

/**
 * 启动一个浏览器调试会话并交出 CDP 发送句柄。
 * @param {object} options - 启动参数。
 * @param {string} options.chromePath - 浏览器可执行文件。
 * @param {string} options.profileDir - 独立 user-data-dir（登录态就存这里）。
 * @param {boolean} [options.headless] - false 时开可见窗口（扫码登录用）。
 * @returns {Promise<{ send: Function, close: () => void, sessionId: string }>}
 */
async function openSession({ chromePath, profileDir, headless = true }) {
  const port = await freePort()
  const args = [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--lang=zh-CN',
    '--window-size=1280,900',
    'about:blank',
  ]
  const child = spawn(chromePath, args, { stdio: 'ignore', detached: false })
  const exited = new Promise((_, reject) => {
    child.once('exit', (code) => reject(new Error(`浏览器进程退出（code ${code}）`)))
  })
  exited.catch(() => { /* 由调用方处理 */ })

  const versionUrl = `http://127.0.0.1:${port}/json/version`
  let version = null
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      version = await (await fetch(versionUrl)).json()
      break
    } catch {
      await sleep(250)
    }
  }
  if (!version) {
    child.kill('SIGTERM')
    throw new Error('浏览器调试端口未就绪（可能被安全策略拦截）')
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await Promise.race([
    new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP WebSocket 连接失败')) }),
    exited,
  ])

  let seq = 0
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined) {
      const slot = pending.get(msg.id)
      if (slot) {
        pending.delete(msg.id)
        if (msg.error) slot.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else slot.resolve(msg.result)
      }
      return
    }
    for (const fn of listeners) fn(msg)
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)

  return {
    send: (method, params) => send(method, params, sessionId),
    onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    close() {
      try { ws.close() } catch { /* 已关闭 */ }
      try { child.kill('SIGTERM') } catch { /* 已退出 */ }
    },
  }
}

/** 启动一个浏览器调试会话（导出供视频 URL 刷新等复用）。 */
export { openSession }

/** 读取当前 profile 对抖音的 Cookie。 */
async function douyinCookies(session) {
  const r = await session.send('Network.getCookies', { urls: ['https://www.douyin.com/'] })
  return r.cookies || []
}

/**
 * 扫码登录：开一个可见浏览器窗口停在抖音首页，轮询登录 Cookie。
 * @param {object} options - { chromePath, profileDir, timeoutMs }
 * @returns {Promise<{ ok: boolean, reason?: string, detail?: string }>}
 */
export async function loginFlow({ chromePath, profileDir, timeoutMs = 240000 }) {
  const session = await openSession({ chromePath, profileDir, headless: false })
  try {
    await session.send('Page.navigate', { url: 'https://www.douyin.com/' })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const cookies = await douyinCookies(session)
      if (cookies.some((c) => LOGIN_COOKIE_NAMES.includes(c.name))) return { ok: true }
      await sleep(2000)
    }
    return { ok: false, reason: 'timeout', detail: '登录超时（未在窗口内完成登录）' }
  } finally {
    session.close()
  }
}

/**
 * 当前登录态：profile 里是否已有可用的抖音登录 Cookie。
 * @param {object} options - { chromePath, profileDir }
 * @returns {Promise<{ ok: boolean, loggedIn: boolean, reason?: string, detail?: string }>}
 */
export async function loginStatus({ chromePath, profileDir }) {
  const session = await openSession({ chromePath, profileDir })
  try {
    await session.send('Page.navigate', { url: 'https://www.douyin.com/' })
    await sleep(3000)
    const cookies = await douyinCookies(session)
    return { ok: true, loggedIn: cookies.some((c) => LOGIN_COOKIE_NAMES.includes(c.name)) }
  } catch (e) {
    return { ok: false, loggedIn: false, reason: 'launch', detail: e instanceof Error ? e.message : String(e) }
  } finally {
    session.close()
  }
}

/** 把一个 aweme 条目规整成插件的作品结构（与 RSSHub 解析结果同形）。 */
function toWork(aweme) {
  const st = aweme.statistics || {}
  const cover = (aweme.video && aweme.video.cover && aweme.video.cover.url_list && aweme.video.cover.url_list[0])
    || (aweme.images && aweme.images[0] && aweme.images[0].url_list && aweme.images[0].url_list[0])
    || ''
  // 可播直链：play_addr 是带时效、校验 Referer 的 CDN 地址，播放需经插件端代理。
  const playList = (aweme.video && aweme.video.play_addr && aweme.video.play_addr.url_list) || []
  return {
    awemeId: String(aweme.aweme_id || ''),
    title: String(aweme.desc || '').trim() || `视频 ${aweme.aweme_id || ''}`,
    time: Number(aweme.create_time) || 0,
    duration: Math.round(Number((aweme.video && aweme.video.duration) || 0)),
    cover,
    playUrl: playList[0] || '',
    stats: {
      plays: Number(st.play_count) || 0,
      likes: Number(st.digg_count) || 0,
      comments: Number(st.comment_count) || 0,
      shares: Number(st.share_count) || 0,
      collects: Number(st.collect_count) || 0,
    },
    link: aweme.share_url || `https://www.douyin.com/video/${aweme.aweme_id}`,
  }
}

/**
 * 触发下一页：抖音主页的作品列表挂在内部滚动容器上，只滚 window 不一定翻页，
 * 因此同时滚窗口与页面上可滚动距离最大的元素。
 */
const SCROLL_EXPR = `(() => {
  window.scrollTo(0, document.body.scrollHeight);
  const scrollers = Array.from(document.querySelectorAll('*')).filter((e) => (
    e.scrollHeight > e.clientHeight + 200 && e.clientHeight > 300
  ));
  scrollers.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  if (scrollers[0]) scrollers[0].scrollTop = scrollers[0].scrollHeight;
  return scrollers.length;
})()`

/**
 * 抓取一个抖音主页的作品列表。
 * @param {object} options - 抓取参数。
 * @param {string} options.secUid - 主页 secUid（`MS4wLjABAAAA...`）。
 * @param {string} options.chromePath - 浏览器路径。
 * @param {string} options.profileDir - 持久化 profile 目录（登录态来源）。
 * @param {string} [options.cookie] - 可选 Cookie 串，优先于 profile 注入。
 * @param {number} [options.maxWorks] - 作品数上限。
 * @param {number} [options.scrollRounds] - 下拉翻页轮数。
 * @returns {Promise<{ ok: boolean, works?: object[], reason?: string, detail?: string }>}
 */
export async function captureWorks({ secUid, chromePath, profileDir, cookie, maxWorks = 100, scrollRounds = 8 }) {
  const session = await openSession({ chromePath, profileDir })
  const pages = []
  const off = session.onEvent((msg) => {
    if (msg.method === 'Network.responseReceived' && String(msg.params?.response?.url || '').includes(POST_API_MARK)) {
      pages.push({ requestId: msg.params.requestId, status: msg.params.response.status, done: false })
    }
    if (msg.method === 'Network.loadingFinished') {
      const hit = pages.find((p) => p.requestId === msg.params.requestId)
      if (hit) hit.done = true
    }
  })
  try {
    if (cookie) {
      const items = splitCookie(cookie, 'https://www.douyin.com/')
      if (items.length) await session.send('Network.setCookies', { cookies: items })
    }
    await session.send('Page.navigate', { url: `https://www.douyin.com/user/${secUid}` })
    await sleep(12000)

    const works = new Map()
    let idleRounds = 0
    for (let round = 0; round <= scrollRounds; round++) {
      await collectPages(session, pages, works)
      if (works.size >= maxWorks) break
      const before = works.size
      await session.send('Runtime.evaluate', { expression: SCROLL_EXPR, returnByValue: true }).catch(() => null)
      await sleep(4000)
      idleRounds = works.size === before ? idleRounds + 1 : 0
      if (idleRounds >= 3) break
    }
    await collectPages(session, pages, works)

    if (works.size === 0) {
      const failed = pages.filter((p) => p.status !== 200)
      if (pages.length === 0) {
        const text = await session.send('Runtime.evaluate', { expression: '(document.body.innerText||"").slice(0,120)', returnByValue: true }).catch(() => null)
        return { ok: false, reason: 'no-login', detail: `未截到作品接口；页面内容：${String(text?.result?.value || '').replace(/\s+/g, ' ')}` }
      }
      return { ok: false, reason: failed.length ? 'no-login' : 'empty', detail: failed.length ? `作品接口返回 HTTP ${failed[0].status}` : '作品接口返回空列表（多为登录态失效）' }
    }
    // 主页标题形如「柱子哥TzFilm的抖音 - 抖音」，剥掉后缀即博主昵称，用作订阅源标题。
    const titleResult = await session.send('Runtime.evaluate', { expression: 'document.title || ""', returnByValue: true }).catch(() => null)
    const nickname = String(titleResult?.result?.value || '')
      .replace(/的抖音\s*-\s*抖音$/, '')
      .replace(/\s*-\s*抖音$/, '')
      .trim()
    return {
      ok: true,
      user: { secUid, nickname: nickname || null },
      works: [...works.values()].sort((a, b) => b.time - a.time).slice(0, maxWorks),
    }
  } finally {
    off()
    session.close()
  }
}

/** 把已完成的作品接口响应读出来并合并进 works（按 aweme_id 去重）。 */
async function collectPages(session, pages, works) {
  for (const p of pages) {
    if (!p.done || p.read) continue
    p.read = true
    let text = ''
    try {
      const body = await session.send('Network.getResponseBody', { requestId: p.requestId })
      text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
    } catch { continue }
    if (!text) continue
    let parsed = null
    try { parsed = JSON.parse(text) } catch { continue }
    for (const aweme of parsed.aweme_list || []) {
      const w = toWork(aweme)
      if (w.awemeId) works.set(w.awemeId, w)
    }
  }
}

/**
 * 把已登录 profile 的抖音 Cookie 导出成 Netscape cookies.txt，供 yt-dlp
 * `--cookies` 使用（抖音的字幕与音频轨在无 Cookie 时取不到）。
 * @param {object} options - { chromePath, profileDir, outFile }
 * @returns {Promise<{ok: boolean, file?: string, count?: number, reason?: string}>}
 */
export async function exportCookieFile({ chromePath, profileDir, outFile }) {
  const session = await openSession({ chromePath, profileDir })
  try {
    await session.send('Page.navigate', { url: 'https://www.douyin.com/' })
    await sleep(3000)
    const cookies = await douyinCookies(session)
    if (cookies.length === 0) return { ok: false, reason: 'no-cookies' }
    const lines = ['# Netscape HTTP Cookie File', '# 由 feedfuse-workbench 从插件浏览器 profile 导出']
    for (const c of cookies) {
      const domain = String(c.domain || '')
      const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE'
      const secure = c.secure ? 'TRUE' : 'FALSE'
      const expiry = Number(c.expires) > 0 ? Math.round(Number(c.expires)) : 0
      lines.push([domain, flag, c.path || '/', secure, expiry, c.name, c.value].join('\t'))
    }
    writeFileSync(outFile, lines.join('\n') + '\n', { mode: 0o600 })
    return { ok: true, file: outFile, count: cookies.length }
  } finally {
    session.close()
  }
}

/** 默认 profile 目录（放在插件 dataDir 下，随插件数据一起管理）。 */
export function defaultProfileDir(dataDir) {
  return join(dataDir || tmpdir(), 'douyin-profile')
}

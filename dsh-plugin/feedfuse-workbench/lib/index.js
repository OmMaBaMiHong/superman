/**
 * feedfuse-workbench host 半。
 *
 * 持久插件的 Node 半：通过 webServer 暴露 /feedfuse/* HTTP 路由，
 * 代理到本地 FeedFuse 后端（默认 http://127.0.0.1:9559），把登录、
 * 会话 cookie、数据拉取都留在 Node 侧，浏览器 client 只发同源 fetch。
 *
 * 数据源仍是 FeedFuse 真实后端：登录用项目 .env 的 AUTH_INITIAL_PASSWORD，
 * 后续请求带 feedfuse_session cookie。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'feedfuse-workbench'
const DEFAULT_BASE_URL = 'http://127.0.0.1:9559'
const FEEDFUSE_DIR = '/Users/wade/work-space/pa-chong-cai-ji/FeedFuse'

/** 「视频 → 下载/提取/改写/口播」工作流技能正文（Markdown 指令 + 口播模板）。 */
const SKILL_CONTENT = `# FeedFuse 视频工作流

当用户要求「下载视频 / 提取文案 / 改写文案 / 生成口播脚本」，或用户输入以 /feedfuse 开头时，按下面流程执行。

## 可用工具
- feedfuse_extract_transcript：提取视频文案（优先字幕，否则语音识别）
- feedfuse_download_video：下载视频到 FeedFuse 本地工作区

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

export const name = NAME
// webServer 只在 web profile 存在；用 scoped inject 避免 headless 下永远等待。
export const inject = []

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(data.length) })
  res.end(data)
}

/** 从 FeedFuse .env 读取 AUTH_INITIAL_PASSWORD（可选）。 */
function readInitialPassword(workspaceRoot) {
  try {
    const envPath = join(workspaceRoot || FEEDFUSE_DIR, '.env')
    const text = readFileSync(envPath, 'utf8')
    const m = /^AUTH_INITIAL_PASSWORD=(.*)$/m.exec(text)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

export function apply(ctx, config = {}) {
  // 这些是模块级单例状态：一次登录复用 cookie，跨请求共享。
  // 放在 apply 外会 pin 在模块缓存（插件 reload 后残留），放这里随 fiber 生命期。
  const state = {
    baseUrl: (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
    username: config.username || 'admin',
    password: typeof config.password === 'string' ? config.password : null,
    cookie: null,
    workspaceRoot: '',
  }

  // 可选读取 workspace root，用于定位 .env。
  const sp = ctx.get('sandboxPolicy')
  if (sp && sp.workspaceRoot) state.workspaceRoot = sp.workspaceRoot

  async function doLogin() {
    if (!state.password) state.password = readInitialPassword(state.workspaceRoot)
    if (!state.password) return { ok: false, error: '未找到初始密码：请在 FeedFuse .env 配置 AUTH_INITIAL_PASSWORD' }
    let res
    try {
      res = await fetch(`${state.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: state.username, password: state.password }),
      })
    } catch (e) {
      return { ok: false, error: `FeedFuse 未运行于 ${state.baseUrl}` }
    }
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    const session = setCookies.find((c) => c.startsWith('feedfuse_session='))
    if (!session) {
      const raw = res.headers.get('set-cookie') || ''
      const m = /feedfuse_session=([^;,\s]+)/.exec(raw)
      if (!m) return { ok: false, error: `登录失败：FeedFuse 未返回会话 cookie（HTTP ${res.status}）` }
      state.cookie = `feedfuse_session=${m[1]}`
    } else {
      state.cookie = session.split(';')[0]
    }
    return { ok: true, baseUrl: state.baseUrl }
  }

  async function ensureAuthed() {
    if (state.cookie) return { ok: true }
    return doLogin()
  }

  /** GET FeedFuse 端点，返回 {ok, status, data}；401 时重登录一次。 */
  async function ffGet(path) {
    let authed = await ensureAuthed()
    if (!authed.ok) return authed
    let res
    try {
      res = await fetch(`${state.baseUrl}${path}`, { headers: { cookie: state.cookie } })
    } catch (e) {
      return { ok: false, error: `请求 FeedFuse 失败：${state.baseUrl}${path}` }
    }
    if (res.status === 401) {
      state.cookie = null
      authed = await ensureAuthed()
      if (!authed.ok) return authed
      try {
        res = await fetch(`${state.baseUrl}${path}`, { headers: { cookie: state.cookie } })
      } catch (e) {
        return { ok: false, error: `请求 FeedFuse 失败：${state.baseUrl}${path}` }
      }
    }
    let data = null
    try {
      data = await res.json()
    } catch {
      return { ok: false, error: '响应解析失败', status: res.status }
    }
    return { ok: true, status: res.status, data }
  }

  function unwrapData(payload) {
    // FeedFuse 统一 { ok, data, error } 信封；部分端点直接返回数组/对象。
    if (payload && typeof payload === 'object' && 'ok' in payload && 'data' in payload) return payload.data
    return payload
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

  /**
   * FeedFuse 的图片代理路径是站内相对路径 /api/media/image?url=…，
   * 在 DSH 页面里会解析到 DSH 自己的域名而 404。这里改写到本插件前缀，
   * 由下方 `media` 处理器带会话 cookie 转发回 FeedFuse。
   */
  function rewriteImageForProxy(imageUrl) {
    if (typeof imageUrl === 'string' && imageUrl.startsWith('/api/media/image')) {
      return imageUrl.replace(/^\/api\/media\/image/, '/feedfuse/media')
    }
    return imageUrl
  }

  /** 带认证与 401 重试的 POST 转发，返回 { ok, res }（res 为 fetch Response）。 */
  async function ffPost(path, body) {
    let authed = await ensureAuthed()
    if (!authed.ok) return authed
    const doFetch = () => fetch(`${state.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: state.cookie },
      body: JSON.stringify(body),
    })
    let res
    try {
      res = await doFetch()
    } catch {
      return { ok: false, error: `请求 FeedFuse 失败：${state.baseUrl}${path}` }
    }
    if (res.status === 401) {
      state.cookie = null
      authed = await ensureAuthed()
      if (!authed.ok) return authed
      try {
        res = await doFetch()
      } catch {
        return { ok: false, error: `请求 FeedFuse 失败：${state.baseUrl}${path}` }
      }
    }
    return { ok: true, res }
  }

  // 注册 /feedfuse 前缀路由。webServer 只在 web profile 存在。
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

            // —— POST 动作：提取文案 / 下载视频 ——
            if (req.method === 'POST') {
              const body = await readJsonBody(req)
              if (op === 'transcript') {
                const r = await ffPost('/api/video/transcript', {
                  url: body.url,
                  articleId: body.articleId,
                  videoTitle: body.videoTitle,
                  provider: body.provider,
                })
                if (!r.ok) return json(res, 500, r)
                let data = null
                try { data = await r.res.json() } catch { /* ignore */ }
                const text = (data && data.data && data.data.text) || (data && data.text) || ''
                const source = (data && data.data && data.data.source) || (data && data.source) || null
                json(res, 200, { ok: true, text, source })
                return
              }
              if (op === 'download') {
                const r = await ffPost('/api/video/download', {
                  url: body.url,
                  articleId: body.articleId,
                })
                if (!r.ok) return json(res, 500, r)
                const buf = Buffer.from(await r.res.arrayBuffer())
                const ct = r.res.headers.get('content-type') || 'application/octet-stream'
                const cd = r.res.headers.get('content-disposition') || 'attachment'
                res.writeHead(r.res.status, { 'content-type': ct, 'content-disposition': cd, 'content-length': String(buf.length) })
                res.end(buf)
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
              json(res, 200, { ok: true, baseUrl: state.baseUrl, authed: !!state.cookie })
              return
            }
            if (op === 'login') {
              const r = await doLogin()
              json(res, r.ok ? 200 : 500, r)
              return
            }

            // —— 数据端点 ——
            if (op === 'snapshot') {
              const view = q.get('view') || 'all'
              const limit = q.get('limit') || '80'
              const r = await ffGet(`/api/reader/snapshot?view=${encodeURIComponent(view)}&limit=${encodeURIComponent(limit)}`)
              if (!r.ok) return json(res, 500, r)
              const d = unwrapData(r.data) || {}
              const feeds = (d.feeds || []).map((f) => ({ ...f, iconUrl: rewriteImageForProxy(f.iconUrl) }))
              const articles = ((d.articles && (d.articles.items || d.articles)) || [])
                .map((a) => ({ ...a, previewImage: rewriteImageForProxy(a.previewImage) }))
              json(res, 200, { ok: true, categories: d.categories || [], feeds, articles })
              return
            }
            if (op === 'media') {
              // 图片代理：转发 FeedFuse /api/media/image?url=…（带会话 cookie）
              const target = `${state.baseUrl}/api/media/image${url.search}`
              let fres
              try {
                fres = await fetch(target, { headers: { cookie: state.cookie } })
              } catch {
                return json(res, 502, { ok: false, error: `图片代理失败：${target}` })
              }
              if (fres.status === 401) {
                state.cookie = null
                const authed = await ensureAuthed()
                if (!authed.ok) return json(res, 401, authed)
                try {
                  fres = await fetch(target, { headers: { cookie: state.cookie } })
                } catch {
                  return json(res, 502, { ok: false, error: `图片代理失败：${target}` })
                }
              }
              const buf = Buffer.from(await fres.arrayBuffer())
              const ct = fres.headers.get('content-type') || 'application/octet-stream'
              res.writeHead(fres.status, { 'content-type': ct, 'content-length': String(buf.length), 'cache-control': 'public, max-age=3600' })
              res.end(buf)
              return
            }
            if (op === 'material') {
              const articleId = q.get('articleId')
              if (!articleId) return json(res, 400, { ok: false, error: '缺少 articleId' })
              const r = await ffGet(`/api/video/material?articleId=${encodeURIComponent(articleId)}`)
              if (!r.ok) return json(res, 500, r)
              json(res, 200, { ok: true, material: unwrapData(r.data) || null })
              return
            }
            if (op === 'repos') {
              const r = await ffGet('/api/github/repos')
              if (!r.ok) return json(res, 500, r)
              json(res, 200, { ok: true, repos: unwrapData(r.data) || [] })
              return
            }
            if (op === 'recommended') {
              const r = await ffGet('/api/feeds/recommended')
              if (!r.ok) return json(res, 500, r)
              json(res, 200, { ok: true, items: unwrapData(r.data) || [] })
              return
            }
            if (op === 'article') {
              const id = q.get('id')
              if (!id) return json(res, 400, { ok: false, error: '缺少 id' })
              const r = await ffGet(`/api/articles/${encodeURIComponent(id)}`)
              if (!r.ok) return json(res, 500, r)
              const article = unwrapData(r.data) || null
              // 提取视频直链（抖音/B站播放地址藏在 contentHtml 的 <a href> 里）
              let videoUrl = null
              if (article && typeof article.contentHtml === 'string') {
                const m = /href="([^"]*(?:play_url|aweme\/v1\/play|video\/|\.mp4)[^"]*)"/i.exec(article.contentHtml)
                if (m) videoUrl = m[1].replace(/&amp;/g, '&')
              }
              json(res, 200, { ok: true, article: article, videoUrl: videoUrl })
              return
            }
            if (op === 'knowledge') {
              const query = q.get('q') || ''
              const r = await ffGet(`/api/knowledge/search?q=${encodeURIComponent(query)}`)
              if (!r.ok) return json(res, 500, r)
              const d = unwrapData(r.data) || {}
              json(res, 200, { ok: true, items: (d.items || d || []) })
              return
            }
            if (op === 'myworks') {
              const r = await ffGet('/api/workspace/douyin/my-works')
              if (!r.ok) return json(res, 500, r)
              const d = unwrapData(r.data) || {}
              json(res, 200, { ok: true, items: d.items || [], summary: d.summary || null, feedId: d.feedId || null })
              return
            }
            if (op === 'overview') {
              const r = await ffGet('/api/workspace/douyin/overview')
              if (!r.ok) return json(res, 500, r)
              json(res, 200, { ok: true, overview: unwrapData(r.data) || null })
              return
            }
            if (op === 'accounts') {
              const platform = q.get('platform') || 'douyin'
              const r = await ffGet(`/api/publish/${encodeURIComponent(platform)}/accounts`)
              if (!r.ok) return json(res, 500, r)
              const p = unwrapData(r.data)
              json(res, 200, { ok: true, accounts: Array.isArray(p) ? p : (p && p.accounts) || [] })
              return
            }
            if (op === 'materials') {
              const r = await ffGet('/api/workspace/materials')
              if (!r.ok) return json(res, 500, r)
              const p = unwrapData(r.data)
              json(res, 200, { ok: true, materials: Array.isArray(p) ? p : [] })
              return
            }

            json(res, 404, { ok: false, error: `未知端点 ${op}` })
          } catch (error) {
            json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      `${NAME}: feedfuse HTTP route`,
    )
  })

  // —— 模型工具：agent 可调度「下载视频 / 提取文案」 ——
  ctx.inject(['tools'], (scope) => {
    scope.effect(() => scope.tools.register({
      name: 'feedfuse_extract_transcript',
      description: '提取抖音/快手/B站/YouTube 视频的文案（优先字幕，否则语音识别）。传入视频链接，返回文案全文与来源。用于「提取文案→改写→口播」工作流的第一步。',
      parameters: {
        type: 'object',
        properties: {
          link: { type: 'string', description: '视频链接（必填，如 https://www.douyin.com/video/<id>）' },
          articleId: { type: 'string', description: 'FeedFuse 文章 id（可选，用于关联素材）' },
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
        const r = await ffPost('/api/video/transcript', { url: args.link, articleId: args.articleId, videoTitle: args.title })
        if (!r.ok) throw new Error(r.error || '文案提取失败')
        const data = await r.res.json().catch(() => null)
        const text = (data && data.data && data.data.text) || (data && data.text) || ''
        const source = (data && data.data && data.data.source) || (data && data.source) || 'unknown'
        if (!text) throw new Error('未能提取到文案（可能无字幕，需语音识别或稍后重试）')
        return { text, source }
      },
    }), `${NAME}: tool feedfuse_extract_transcript`)

    scope.effect(() => scope.tools.register({
      name: 'feedfuse_download_video',
      description: '下载抖音/快手/B站/YouTube 视频到 FeedFuse 本地工作区。传入视频链接，返回是否成功与文件名。用于需要本地素材或去剪辑前的下载步骤。',
      parameters: {
        type: 'object',
        properties: {
          link: { type: 'string', description: '视频链接（必填）' },
          articleId: { type: 'string', description: 'FeedFuse 文章 id（可选）' },
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
        render: (_args, value) => [{ type: 'text', text: value.downloaded ? '视频已下载到 FeedFuse 工作区：' + (value.fileName || '') : '下载失败' }],
      },
      async execute(args) {
        const r = await ffPost('/api/video/download', { url: args.link, articleId: args.articleId })
        if (!r.ok) throw new Error(r.error || '下载失败')
        const cd = r.res.headers.get('content-disposition') || ''
        const m = /filename\*=UTF-8''(.+?)(?:;|$)/.exec(cd)
        const fileName = m ? decodeURIComponent(m[1]) : 'video.mp4'
        // FeedFuse 下载接口已在服务端完成落盘（downloads + 素材记录），此处不缓冲视频体。
        return { downloaded: true, fileName }
      },
    }), `${NAME}: tool feedfuse_download_video`)
  })

  // —— 技能：视频工作流（下载 → 提取 → 改写 → 口播脚本）——
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
}

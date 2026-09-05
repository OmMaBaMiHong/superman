/**
 * feedfuse-workbench client 半（浏览器 bundle）。
 *
 * 手写 window.__ModuleLoader__.load 协议（零构建）：factory 收到 require，
 * 拉取 react 与 slots 类型，返回 { inject, apply }。
 *
 * 注册到源码新增的两个左侧栏操作区插槽：
 *   - sidebar.rss → RSS 订阅（源列表 → 点源看文章列表 → 点文章看详情）
 *   - sidebar.zmt → 自媒体（抖音作品 + 视频素材 + 跳转入口）
 *
 * 数据来自同源 fetch('/feedfuse/*')，由 host 半代理到 FeedFuse 后端。
 */
window.__ModuleLoader__.load({
  id: 'feedfuse-workbench',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useCallback = react.useCallback

    function createStore(initial) {
      var state = initial
      var listeners = []
      return {
        get: function () { return state },
        set: function (next) { state = next; listeners.forEach(function (fn) { fn(state) }) },
        subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn }) } },
      }
    }
    function useStore(store) {
      var pair = useState(store.get)
      var setV = pair[1]
      var v = pair[0]
      useEffect(function () {
        setV(store.get())
        return store.subscribe(setV)
      }, [store])
      return v || {}
    }

    // RSS 与自媒体各自独立 store（互不干扰）
    var rssStore = createStore({ feeds: [], categories: [], status: 'idle', feed: null, articles: null, detail: null })
    var zmtStore = createStore({ status: 'idle', works: [], worksSummary: null, materials: [] })

    function injectCss(css) {
      var el = document.createElement('style')
      el.setAttribute('data-feedfuse-workbench', '')
      el.textContent = css
      document.head.appendChild(el)
      return function () { if (el.parentNode) el.parentNode.removeChild(el) }
    }

    function fmtCount(n) {
      n = Number(n) || 0
      if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
      if (n >= 10000) return (n / 10000).toFixed(1) + '万'
      return String(n)
    }
    function fmtTime(iso) {
      if (!iso) return ''
      var t = new Date(iso).getTime()
      if (Number.isNaN(t)) return ''
      var diff = Date.now() - t
      var m = Math.floor(diff / 60000)
      if (m < 1) return '刚刚'
      if (m < 60) return m + ' 分钟前'
      var hr = Math.floor(m / 60)
      if (hr < 24) return hr + ' 小时前'
      var dd = Math.floor(hr / 24)
      if (dd < 30) return dd + ' 天前'
      var dt = new Date(iso)
      return (dt.getMonth() + 1) + '月' + dt.getDate() + '日'
    }
    function fmtSecTime(sec) {
      if (!sec) return ''
      return fmtTime(new Date(sec * 1000).toISOString())
    }
    function fmtBytes(n) {
      n = Number(n) || 0
      if (!n) return '-'
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    }

    function ffFetch(op, params) {
      var qs = params
        ? '?' + Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]) }).join('&')
        : ''
      return fetch('/feedfuse/' + op + qs).then(function (r) { return r.json() })
    }

    var bridge = { setDraft: null, ctx: null }
    function sendDraft(text) {
      var clean = String(text || '').trim()
      if (!clean) return
      if (typeof bridge.setDraft === 'function') bridge.setDraft(clean)
    }

    function decodeHtmlEntities(s) {
      return String(s == null ? '' : s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
    }
    function inferProvider(link) {
      if (!link) return 'generic'
      if (/douyin\.com|iesdouyin\.com/.test(link)) return 'douyin'
      if (/bilibili\.com|b23\.tv/.test(link)) return 'bilibili'
      if (/youtube\.com|youtu\.be/.test(link)) return 'youtube'
      return 'generic'
    }

    /** 只改 rssStore.detail，保留其余字段（ES5 安全，不用展开运算符）。 */
    function setRssDetail(patch) {
      var st = rssStore.get()
      var d = st.detail || {}
      var nd = {}
      for (var k in d) nd[k] = d[k]
      for (var k2 in patch) nd[k2] = patch[k2]
      rssStore.set({ feeds: st.feeds, categories: st.categories, status: st.status, feed: st.feed, articles: st.articles, detail: nd })
    }

    // —— RSS 视频动作（详情页按钮；读最新 store 态）——
    function rssTranscribe() {
      var st = rssStore.get()
      var a = st.detail && st.detail.article
      if (!a || (st.detail && st.detail.transcribing)) return
      setRssDetail({ transcribing: true, transcriptError: null })
      fetch('/feedfuse/transcript', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: a.link, articleId: a.id, videoTitle: a.title, provider: inferProvider(a.link) }),
      }).then(function (r) { return r.json() }).then(function (r) {
        if (r && r.ok) setRssDetail({ transcribing: false, transcript: r.text, transcriptSource: r.source })
        else setRssDetail({ transcribing: false, transcriptError: (r && r.error) || '提取失败' })
      }).catch(function () {
        setRssDetail({ transcribing: false, transcriptError: '提取失败' })
      })
    }
    function rssDownload() {
      var st = rssStore.get()
      var a = st.detail && st.detail.article
      if (!a || (st.detail && st.detail.downloading)) return
      setRssDetail({ downloading: true, downloadError: null })
      fetch('/feedfuse/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: a.link, articleId: a.id }),
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            setRssDetail({ downloading: false, downloadError: (j && j.error) || '下载失败' })
          })
        }
        var cd = r.headers.get('content-disposition') || ''
        var m = /filename\*=UTF-8''(.+?)(?:;|$)/.exec(cd)
        var fname = m ? decodeURIComponent(m[1]) : ((a.title || 'video') + '.mp4')
        return r.blob().then(function (blob) {
          var url = URL.createObjectURL(blob)
          var el = document.createElement('a')
          el.href = url
          el.download = fname
          document.body.appendChild(el)
          el.click()
          document.body.removeChild(el)
          URL.revokeObjectURL(url)
          setRssDetail({ downloading: false, downloaded: true, downloadedName: fname })
        })
      }).catch(function () {
        setRssDetail({ downloading: false, downloadError: '下载失败' })
      })
    }
    function rssClip() {
      var st = rssStore.get()
      var a = st.detail && st.detail.article
      if (a && a.id) window.open('http://localhost:5199/#/import/' + a.id, '_blank')
    }

    // —— RSS 订阅 tab ——
    function FeedFuseRss(props) {
      var s = useStore(rssStore)
      var feeds = s.feeds || []
      var categories = s.categories || []
      var status = s.status || 'idle'
      var feed = s.feed
      var articles = s.articles
      var detail = s.detail

      var load = useCallback(function () {
        if (status === 'loading' || status === 'ready') return
        rssStore.set({ feeds: [], categories: [], status: 'loading', feed: null, articles: null, detail: null })
        ffFetch('snapshot', { view: 'all', limit: '200' }).then(function (r) {
          if (r && r.ok) rssStore.set({ feeds: r.feeds || [], categories: r.categories || [], status: 'ready', feed: null, articles: null, detail: null })
          else rssStore.set({ feeds: [], categories: [], status: 'error', feed: null, articles: null, detail: null })
        })
      }, [status])

      useEffect(function () { load() }, [load])

      // 窄栏（56px rail）时由上方 rail 图标承载导航，点击即展开；此处不渲染
      // 挤压内容。守卫放在所有 hooks 之后，避免 wide 翻转时 hooks 顺序改变。
      if (!props || props.wide === false) return null

      // 点源：服务端按 feedId 精确返回该源文章（view=<feedId>）
      function openFeed(f) {
        rssStore.set({ feeds: feeds, categories: categories, status: status, feed: f, articles: null, detail: null })
        ffFetch('snapshot', { view: String(f.id), limit: '200' }).then(function (r) {
          if (!r || !r.ok) return
          rssStore.set({ feeds: feeds, categories: categories, status: status, feed: f, articles: r.articles || [], detail: null })
        })
      }

      function openArticle(a) {
        rssStore.set({ feeds: feeds, categories: categories, status: status, feed: feed, articles: articles, detail: { article: a, videoUrl: null, loading: true } })
        ffFetch('article', { id: a.id }).then(function (r) {
          var art = (r && r.ok && r.article) ? r.article : a
          // 详情接口的 previewImageUrl 对抖音/B站为空（封面在 content_html 里），
          // 用列表项的 previewImage（已重写为 /feedfuse/media 代理）兜底。
          if (art && !art.previewImageUrl && !art.previewImage && a && a.previewImage) art.previewImage = a.previewImage
          rssStore.set({ feeds: feeds, categories: categories, status: status, feed: feed, articles: articles, detail: { article: art, videoUrl: (r && r.videoUrl) || null, loading: false } })
        })
      }

      function feedsView() {
        var catById = {}
        categories.forEach(function (c) { catById[String(c.id)] = c.name })
        var groups = []
        var seen = {}
        feeds.forEach(function (f) {
          var key = f.categoryId ? String(f.categoryId) : '__none'
          var name = f.categoryId ? (catById[String(f.categoryId)] || '未命名分类') : '未分类'
          if (!seen[key]) { seen[key] = true; groups.push({ key: key, name: name, feeds: [] }) }
        })
        feeds.forEach(function (f) {
          var key = f.categoryId ? String(f.categoryId) : '__none'
          var g = groups.find(function (gr) { return gr.key === key })
          if (g) g.feeds.push(f)
        })
        if (status === 'loading') return h('div', { className: 'ffw-body' }, h('div', { className: 'ffw-status' }, '正在加载订阅源…'))
        if (status === 'error') return h('div', { className: 'ffw-body' }, h('div', { className: 'ffw-status err' }, '无法连接 FeedFuse', h('button', { onClick: load }, '重试')))
        return h('div', { className: 'ffw-body' },
          groups.map(function (g) {
            return h('div', { key: g.key, className: 'ffw-sec' },
              h('div', { className: 'ffw-sec-h' }, g.name, h('span', { className: 'ffw-cnt' }, g.feeds.length)),
              g.feeds.map(function (f) {
                return h('div', { key: f.id, className: 'ffw-feed-row', onClick: function () { openFeed(f) } },
                  h('span', { className: 'ffw-ic' }),
                  h('span', { className: 'ffw-nm' }, f.title),
                  f.unreadCount ? h('span', { className: 'ffw-ub' }, f.unreadCount) : null)
              }))
          }))
      }

      function articlesView() {
        return h('div', { className: 'ffw-body' },
          h('div', { className: 'ffw-navbar' },
            h('button', { className: 'ffw-back', onClick: function () { rssStore.set({ feeds: feeds, categories: categories, status: status, feed: null, articles: null, detail: null }) } }, '← 返回'),
            h('span', { className: 'ffw-nav-t' }, feed ? feed.title : '文章')),
          !articles || articles.length === 0
            ? h('div', { className: 'ffw-empty' }, '该源暂无文章')
            : articles.map(function (a) {
                return h('div', { key: a.id, className: 'ffw-art-row', onClick: function () { openArticle(a) } },
                  a.previewImage
                    ? h('img', { className: 'ffw-art-cover', src: a.previewImage, alt: '' })
                    : h('div', { className: 'ffw-art-cover ph' }, '📄'),
                  h('div', { className: 'ffw-art-mid' },
                    h('div', { className: 'ffw-art-title' }, a.title),
                    h('div', { className: 'ffw-meta' }, h('span', null, fmtTime(a.publishedAt))))
                )
              }))
      }

      function detailView() {
        var a = detail.article
        var videoUrl = detail.videoUrl
        var cover = a.previewImageUrl || a.previewImage
        var isVideo = !!videoUrl || /视频|video|douyin|bilibili/i.test((cover || '') + (a.summary || ''))
        var transcribing = !!detail.transcribing
        var downloading = !!detail.downloading
        var transcript = detail.transcript
        var transcriptSource = detail.transcriptSource
        var link = a.link || ''

        var actions = [
          h('button', { className: 'ffw-tbtn', disabled: transcribing, onClick: rssTranscribe },
            transcribing ? '提取中…' : (transcript ? '查看文案' : '提取文案')),
          h('button', { className: 'ffw-tbtn', disabled: downloading, onClick: rssDownload },
            downloading ? '下载中…' : (detail.downloaded ? '已下载' : '下载视频')),
        ]
        if (isVideo || /douyin|bilibili|b23\.tv|iesdouyin/i.test(link)) {
          actions.push(h('button', { className: 'ffw-tbtn clip', onClick: rssClip }, '✂ 去剪辑'))
        }
        actions.push(h('button', { className: 'ffw-tbtn on', onClick: function () { sendDraft('/feedfuse 下载并提取这个视频的文案，然后改写成口播脚本：' + link + (a.title ? '（标题：' + a.title + '）' : '')) } }, '📤 送入聊天（下载+提取+改写）'))
        if (link) actions.push(h('a', { className: 'ffw-tbtn', href: link, target: '_blank', rel: 'noopener noreferrer' }, '↗ 打开原文'))

        return h('div', { className: 'ffw-body' },
          h('div', { className: 'ffw-navbar' },
            h('button', { className: 'ffw-back', onClick: function () { rssStore.set({ feeds: feeds, categories: categories, status: status, feed: feed, articles: articles, detail: null }) } }, '← 返回'),
            h('span', { className: 'ffw-nav-t' }, '详情')),
          h('div', { className: 'ffw-detail' },
            cover ? h('img', { className: 'ffw-detail-cover', src: cover, alt: '' }) : null,
            isVideo && videoUrl
              ? h('video', { className: 'ffw-video', src: videoUrl, controls: true, autoPlay: false, preload: 'metadata' })
              : null,
            h('div', { className: 'ffw-dh' }, a.title),
            h('div', { className: 'ffw-meta' },
              feed ? h('span', null, feed.title) : null,
              a.author ? h('span', null, '作者：' + a.author) : null,
              h('span', null, fmtTime(a.publishedAt))),
            transcript
              ? h('div', { className: 'ffw-transcript' },
                  h('div', { className: 'ffw-transcript-h' }, '视频文案' + (transcriptSource === 'subtitle' ? '（字幕）' : transcriptSource === 'whisper' ? '（语音识别）' : '')),
                  h('div', { className: 'ffw-transcript-b' }, transcript))
              : null,
            detail.transcriptError ? h('div', { className: 'ffw-err' }, '提取失败：' + detail.transcriptError) : null,
            detail.downloadError ? h('div', { className: 'ffw-err' }, '下载失败：' + detail.downloadError) : null,
            detail.downloaded && detail.downloadedName ? h('div', { className: 'ffw-meta' }, h('span', null, '已下载：' + detail.downloadedName)) : null,
            a.summary ? h('div', { className: 'ffw-ai' }, a.summary) : null,
            h('div', { className: 'ffw-toolbar' }, actions))
        )
      }

      var body
      if (detail) body = detailView()
      else if (feed) body = articlesView()
      else body = feedsView()

      return h('div', { className: 'ffw-root' }, body)
    }

    // —— 自媒体 tab ——
    function FeedFuseZmt(props) {
      var s = useStore(zmtStore)
      var status = s.status || 'idle'
      var works = s.works || []
      var worksSummary = s.worksSummary
      var materials = s.materials || []

      var load = useCallback(function () {
        if (status === 'loading' || status === 'ready') return
        zmtStore.set({ status: 'loading', works: [], worksSummary: null, materials: [] })
        Promise.all([ffFetch('myworks'), ffFetch('materials')]).then(function (rs) {
          var worksR = rs[0], matR = rs[1]
          zmtStore.set({
            status: 'ready',
            works: (worksR && worksR.ok ? worksR.items : []) || [],
            worksSummary: (worksR && worksR.ok ? worksR.summary : null) || null,
            materials: (matR && matR.ok ? matR.materials : []) || [],
          })
        })
      }, [status])

      useEffect(function () { load() }, [load])

      if (!props || props.wide === false) return null

      if (status === 'error') {
        return h('div', { className: 'ffw-body' }, h('div', { className: 'ffw-status err' }, '无法连接 FeedFuse', h('button', { onClick: load }, '重试')))
      }

      return h('div', { className: 'ffw-body' },
        h('div', { className: 'ffw-sec' },
          h('div', { className: 'ffw-sec-h' }, '抖音作品', h('span', { className: 'ffw-cnt' }, works.length)),
          worksSummary ? h('div', { className: 'ffw-card', style: { cursor: 'default' } },
            h('div', { className: 'ffw-meta' }, h('span', null, '▶ ' + fmtCount(worksSummary.totalPlays)), h('span', null, '♥ ' + fmtCount(worksSummary.totalLikes)), h('span', null, '💬 ' + fmtCount(worksSummary.totalComments)))) : null,
          works.length === 0
            ? h('div', { className: 'ffw-empty' }, '暂无作品')
            : works.slice(0, 8).map(function (w) {
                return h('div', { key: w.awemeId || w.articleId, className: 'ffw-art-row', onClick: function () { sendDraft('/feedfuse 下载并提取这个视频的文案，然后改写成口播脚本：https://www.douyin.com/video/' + w.awemeId + '（标题：' + w.title + '）') } },
                  w.cover
                    ? h('img', { className: 'ffw-art-cover', src: decodeHtmlEntities(w.cover), alt: '', loading: 'lazy' })
                    : h('div', { className: 'ffw-art-cover ph' }, '🎬'),
                  h('div', { className: 'ffw-art-mid' },
                    h('div', { className: 'ffw-art-title' }, w.title),
                    h('div', { className: 'ffw-meta' }, h('span', null, '▶ ' + fmtCount(w.stats && w.stats.plays)), h('span', null, '♥ ' + fmtCount(w.stats && w.stats.likes)), h('span', null, '💬 ' + fmtCount(w.stats && w.stats.comments)), w.time ? h('span', null, fmtSecTime(w.time)) : null)))
              })
        ),
        h('div', { className: 'ffw-sec' },
          h('div', { className: 'ffw-sec-h' }, '视频素材', h('span', { className: 'ffw-cnt' }, materials.length)),
          materials.length === 0
            ? h('div', { className: 'ffw-empty' }, '暂无素材')
            : materials.map(function (m) {
                return h('div', { key: m.id, className: 'ffw-card' },
                  h('div', { className: 'ffw-ti' }, m.title),
                  h('div', { className: 'ffw-meta' }, h('span', null, m.kind === 'video' ? '视频' : '文件'), h('span', null, fmtBytes(m.fileSize)), m.createdAt ? h('span', null, fmtTime(m.createdAt)) : null),
                  h('div', { className: 'ffw-toolbar' },
                    m.kind === 'video' ? h('a', { className: 'ffw-tbtn', href: 'http://localhost:5199/#/import-ws/' + m.id, target: '_blank', rel: 'noopener noreferrer' }, '✂ 去剪辑') : null,
                    h('a', { className: 'ffw-tbtn', href: 'http://localhost:9559/?view=publish-center', target: '_blank', rel: 'noopener noreferrer' }, '↗ 工作台'),
                    h('a', { className: 'ffw-tbtn', href: 'http://localhost:9559/', target: '_blank', rel: 'noopener noreferrer' }, '↗ 原项目')))
              })
        )
      )
    }

    // InputBridge：session 域捕获 inputActions.setDraft
    function InputBridge(p) {
      useEffect(function () {
        bridge.setDraft = (p.inputActions && typeof p.inputActions.setDraft === 'function') ? p.inputActions.setDraft : null
      }, [p.inputActions])
      return null
    }

    function apply(ctx) {
      bridge.ctx = ctx
      var removeCss = injectCss(CSS)

      ctx.slots.inject('sidebar.rss', function () {
        return ctx.slots.register({ name: 'sidebar.rss', priority: 0 }, FeedFuseRss)
      })

      ctx.slots.inject('sidebar.zmt', function () {
        return ctx.slots.register({ name: 'sidebar.zmt', priority: 0 }, FeedFuseZmt)
      })

      ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({ name: 'conversation.input.dock', id: 'feedfuse-bridge', order: 30 }, InputBridge)
      })

      ctx.effect(function () { return removeCss }, 'feedfuse-workbench: css')
    }

    var CSS = [
      '.ffw-root{display:flex;flex-direction:column;height:100%;min-width:0;color:var(--dsw-alias-label-primary);font-family:inherit}',
      '.ffw-body{flex:1;overflow-y:auto;min-height:0;padding:10px}',
      '.ffw-body::-webkit-scrollbar{width:6px}',
      '.ffw-body::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:6px}',
      '.ffw-sec{margin-bottom:12px}',
      '.ffw-sec-h{display:flex;align-items:center;justify-content:space-between;padding:6px 4px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.3px}',
      '.ffw-cnt{font-size:11px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-secondary);padding:1px 7px;border-radius:999px}',
      '.ffw-feed-row{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:9px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12.5px;border:1px solid transparent;transition:.14s}',
      '.ffw-feed-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}',
      '.ffw-ic{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex-shrink:0}',
      '.ffw-nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-ub{font-size:10.5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);color:var(--dsw-alias-label-secondary);padding:1px 6px;border-radius:999px;flex-shrink:0}',
      '.ffw-navbar{display:flex;align-items:center;gap:8px;padding:6px 4px 10px;flex-shrink:0}',
      '.ffw-back{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}',
      '.ffw-back:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.ffw-nav-t{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-art-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);margin-bottom:8px;cursor:pointer;transition:.15s}',
      '.ffw-art-row:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent)}',
      '.ffw-art-cover{width:64px;height:42px;border-radius:7px;object-fit:cover;flex-shrink:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}',
      '.ffw-art-cover.ph{display:flex;align-items:center;justify-content:center;font-size:20px}',
      '.ffw-art-mid{flex:1;min-width:0}',
      '.ffw-art-title{font-size:12.5px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.ffw-card{padding:9px 11px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);margin-bottom:8px;cursor:pointer;transition:.15s}',
      '.ffw-card:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent)}',
      '.ffw-ti{font-size:12.5px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap;margin-top:3px}',
      '.ffw-detail{padding:2px}',
      '.ffw-detail-cover{width:100%;max-height:240px;object-fit:cover;border-radius:11px;margin-bottom:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}',
      '.ffw-video{width:100%;border-radius:11px;margin-bottom:10px;background:#000}',
      '.ffw-dh{font-size:15px;font-weight:700;line-height:1.4;margin-bottom:8px;color:var(--dsw-alias-label-primary)}',
      '.ffw-ai{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,transparent);color:var(--dsw-alias-label-primary);font-size:12px;padding:9px 11px;border-radius:11px;margin:10px 0;line-height:1.6}',
      '.ffw-toolbar{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}',
      '.ffw-tbtn{font-size:12px;padding:6px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:5px}',
      '.ffw-tbtn.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent)}',
      '.ffw-tbtn:hover{border-color:var(--dsw-alias-border-l2)}',
      '.ffw-tbtn:disabled{opacity:.45;cursor:default}',
      '.ffw-tbtn.clip{color:#f59e0b;border-color:color-mix(in srgb,#f59e0b 35%,transparent);background:color-mix(in srgb,#f59e0b 10%,transparent)}',
      '.ffw-transcript{margin:10px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;overflow:hidden}',
      '.ffw-transcript-h{padding:7px 11px;font-size:11px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.ffw-transcript-b{padding:9px 11px;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-primary);white-space:pre-wrap;max-height:260px;overflow-y:auto}',
      '.ffw-err{color:var(--dsw-alias-state-error-primary);font-size:11.5px;margin-top:6px}',
      '.ffw-empty{color:var(--dsw-alias-label-secondary);font-size:12.5px;text-align:center;padding:22px 12px}',
      '.ffw-status{color:var(--dsw-alias-label-secondary);font-size:13px;padding:16px}',
      '.ffw-status.err{color:var(--dsw-alias-state-error-primary)}',
      '.ffw-status button{margin-top:10px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:12px}',
    ].join('\n')

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

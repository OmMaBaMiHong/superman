/**
 * feedfuse-workbench client 半（浏览器 bundle）。
 *
 * 手写 window.__ModuleLoader__.load 协议（零构建）：factory 收到 require，
 * 拉取 react 与 slots 类型，返回 { inject, apply }。
 *
 * 左栏由本插件通过官方 'sidebar' 插槽整体接管（见 SidebarShell）：插件自带
 * 工作区 / RSS订阅 / 自媒体 三个操作标签，同时把内置席位声明回来并交还原主，
 * 因此 packages/client/ui-sidebar 的源码保持上游原样（部署层 disable 掉内置外壳
 * 一行，见 cordis.patch.yml）。席位归属：
 *   - sidebar.brand.mark / sidebar.brand.name → ui-brand-official
 *   - sidebar.workspaces → ui-workspace（内置工作区 / 会话浏览器）
 *   - sidebar.rss → RSS 订阅（源列表 → 点源看文章列表 → 点文章看详情）
 *   - sidebar.zmt → 自媒体（抖音作品 + 视频素材 + 跳转入口）
 *   - sidebar.settings → ui-settings-general
 *   - sidebar.footer.action → 各插件叠加（list 席位）
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
    var useRef = react.useRef

    // 平台内置的 UI 基础件（shell 静态种子模块，require 直接命中）。
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var FishLogo = primitives.FishLogo
    var Tooltip = primitives.Tooltip
    var Modal = primitives.Modal
    var Button = primitives.Button
    var IconNewChatOutline16 = primitives.IconNewChatOutline16
    var IconPanelLeftOutline16 = primitives.IconPanelLeftOutline16
    var IconRefreshOutline16 = primitives.IconRefreshOutline16

    /** 拼接非空 class 片段（等价 clsx）。 */
    function cx() {
      var out = []
      for (var i = 0; i < arguments.length; i++) { if (arguments[i]) out.push(arguments[i]) }
      return out.join(' ')
    }

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

    // RSS 与加工台各自独立 store（互不干扰）
    var rssStore = createStore({ feeds: [], categories: [], status: 'idle', feed: null, articles: null, detail: null })
    // 加工台队列（视频条目 + 文案/分析完成度 + 已下载素材 + 仪表盘统计 + UI 状态）
    var wbStore = createStore({ status: 'idle', items: [], stats: {}, materials: [], dashboard: null, busy: null, note: '' })
    // 主工作区浮层 store：点击博主后在此展开文章列表(二级)+文章详情(三级)，
    // 仿 dsh-worktable 控制室在 main 区域铺满，不挤在侧边栏。
    var wsStore = createStore({ open: false, feed: null, articles: [], article: null })
    // 加工台主工作区浮层 store：视频作品列表(二级)+视频详情(三级)
    var wbWsStore = createStore({ open: false, items: [], article: null })
    // 二创工作区 store：对一条作品生成多形态内容（口播/分镜/短剧/图文/标题），按版本保存
    var remixStore = createStore({ open: false, article: null, versions: [], contentType: 'oral', params: { style: '', length: '', hook: '' }, output: '', generating: false, note: '' })
    // 流水线 store：定义列表 + 执行历史 + 当前运行状态
    var pipelineStore = createStore({ definitions: [], runs: [], templates: [], status: 'idle', runningId: null, note: '' })
    // 加工台主工作区浮层 store：在主区域展开，含仪表盘/数据表格/流水线三个子页
    var wbOverlayStore = createStore({ open: false, tab: 'dashboard' })

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
    /** 秒 → mm:ss（超过一小时带小时）。 */
    function fmtDur(sec) {
      var s = Math.max(0, Math.round(Number(sec) || 0))
      var h = Math.floor(s / 3600)
      var m = Math.floor((s % 3600) / 60)
      var r = s % 60
      var mm = String(m).padStart(2, '0')
      var ss = String(r).padStart(2, '0')
      return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss
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

    function ffJson(op, method, body) {
      return fetch('/feedfuse/' + op, {
        method: method || 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(function (r) { return r.json() })
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
    /** AI 语义分析当前详情条目；完成后重取详情，让评分与标签进入视图。 */
    function rssAnalyze() {
      var st = rssStore.get()
      var a = st.detail && st.detail.article
      if (!a || (st.detail && st.detail.analyzing)) return
      setRssDetail({ analyzing: true, analyzeError: null })
      ffJson('analyze', 'POST', { articleId: a.id }).then(function (r) {
        var one = r && r.results && r.results[0]
        if (!one || !one.ok) {
          setRssDetail({ analyzing: false, analyzeError: (one && one.error) || '分析失败' })
          return
        }
        return ffFetch('article', { id: a.id }).then(function (rr) {
          var art = (rr && rr.ok && rr.article) ? rr.article : a
          setRssDetail({ analyzing: false, article: art })
        })
      }).catch(function () {
        setRssDetail({ analyzing: false, analyzeError: '分析失败' })
      })
    }

    function rssClip() {
      var st = rssStore.get()
      var a = st.detail && st.detail.article
      if (!a) return
      // 剪辑能力未随本插件发布，改为送入聊天交给 agent 处理（下载并留作素材）
      sendDraft('/feedfuse 把下面这个视频下载下来，作为剪辑素材：' + a.link + (a.title ? '（标题：' + a.title + '）' : ''))
    }

    // —— 订阅源：新增 / 发现（对齐原 FeedFuse FeedDialog + DiscoverPage）——

    /**
     * 对话框外壳：使用 ui-primitives 的官方 Modal（遮罩 + 不透明卡面 + Esc /
     * 点击遮罩关闭，并传送到 document.body）。插件自绘的 fixed 浮层挂在侧栏列内，
     * 会被列的 overflow 裁切、被折叠淡出的祖先改定位，且拿不到可用的不透明表面，
     * 因此统一走 Modal；动作行放 footer 槽，标题与关闭按钮由 Modal 头部提供。
     */
    function FeedModal(p) {
      return h(Modal, {
        open: true,
        onClose: p.onClose,
        closeLabel: '关闭',
        title: p.title,
        className: 'ffw-modal',
        contentClassName: 'ffw-modal-content',
        footer: p.footer,
      }, p.children)
    }

    /** 添加 RSS 源弹窗：URL → 校验 → 修正名称/选分类 → 确定（对齐原 FeedDialog add 三段式）。 */
    function FeedAddDialog(p) {
      var pair = useState({ url: '', vs: 'idle', title: '', siteUrl: '', categoryId: null, submitting: false, error: null })
      var st = pair[0]
      var set = pair[1]

      function setUrl(v) {
        set({ url: v, vs: 'idle', title: '', siteUrl: '', categoryId: st.categoryId, submitting: false, error: null })
      }
      function doValidate() {
        var u = String(st.url || '').trim()
        if (!u) { set({ url: st.url, vs: 'failed', title: st.title, siteUrl: st.siteUrl, categoryId: st.categoryId, submitting: false, error: '请输入订阅地址' }); return }
        set({ url: st.url, vs: 'validating', title: st.title, siteUrl: st.siteUrl, categoryId: st.categoryId, submitting: false, error: null })
        ffFetch('feeds/validate', { url: u }).then(function (r) {
          if (r && r.ok) set({ url: st.url, vs: 'verified', title: r.title || '', siteUrl: r.siteUrl || '', categoryId: st.categoryId, submitting: false, error: null })
          else set({ url: st.url, vs: 'failed', title: st.title, siteUrl: st.siteUrl, categoryId: st.categoryId, submitting: false, error: (r && r.error) || '校验失败' })
        }).catch(function () {
          set({ url: st.url, vs: 'failed', title: st.title, siteUrl: st.siteUrl, categoryId: st.categoryId, submitting: false, error: '校验失败' })
        })
      }
      function canSave() { return st.vs === 'verified' && !st.submitting }
      function doSubmit() {
        if (!canSave()) return
        set({ url: st.url, vs: st.vs, title: st.title, siteUrl: st.siteUrl, categoryId: st.categoryId, submitting: true, error: null })
        ffJson('feeds', 'POST', { url: String(st.url).trim(), title: (st.title.trim() ? st.title.trim() : st.siteUrl), siteUrl: st.siteUrl, categoryId: st.categoryId }).then(function (r) {
          if (r && r.ok) { if (p.onCreated) p.onCreated(); if (p.onClose) p.onClose() }
          else set({ url: st.url, vs: st.vs, title: st.title, siteUrl: st.siteUrl, categoryId: st.categoryId, submitting: false, error: (r && r.error) || '添加失败' })
        })
      }

      var badge = st.vs === 'idle' ? { text: '待验证', cls: 'ffw-badge' }
        : st.vs === 'validating' ? { text: '验证中…', cls: 'ffw-badge run' }
        : st.vs === 'verified' ? { text: '验证成功', cls: 'ffw-badge ok' }
        : { text: '验证失败', cls: 'ffw-badge bad' }

      var catOptions = (p.categories || []).slice()
      catOptions.unshift({ id: null, name: '未分类' })

      return h(FeedModal, {
        title: '添加 RSS 源',
        onClose: p.onClose,
        footer: h(react.Fragment, null,
          h(Button, { variant: 'outline', size: 'sm', onClick: p.onClose }, '取消'),
          h(Button, { variant: 'primary', size: 'sm', disabled: !canSave(), onClick: doSubmit }, st.submitting ? '正在添加…' : '添加订阅源')),
      },
        h('div', { className: 'ffw-form' },
          h('label', { className: 'ffw-lbl' }, '订阅地址'),
          h('div', { className: 'ffw-row' },
            h('input', { className: 'ffw-inp', placeholder: 'https://example.com/feed.xml', value: st.url, onChange: function (e) { setUrl(e.target.value) }, onBlur: doValidate }),
            h('button', { className: 'ffw-tbtn on', disabled: st.vs === 'validating', onClick: doValidate }, st.vs === 'validating' ? '验证中…' : '验证')),
          h('span', { className: badge.cls }, badge.text),
          st.error ? h('div', { className: 'ffw-err' }, st.error) : null,
          st.vs === 'verified'
            ? h('div', { className: 'ffw-preview' },
                h('div', { className: 'ffw-fi' },
                  h('span', { className: 'ffw-lbl' }, '名称'),
                  h('input', { className: 'ffw-inp', value: st.title, onChange: function (e) { set({ url: st.url, vs: st.vs, title: e.target.value, siteUrl: st.siteUrl, categoryId: st.categoryId, submitting: false, error: null }) } })),
                st.siteUrl ? h('div', { className: 'ffw-meta' }, h('span', null, st.siteUrl)) : null)
            : null,
          h('div', { className: 'ffw-fi' },
            h('span', { className: 'ffw-lbl' }, '分类'),
            h('select', { className: 'ffw-inp', value: st.categoryId == null ? '' : String(st.categoryId), onChange: function (e) { set({ url: st.url, vs: st.vs, title: st.title, siteUrl: st.siteUrl, categoryId: e.target.value === '' ? null : Number(e.target.value), submitting: false, error: null }) } },
              catOptions.map(function (c) { return h('option', { key: c.id == null ? '__none' : c.id, value: c.id == null ? '' : String(c.id) }, c.name) }))))
      )
    }

    /** 发现订阅源视图：推荐列表 + 搜索 + 一键订阅（对齐原 DiscoverPage）。 */
    function FeedDiscover(p) {
      var pair = useState({ items: [], status: 'loading', error: null, query: '' })
      var st = pair[0]
      var set = pair[1]
      var existingUrls = p.existingUrls || {}

      var load = useCallback(function () {
        set({ items: [], status: 'loading', error: null, query: st.query })
        ffFetch('recommended').then(function (r) {
          if (r && r.ok) set({ items: r.items || [], status: 'ready', error: null, query: st.query })
          else set({ items: [], status: 'error', error: (r && r.error) || '加载失败', query: st.query })
        }).catch(function () {
          set({ items: [], status: 'error', error: '加载失败', query: st.query })
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(function () { load() }, [load])

      function subscribe(item) {
        ffJson('feeds', 'POST', { url: item.url, title: item.title, categoryId: null }).then(function (r) {
          if (r && r.ok) { if (p.onCreated) p.onCreated() }
          load()
        })
      }

      var filtered = st.items.filter(function (it) {
        var q = String(st.query || '').trim().toLowerCase()
        if (!q) return true
        return String(it.title || '').toLowerCase().indexOf(q) >= 0 || String(it.url || '').toLowerCase().indexOf(q) >= 0
      })

      return h(FeedModal, {
        title: '发现订阅源',
        onClose: p.onClose,
        footer: h(Button, { variant: 'outline', size: 'sm', onClick: p.onClose }, '关闭'),
      },
        h('div', { className: 'ffw-form' },
          h('input', { className: 'ffw-inp', placeholder: '搜索订阅源名称或 URL…', value: st.query, onChange: function (e) { set({ items: st.items, status: st.status, error: st.error, query: e.target.value }) } })),
        st.status === 'loading' ? h('div', { className: 'ffw-status' }, '正在加载推荐源…')
          : st.status === 'error' ? h('div', { className: 'ffw-status err' }, st.error, h('button', { onClick: load }, '重试'))
          : filtered.length === 0 ? h('div', { className: 'ffw-empty' }, st.query ? '没有找到匹配的订阅源' : '暂无推荐订阅源')
          : h('div', { className: 'ffw-disc' },
              filtered.map(function (item) {
                var subscribed = !!existingUrls[item.url]
                return h('div', { key: item.url, className: 'ffw-src' },
                  h('div', { className: 'ffw-art-mid' },
                    h('div', { className: 'ffw-art-title' }, item.title),
                    h('div', { className: 'ffw-meta' }, h('span', null, item.url)),
                    item.description ? h('div', { className: 'ffw-desc' }, item.description) : null),
                  h('button', { className: subscribed ? 'ffw-tbtn' : 'ffw-tbtn on', disabled: subscribed, onClick: function () { subscribe(item) } },
                    subscribed ? '已订阅' : '+ 订阅'))
              })))
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
      var dialogPair = useState(null)
      var dialog = dialogPair[0]
      var setDialog = dialogPair[1]
      // 刷新进行中的目标（null | 'all' | feedId）与结果提示；放在早退 return 之前，
      // 保证 wide 翻转时 hooks 顺序稳定。
      var busyPair = useState(null)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var notePair = useState(null)
      var note = notePair[0]
      var setNote = notePair[1]

      var load = useCallback(function () {
        if (status === 'loading' || status === 'ready') return
        rssStore.set({ feeds: [], categories: [], status: 'loading', feed: null, articles: null, detail: null })
        ffFetch('snapshot', { view: 'all', limit: '200' }).then(function (r) {
          if (r && r.ok) rssStore.set({ feeds: r.feeds || [], categories: r.categories || [], status: 'ready', feed: null, articles: null, detail: null })
          else rssStore.set({ feeds: [], categories: [], status: 'error', feed: null, articles: null, detail: null })
        })
      }, [status])

      useEffect(function () { load() }, [load])

      function reload() {
        rssStore.set({ feeds: [], categories: [], status: 'loading', feed: null, articles: null, detail: null })
        ffFetch('snapshot', { view: 'all', limit: '200' }).then(function (r) {
          if (r && r.ok) rssStore.set({ feeds: r.feeds || [], categories: r.categories || [], status: 'ready', feed: null, articles: null, detail: null })
          else rssStore.set({ feeds: [], categories: [], status: 'error', feed: null, articles: null, detail: null })
        })
      }

      // 窄栏（56px rail）时由上方 rail 图标承载导航，点击即展开；此处不渲染
      // 挤压内容。守卫放在所有 hooks 之后，避免 wide 翻转时 hooks 顺序改变。
      if (!props || props.wide === false) return null

      /** 刷新后按当前视图重读快照：源列表/未读数与文章列表就地更新，详情不打断。 */
      function reloadKeepView() {
        var st = rssStore.get()
        var view = st.feed ? String(st.feed.id) : 'all'
        return ffFetch('snapshot', { view: view, limit: '200' }).then(function (r) {
          if (!r || !r.ok) return
          rssStore.set({
            feeds: r.feeds || st.feeds,
            categories: r.categories || st.categories,
            status: 'ready',
            feed: st.feed,
            articles: st.feed ? (r.articles || st.articles) : st.articles,
            detail: st.detail,
          })
        })
      }

      /** 刷新结果摘要：全部源 → 「已刷新 N 个源（M 个失败）」，单源 → 成/败。 */
      function refreshSummary(results) {
        var list = results || []
        var failed = list.filter(function (x) { return !x || !x.ok }).length
        if (list.length === 0) return '没有可刷新的订阅源'
        if (failed === 0) return '已刷新 ' + list.length + ' 个订阅源'
        return '已刷新 ' + list.length + ' 个订阅源 · ' + failed + ' 个失败'
      }

      function finishRefresh(r) {
        if (!r || !r.ok) { setNote('刷新失败，请检查网络或订阅地址'); return }
        setNote(refreshSummary(r.results))
        return reloadKeepView()
      }

      /** 图标按钮：抓取全部订阅源的最新文章（热更新，无需重启）。 */
      function refreshAll() {
        if (busy !== null) return
        setBusy('all')
        setNote(null)
        ffJson('refresh', 'POST', {})
          .then(finishRefresh)
          .catch(function () { setNote('刷新失败，请检查网络或订阅地址') })
          .then(function () { setBusy(null) })
      }

      /** 图标按钮：只抓取当前源的最新文章。 */
      function refreshOne(f) {
        if (busy !== null || !f) return
        setBusy(f.id)
        setNote(null)
        ffJson('refresh', 'POST', { feedId: f.id })
          .then(finishRefresh)
          .catch(function () { setNote('刷新失败，请检查网络或订阅地址') })
          .then(function () { setBusy(null) })
      }

      /** 刷新图标按钮（带 tooltip 与进行中态）；key 是 busy 令牌（'all' 或 feedId）。 */
      function refreshButton(key, onGo, label) {
        return h(Tooltip, { label: label, delayMs: 400 },
          h('button', {
            type: 'button',
            className: 'ffw-iconbtn',
            'aria-label': label,
            disabled: busy !== null,
            onClick: onGo,
          }, h(IconRefreshOutline16, { size: 14, className: busy === key ? 'ffw-spin' : null })))
      }

      // 点源：在对话根铺开工作区（文章列表二级 + 详情三级），聊天窗被 margin 挤到右侧；
      // 侧边栏只保留订阅源导航。仿 dsh-worktable 控制室。
      function openFeed(f) {
        rssStore.set({ feeds: feeds, categories: categories, status: status, feed: f, articles: null, detail: null })
        // 先释放旧工作区
        wsCloseGeom()
        wsOpenGeom()
        wsStore.set({ open: true, feed: f, articles: [], article: null })
        ffFetch('snapshot', { view: String(f.id), limit: '200' }).then(function (r) {
          if (!r || !r.ok) return
          var list = r.articles || []
          rssStore.set({ feeds: feeds, categories: categories, status: status, feed: f, articles: list, detail: null })
          var ws = wsStore.get()
          if (ws.open && ws.feed && ws.feed.id === f.id) {
            wsStore.set({ open: true, feed: f, articles: list, article: ws.article || list[0] || null })
          }
        })
      }

      // 主工作区里点击文章：更新详情面板（不改变侧边栏状态）
      function openArticle(a) {
        var ws = wsStore.get()
        wsStore.set({ open: true, feed: ws.feed || feed, articles: ws.articles || articles || [], article: a })
        ffFetch('article', { id: a.id }).then(function (r) {
          var art = (r && r.ok && r.article) ? r.article : a
          var w = wsStore.get()
          if (w.open && w.article && w.article.id === art.id) {
            wsStore.set({ open: true, feed: w.feed, articles: w.articles, article: art })
          }
        })
      }

      /** 数据新鲜度：各源最近一次抓取时刻；没有提示行时占位显示。 */
      function freshnessLine() {
        var latest = 0
        feeds.forEach(function (f) { if (f.lastFetchAt && f.lastFetchAt > latest) latest = f.lastFetchAt })
        if (!latest) return null
        return '上次抓取 · ' + fmtTime(new Date(latest).toISOString())
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
          h('div', { className: 'ffw-toolbar ffw-subbar' },
            h('button', { className: 'ffw-tbtn on', onClick: function () { setDialog({ view: 'add' }) } }, '+ 新增订阅源'),
            h('button', { className: 'ffw-tbtn', onClick: function () { setDialog({ view: 'discover' }) } }, '发现订阅源'),
            h('span', { className: 'ffw-sp' }),
            refreshButton('all', refreshAll, '抓取全部订阅源的最新文章')),
          note || freshnessLine() ? h('div', { className: 'ffw-note' }, note || freshnessLine()) : null,
          groups.map(function (g) {
            return h('div', { key: g.key, className: 'ffw-sec' },
              h('div', { className: 'ffw-sec-h' }, g.name, h('span', { className: 'ffw-cnt' }, g.feeds.length)),
              g.feeds.map(function (f) {
                return h('div', { key: f.id, className: 'ffw-feed-row', onClick: function () { openFeed(f) } },
                  h('span', { className: f.lastError ? 'ffw-ic err' : 'ffw-ic', title: f.lastError || '加载失败' }),
                  h('span', { className: 'ffw-nm' }, f.title),
                  f.platform ? h('span', { className: 'ffw-plat' }, f.platform === 'douyin' ? '抖音' : f.platform) : null,
                  f.unreadCount ? h('span', { className: 'ffw-ub' }, f.unreadCount) : null)
              }))
          }))
      }

      function articlesView() {
        return h('div', { className: 'ffw-body' },
          h('div', { className: 'ffw-navbar' },
            h('button', { className: 'ffw-back', onClick: function () { rssStore.set({ feeds: feeds, categories: categories, status: status, feed: null, articles: null, detail: null }) } }, '← 返回'),
            h('span', { className: 'ffw-nav-t' }, feed ? feed.title : '文章'),
            h('span', { className: 'ffw-sp' }),
            refreshButton(feed ? feed.id : 'feed', function () { refreshOne(feed) }, '抓取该源最新文章')),
          note ? h('div', { className: 'ffw-note' }, note) : null,
          !articles || articles.length === 0
            ? h('div', { className: 'ffw-empty' }, '该源暂无文章')
            : articles.map(function (a) {
                var isVid = a.mediaType === 'video'
                return h('div', { key: a.id, className: 'ffw-art-row', onClick: function () { openArticle(a) } },
                  a.previewImage
                    ? h('img', { className: 'ffw-art-cover', src: a.previewImage, alt: '' })
                    : h('div', { className: 'ffw-art-cover ph' }, isVid ? '🎬' : '📄'),
                  h('div', { className: 'ffw-art-mid' },
                    h('div', { className: 'ffw-art-title' }, a.title),
                    h('div', { className: 'ffw-meta' },
                      h('span', null, fmtTime(a.publishedAt)),
                      isVid && a.durationSec ? h('span', null, fmtDur(a.durationSec)) : null,
                      a.score != null ? h('span', { className: 'ffw-score' }, a.score) : null,
                      isVid ? h('span', { className: a.transcript ? 'ffw-state ok' : 'ffw-state' }, a.transcript ? '有文案' : '待提取') : null))
                )
              }))
      }

      function detailView() {
        var a = detail.article
        var videoUrl = detail.videoUrl
        var cover = a.previewImageUrl || a.previewImage
        var isVideo = !!videoUrl || a.mediaType === 'video' || /视频|video|douyin|bilibili/i.test((cover || '') + (a.summary || ''))
        var transcribing = !!detail.transcribing
        var downloading = !!detail.downloading
        var transcript = detail.transcript || a.transcript
        var transcriptSource = detail.transcriptSource || a.transcriptSource
        var link = a.link || ''
        // 播放走插件代理：由服务端补 UA/Referer 并透传 Range，避免直链时效与防盗链差异
        var playSrc = a.videoUrl ? ('/feedfuse/video?id=' + encodeURIComponent(a.id)) : (videoUrl || null)

        /** 直链过期（代理 403）：记录状态，界面给出刷新入口。 */
        function onVideoError() {
          var st = rssStore.get()
          var d = st.detail || {}
          var nd = {}
          for (var k in d) nd[k] = d[k]
          nd.videoError = true
          rssStore.set({ feeds: st.feeds, categories: st.categories, status: st.status, feed: st.feed, articles: st.articles, detail: nd })
        }

        var actions = [
          h('button', { className: 'ffw-tbtn', disabled: transcribing, onClick: rssTranscribe },
            transcribing ? '提取中…' : (transcript ? '查看文案' : '提取文案')),
          h('button', { className: 'ffw-tbtn', disabled: !!detail.analyzing, onClick: rssAnalyze },
            detail.analyzing ? '分析中…' : (a.score != null ? '重新分析' : 'AI 分析')),
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
            isVideo && playSrc
              ? h('video', {
                className: 'ffw-video', src: playSrc, controls: true, autoPlay: false, preload: 'metadata',
                onError: onVideoError,
              })
              : null,
            detail.videoError
              ? h('div', { className: 'ffw-err' },
                '可播直链已过期。',
                h('button', { className: 'ffw-tbtn', onClick: function () { refreshOne(feed) } }, '刷新该源后重看'))
              : null,
            h('div', { className: 'ffw-dh' }, a.title),
            h('div', { className: 'ffw-meta' },
              feed ? h('span', null, feed.title) : null,
              a.author ? h('span', null, '作者：' + a.author) : null,
              a.durationSec ? h('span', null, fmtDur(a.durationSec)) : null,
              h('span', null, fmtTime(a.publishedAt))),
            (a.score != null || a.category || (a.tags && a.tags.length))
              ? h('div', { className: 'ffw-ai-tags' },
                a.score != null ? h('span', { className: 'ffw-score lg' }, '爆款分 ' + a.score) : null,
                a.category ? h('span', { className: 'ffw-chip' }, a.category) : null,
                (a.tags || []).map(function (t) { return h('span', { key: t, className: 'ffw-chip' }, t) }))
              : null,
            a.note ? h('div', { className: 'ffw-meta' }, a.note) : null,
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

      // 三栏布局：订阅源 + 文章列表 + 文章详情（选中博主后展开二级栏目，点文章后展开详情）
      // 侧边栏只显示订阅源导航（紧凑列表）；文章列表与详情由主工作区浮层（shell.overlay）展开。
      var body = h('div', { className: 'ffw-body' }, feedsView())

      var existingUrls = {}
      feeds.forEach(function (f) { if (f.url) existingUrls[f.url] = true })

      var overlay = null
      if (dialog && dialog.view === 'add') overlay = h(FeedAddDialog, { categories: categories, onClose: function () { setDialog(null) }, onCreated: reload })
      else if (dialog && dialog.view === 'discover') overlay = h(FeedDiscover, { existingUrls: existingUrls, onClose: function () { setDialog(null) }, onCreated: reload })

      return h('div', { className: 'ffw-root' }, body, overlay)
    }

    // —— 自媒体 tab ——
    // —— 加工台：订阅来的短视频 → 提取文案 → AI 标签评分 → 二次创作 ——
    //
    // 加工台 = 个人数据处理中心。顶部仪表盘（处理进度 + 方向分布 + 热点 + 趋势），
    // 底部数据表格（全部订阅视频，按处理状态筛选：待提取/已提取/已打标）。
    function FeedFuseWorkbench(props) {
      var s = useStore(wbStore)
      var items = s.items || []
      var stats = s.stats || {}
      var status = s.status || 'idle'
      var dashboard = s.dashboard
      var filterPair = useState('all')
      var filter = filterPair[0]
      var setFilter = filterPair[1]
      var busyPair = useState(null)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var notePair = useState(null)
      var note = notePair[0]
      var setNote = notePair[1]

      function loadList(force) {
        wbStore.set({ status: 'loading', items: [], stats: {}, dashboard: dashboard })
        Promise.all([ffFetch('workbench', { limit: '300' }), ffFetch('materials'), ffFetch('workbench-stats')]).then(function (rs) {
          var r = rs[0], mat = rs[1], ds = rs[2]
          if (r && r.ok) wbStore.set({ status: 'ready', items: r.items || [], stats: r.stats || {}, materials: (mat && mat.materials) || [], dashboard: (ds && ds.ok) ? ds : dashboard })
          else wbStore.set({ status: 'error', items: [], stats: {}, materials: [], dashboard: dashboard })
        }).catch(function () { wbStore.set({ status: 'error', items: [], stats: {}, materials: [], dashboard: dashboard }) })
      }

      var load = useCallback(function () {
        if (status === 'loading' || status === 'ready') return
        loadList()
      }, [status])

      useEffect(function () { load() }, [load])

      /** 单条提取文案（yt-dlp 字幕优先、Whisper 回退），结果写回条目。 */
      function transcribe(a) {
        if (busy) return
        setBusy({ id: a.id, op: 't' })
        setNote('正在提取文案：' + String(a.title).slice(0, 18) + '…')
        ffJson('transcript', 'POST', { articleId: a.id, url: a.link, videoTitle: a.title }).then(function (r) {
          if (r && r.ok) setNote('文案已提取（' + (r.source === 'subtitle' ? '字幕' : '语音识别') + ' ' + String(r.text || '').length + ' 字）')
          else setNote('提取失败：' + ((r && r.error) || '未知原因'))
          loadList(true)
        }).catch(function () { setNote('提取失败') }).then(function () { setBusy(null) })
      }

      /** 单条自动打标（提取文案 + 结构化标签）。 */
      function autoTagOne(a) {
        if (busy) return
        setBusy({ id: a.id, op: 'a' })
        setNote('正在自动打标：' + String(a.title).slice(0, 18) + '…')
        ffJson('auto-tag', 'POST', { articleId: a.id }).then(function (r) {
          var one = r && r.results && r.results[0]
          if (one && one.ok) setNote('打标完成 · 爆款分 ' + one.score + ' · ' + (one.structured_tags && one.structured_tags.direction || ''))
          else setNote('打标失败：' + ((one && one.error) || '未知原因'))
          loadList(true)
        }).catch(function () { setNote('打标失败') }).then(function () { setBusy(null) })
      }

      /** 批量自动打标未处理条目（默认 20 条）。 */
      function autoTagBatch() {
        if (busy) return
        setBusy({ id: 'batch', op: 'a' })
        setNote('正在批量自动打标…')
        ffJson('auto-tag', 'POST', { all: true, limit: 20 }).then(function (r) {
          var list = (r && r.results) || []
          var ok = list.filter(function (x) { return x.ok }).length
          setNote('批量打标完成：成功 ' + ok + ' / ' + list.length)
          loadList(true)
        }).catch(function () { setNote('批量打标失败') }).then(function () { setBusy(null) })
      }

      if (!props || props.wide === false) return null

      // 处理状态：pending=待提取, transcribed=已提取, tagged=已打标
      function procStatus(a) {
        if (a.structured_tags) return 'tagged'
        if (a.transcript) return 'transcribed'
        return 'pending'
      }
      var FILTERS = [
        { id: 'all', name: '全部' },
        { id: 'pending', name: '待提取', count: items.filter(function (a) { return procStatus(a) === 'pending' }).length },
        { id: 'transcribed', name: '已提取', count: items.filter(function (a) { return procStatus(a) === 'transcribed' }).length },
        { id: 'tagged', name: '已打标', count: items.filter(function (a) { return procStatus(a) === 'tagged' }).length },
      ]
      var shown = items.filter(function (a) {
        if (filter === 'all') return true
        return procStatus(a) === filter
      })

      return h('div', { className: 'ffw-root' },
        h('div', { className: 'ffw-body' },
          // ── 仪表盘 ──
          h('div', { className: 'ffw-dash' },
            h('div', { className: 'ffw-dash-row' },
              dashCard('总视频', (dashboard && dashboard.overview.total) || stats.total || 0, ''),
              dashCard('今日新增', (dashboard && dashboard.overview.today) || 0, 'new'),
              dashCard('已提取', (dashboard && dashboard.overview.transcribed) || stats.transcribed || 0, ''),
              dashCard('已打标', (dashboard && dashboard.overview.tagged) || stats.analyzed || 0, 'ok'),
              dashCard('平均分', (dashboard && dashboard.overview.avgScore) || 0, 'score')),
            h('div', { className: 'ffw-dash-row' },
              h('div', { className: 'ffw-dash-card' },
                h('div', { className: 'ffw-dash-card-h' }, '方向分布'),
                (dashboard && dashboard.directions && dashboard.directions.length)
                  ? h('div', { className: 'ffw-dir-bars' }, dashboard.directions.slice(0, 6).map(function (d) {
                      var max = dashboard.directions[0].count || 1
                      return h('div', { key: d.direction, className: 'ffw-dir-row' },
                        h('span', { className: 'ffw-dir-label' }, d.direction),
                        h('div', { className: 'ffw-dir-track' }, h('div', { className: 'ffw-dir-fill', style: { width: Math.round(d.count / max * 100) + '%' } })),
                        h('span', { className: 'ffw-dir-cnt' }, d.count))
                    }))
                  : h('div', { className: 'ffw-dash-empty' }, '暂无数据，先打标签')),
              h('div', { className: 'ffw-dash-card' },
                h('div', { className: 'ffw-dash-card-h' }, '7 日趋势'),
                (dashboard && dashboard.trend && dashboard.trend.length)
                  ? h('div', { className: 'ffw-trend' }, dashboard.trend.map(function (t, i) {
                      var max = Math.max.apply(null, dashboard.trend.map(function (x) { return x.count })) || 1
                      return h('div', { key: i, className: 'ffw-trend-col' },
                        h('div', { className: 'ffw-trend-bar', style: { height: Math.max(4, Math.round(t.count / max * 40)) + 'px' } }),
                        h('span', { className: 'ffw-trend-label' }, t.label),
                        h('span', { className: 'ffw-trend-cnt' }, t.count))
                    }))
                  : h('div', { className: 'ffw-dash-empty' }, '暂无数据')),
              h('div', { className: 'ffw-dash-card' },
                h('div', { className: 'ffw-dash-card-h' }, '热门话题 TOP10'),
                (dashboard && dashboard.topics && dashboard.topics.length)
                  ? h('div', { className: 'ffw-topics' }, dashboard.topics.map(function (t, i) {
                      return h('div', { key: i, className: 'ffw-topic-row' },
                        h('span', { className: 'ffw-topic-rank' }, i + 1),
                        h('span', { className: 'ffw-topic-name' }, t.topic),
                        h('span', { className: 'ffw-topic-cnt' }, t.count))
                    }))
                  : h('div', { className: 'ffw-dash-empty' }, '暂无数据')))),
          // ── 工具栏 ──
          h('div', { className: 'ffw-toolbar ffw-subbar' },
            h('span', { className: 'ffw-cnt' }, '共 ' + items.length + ' 条'),
            h('span', { className: 'ffw-sp' }),
            h(Tooltip, { label: '刷新数据与统计', delayMs: 400 },
              h('button', { type: 'button', className: 'ffw-iconbtn', 'aria-label': '刷新', disabled: !!busy, onClick: function () { loadList(true) } },
                h(IconRefreshOutline16, { size: 14, className: busy && busy.id === 'batch' ? 'ffw-spin' : null }))),
            h(Tooltip, { label: '批量自动打标未处理条目（每次 20 条）', delayMs: 400 },
              h('button', { type: 'button', className: cx('ffw-tbtn', 'on'), disabled: !!busy, onClick: autoTagBatch },
                busy && busy.id === 'batch' ? '打标中…' : '批量自动打标'))),
          note ? h('div', { className: 'ffw-note' }, note) : null,
          // ── 状态筛选 ──
          h('div', { className: 'ffw-filters' },
            FILTERS.map(function (f) {
              return h('button', {
                key: f.id, type: 'button',
                className: cx('ffw-chip', filter === f.id && 'on'),
                onClick: function () { setFilter(f.id) },
              }, f.name + (f.count != null ? ' (' + f.count + ')' : ''))
            })),
          status === 'error' ? h('div', { className: 'ffw-status err' }, '读取加工台队列失败', h('button', { onClick: function () { loadList(true) } }, '重试')) : null,
          shown.length === 0 ? h('div', { className: 'ffw-empty' }, items.length === 0 ? '还没有视频条目。到「RSS订阅」里订阅一个抖音博主（粘贴 rsshub://douyin/user/<secUid> 或主页地址）即可。' : '该筛选下没有条目') : null,
          // ── 数据表格 ──
          h('div', { className: 'ffw-table' },
            h('div', { className: 'ffw-table-hdr' },
              h('span', { className: 'ffw-th ffw-th-cover' }, ''),
              h('span', { className: 'ffw-th ffw-th-title' }, '标题 / 博主'),
              h('span', { className: 'ffw-th ffw-th-status' }, '状态'),
              h('span', { className: 'ffw-th ffw-th-dir' }, '方向'),
              h('span', { className: 'ffw-th ffw-th-score' }, '分'),
              h('span', { className: 'ffw-th ffw-th-actions' }, '操作')),
            shown.slice(0, 100).map(function (a) {
              var st = a.structured_tags
              return h('div', { key: a.id, className: 'ffw-table-row' },
                h('span', { className: 'ffw-td ffw-th-cover' },
                  a.previewImage ? h('img', { className: 'ffw-art-cover sm', src: a.previewImage, alt: '', loading: 'lazy' }) : h('div', { className: 'ffw-art-cover sm ph' }, '🎬')),
                h('span', { className: 'ffw-td ffw-th-title' },
                  h('div', { className: 'ffw-art-title' }, a.title),
                  h('div', { className: 'ffw-meta' }, (a.author || '') + (a.publishedAt ? ' · ' + fmtTime(a.publishedAt) : ''))),
                h('span', { className: 'ffw-td ffw-th-status' },
                  h('span', { className: 'ffw-status-tag ' + procStatus(a) },
                    procStatus(a) === 'tagged' ? '已打标' : procStatus(a) === 'transcribed' ? '已提取' : '待提取')),
                h('span', { className: 'ffw-td ffw-th-dir' }, st && st.direction ? h('span', { className: 'ffw-dir-badge' }, st.direction) : '—'),
                h('span', { className: 'ffw-td ffw-th-score' }, a.score != null ? h('span', { className: 'ffw-score' }, a.score) : '—'),
                h('span', { className: 'ffw-td ffw-th-actions' },
                  h('button', { className: 'ffw-tbtn sm', disabled: !!busy, onClick: function () { transcribe(a) } }, a.transcript ? '提取' : '提取'),
                  h('button', { className: 'ffw-tbtn sm', disabled: !!busy, onClick: function () { autoTagOne(a) } }, '打标')))
            }))))
    }

    function dashCard(label, value, cls) {
      return h('div', { className: 'ffw-dash-stat ' + (cls || '') },
        h('div', { className: 'ffw-dash-stat-v' }, value),
        h('div', { className: 'ffw-dash-stat-l' }, label))
    }


    // InputBridge：session 域捕获 inputActions.setDraft
    function InputBridge(p) {
      useEffect(function () {
        bridge.setDraft = (p.inputActions && typeof p.inputActions.setDraft === 'function') ? p.inputActions.setDraft : null
      }, [p.inputActions])
      return null
    }

    // —— FeedFuse 设置卡片（key=feedfuse，编辑 config 的非黑盒入口）——
    //
    // 通过 ctx.settingsScope 读写 feedfuse namespace；字段与 Host 半 schema 对齐。
    // scope 契约来自 @deepseek-ai/dsh-client-runtime 的 settings-scope：
    //   getSnapshot() -> { status, value, base, user, writable, ... }
    //   subscribe(cb) -> disposer
    //   set(field, value) / unset(field) -> Promise<void>
    // 不存在 scope.value / scope.user / scope.commit()。
    // 卡片自包含外观与暂存逻辑，不依赖 ui-settings-plugins 内部（client bundle 纯净度门禁）。

    // 卡片编辑的字段定义（与 Host 半 FeedfuseSettingsSchema 对齐）。
    // kind：text 自由文本；num 整数；bool 布尔开关。字符串化「已覆盖」按 user 层存在与否判断。
    var SET_FIELDS = [
      // 存储：内置 SQLite 库文件路径（设置菜单首项）
      { key: 'dbFilePath', label: 'SQLite 库文件路径', ph: 'feedfuse.sqlite', hint: '库文件名（相对数据目录）' },
      { key: 'dataDir', label: '数据目录', ph: 'feedfuse-data', hint: '素材/临时产物与 SQLite 库所在目录' },
      // RSS 抓取参数
      { key: 'rssUserAgent', label: 'RSS User-Agent', ph: 'FeedFuse/1.0' },
      { key: 'rssTimeoutMs', label: 'RSS 请求超时(ms)', ph: '10000', kind: 'num' },
      { key: 'fetchIntervalMinutes', label: '抓取间隔(分钟)', ph: '30', kind: 'num', hint: '打开列表时超过该间隔的源自动重抓；刷新按钮立即抓取' },
      { key: 'autoInstallAssets', label: '自动安装工具链', kind: 'bool', hint: '缺工具(yt-dlp/ffmpeg/whisper)时自动安装' },
      // 自媒体（抖音）配置 —— 内建浏览器抓取优先，RSSHub 为备用来源
      { key: 'douyinSource', label: '取数来源', ph: 'auto', hint: 'auto=内建浏览器优先 / browser=只用浏览器 / rsshub=只用 RSSHub 订阅' },
      { key: 'douyinUid', label: '抖音 secUid', hint: '也可填 rsshub://douyin/user/<secUid> 或你的抖音主页地址' },
      { key: 'douyinCookie', label: '抖音 Cookie', hint: '从浏览器复制；留空则用「登录抖音」按钮的扫码登录态' },
      { key: 'chromePath', label: 'Chrome 路径', ph: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', hint: '留空自动探测本机浏览器' },
      { key: 'douyinMaxWorks', label: '作品抓取上限', ph: '100', kind: 'num' },
      { key: 'rsshubBase', label: 'RSSHub 基础地址', ph: 'https://rsshub.app' },
      { key: 'douyinFeedUrl', label: '抖音作品订阅地址', hint: '备用来源：RSSHub 的 /douyin/user 订阅地址' },
      // 工具路径
      { key: 'ytDlpPath', label: 'yt-dlp 路径' },
      { key: 'ffmpegPath', label: 'ffmpeg 路径' },
      { key: 'ffprobePath', label: 'ffprobe 路径' },
      { key: 'whisperPath', label: 'whisper 路径' },
      { key: 'whisperModelUrl', label: 'whisper 模型下载地址' },
    ]

    /** 把某个字段的有效值格式化为草稿文本（bool 返回布尔本身，其余返回字符串）。 */
    function seedOf(f, v) {
      if (f.kind === 'bool') return !!v
      return v == null ? '' : String(v)
    }

    /** 单个字段的解析与写入：返回 { field, run }；草稿非法或不变时返回 null。 */
    function planField(scope, snap, f, staged) {
      var cur = f.kind === 'bool'
        ? seedOf(f, snap.value ? snap.value[f.key] : undefined)
        : (snap.value && snap.value[f.key] != null ? String(snap.value[f.key]) : '')
      var raw = staged

      if (f.kind === 'bool') {
        if (raw === cur) return null
        return { field: f.key, run: function () { return scope.set(f.key, !!raw) } }
      }
      var text = String(raw == null ? '' : raw).trim()
      if (text === cur) return null
      if (text === '') {
        // 空草稿：清除该字段（含 user 层覆盖），让它回落到 base/默认层。
        return { field: f.key, run: function () { return scope.unset(f.key) } }
      }
      if (f.kind === 'num') {
        var n = Number(text)
        if (!Number.isFinite(n)) return { field: f.key, invalid: true }
        return { field: f.key, run: function () { return scope.set(f.key, n) } }
      }
      return { field: f.key, run: function () { return scope.set(f.key, text) } }
    }

    function FeedfuseSettingsCard(p) {
      var scope = p.scope
      var snapPair = useState(function () { return scope ? scope.getSnapshot() : null })
      var snap = snapPair[0]
      var setSnap = snapPair[1]
      var editPair = useState(null) // null 表示尚未从快照播种草稿
      var edit = editPair[0]
      var setEdit = editPair[1]
      var savingPair = useState(false)
      var saving = savingPair[0]
      var setSaving = savingPair[1]

      // 订阅 scope：主机配置变化时刷新快照。
      useEffect(function () {
        if (!scope) return
        var onSnap = function () { setSnap(scope.getSnapshot()) }
        setSnap(scope.getSnapshot())
        return scope.subscribe(onSnap)
      }, [scope])

      // 快照就绪后播种一次草稿（此后只在保存/放弃后重播种）。
      useEffect(function () {
        if (!((snap && snap.status === 'ready') && edit === null)) return
        var seed = {}
        SET_FIELDS.forEach(function (f) {
          seed[f.key] = seedOf(f, snap.value ? snap.value[f.key] : undefined)
        })
        setEdit(seed)
      }, [snap, edit])

      var status = snap ? snap.status : 'loading'
      var writable = !!(snap && snap.writable)
      var user = (snap && snap.user) || {}
      var dirtyFlag = edit !== null && SET_FIELDS.some(function (f) {
        return planField(scope, snap, f, edit[f.key]) !== null
      })

      function setField(key, v) {
        var nd = {}
        for (var k in edit) nd[k] = edit[k]
        nd[key] = v
        setEdit(nd)
      }

      function save() {
        if (!scope || !writable || saving || edit === null) return
        var writes = []
        var rejected = false
        SET_FIELDS.forEach(function (f) {
          var planned = planField(scope, snap, f, edit[f.key])
          if (!planned) return
          if (planned.invalid) { rejected = true; return }
          writes.push(planned.run)
        })
        if (rejected) return
        if (writes.length === 0) return
        setSaving(true)
        Promise.all(writes.map(function (run) { return run() })).catch(function () {
          // 写入失败时 Settings 会自动回读主机状态；这里无论如何都刷新快照，
          // 让界面呈现主机实际接受的结果，而不是停留在未落地的草稿。
        }).then(function () {
          var accepted = scope.getSnapshot()
          setSnap(accepted)
          var seed = {}
          SET_FIELDS.forEach(function (f) {
            seed[f.key] = seedOf(f, accepted.value ? accepted.value[f.key] : undefined)
          })
          setEdit(seed)
          setSaving(false)
        })
      }

      function discard() {
        if (!snap) return
        var seed = {}
        SET_FIELDS.forEach(function (f) {
          seed[f.key] = seedOf(f, snap.value ? snap.value[f.key] : undefined)
        })
        setEdit(seed)
      }

      if (status === 'loading') {
        return h('div', { className: 'ffw-set' }, h('div', { className: 'ffw-status' }, '正在加载配置…'))
      }
      if (status === 'unavailable') {
        return h('div', { className: 'ffw-set' }, h('div', { className: 'ffw-empty' }, '当前连接未提供 FeedFuse 配置'))
      }

      return h('div', { className: 'ffw-set' },
        SET_FIELDS.map(function (f) {
          var overridden = Object.prototype.hasOwnProperty.call(user, f.key)
          var val = edit ? edit[f.key] : seedOf(f, snap.value ? snap.value[f.key] : undefined)
          return h('div', { key: f.key, className: 'ffw-set-fi' },
            h('div', { className: 'ffw-fi' },
              h('span', { className: 'ffw-lbl' }, f.label, overridden ? h('span', { className: 'ffw-set-ov', title: '已由本地设置覆盖' }, '●') : null),
              f.kind === 'bool'
                ? h('input', { type: 'checkbox', disabled: !writable, checked: !!val, onChange: function (e) { setField(f.key, e.target.checked) } })
                : h('input', { className: 'ffw-inp', placeholder: f.ph || '', disabled: !writable, value: val, onChange: function (e) { setField(f.key, e.target.value) } }),
              f.hint ? h('span', { className: 'ffw-set-hint' }, f.hint) : null))
        }),
        h('div', { className: 'ffw-toolbar' },
          h('button', { className: 'ffw-tbtn on', disabled: !dirtyFlag || !writable, onClick: save }, saving ? '保存中…' : '保存'),
          h('button', { className: 'ffw-tbtn', disabled: saving, onClick: discard }, '放弃'),
          h('span', { className: 'ffw-set-note' }, writable ? '保存后对新抓取生效；库文件路径变更于下次启动迁移' : '当前连接只读，无法保存') ))
    }

    // —— 侧边栏外壳：官方 'sidebar' 插槽的 occupant ——
    //
    // ui-layout 把整个左栏声明成 single 席位 'sidebar'，注册到这里即整体替换默认
    // 侧边栏（内置 ui-sidebar 在 patch 层 disable，见 cordis.patch.yml）。列几何、
    // 品牌行、新建会话与折叠动效沿用上游 SidebarRoot 的实现；在此之上本外壳自带
    // 一排操作标签，标签体各自是一个子席位，由原注册方照常填入：
    //   sidebar.workspaces → ui-workspace、sidebar.settings → ui-settings-general、
    //   sidebar.footer.action → 各插件叠加、sidebar.brand.* → ui-brand-official、
    //   sidebar.rss / sidebar.zmt → 本插件的 FeedFuseRss / FeedFuseZmt。
    // 注意：席位是「声明即独占」，所以声明这些子席位的只能有一个 occupant。

    /** 展开态内容卸载延时；与 150ms 宽内容淡出一致。 */
    var SIDEBAR_COLLAPSE_SETTLE_MS = 150

    /** 指针离开侧栏后滚动条继续绘制的时长。 */
    var SIDEBAR_SCROLLBAR_LINGER_MS = 2000

    /** 操作标签表：id → 图标 → 文案 → 承载标签体的子席位。 */
    var SIDEBAR_TABS = [
      { id: 'workspace', icon: '📁', label: '工作区', slot: 'sidebar.workspaces' },
      { id: 'rss', icon: '📡', label: 'RSS订阅', slot: 'sidebar.rss' },
    ]
    // 加工台在主区域展开（不在侧边栏），侧边栏只保留一个触发按钮
    var SIDEBAR_ACTIONS = [
      { id: 'workbench', icon: '🛠️', label: '加工台', overlay: true },
    ]

    /**
     * 外壳声明的子席位表（声明 = 独占渲染权 + 运行时派发规格）。
     * 折叠态（56px rail）由这些席位的 occupant 自己按 wide 标志渲染。
     */
    var SIDEBAR_CHILDREN = {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.rss': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    }

    /**
     * 渲染左栏外壳。
     * @param p - 席位组合 props：layout 传入的 collapsed / width，框架的 renderSlot，
     *   以及本插件 inject 的 startSession / toggleSidebar 回调。
     * @returns 侧边栏元素树。
     */
    function SidebarShell(p) {
      var collapsed = p.collapsed
      var width = p.width
      var renderSlot = p.renderSlot
      var startSession = p.startSession
      var toggleSidebar = p.toggleSidebar

      // 折叠动画期间宽内容保持挂载（淡出），settle 后才卸载并切到 rail 布局。
      var settledPair = useState(collapsed)
      var settled = settledPair[0]
      var setSettled = settledPair[1]
      useEffect(function () {
        if (!collapsed) { setSettled(false); return }
        var timer = window.setTimeout(function () { setSettled(true) }, SIDEBAR_COLLAPSE_SETTLE_MS)
        return function () { window.clearTimeout(timer) }
      }, [collapsed])
      var wide = !collapsed || !settled

      // 当前操作标签（工作区 / RSS订阅 / 自媒体），仅存在于外壳本地状态。
      var activePair = useState(SIDEBAR_TABS[0].id)
      var activeOp = activePair[0]
      var setActiveOp = activePair[1]
      var activeTab = SIDEBAR_TABS.filter(function (t) { return t.id === activeOp })[0] || SIDEBAR_TABS[0]

      // 淡出过程中把内容冻结在展开宽度上（内联样式），滑动的列裁切它而非重排它。
      var lastWideWidth = useRef(width)
      if (!collapsed) lastWideWidth.current = width

      // rail 淡入只服务「活的」折叠：直接以折叠态刷新时静态渲染 rail。
      var everWide = useRef(!collapsed)
      if (!collapsed) everWide.current = true

      // 列内的滚动条是指针附属品：指针在内时绘制，离开后再保留一会儿。
      var column = useRef(null)
      var insidePair = useState(false)
      var pointerInside = insidePair[0]
      var setPointerInside = insidePair[1]
      var lingerTimer = useRef(undefined)
      function cancelLinger() {
        window.clearTimeout(lingerTimer.current)
        lingerTimer.current = undefined
      }
      function armLinger() {
        if (lingerTimer.current !== undefined) return
        lingerTimer.current = window.setTimeout(function () {
          lingerTimer.current = undefined
          setPointerInside(false)
        }, SIDEBAR_SCROLLBAR_LINGER_MS)
      }
      useEffect(function () {
        if (!pointerInside) return
        function onMove(event) {
          var rect = column.current && column.current.getBoundingClientRect()
          if (!rect) return
          var inside = event.clientX >= rect.left && event.clientX < rect.right
            && event.clientY >= rect.top && event.clientY < rect.bottom
          if (inside) cancelLinger()
          else armLinger()
        }
        document.addEventListener('pointermove', onMove)
        return function () {
          document.removeEventListener('pointermove', onMove)
          cancelLinger()
        }
      }, [pointerInside])

      function expandIfNeeded() {
        if (collapsed) toggleSidebar()
      }

      function pickTab(id) {
        return function () { setActiveOp(id) }
      }

      function pickTabAndExpand(id) {
        return function () {
          setActiveOp(id)
          toggleSidebar()
        }
      }

      var brandMark = function (size) {
        return renderSlot('sidebar.brand.mark', { size: size }, {
          fallback: h(FishLogo, { size: size }),
        })
      }

      return h('div', {
        ref: column,
        className: cx('ffw-side-root', !wide && 'ffw-side-collapsed', !wide && everWide.current && 'ffw-side-railIn',
          collapsed && wide && 'ffw-side-fading', !pointerInside && 'ffw-side-quietBars'),
        style: wide ? { width: collapsed ? lastWideWidth.current : width } : undefined,
        onPointerEnter: function () { cancelLinger(); setPointerInside(true) },
        onPointerLeave: armLinger,
      },
        h('div', { className: 'ffw-side-logoRow' },
          // 展开态品牌即新建会话快捷入口；折叠 rail 的 logo 是下方的展开开关。
          wide && h('button', {
            type: 'button',
            className: cx('ffw-side-brand', 'ffw-side-wide'),
            'aria-label': '新建会话',
            onClick: function () { startSession() },
          },
            h('span', { className: 'ffw-side-brandIdentity', 'aria-hidden': 'true' },
              h('span', { className: 'ffw-side-brandMark' }, brandMark(24)),
              h('span', { className: 'ffw-side-brandName' },
                renderSlot('sidebar.brand.name', {}, {
                  fallback: h('span', { className: 'ffw-side-fallbackName' }, 'DSH Local Build'),
                })))),
          // 折叠态静止显示品牌图形，悬停换成面板图标（展开入口）。
          h(Tooltip, { label: collapsed ? '打开侧边栏' : '收起侧边栏', delayMs: 500 },
            h('button', {
              type: 'button',
              className: cx('ffw-side-iconButton', 'ffw-side-toggle'),
              'aria-label': collapsed ? '打开侧边栏' : '收起侧边栏',
              onClick: function () { toggleSidebar() },
            },
              !wide && h('span', { className: 'ffw-side-railMark', 'aria-hidden': 'true' }, brandMark(24)),
              // rail 图标按规范画 18，展开态用图标原生尺寸。
              h(IconPanelLeftOutline16, { className: 'ffw-side-panelIcon', size: wide ? 16 : 18 })))),

        // 展开态按钮自带文案，只有 rail 需要 tooltip。
        h(Tooltip, { label: '新会话', delayMs: 500, disabled: wide },
          h('button', {
            type: 'button',
            className: 'ffw-side-newSession',
            'aria-label': '新建会话',
            onClick: function () { startSession() },
          },
            h(IconNewChatOutline16, { size: wide ? 14 : 18 }),
            wide && h('span', { className: cx('ffw-side-newSessionLabel', 'ffw-side-wide') }, '新会话'))),

        // 操作标签栏：展开态一行图标+文案，rail 竖排图标。
        wide
          ? h('div', { className: 'ffw-side-opTabs', role: 'tablist' },
              SIDEBAR_TABS.map(function (tab) {
                return h('button', {
                  key: tab.id,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': activeOp === tab.id,
                  className: cx('ffw-side-opTab', activeOp === tab.id && 'ffw-side-opTabActive'),
                  onClick: pickTab(tab.id),
                },
                  h('span', { className: 'ffw-side-opTabIcon' }, tab.icon),
                  h('span', { className: 'ffw-side-opTabLabel' }, tab.label))
              }))
          : h('div', { className: 'ffw-side-opRail', role: 'tablist' },
              SIDEBAR_TABS.map(function (tab) {
                return h('button', {
                  key: tab.id,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': activeOp === tab.id,
                  title: tab.label,
                  className: cx('ffw-side-opRailIcon', activeOp === tab.id && 'ffw-side-opRailIconActive'),
                  onClick: pickTabAndExpand(tab.id),
                }, tab.icon)
              })),

        // 浏览区在当前标签的子席位上；列在两种宽度下都占满控件与底部之间。
        h('div', { className: 'ffw-side-regionArea' },
          renderSlot(activeTab.slot, { wide: wide, expandSidebar: expandIfNeeded })),

        // 加工台触发按钮：点击后在主区域展开完整工作台。
        h('div', { className: 'ffw-side-wbTrigger', title: '加工台（主区域展开）', onClick: openWorkbenchOverlay }, '🛠️'),

        // 底部：叠加动作在上、设置席位在下，两种宽度同序。
        h('div', { className: 'ffw-side-footArea' },
          h('div', { className: 'ffw-side-footerActions' }, renderSlot('sidebar.footer.action', { wide: wide })),
          h('div', { className: 'ffw-side-settingsArea' }, renderSlot('sidebar.settings', { wide: wide }))))
    }

    function apply(ctx) {
      bridge.ctx = ctx
      var removeCss = injectCss(CSS)

      // 左栏外壳：注册进 ui-layout 的官方 'sidebar' 席位，替换内置侧边栏。
      // inject 只带外壳自己的两个控制回调，其余数据走席位。
      var shellProps = function () {
        return {
          startSession: function (workspaceId) { ctx.workspaces.startSession(workspaceId) },
          toggleSidebar: function () { ctx.layout.toggleSidebar() },
        }
      }
      ctx.slots.inject('sidebar', function () {
        return ctx.slots.register({
          name: 'sidebar',
          children: SIDEBAR_CHILDREN,
          inject: shellProps,
        }, SidebarShell)
      })

      ctx.slots.inject('sidebar.rss', function () {
        return ctx.slots.register({ name: 'sidebar.rss', priority: 0 }, FeedFuseRss)
      })

      // 加工台/流水线已移至主区域浮层（通过侧边栏 🛠️ 按钮触发），不再占侧边栏席位。

      // 文章详情 / 加工台在主工作区（shell.overlay）渲染：仿 dsh-worktable 控制室，
      // 用 position:fixed 定位到对话根，铺满主区域，左侧边栏和右侧对话窗不受影响。
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'feedfuse-article-overlay', order: 90 }, WorkspaceDetail)
      })
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'feedfuse-workbench-overlay', order: 91 }, WorkbenchDetail)
      })
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'feedfuse-remix-overlay', order: 92 }, RemixDetail)
      })
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'feedfuse-wb-overlay', order: 89 }, WorkbenchOverlay)
      })

      ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({ name: 'conversation.input.dock', id: 'feedfuse-bridge', order: 30 }, InputBridge)
      })

      // FeedFuse 设置卡片：以 feedfuse namespace 为 key，在「插件配置」标签页渲染。
      // 若宿主未挂载 settings 服务（无 settingsScope 注入），则静默跳过。
      if (ctx.settingsScope) {
        var ffScope = ctx.settingsScope.bind({ namespace: 'feedfuse' })
        ctx.slots.inject('settings.plugin.item', function () {
          return ctx.slots.register({
            name: 'settings.plugin.item',
            key: 'feedfuse',
            locale: 'feedfuse',
            inject: function () { return { scope: ffScope } },
          }, function Card(p) {
            return h(FeedfuseSettingsCard, { scope: p.scope })
          })
        })
      }

      // 共享分栏互斥协议：其他分栏引擎（dsh-worktable 等）声明占用时关闭本工作区
      ctx.effect(function () {
        function onClaim(e) {
          try {
            var id = e && e.detail && e.detail.id
            var ws = wsStore.get()
            if (ws.open && id && id !== 'feedfuse-article') {
              wsCloseGeom()
              wsStore.set({ open: false, feed: null, articles: [], article: null })
            }
          } catch {}
        }
        window.addEventListener('dsh:split-claim', onClaim)
        return function () { window.removeEventListener('dsh:split-claim', onClaim) }
      }, 'feedfuse-workbench: split claim')

      ctx.effect(function () { return removeCss }, 'feedfuse-workbench: css')
    }

    var CSS = [
      // —— 侧边栏外壳（几何与动效对齐上游 ui-sidebar，类名带 ffw-side 前缀避碰）——
      '.ffw-side-root{--ffw-side-inline-padding:12px;display:flex;flex-direction:column;height:100%;padding:6px var(--ffw-side-inline-padding);box-sizing:border-box;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);font-size:14px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
      // rail 几何：56px 列内左右 10px，控件 36x36，12px 竖向节奏。
      '.ffw-side-root.ffw-side-collapsed{padding:18px 10px 6px}',
      // 指针不在列内时收掉滚动条（改配透明而非隐藏，保留 gutter 不重排行）。
      '.ffw-side-root.ffw-side-quietBars{--dsh-scrollbar-thumb:transparent;--dsh-scrollbar-thumb-hover:transparent}',
      // 折叠第一阶段：冻结宽度的内容整体淡出。
      '.ffw-side-fading>*{opacity:0;transition:opacity 150ms var(--ds-ease-in-out)}',
      '.ffw-side-wide{animation:ffw-side-wide-in 200ms var(--ds-ease-in-out)}',
      '@keyframes ffw-side-wide-in{from{opacity:0}}',
      // 第二阶段：rail 控件从原 rail 右边缘平移入场；底部只淡入。
      '.ffw-side-railIn .ffw-side-iconButton,.ffw-side-railIn .ffw-side-newSession,.ffw-side-railIn .ffw-side-regionArea{animation:ffw-side-rail-in 150ms var(--ds-ease-in-out) backwards}',
      '.ffw-side-railIn .ffw-side-footArea{animation:ffw-side-rail-fade-in 150ms var(--ds-ease-in-out) backwards}',
      '@keyframes ffw-side-rail-in{from{opacity:0;transform:translateX(49px)}}',
      '@keyframes ffw-side-rail-fade-in{from{opacity:0}}',
      '.ffw-side-logoRow{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;height:60px;padding:8px 0 8px 4px;margin-bottom:8px;box-sizing:border-box;overflow:hidden}',
      '.ffw-side-collapsed .ffw-side-logoRow{height:36px;padding:0;margin-bottom:12px;justify-content:flex-start}',
      // 品牌组：只在行为上是按钮（新建会话快捷入口），无悬停外观。
      '.ffw-side-brand{flex:1;min-width:0;display:inline-flex;align-items:center;overflow:hidden;padding:0;border:none;background:transparent;color:inherit;cursor:pointer}',
      '.ffw-side-brandIdentity{display:inline-flex;align-items:center;gap:8px;height:24px;min-width:0}',
      '.ffw-side-brandMark{flex:none;display:inline-flex;align-items:center;justify-content:center}',
      '.ffw-side-brandName{display:inline-flex;align-items:center;gap:6px;min-width:0;height:24px;font-size:18px;font-weight:600;line-height:24px;letter-spacing:.04em}',
      '.ffw-side-fallbackName{font-size:17px;letter-spacing:0;white-space:nowrap}',
      '.ffw-side-iconButton{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary)}',
      '.ffw-side-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ffw-side-collapsed .ffw-side-iconButton{width:36px;height:36px;color:var(--dsw-alias-label-primary)}',
      // rail 开关：静止显示品牌图形，悬停换成面板图标。
      '.ffw-side-collapsed .ffw-side-toggle .ffw-side-panelIcon{display:none}',
      '.ffw-side-collapsed .ffw-side-toggle:hover .ffw-side-panelIcon{display:inline}',
      '.ffw-side-collapsed .ffw-side-toggle:hover .ffw-side-railMark{display:none}',
      '.ffw-side-railMark{display:inline-flex;align-items:center;justify-content:center}',
      '.ffw-side-newSession{flex:none;display:flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:8px 16px;margin:0 2px 8px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;cursor:pointer;overflow:hidden}',
      '.ffw-side-newSession:hover{background:var(--dsw-alias-button-floating-hover)}',
      '.ffw-side-collapsed .ffw-side-newSession{align-self:flex-start;width:36px;height:36px;padding:0;margin:0 0 12px;gap:0;border-color:transparent;background:transparent}',
      '.ffw-side-collapsed .ffw-side-newSession:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ffw-side-newSessionLabel{max-width:200px;overflow:hidden;white-space:nowrap}',
      '.ffw-side-collapsed .ffw-side-newSessionLabel{max-width:0}',
      // 浏览区常驻挂载，脚部位置不随内容浮动；负边距把嵌套滚动条推到列边缘。
      '.ffw-side-regionArea{flex:1;min-height:0;display:flex;flex-direction:column;margin-left:-4px;margin-right:calc(-1 * var(--ffw-side-inline-padding));padding-left:4px;overflow:hidden}',
      '.ffw-side-collapsed .ffw-side-regionArea{margin-left:0;margin-right:0;padding-left:0}',
      // 加工台触发按钮
      '.ffw-side-wbTrigger{display:flex;align-items:center;justify-content:center;width:36px;height:36px;margin:4px 2px 8px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;cursor:pointer}',
      '.ffw-side-wbTrigger:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}',
      // 操作标签栏：展开态一行图标+文案，rail 竖排图标。
      '.ffw-side-opTabs{flex:none;display:flex;gap:4px;min-width:0;width:100%;padding:0 2px 6px}',
      '.ffw-side-opTab{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:9px;padding:5px 4px;cursor:pointer;white-space:nowrap}',
      '.ffw-side-opTab:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.ffw-side-opTabActive{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}',
      '.ffw-side-opTabIcon{font-size:13px;flex:none}',
      '.ffw-side-opTabLabel{font-size:11.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis}',
      '.ffw-side-opRail{flex:none;display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px 0}',
      '.ffw-side-opRailIcon{width:34px;height:34px;border-radius:10px;border:1px solid transparent;background:transparent;font-size:16px;cursor:pointer}',
      '.ffw-side-opRailIcon:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ffw-side-opRailIconActive{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent)}',
      // 脚部：叠加动作排在设置之上，各自拥有按钮外观。
      '.ffw-side-footArea{flex:none;display:flex;flex-direction:column}',
      '.ffw-side-settingsArea,.ffw-side-footerActions{flex:none;min-width:0;width:100%}',
      '.ffw-side-footerActions{display:flex}',
      '.ffw-side-collapsed .ffw-side-footArea{align-items:center}',
      '.ffw-side-collapsed .ffw-side-settingsArea,.ffw-side-collapsed .ffw-side-footerActions{display:flex;justify-content:center;width:auto}',
      '@media (prefers-reduced-motion: reduce){.ffw-side-wide,.ffw-side-fading>*,.ffw-side-railIn .ffw-side-iconButton,.ffw-side-railIn .ffw-side-newSession,.ffw-side-railIn .ffw-side-footArea,.ffw-side-railIn .ffw-side-regionArea{transition:none;animation:none}}',
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
      '.ffw-subbar{margin-bottom:4px}',
      // 遮罩、不透明卡面、头部与关闭按钮都由 ui-primitives 的 Modal 提供；
      // 这里只限高对话框并让内容区滚动（发现列表可能很长）。
      '.ffw-modal{max-height:min(76vh,680px)}',
      '.ffw-modal-content{flex:1;min-height:0;overflow-y:auto}',
      '.ffw-form{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.ffw-lbl{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.ffw-row{display:flex;gap:8px;align-items:center}',
      '.ffw-row .ffw-inp{flex:1}',
      '.ffw-inp{width:100%;padding:7px 10px;font-size:12.5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-primary);outline:none}',
      '.ffw-inp:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent)}',
      '.ffw-inp::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.ffw-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-secondary)}',
      '.ffw-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary)) 15%,transparent);color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}',
      '.ffw-badge.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}',
      '.ffw-badge.run{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-secondary)}',
      '.ffw-preview{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
      '.ffw-fi{display:flex;flex-direction:column;gap:5px}',
      '.ffw-disc{display:flex;flex-direction:column;gap:6px;min-height:0}',
      '.ffw-src{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
      '.ffw-src .ffw-tbtn{flex-shrink:0}',
      '.ffw-desc{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.ffw-set{display:flex;flex-direction:column;gap:6px;padding:10px 14px}',
      '.ffw-set-fi{display:flex;gap:8px}',
      '.ffw-set-fi .ffw-fi{flex:1}',
      '.ffw-set-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.ffw-set-ov{color:#f59e0b;font-size:10px;margin-left:4px}',
      '.ffw-set-note{font-size:11px;color:var(--dsw-alias-label-secondary);align-self:center}',
      // —— 刷新（热更新抓取）——
      '.ffw-sp{flex:1;min-width:0}',
      '.ffw-iconbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}',
      '.ffw-iconbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}',
      '.ffw-iconbtn:disabled{opacity:.45;cursor:default}',
      '.ffw-spin{animation:ffw-spin 900ms linear infinite}',
      '@keyframes ffw-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
      '.ffw-note{font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 4px 8px}',
      '.ffw-ic.err{background:var(--dsw-alias-state-error-primary)}',
      '.ffw-login-guide{padding:10px 11px;border-radius:11px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);margin-bottom:8px}',
      '.ffw-lg-t{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px}',
      '.ffw-lg-d{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.ffw-lg-alt{font-size:11px;color:var(--dsw-alias-label-secondary);align-self:center}',
      // —— 内容类型与加工台 ——
      '.ffw-plat{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary)}',
      '.ffw-score{flex:none;min-width:26px;text-align:center;font-size:11px;font-weight:700;padding:1px 6px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary)) 16%,transparent);color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}',
      '.ffw-score.lg{font-size:12px;padding:2px 8px}',
      '.ffw-state{font-size:10.5px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px}',
      '.ffw-state.ok{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary)) 40%,transparent)}',
      '.ffw-filters{display:flex;gap:5px;flex-wrap:wrap;margin:2px 0 8px}',
      '.ffw-chip{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.ffw-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.ffw-chip.on{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}',
      '.ffw-wb-row{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);padding:8px;margin-bottom:8px}',
      '.ffw-wb-head{display:flex;align-items:center;gap:9px;cursor:pointer}',
      '.ffw-wb-tc{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);margin-top:6px}',
      '.ffw-wb-open{margin-top:8px}',
      '.ffw-ai-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}',
      // —— 侧边栏双栏（订阅源 + 文章列表），详情走主工作区浮层 ——
      '.ffw-split{display:flex;height:100%;overflow:hidden}',
      '.ffw-split-col{overflow-y:auto;min-width:0}',
      '.ffw-split-feeds{width:44%;max-width:340px;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.ffw-split-articles{flex:1}',
      // —— 主工作区浮层（文章详情）——
      '.ffw-ov{position:fixed;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;z-index:90}',
      '.ffw-ov-hdr{display:flex;align-items:center;gap:12px;height:46px;padding:0 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-shrink:0;background:var(--dsw-alias-bg-base)}',
      '.ffw-ov-title{font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-ov-note{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}',
      '.ffw-ov-tabs{display:flex;gap:4px;margin:0 8px}',
      '.ffw-ov-tab{padding:4px 12px;border-radius:7px;border:1px solid transparent;background:transparent;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.ffw-ov-tab:hover{color:var(--dsw-alias-label-primary)}',
      '.ffw-ov-tab.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent)}',
      '.ffw-ov-close{width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;font-size:17px;color:var(--dsw-alias-label-secondary)}',
      '.ffw-ov-close:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ffw-ov-body{flex:1;overflow-y:auto;padding:18px 22px}',
      '.ffw-ov-h{font-size:18px;font-weight:600;line-height:1.4;margin-bottom:8px}',
      '.ffw-ov-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:14px}',
      '.ffw-ov-video{width:100%;max-width:560px;border-radius:8px;margin-bottom:14px;background:#000}',
      '.ffw-ov-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}',
      '.ffw-ov-tbtn{padding:7px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px}',
      '.ffw-ov-tbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ffw-ov-section{margin-bottom:18px}',
      '.ffw-ov-section-t{font-size:11px;font-weight:600;margin-bottom:6px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.5px}',
      '.ffw-ov-transcript{font-size:13px;line-height:1.7;white-space:pre-wrap;padding:12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);border:1px solid var(--dsw-alias-border-l1)}',
      '.ffw-ov-tags{display:flex;gap:6px;flex-wrap:wrap}',
      '.ffw-ov-tag{padding:3px 10px;border-radius:12px;font-size:11px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-secondary)}',
      '.ffw-ov-body2{display:flex;flex:1;overflow:hidden}',
      '.ffw-ov-list{width:320px;min-width:240px;border-right:1px solid var(--dsw-alias-border-l1);overflow-y:auto;padding:8px}',
      '.ffw-ov-list-h{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.5px;padding:6px 8px}',
      '.ffw-ov-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:14px 8px}',
      '.ffw-ov-row{padding:8px;border-radius:8px;cursor:pointer;border:1px solid transparent;margin-bottom:2px}',
      '.ffw-ov-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ffw-ov-row-on{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
      '.ffw-ov-row-t{font-size:12px;font-weight:500;line-height:1.4}',
      '.ffw-ov-row-m{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.ffw-ov-detail{flex:1;overflow-y:auto;padding:20px 24px}',
      '.ffw-ov-err{font-size:12px;color:var(--dsw-alias-state-error-primary);padding:8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);margin-bottom:8px}',
      // —— 二创工作区 ——
      '.ffw-remix-src{width:300px;min-width:220px}',
      '.ffw-remix-srcbox{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;padding:10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);border:1px solid var(--dsw-alias-border-l1);max-height:60%;overflow-y:auto}',
      '.ffw-remix-types{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}',
      '.ffw-remix-params{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}',
      '.ffw-remix-input{flex:1;min-width:120px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;outline:none}',
      '.ffw-remix-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.ffw-remix-btns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
      '.ffw-remix-out{font-size:13.5px;line-height:1.8;white-space:pre-wrap;padding:14px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);border:1px solid var(--dsw-alias-border-l1);min-height:120px}',
      '.ffw-remix-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:30px 10px;text-align:center;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px}',
      '.ffw-remix-versions{margin-top:16px}',
      '.ffw-remix-ver{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid transparent;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.ffw-remix-ver:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ffw-remix-ver .ffw-chk{color:var(--dsw-alias-brand-primary)}',
      // —— 加工台仪表盘 ——
      '.ffw-dash{margin-bottom:14px}',
      '.ffw-dash-row{display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap}',
      '.ffw-dash-stat{flex:1;min-width:90px;padding:10px 14px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
      '.ffw-dash-stat-v{font-size:20px;font-weight:700;color:var(--dsw-alias-label-primary);line-height:1.2}',
      '.ffw-dash-stat-l{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}',
      '.ffw-dash-stat.new .ffw-dash-stat-v{color:var(--dsw-alias-brand-primary)}',
      '.ffw-dash-stat.ok .ffw-dash-stat-v{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}',
      '.ffw-dash-stat.score .ffw-dash-stat-v{color:var(--dsw-alias-brand-primary)}',
      '.ffw-dash-card{flex:1;min-width:200px;padding:12px 14px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
      '.ffw-dash-card-h{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}',
      '.ffw-dash-empty{font-size:11px;color:var(--dsw-alias-label-secondary);padding:12px 0}',
      '.ffw-dir-bars{display:flex;flex-direction:column;gap:5px}',
      '.ffw-dir-row{display:flex;align-items:center;gap:8px;font-size:11px}',
      '.ffw-dir-label{width:56px;flex:none;color:var(--dsw-alias-label-secondary);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-dir-track{flex:1;height:8px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);overflow:hidden}',
      '.ffw-dir-fill{height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary)}',
      '.ffw-dir-cnt{width:20px;flex:none;color:var(--dsw-alias-label-secondary);text-align:right}',
      '.ffw-trend{display:flex;align-items:flex-end;gap:6px;height:56px}',
      '.ffw-trend-col{display:flex;flex-direction:column;align-items:center;flex:1;gap:2px}',
      '.ffw-trend-bar{width:100%;border-radius:3px 3px 0 0;background:var(--dsw-alias-brand-primary);min-height:2px}',
      '.ffw-trend-label{font-size:9px;color:var(--dsw-alias-label-secondary)}',
      '.ffw-trend-cnt{font-size:9px;color:var(--dsw-alias-label-primary);font-weight:600}',
      '.ffw-topics{display:flex;flex-direction:column;gap:3px}',
      '.ffw-topic-row{display:flex;align-items:center;gap:7px;font-size:11px}',
      '.ffw-topic-rank{width:16px;height:16px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary);text-align:center;line-height:16px;font-size:10px;font-weight:700;flex:none}',
      '.ffw-topic-name{flex:1;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-topic-cnt{color:var(--dsw-alias-label-secondary);font-size:10px}',
      // —— 数据表格 ——
      '.ffw-table{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;overflow:hidden}',
      '.ffw-table-hdr{display:flex;align-items:center;gap:8px;padding:8px 12px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);border-bottom:1px solid var(--dsw-alias-border-l1);font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.4px}',
      '.ffw-table-row{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 60%,transparent);font-size:12px}',
      '.ffw-table-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 2%,transparent)}',
      '.ffw-th,.ffw-td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-th-cover,.ffw-td.ffw-th-cover{width:36px;flex:none}',
      '.ffw-th-title,.ffw-td.ffw-th-title{flex:1;min-width:120px;white-space:normal}',
      '.ffw-th-status,.ffw-td.ffw-th-status{width:64px;flex:none}',
      '.ffw-th-dir,.ffw-td.ffw-th-dir{width:76px;flex:none}',
      '.ffw-th-score,.ffw-td.ffw-th-score{width:40px;flex:none;text-align:center}',
      '.ffw-th-actions,.ffw-td.ffw-th-actions{width:120px;flex:none;display:flex;gap:5px;justify-content:flex-end}',
      '.ffw-art-cover.sm{width:36px;height:36px;border-radius:6px}',
      '.ffw-tbtn.sm{padding:4px 9px;font-size:11px}',
      '.ffw-status-tag{display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:600}',
      '.ffw-status-tag.pending{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}',
      '.ffw-status-tag.transcribed{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}',
      '.ffw-status-tag.tagged{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary));background:color-mix(in srgb,var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary)) 12%,transparent)}',
      '.ffw-dir-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:600;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
      // —— 结构化标签 ——
      '.ffw-st-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;font-size:12px}',
      '.ffw-st-label{flex:none;min-width:68px;color:var(--dsw-alias-label-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.3px;font-size:10.5px}',
      '.ffw-st-val{color:var(--dsw-alias-label-primary);line-height:1.5}',
      // —— 流水线面板 ——
      '.ffw-pipeline{display:flex;flex-direction:column;height:100%;min-height:0}',
      '.ffw-pipeline-list{flex:1;overflow-y:auto;min-height:0;padding-bottom:12px}',
      '.ffw-pipeline-group{margin-bottom:12px}',
      '.ffw-pipeline-group-h{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.5px;padding:4px 2px;margin-bottom:4px}',
      '.ffw-pipeline-item{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);margin-bottom:5px;cursor:pointer;transition:.14s}',
      '.ffw-pipeline-item:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
      '.ffw-pipeline-item.on{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}',
      '.ffw-pipeline-item.tpl{border-style:dashed}',
      '.ffw-pipeline-item-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.ffw-pipeline-item-desc{font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.4}',
      '.ffw-pipeline-item-steps{font-size:10.5px;color:var(--dsw-alias-brand-primary);margin-top:2px}',
      '.ffw-pipeline-create{width:100%;padding:7px;border-radius:9px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;margin-top:4px}',
      '.ffw-pipeline-create:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.ffw-pipeline-detail{flex:1;overflow-y:auto;min-height:0}',
      '.ffw-pipeline-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:20px}',
      '.ffw-pipeline-cfg-h{display:flex;gap:8px;align-items:center;margin-bottom:10px}',
      '.ffw-pipeline-name{flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;outline:none}',
      '.ffw-pipeline-name:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.ffw-pipeline-cfg-desc{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}',
      '.ffw-pipeline-section{margin-bottom:14px}',
      '.ffw-pipeline-section-t{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}',
      '.ffw-pipeline-filters{display:flex;gap:5px;flex-wrap:wrap}',
      '.ffw-pipeline-steps{display:flex;flex-direction:column;gap:6px}',
      '.ffw-pipeline-step{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;transition:.14s}',
      '.ffw-pipeline-step:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent)}',
      '.ffw-pipeline-step.on{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}',
      '.ffw-pipeline-step-icon{font-size:16px;flex:none}',
      '.ffw-pipeline-step-info{flex:1;min-width:0}',
      '.ffw-pipeline-step-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.ffw-pipeline-step-desc{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.ffw-pipeline-step-toggle{font-size:14px;color:var(--dsw-alias-label-secondary);width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--dsw-alias-border-l1)}',
      '.ffw-pipeline-step.on .ffw-pipeline-step-toggle{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.ffw-pipeline-runs{display:flex;flex-direction:column;gap:5px}',
      '.ffw-pipeline-run{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);font-size:11px}',
      '.ffw-pipeline-run-name{flex:1;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ffw-pipeline-run-stat{color:var(--dsw-alias-label-secondary)}',
    ].join('\n')

    // —— 主工作区浮层：文章详情（仿 dsh-worktable 控制室铺满主区域）——
    // 找到对话根（宿主 ConversationRoot 带 data-phase 属性），作为工作区定位基准。
    function findConvRoot() {
      var cands = Array.from(document.querySelectorAll('[data-phase]'))
      function ok(el) { return el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT' && el.children.length >= 2 }
      return cands.find(function (el) { return ok(el) && el.dataset.phase === 'active' })
        || cands.find(ok)
        || null
    }

    // —— 主工作区几何管理（仿 dsh-worktable 分栏引擎：给聊天滚动区设 marginLeft 把聊天挤到右侧，腾出主区）——
    var ffWsGeom = { geom: null, viewArea: null, savedLeft: '', savedRight: '', savedTop: '' }

    function findConvScroll() {
      var root = findConvRoot()
      if (!root) return null
      return root.querySelector('[data-conversation-scroll]')
        || root.children[1] || null
    }

    /** 打开工作区：计算对话根几何 + 用 margin 挤开聊天窗（贴右）。返回是否成功。 */
    function wsOpenGeom() {
      var root = findConvRoot()
      if (!root) return false
      var viewArea = findConvScroll()
      if (!viewArea) return false
      // 声明占用：接入共享 dsh:split-claim 协议的其他分栏引擎（如 dsh-worktable）收到后让位
      try {
        window.dispatchEvent(new CustomEvent('dsh:split-claim', { detail: { id: 'feedfuse-article' } }))
      } catch {}
      var rr = root.getBoundingClientRect()
      var header = root.children[0]
      var hr = header && header.getBoundingClientRect ? header.getBoundingClientRect() : { bottom: rr.top }
      var geom = { left: rr.left, top: hr.bottom, right: rr.right, bottom: rr.bottom }
      ffWsGeom.geom = geom
      ffWsGeom.viewArea = viewArea
      ffWsGeom.savedLeft = viewArea.style.marginLeft
      ffWsGeom.savedRight = viewArea.style.marginRight
      ffWsGeom.savedTop = viewArea.style.marginTop
      // 聊天恒贴右：marginLeft = 主区宽，把对话滚动区推到右侧，主区留给工作区
      var colW = geom.right - geom.left
      var chatW = 400
      var gap = Math.max(0, colW - chatW) + 'px'
      viewArea.style.marginLeft = gap
      viewArea.style.marginRight = ''
      viewArea.style.marginTop = '0px'
      return true
    }

    /** 关闭工作区：恢复聊天 margin，清几何。 */
    function wsCloseGeom() {
      if (ffWsGeom.viewArea) {
        ffWsGeom.viewArea.style.marginLeft = ffWsGeom.savedLeft
        ffWsGeom.viewArea.style.marginRight = ffWsGeom.savedRight
        ffWsGeom.viewArea.style.marginTop = ffWsGeom.savedTop
      }
      ffWsGeom.geom = null
      ffWsGeom.viewArea = null
    }

    /** 重测几何（宿主尺寸变化/会话根切换时调用）。 */
    function wsRefreshGeom() {
      var root = findConvRoot()
      if (!root) return
      var rr = root.getBoundingClientRect()
      var header = root.children[0]
      var hr = header && header.getBoundingClientRect ? header.getBoundingClientRect() : { bottom: rr.top }
      ffWsGeom.geom = { left: rr.left, top: hr.bottom, right: rr.right, bottom: rr.bottom }
    }

    // 读文章详情所需的服务端动作（复用侧栏同款，输入文章 id）
    function wsTranscribe(a) {
      ffJson('transcribe', 'POST', { articleId: a.id }).then(function (r) {
        if (r && r.ok) sendDraft('文案提取完成，' + (a.title || a.id))
      })
    }
    function wsAnalyze(a) {
      ffJson('analyze', 'POST', { articleId: a.id }).then(function (r) {
        var one = r && r.results && r.results[0]
        if (one && one.ok) sendDraft('已完成分析，爆款分 ' + one.score + '，类型 ' + (one.category || '未分析'))
      })
    }
    // 自动打标：提取文案(若缺) → AI 结构化分析 → 写回多维度标签；成功后回写 store 触发 UI 刷新
    function autoTag(a) {
      ffJson('auto-tag', 'POST', { articleId: a.id }).then(function (r) {
        var one = r && r.results && r.results[0]
        if (!one || !one.ok) return
        var st = one.structured_tags
        var ws = wsStore.get()
        if (ws.article && ws.article.id === a.id) wsStore.set({ open: ws.open, feed: ws.feed, articles: ws.articles, article: { ...ws.article, structured_tags: st } })
        var wb = wbWsStore.get()
        if (wb.article && wb.article.id === a.id) wbWsStore.set({ open: wb.open, items: wb.items, article: { ...wb.article, structured_tags: st }, note: wb.note })
      })
    }

    function WorkspaceDetail() {
      var s = useStore(wsStore)
      var tickPair = useState(0)
      var tick = tickPair[0]
      var setTick = tickPair[1]
      // 打开时重测几何 + ResizeObserver 跟随会话根尺寸；关闭时恢复聊天 margin。
      useEffect(function () {
        if (!s || !s.open) return
        wsRefreshGeom()
        setTick(function (x) { return x + 1 })
        function onResize() {
          wsRefreshGeom()
          setTick(function (x) { return x + 1 })
        }
        var ro = new ResizeObserver(onResize)
        var root = findConvRoot()
        if (root) ro.observe(root)
        var mo = new MutationObserver(onResize)
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] })
        return function () {
          ro.disconnect()
          mo.disconnect()
          wsCloseGeom()
        }
      }, [s && s.open])

      var geom = ffWsGeom.geom
      if (!s || !s.open || !geom) return null
      var feed = s.feed
      var articles = s.articles || []
      var article = s.article
      // 工作区宽度 = 主区宽（colW - chatW），右侧留出聊天窗
      var colW = geom.right - geom.left
      var chatW = 400
      var width = Math.max(320, colW - chatW)
      var height = Math.max(200, geom.bottom - geom.top)

      function closeWs() {
        wsCloseGeom()
        wsStore.set({ open: false, feed: null, articles: [], article: null })
      }

      return h('div', { className: 'ffw-ov', style: { left: geom.left, top: geom.top, width: width, height: height } },
        h('div', { className: 'ffw-ov-hdr' },
          h('span', { className: 'ffw-ov-title' }, feed ? feed.title : '文章'),
          h('button', { className: 'ffw-ov-close', onClick: closeWs, 'aria-label': '关闭' }, '✕')),
        h('div', { className: 'ffw-ov-body2' },
          h('div', { className: 'ffw-ov-list' },
            h('div', { className: 'ffw-ov-list-h' }, '文章列表'),
            articles.length === 0
              ? h('div', { className: 'ffw-ov-empty' }, '该源暂无文章')
              : articles.map(function (a) {
                  var isVid = a.mediaType === 'video'
                  return h('div', { key: a.id, className: 'ffw-ov-row' + (article && article.id === a.id ? ' ffw-ov-row-on' : ''), onClick: function () { openArticleInWs(a) } },
                    h('div', { className: 'ffw-ov-row-t' }, a.title || '(无标题)'),
                    h('div', { className: 'ffw-ov-row-m' },
                      h('span', null, fmtTime(a.publishedAt)),
                      isVid && a.durationSec ? h('span', null, fmtDur(a.durationSec)) : null,
                      a.score != null ? h('span', { className: 'ffw-score' }, a.score) : null,
                      isVid ? h('span', { className: a.transcript ? 'ffw-state ok' : 'ffw-state' }, a.transcript ? '有文案' : '待提取') : null))
                })),
          h('div', { className: 'ffw-ov-detail' },
            article ? renderArticleDetail(article) : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, '← 在左侧选择文章'))))
    }

    function openArticleInWs(a) {
      var w = wsStore.get()
      wsStore.set({ open: true, feed: w.feed, articles: w.articles, article: a })
      ffFetch('article', { id: a.id }).then(function (r) {
        var art = (r && r.ok && r.article) ? r.article : a
        var w2 = wsStore.get()
        if (w2.open && w2.article && w2.article.id === art.id) {
          wsStore.set({ open: true, feed: w2.feed, articles: w2.articles, article: art })
        }
      })
    }

    // 渲染多维度结构化标签块（方向/话题/用途/价值/受众/一句话）
    function renderStructuredTags(a) {
      var st = a.structured_tags
      if (!st) return null
      var rows = []
      if (st.direction) rows.push({ label: '方向', val: st.direction })
      if (st.one_liner) rows.push({ label: '概要', val: st.one_liner })
      if (st.topics && st.topics.length) rows.push({ label: '话题', val: null, tags: st.topics })
      if (st.use_cases && st.use_cases.length) rows.push({ label: '可用形态', val: null, tags: st.use_cases })
      if (st.value_to_me) rows.push({ label: '对我的价值', val: st.value_to_me })
      if (st.audience) rows.push({ label: '受众', val: st.audience })
      if (rows.length === 0) return null
      return h('div', { className: 'ffw-ov-section' },
        h('div', { className: 'ffw-ov-section-t' }, '结构化标签'),
        rows.map(function (r, i) {
          if (r.tags) return h('div', { key: i, className: 'ffw-st-row' }, h('span', { className: 'ffw-st-label' }, r.label), h('div', { className: 'ffw-ov-tags' }, r.tags.map(function (t) { return h('span', { key: t, className: 'ffw-ov-tag' }, t) })))
          return h('div', { key: i, className: 'ffw-st-row' }, h('span', { className: 'ffw-st-label' }, r.label), h('span', { className: 'ffw-st-val' }, r.val))
        }))
    }

    function renderArticleDetail(a) {
      // 视频统一走服务端代理（/feedfuse/video?id=），服务端会按需刷新过期直链
      var isVideo = a.mediaType === 'video' || /视频|video|douyin|bilibili/i.test(((a.previewImageUrl || a.previewImage || '') + (a.summary || '')).slice(0, 200))
      var playSrc = isVideo ? ('/feedfuse/video?id=' + encodeURIComponent(a.id)) : null
      var transcript = a.transcript || null

      function sendClip() { sendDraft('/feedfuse 下载并提取这个视频的文案，然后改写成口播脚本：' + (a.link || '') + (a.title ? '（标题：' + a.title + '）' : '')) }
      // 直链过期（代理 403/404）：提示刷新该源后重看
      function onVideoError(ev) {
        var t = ev && ev.currentTarget
        if (!t) return
        var box = document.createElement('div')
        box.className = 'ffw-ov-err'
        box.textContent = '视频地址已过期。请点下方「AI 分析」旁边的「刷新该源后重看」或稍后重试。'
        t.parentNode && t.parentNode.appendChild(box)
        t.remove()
      }

      var actions = [
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { wsTranscribe(a) } }, '提取文案'),
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { autoTag(a) } }, a.structured_tags ? '重新打标' : '自动打标'),
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { openRemix(a) } }, '✍️ 去二创'),
        h('button', { className: 'ffw-ov-tbtn', onClick: sendClip }, '📤 送入聊天（下载+提取+改写）'),
      ]
      if (a.link) actions.push(h('a', { className: 'ffw-ov-tbtn', href: a.link, target: '_blank', rel: 'noopener noreferrer' }, '↗ 打开原文'))

      return h('div', null,
        isVideo && playSrc
          ? h('video', { className: 'ffw-ov-video', src: playSrc, controls: true, autoPlay: false, preload: 'metadata', onError: onVideoError })
          : null,
        h('h2', { className: 'ffw-ov-h' }, a.title || '(无标题)'),
        h('div', { className: 'ffw-ov-meta' },
          a.author ? h('span', null, '作者: ' + a.author) : null,
          a.durationSec ? h('span', null, ' · ' + fmtDur(a.durationSec)) : null,
          a.publishedAt ? h('span', null, ' · ' + fmtTime(a.publishedAt)) : null),
        h('div', { className: 'ffw-ov-actions' }, actions),
        (a.score != null || a.category || (a.tags && a.tags.length))
          ? h('div', { className: 'ffw-ov-section' },
              h('div', { className: 'ffw-ov-section-t' }, '标签'),
              h('div', { className: 'ffw-ov-tags' },
                a.score != null ? h('span', { className: 'ffw-ov-tag' }, '爆款分 ' + a.score) : null,
                a.category ? h('span', { className: 'ffw-ov-tag' }, a.category) : null,
                (a.tags || []).map(function (t) { return h('span', { key: t, className: 'ffw-ov-tag' }, t) })))
          : null,
        transcript
          ? h('div', { className: 'ffw-ov-section' },
              h('div', { className: 'ffw-ov-section-t' }, '视频文案'),
              h('div', { className: 'ffw-ov-transcript' }, transcript))
          : null,
        a.summary
          ? h('div', { className: 'ffw-ov-section' },
              h('div', { className: 'ffw-ov-section-t' }, '摘要'),
              h('div', { style: { fontSize: '13px', lineHeight: '1.7' } }, a.summary))
          : null,
        renderStructuredTags(a))
    }

    // —— 加工台主工作区浮层（视频作品列表 + 详情，多栏展开）——
    function wbTranscribe(a) {
      wbNote('正在提取文案：' + String(a.title || '').slice(0, 18) + '…')
      ffJson('transcript', 'POST', { articleId: a.id, url: a.link, videoTitle: a.title }).then(function (r) {
        if (r && r.ok) wbNote('文案已提取（' + (r.source === 'subtitle' ? '字幕' : '语音识别') + ' ' + String(r.text || '').length + ' 字）')
        else wbNote('提取失败：' + ((r && r.error) || '未知原因'))
        refreshWb()
      }).catch(function () { wbNote('提取失败') })
    }
    function wbAnalyze(a) {
      wbNote('AI 分析中：' + String(a.title || '').slice(0, 18) + '…')
      ffJson('analyze', 'POST', { articleId: a.id }).then(function (r) {
        var one = r && r.results && r.results[0]
        if (one && one.ok) wbNote('分析完成 · 爆款分 ' + one.score + ' · ' + one.category)
        else wbNote('分析失败：' + ((one && one.error) || '未知原因'))
        refreshWb()
      }).catch(function () { wbNote('分析失败') })
    }
    function wbDownload(a) {
      wbNote('正在下载：' + String(a.title || '').slice(0, 18) + '…')
      ffJson('download', 'POST', { articleId: a.id }).then(function (r) {
        if (r && r.ok) wbNote('已下载：' + ((r.name) || ''))
        else wbNote('下载失败：' + ((r && r.error) || '未知原因'))
        refreshWb()
      }).catch(function () { wbNote('下载失败') })
    }
    function wbRewrite(a) {
      var prompt = '这条短视频文案（爆款分 ' + (a.score == null ? '未评' : a.score) + '，类型 ' + (a.category || '未分析') + '）帮我改写成口播脚本：' + (a.transcript || a.title)
      sendDraft(prompt)
    }
    function wbClip(a) {
      sendDraft('/feedfuse 下载并提取这个视频的文案，然后改写成口播脚本：' + (a.link || '') + (a.title ? '（标题：' + a.title + '）' : ''))
    }
    var wbNoteText = ''
    function wbNote(msg) { wbNoteText = msg || ''; var s = wbWsStore.get(); wbWsStore.set({ open: s.open, items: s.items, article: s.article, note: wbNoteText }) }
    function refreshWb() {
      ffFetch('workbench', { limit: '300' }).then(function (r) {
        if (!r || !r.ok) return
        var s = wbWsStore.get()
        wbWsStore.set({ open: s.open, items: r.items || [], article: s.article, note: s.note })
      })
    }
    // 侧栏点击视频 → 打开加工台主工作区浮层
    function openWb(items, article) {
      wbNoteText = ''
      wbWsStore.set({ open: true, items: items || [], article: article || (items && items[0]) || null, note: '' })
      wsOpenGeom()
    }

    function WorkbenchDetail() {
      var s = useStore(wbWsStore)
      var tickPair = useState(0)
      useEffect(function () {
        if (!s || !s.open) return
        wsRefreshGeom()
        tickPair[1](function (x) { return x + 1 })
        function onResize() { wsRefreshGeom(); tickPair[1](function (x) { return x + 1 }) }
        var ro = new ResizeObserver(onResize)
        var root = findConvRoot()
        if (root) ro.observe(root)
        var mo = new MutationObserver(onResize)
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] })
        return function () { ro.disconnect(); mo.disconnect() }
      }, [s && s.open])

      var geom = ffWsGeom.geom
      if (!s || !s.open || !geom) return null
      var items = s.items || []
      var article = s.article
      var note = s.note || wbNoteText
      var colW = geom.right - geom.left
      var chatW = 400
      var width = Math.max(320, colW - chatW)
      var height = Math.max(200, geom.bottom - geom.top)

      function closeWs() { wsCloseGeom(); wbWsStore.set({ open: false, items: [], article: null, note: '' }); wbNoteText = '' }

      return h('div', { className: 'ffw-ov', style: { left: geom.left, top: geom.top, width: width, height: height } },
        h('div', { className: 'ffw-ov-hdr' },
          h('span', { className: 'ffw-ov-title' }, '加工台 · 视频作品'),
          h('span', { className: 'ffw-ov-note' }, note || ''),
          h('button', { className: 'ffw-ov-close', onClick: closeWs, 'aria-label': '关闭' }, '✕')),
        h('div', { className: 'ffw-ov-body2' },
          h('div', { className: 'ffw-ov-list' },
            h('div', { className: 'ffw-ov-list-h' }, '视频作品 · ' + items.length),
            items.length === 0
              ? h('div', { className: 'ffw-ov-empty' }, '暂无视频作品')
              : items.map(function (a) {
                  return h('div', { key: a.id, className: 'ffw-ov-row' + (article && article.id === a.id ? ' ffw-ov-row-on' : ''), onClick: function () { switchWb(a) } },
                    h('div', { className: 'ffw-ov-row-t' }, a.title || '(无标题)'),
                    h('div', { className: 'ffw-ov-row-m' },
                      h('span', null, a.author || ''),
                      a.durationSec ? h('span', null, fmtDur(a.durationSec)) : null,
                      h('span', null, fmtTime(a.publishedAt)),
                      a.score != null ? h('span', { className: 'ffw-score' }, a.score) : null,
                      h('span', { className: a.transcript ? 'ffw-state ok' : 'ffw-state' }, a.transcript ? '有文案' : '待提取'))
                  )
                })),
          h('div', { className: 'ffw-ov-detail' },
            article ? renderWbDetail(article) : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, '← 在左侧选择作品'))))
    }

    function switchWb(a) {
      var s = wbWsStore.get()
      wbWsStore.set({ open: true, items: s.items, article: a, note: s.note })
      ffFetch('article', { id: a.id }).then(function (r) {
        var art = (r && r.ok && r.article) ? r.article : a
        var s2 = wbWsStore.get()
        if (s2.open && s2.article && s2.article.id === art.id) {
          wbWsStore.set({ open: true, items: s2.items, article: art, note: s2.note })
        }
      })
    }

    // —— 二创工作区：从文章/详情「去二创」进入，多形态改写，按版本保存 ——
    // 侧边栏触发：在主区域展开加工台浮层
    function openWorkbenchOverlay() {
      wbOverlayStore.set({ open: true, tab: 'dashboard' })
      wsOpenGeom()
    }
    function closeWorkbenchOverlay() {
      wsCloseGeom()
      wbOverlayStore.set({ open: false, tab: 'dashboard' })
    }
    function setWbTab(tab) {
      var s = wbOverlayStore.get()
      wbOverlayStore.set({ open: s.open, tab: tab })
    }

    function openRemix(a) {
      remixStore.set({ open: true, article: a, versions: [], contentType: 'oral', params: { style: '', length: '', hook: '' }, output: '', generating: false, note: '' })
      wsOpenGeom()
      ffFetch('remixes', { id: a.id }).then(function (r) {
        var s = remixStore.get()
        if (s.open && s.article && s.article.id === a.id && r && r.ok) {
          remixStore.set({ open: true, article: s.article, versions: r.versions || [], contentType: s.contentType, params: s.params, output: s.output, generating: false, note: s.note })
        }
      })
    }
    function setRemix(patch) {
      var s = remixStore.get()
      remixStore.set({ open: s.open, article: s.article, versions: s.versions, contentType: s.contentType, params: s.params, output: s.output, generating: s.generating, note: s.note, ...patch })
    }
    function generateRemix() {
      var s = remixStore.get()
      var a = s.article
      if (!a || s.generating) return
      setRemix({ generating: true, note: '正在生成 ' + (REMIX_TYPES[s.contentType] || s.contentType) + '…', output: '' })
      ffJson('remix', 'POST', { articleId: a.id, contentType: s.contentType, params: s.params }).then(function (r) {
        if (r && r.ok) {
          setRemix({ generating: false, output: r.version ? r.version.text : '', versions: r.versions || [], note: '已生成 1 版（' + (r.version && r.version.id) + '）' })
        } else {
          setRemix({ generating: false, note: '生成失败：' + ((r && r.error) || '未知原因') })
        }
      }).catch(function () { setRemix({ generating: false, note: '生成失败' }) })
    }
    var REMIX_TYPES = {
      oral: '口播脚本', storyboard: '分镜表', drama: '短剧脚本', post: '图文笔记', title: '标题',
    }

    function RemixDetail() {
      var s = useStore(remixStore)
      var tickPair = useState(0)
      useEffect(function () {
        if (!s || !s.open) return
        wsRefreshGeom()
        tickPair[1](function (x) { return x + 1 })
        function onResize() { wsRefreshGeom(); tickPair[1](function (x) { return x + 1 }) }
        var ro = new ResizeObserver(onResize)
        var root = findConvRoot()
        if (root) ro.observe(root)
        var mo = new MutationObserver(onResize)
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] })
        return function () { ro.disconnect(); mo.disconnect() }
      }, [s && s.open])

      var geom = ffWsGeom.geom
      if (!s || !s.open || !geom) return null
      var a = s.article
      var versions = s.versions || []
      var contentType = s.contentType || 'oral'
      var params = s.params || {}
      var output = s.output || ''
      var note = s.note || ''
      var generating = !!s.generating
      var colW = geom.right - geom.left
      var chatW = 400
      var width = Math.max(320, colW - chatW)
      var height = Math.max(200, geom.bottom - geom.top)

      function closeWs() { wsCloseGeom(); remixStore.set({ open: false, article: null, versions: [], contentType: 'oral', params: { style: '', length: '', hook: '' }, output: '', generating: false, note: '' }) }
      function pickType(t) { setRemix({ contentType: t, output: '' }) }
      function setParam(k, v) { var p = {}; for (var kk in params) p[kk] = params[kk]; p[k] = v; setRemix({ params: p }) }
      function pickVersion(v) { setRemix({ output: v ? v.text : '' }) }
      function copyOut() {
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(output || ''); setRemix({ note: '已复制' }) } catch (e) { setRemix({ note: '复制失败' }) }
      }
      function sendToChat() { if (output) sendDraft('这是我对这条视频的二创（' + (REMIX_TYPES[contentType] || contentType) + '）：\n' + output) }
      var srcText = String((a && (a.transcript || a.summary || '')) || '')

      return h('div', { className: 'ffw-ov', style: { left: geom.left, top: geom.top, width: width, height: height } },
        h('div', { className: 'ffw-ov-hdr' },
          h('span', { className: 'ffw-ov-title' }, '二创 · ' + (a ? (a.title || '') : '')),
          h('span', { className: 'ffw-ov-note' }, note),
          h('button', { className: 'ffw-ov-close', onClick: closeWs, 'aria-label': '关闭' }, '✕')),
        h('div', { className: 'ffw-ov-body2' },
          h('div', { className: 'ffw-ov-list ffw-remix-src' },
            h('div', { className: 'ffw-ov-list-h' }, '原文案'),
            h('div', { className: 'ffw-remix-srcbox' }, srcText || '（该作品暂无文案，请先提取）')),
          h('div', { className: 'ffw-ov-detail' },
            h('div', { className: 'ffw-remix-types' },
              ['oral', 'storyboard', 'drama', 'post', 'title'].map(function (t) {
                return h('button', { key: t, className: cx('ffw-ov-tbtn', contentType === t && 'on'), onClick: function () { pickType(t) } }, REMIX_TYPES[t])
              })),
            h('div', { className: 'ffw-remix-params' },
              h('input', { className: 'ffw-remix-input', placeholder: '风格（如 抑扬顿挫、口语化）', value: params.style || '', onChange: function (e) { setParam('style', e.target.value) } }),
              h('input', { className: 'ffw-remix-input', placeholder: '篇幅（如 500字、1分钟）', value: params.length || '', onChange: function (e) { setParam('length', e.target.value) } }),
              h('input', { className: 'ffw-remix-input', placeholder: '钩子（如 悬念式、数字式）', value: params.hook || '', onChange: function (e) { setParam('hook', e.target.value) } })),
            h('div', { className: 'ffw-remix-btns' },
              h('button', { className: cx('ffw-ov-tbtn', 'on'), disabled: generating, onClick: generateRemix }, generating ? '生成中…' : '🎬 生成' + (REMIX_TYPES[contentType] || '')),
              h('button', { className: 'ffw-ov-tbtn', onClick: copyOut }, '📋 复制'),
              h('button', { className: 'ffw-ov-tbtn', onClick: sendToChat }, '📤 送入聊天')),
            output
              ? h('div', { className: 'ffw-remix-out' }, output)
              : h('div', { className: 'ffw-remix-empty' }, generating ? '正在生成…' : '选择形态与参数，点「生成」开始二创'),
            versions.length > 0
              ? h('div', { className: 'ffw-remix-versions' },
                  h('div', { className: 'ffw-ov-list-h' }, '历史版本 · ' + versions.length),
                  versions.slice().reverse().map(function (v) {
                    return h('div', { key: v.id, className: 'ffw-remix-ver', onClick: function () { pickVersion(v) } },
                      h('span', null, (REMIX_TYPES[v.contentType] || v.contentType) + ' · ' + new Date(v.createdAt).toLocaleString()),
                      h('span', { className: 'ffw-chk' }, v.id && output === v.text ? '●' : ''))
                  }))
              : null)))
    }

    function renderWbDetail(a) {
      var isVideo = a.mediaType === 'video' || /视频|video|douyin|bilibili/i.test(((a.previewImageUrl || a.previewImage || '') + (a.summary || '')).slice(0, 200))
      var playSrc = isVideo ? ('/feedfuse/video?id=' + encodeURIComponent(a.id)) : null
      var transcript = a.transcript || null
      function onVideoError(ev) {
        var t = ev && ev.currentTarget
        if (!t) return
        var box = document.createElement('div')
        box.className = 'ffw-ov-err'
        box.textContent = '视频地址已过期，请稍后重试或刷新订阅源。'
        t.parentNode && t.parentNode.appendChild(box)
        t.remove()
      }

      var actions = [
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { wbTranscribe(a) } }, a.transcript ? '重新提取' : '提取文案'),
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { autoTag(a) } }, a.structured_tags ? '重新打标' : '自动打标'),
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { wbDownload(a) } }, '下载视频'),
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { openRemix(a) } }, '✍️ 去二创'),
        h('button', { className: 'ffw-ov-tbtn clip', onClick: function () { wbClip(a) } }, '✂ 去剪辑'),
        h('button', { className: 'ffw-ov-tbtn', onClick: function () { wbRewrite(a) } }, '📝 改写文案'),
      ]
      if (a.link) actions.push(h('a', { className: 'ffw-ov-tbtn', href: a.link, target: '_blank', rel: 'noopener noreferrer' }, '↗ 打开原文'))

      return h('div', null,
        isVideo && playSrc
          ? h('video', { className: 'ffw-ov-video', src: playSrc, controls: true, autoPlay: false, preload: 'metadata', onError: onVideoError })
          : null,
        h('h2', { className: 'ffw-ov-h' }, a.title || '(无标题)'),
        h('div', { className: 'ffw-ov-meta' },
          a.author ? h('span', null, '作者: ' + a.author) : null,
          a.durationSec ? h('span', null, ' · ' + fmtDur(a.durationSec)) : null,
          a.stats && a.stats.plays ? h('span', null, ' · 播放 ' + a.stats.plays) : null,
          a.publishedAt ? h('span', null, ' · ' + fmtTime(a.publishedAt)) : null),
        h('div', { className: 'ffw-ov-actions' }, actions),
        (a.score != null || a.category || (a.tags && a.tags.length))
          ? h('div', { className: 'ffw-ov-section' },
              h('div', { className: 'ffw-ov-section-t' }, '标签'),
              h('div', { className: 'ffw-ov-tags' },
                a.score != null ? h('span', { className: 'ffw-ov-tag' }, '爆款分 ' + a.score) : null,
                a.category ? h('span', { className: 'ffw-ov-tag' }, a.category) : null,
                (a.tags || []).map(function (t) { return h('span', { key: t, className: 'ffw-ov-tag' }, t) })))
          : null,
        transcript
          ? h('div', { className: 'ffw-ov-section' },
              h('div', { className: 'ffw-ov-section-t' }, '视频文案'),
              h('div', { className: 'ffw-ov-transcript' }, transcript))
          : null,
        a.summary
          ? h('div', { className: 'ffw-ov-section' },
              h('div', { className: 'ffw-ov-section-t' }, '摘要'),
              h('div', { style: { fontSize: '13px', lineHeight: '1.7' } }, a.summary))
          : null,
        renderStructuredTags(a))
    }

    // —— 流水线面板：步骤列表 + 执行历史 ——
    function PipelinePanel() {
      var s = useStore(pipelineStore)
      var defs = s.definitions || []
      var runs = s.runs || []
      var templates = s.templates || []
      var runningId = s.runningId
      var note = s.note || ''
      var status = s.status || 'idle'
      var selectedPair = useState(null)
      var selected = selectedPair[0]
      var setSelected = selectedPair[1]

      useEffect(function () {
        pipelineStore.set({ ...pipelineStore.get(), status: 'loading' })
        ffFetch('pipelines').then(function (r) {
          if (r && r.ok) pipelineStore.set({ definitions: r.definitions || [], runs: r.runs || [], templates: r.templates || [], status: 'ready', runningId: null, note: '' })
          else pipelineStore.set({ definitions: [], runs: [], templates: [], status: 'error', runningId: null, note: '' })
        })
      }, [])

      function refresh() {
        ffFetch('pipelines').then(function (r) {
          if (r && r.ok) pipelineStore.set({ ...pipelineStore.get(), definitions: r.definitions || [], runs: r.runs || [], templates: r.templates || [] })
        })
      }

      function runPipeline(def) {
        pipelineStore.set({ ...pipelineStore.get(), runningId: def.id, note: '正在启动「' + def.name + '」…' })
        ffJson('pipelines/run', 'POST', { id: def.id }).then(function (r) {
          if (r && r.ok) pipelineStore.set({ ...pipelineStore.get(), runningId: def.id, note: '已启动「' + def.name + '」' })
          else pipelineStore.set({ ...pipelineStore.get(), runningId: null, note: '启动失败' })
          setTimeout(refresh, 2000)
        }).catch(function () { pipelineStore.set({ ...pipelineStore.get(), runningId: null, note: '启动失败' }) })
      }

      function deletePipe(id) {
        ffJson('pipelines/delete', 'POST', { id: id }).then(function () { refresh(); setSelected(null) })
      }

      function createFromTemplate(tpl) {
        const def = { name: tpl.name, description: tpl.description, filter: tpl.filter, steps: JSON.parse(JSON.stringify(tpl.steps)), fromTemplate: tpl.id }
        ffJson('pipelines/save', 'POST', { definition: def }).then(function (r) { if (r && r.ok) { refresh(); setSelected(r.definition.id) } })
      }

      function createNew() {
        const def = { name: '新流水线', description: '', filter: { mediaType: 'video' }, steps: [{ type: 'auto_tag', label: '自动打标' }] }
        ffJson('pipelines/save', 'POST', { definition: def }).then(function (r) { if (r && r.ok) { refresh(); setSelected(r.definition.id) } })
      }

      var cur = selected ? defs.find(function (d) { return d.id === selected }) : null

      function toggleStep(stepType) {
        if (!cur) return
        var exists = cur.steps.findIndex(function (s) { return s.type === stepType })
        var steps = cur.steps.slice()
        if (exists >= 0) { steps.splice(exists, 1) }
        else {
          var labelMap = { transcribe: '提取文案', auto_tag: '自动打标', remix: '二创口播', download: '下载视频' }
          steps.push({ type: stepType, label: labelMap[stepType] || stepType, params: { contentType: 'oral' } })
        }
        var updated = { ...cur, steps: steps }
        ffJson('pipelines/save', 'POST', { definition: updated }).then(function (r) { if (r && r.ok) { refresh(); setSelected(r.definition.id) } })
      }

      function updateFilter(key, val) {
        if (!cur) return
        var filter = { ...(cur.filter || {}) }
        if (val === null || val === '' || val === false) delete filter[key]; else filter[key] = val
        var updated = { ...cur, filter: filter }
        ffJson('pipelines/save', 'POST', { definition: updated }).then(function (r) { if (r && r.ok) { refresh(); setSelected(r.definition.id) } })
      }

      function updateName(name) {
        if (!cur) return
        var updated = { ...cur, name: name }
        ffJson('pipelines/save', 'POST', { definition: updated }).then(function (r) { if (r && r.ok) { refresh(); setSelected(r.definition.id) } })
      }

      var STEP_META = { transcribe: { icon: '🎙', desc: '提取视频文案（字幕/语音识别）' }, auto_tag: { icon: '🏷', desc: 'AI 自动打结构化标签' }, remix: { icon: '✍️', desc: '二创生成口播/分镜/短剧等' }, download: { icon: '⬇️', desc: '下载视频到本地素材库' } }
      var FILTER_OPTS = [
        { key: 'untranscribed', label: '仅待提取文案' },
        { key: 'transcribed', label: '仅已提取文案' },
        { key: 'untagged', label: '仅待打标' },
        { key: 'tagged', label: '仅已打标' },
      ]

      return h('div', { className: 'ffw-pipeline' },
        // 左侧：流水线列表
        h('div', { className: 'ffw-pipeline-list' },
          h('div', { className: 'ffw-pipeline-list-h' },
            h('span', null, '流水线'),
            h('button', { className: 'ffw-iconbtn', onClick: refresh, 'aria-label': '刷新', title: '刷新' }, '↻')),
          // 内置模板
          templates.length
            ? h('div', { className: 'ffw-pipeline-group' },
                h('div', { className: 'ffw-pipeline-group-h' }, '推荐模板'),
                templates.map(function (t) {
                  return h('div', { key: t.id, className: 'ffw-pipeline-item tpl', onClick: function () { createFromTemplate(t) } },
                    h('div', { className: 'ffw-pipeline-item-name' }, t.name),
                    h('div', { className: 'ffw-pipeline-item-desc' }, t.description),
                    h('div', { className: 'ffw-pipeline-item-steps' }, t.steps.map(function (s) { return s.label }).join(' → ')))
                }),
                h('button', { className: 'ffw-pipeline-create', onClick: createNew }, '+ 自定义流水线'))
            : null,
          // 我的流水线
          defs.filter(function (d) { return !d.builtin }).length
            ? h('div', { className: 'ffw-pipeline-group' },
                h('div', { className: 'ffw-pipeline-group-h' }, '我的'),
                defs.filter(function (d) { return !d.builtin }).map(function (d) {
                  return h('div', { key: d.id, className: 'ffw-pipeline-item' + (selected === d.id ? ' on' : ''), onClick: function () { setSelected(d.id) } },
                    h('div', { className: 'ffw-pipeline-item-name' }, d.name),
                    h('div', { className: 'ffw-pipeline-item-steps' }, d.steps.map(function (s) { return s.label }).join(' → ') || '（空）'))
                }))
            : null),
        // 右侧：选中流水线的配置 + 执行
        h('div', { className: 'ffw-pipeline-detail' },
          cur
            ? h('div', null,
                h('div', { className: 'ffw-pipeline-cfg-h' },
                  h('input', { className: 'ffw-pipeline-name', value: cur.name, onChange: function (e) { updateName(e.target.value) }, placeholder: '流水线名称' }),
                  h('button', { className: cx('ffw-tbtn', 'on'), disabled: !!runningId, onClick: function () { runPipeline(cur) } },
                    runningId === cur.id ? '运行中…' : '▶ 执行'),
                  cur.builtin ? null : h('button', { className: 'ffw-tbtn', disabled: !!runningId, onClick: function () { deletePipe(cur.id) } }, '删除')),
                cur.description ? h('div', { className: 'ffw-pipeline-cfg-desc' }, cur.description) : null,
                // 筛选条件
                h('div', { className: 'ffw-pipeline-section' },
                  h('div', { className: 'ffw-pipeline-section-t' }, '筛选条件'),
                  h('div', { className: 'ffw-pipeline-filters' }, FILTER_OPTS.map(function (o) {
                    var on = cur.filter && cur.filter[o.key]
                    return h('button', { key: o.key, className: cx('ffw-chip', on && 'on'), onClick: function () { updateFilter(o.key, !on) } }, o.label)
                  }))),
                // 步骤列表
                h('div', { className: 'ffw-pipeline-section' },
                  h('div', { className: 'ffw-pipeline-section-t' }, '处理步骤'),
                  h('div', { className: 'ffw-pipeline-steps' },
                    Object.keys(STEP_META).map(function (st) {
                      var on = cur.steps.findIndex(function (s) { return s.type === st }) >= 0
                      return h('div', { key: st, className: 'ffw-pipeline-step' + (on ? ' on' : ''), onClick: function () { toggleStep(st) } },
                        h('span', { className: 'ffw-pipeline-step-icon' }, STEP_META[st].icon),
                        h('div', { className: 'ffw-pipeline-step-info' },
                          h('div', { className: 'ffw-pipeline-step-name' }, STEP_META[st].icon + ' ' + (st === 'transcribe' ? '提取文案' : st === 'auto_tag' ? '自动打标' : st === 'remix' ? '二创口播' : '下载视频')),
                          h('div', { className: 'ffw-pipeline-step-desc' }, STEP_META[st].desc)),
                        h('span', { className: 'ffw-pipeline-step-toggle' }, on ? '✓' : '+'))
                    }))),
                note ? h('div', { className: 'ffw-note' }, note) : null)
            : h('div', { className: 'ffw-pipeline-empty' }, '← 从左侧选择或创建流水线'),
          // 执行历史
          runs.length
            ? h('div', { className: 'ffw-pipeline-section' },
                h('div', { className: 'ffw-pipeline-section-t' }, '执行历史'),
                h('div', { className: 'ffw-pipeline-runs' }, runs.slice(0, 10).map(function (run) {
                  return h('div', { key: run.id, className: 'ffw-pipeline-run' },
                    h('span', { className: 'ffw-status-tag ' + (run.status === 'done' ? 'tagged' : run.status === 'running' ? 'transcribed' : 'pending') }, run.status === 'done' ? '完成' : run.status === 'running' ? '运行中' : '失败'),
                    h('span', { className: 'ffw-pipeline-run-name' }, run.pipelineName || run.pipelineId),
                    h('span', { className: 'ffw-pipeline-run-stat' },
                      run.stats ? ((run.stats.done || 0) + ' / ' + (run.stats.total || 0)) : ''),
                    h('span', { className: 'ffw-meta' }, run.startedAt ? new Date(run.startedAt).toLocaleString() : ''))
                })))
            : null))
    }

    // —— 加工台主工作区浮层：在主区域展开，含仪表盘/数据表格/流水线三个子页 ——
    function WorkbenchOverlay() {
      var s = useStore(wbOverlayStore)
      var tickPair = useState(0)
      useEffect(function () {
        if (!s || !s.open) return
        wsRefreshGeom()
        tickPair[1](function (x) { return x + 1 })
        function onResize() { wsRefreshGeom(); tickPair[1](function (x) { return x + 1 }) }
        var ro = new ResizeObserver(onResize)
        var root = findConvRoot()
        if (root) ro.observe(root)
        var mo = new MutationObserver(onResize)
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] })
        return function () { ro.disconnect(); mo.disconnect() }
      }, [s && s.open])

      var geom = ffWsGeom.geom
      if (!s || !s.open || !geom) return null
      var tab = s.tab || 'dashboard'
      var colW = geom.right - geom.left
      var chatW = 400
      var width = Math.max(320, colW - chatW)
      var height = Math.max(200, geom.bottom - geom.top)

      var TABS = [
        { id: 'dashboard', label: '📊 仪表盘' },
        { id: 'table', label: '📋 数据' },
        { id: 'pipeline', label: '🔄 流水线' },
      ]

      return h('div', { className: 'ffw-ov', style: { left: geom.left, top: geom.top, width: width, height: height } },
        h('div', { className: 'ffw-ov-hdr' },
          h('span', { className: 'ffw-ov-title' }, '加工台'),
          h('div', { className: 'ffw-ov-tabs' }, TABS.map(function (t) {
            return h('button', { key: t.id, className: cx('ffw-ov-tab', tab === t.id && 'on'), onClick: function () { setWbTab(t.id) } }, t.label)
          })),
          h('button', { className: 'ffw-ov-close', onClick: closeWorkbenchOverlay, 'aria-label': '关闭' }, '✕')),
        h('div', { className: 'ffw-ov-body' },
          tab === 'dashboard' ? h(WbDashboard) : null,
          tab === 'table' ? h(WbTable) : null,
          tab === 'pipeline' ? h(PipelinePanel) : null))
    }

    // 仪表盘子页（原 FeedFuseWorkbench 的仪表盘部分）
    function WbDashboard() {
      var s = useStore(wbStore)
      var items = s.items || []
      var dashboard = s.dashboard
      var busy = s.busy
      var note = s.note
      var status = s.status

      function procStatus(a) {
        if (a.structured_tags) return 'tagged'
        if (a.transcript) return 'transcribed'
        return 'pending'
      }

      useEffect(function () {
        if (status === 'loading' || status === 'ready') return
        loadWb()
      }, [])

      function loadWb() {
        wbStore.set({ status: 'loading', items: [], stats: {}, dashboard: dashboard })
        Promise.all([ffFetch('workbench', { limit: '300' }), ffFetch('materials'), ffFetch('workbench-stats')]).then(function (rs) {
          var r = rs[0], mat = rs[1], ds = rs[2]
          if (r && r.ok) wbStore.set({ status: 'ready', items: r.items || [], stats: r.stats || {}, materials: (mat && mat.materials) || [], dashboard: (ds && ds.ok) ? ds : dashboard, busy: null, note: '' })
          else wbStore.set({ status: 'error', items: [], stats: {}, materials: [], dashboard: dashboard, busy: null, note: '' })
        }).catch(function () { wbStore.set({ status: 'error', items: [], stats: {}, materials: [], dashboard: dashboard, busy: null, note: '' }) })
      }

      function autoTagBatch() {
        if (busy) return
        wbStore.set({ ...wbStore.get(), busy: { id: 'batch', op: 'a' }, note: '正在批量自动打标…' })
        ffJson('auto-tag', 'POST', { all: true, limit: 20 }).then(function (r) {
          var list = (r && r.results) || []
          var ok = list.filter(function (x) { return x.ok }).length
          wbStore.set({ ...wbStore.get(), note: '批量打标完成：成功 ' + ok + ' / ' + list.length })
          loadWb()
        }).catch(function () { wbStore.set({ ...wbStore.get(), note: '批量打标失败' }) }).then(function () { wbStore.set({ ...wbStore.get(), busy: null }) })
      }

      var overview = (dashboard && dashboard.overview) || {}
      var directions = (dashboard && dashboard.directions) || []
      var topics = (dashboard && dashboard.topics) || []
      var trend = (dashboard && dashboard.trend) || []
      var dashTotal = overview.total || items.length || 0

      return h('div', { className: 'ffw-dash' },
        h('div', { className: 'ffw-dash-row' },
          dashCard('总视频', dashTotal, ''),
          dashCard('今日新增', overview.today || 0, 'new'),
          dashCard('已提取', overview.transcribed || 0, ''),
          dashCard('已打标', overview.tagged || 0, 'ok'),
          dashCard('平均分', overview.avgScore || 0, 'score')),
        h('div', { className: 'ffw-toolbar ffw-subbar' },
          h('span', { className: 'ffw-sp' }),
          h(Tooltip, { label: '刷新数据与统计', delayMs: 400 },
            h('button', { type: 'button', className: 'ffw-iconbtn', 'aria-label': '刷新', disabled: !!busy, onClick: loadWb },
              h(IconRefreshOutline16, { size: 14, className: busy && busy.id === 'batch' ? 'ffw-spin' : null }))),
          h(Tooltip, { label: '批量自动打标未处理条目（每次 20 条）', delayMs: 400 },
            h('button', { type: 'button', className: cx('ffw-tbtn', 'on'), disabled: !!busy, onClick: autoTagBatch },
              busy && busy.id === 'batch' ? '打标中…' : '批量自动打标'))),
        note ? h('div', { className: 'ffw-note' }, note) : null,
        h('div', { className: 'ffw-dash-row' },
          h('div', { className: 'ffw-dash-card' },
            h('div', { className: 'ffw-dash-card-h' }, '方向分布'),
            directions.length
              ? h('div', { className: 'ffw-dir-bars' }, directions.slice(0, 6).map(function (d) {
                  var max = directions[0].count || 1
                  return h('div', { key: d.direction, className: 'ffw-dir-row' },
                    h('span', { className: 'ffw-dir-label' }, d.direction),
                    h('div', { className: 'ffw-dir-track' }, h('div', { className: 'ffw-dir-fill', style: { width: Math.round(d.count / max * 100) + '%' } })),
                    h('span', { className: 'ffw-dir-cnt' }, d.count))
                }))
              : h('div', { className: 'ffw-dash-empty' }, '暂无数据，先打标签')),
          h('div', { className: 'ffw-dash-card' },
            h('div', { className: 'ffw-dash-card-h' }, '7 日趋势'),
            trend.length
              ? h('div', { className: 'ffw-trend' }, trend.map(function (t, i) {
                  var max = Math.max.apply(null, trend.map(function (x) { return x.count })) || 1
                  return h('div', { key: i, className: 'ffw-trend-col' },
                    h('div', { className: 'ffw-trend-bar', style: { height: Math.max(4, Math.round(t.count / max * 40)) + 'px' } }),
                    h('span', { className: 'ffw-trend-label' }, t.label),
                    h('span', { className: 'ffw-trend-cnt' }, t.count))
                }))
              : h('div', { className: 'ffw-dash-empty' }, '暂无数据')),
          h('div', { className: 'ffw-dash-card' },
            h('div', { className: 'ffw-dash-card-h' }, '热门话题 TOP10'),
            topics.length
              ? h('div', { className: 'ffw-topics' }, topics.map(function (t, i) {
                  return h('div', { key: i, className: 'ffw-topic-row' },
                    h('span', { className: 'ffw-topic-rank' }, i + 1),
                    h('span', { className: 'ffw-topic-name' }, t.topic),
                    h('span', { className: 'ffw-topic-cnt' }, t.count))
                }))
              : h('div', { className: 'ffw-dash-empty' }, '暂无数据'))))
    }

    // 数据表格子页（原 FeedFuseWorkbench 的表格部分）
    function WbTable() {
      var s = useStore(wbStore)
      var items = s.items || []
      var status = s.status
      var busy = s.busy
      var note = s.note
      var filterPair = useState('all')
      var filter = filterPair[0]
      var setFilter = filterPair[1]

      function procStatus(a) {
        if (a.structured_tags) return 'tagged'
        if (a.transcript) return 'transcribed'
        return 'pending'
      }

      useEffect(function () {
        if (status === 'loading' || status === 'ready') return
        loadWb()
      }, [])

      function loadWb() {
        wbStore.set({ status: 'loading', items: [], stats: {} })
        Promise.all([ffFetch('workbench', { limit: '300' })]).then(function (rs) {
          var r = rs[0]
          if (r && r.ok) wbStore.set({ status: 'ready', items: r.items || [], stats: r.stats || {}, busy: null, note: '' })
          else wbStore.set({ status: 'error', items: [], stats: {}, busy: null, note: '' })
        }).catch(function () { wbStore.set({ status: 'error', items: [], stats: {}, busy: null, note: '' }) })
      }

      function transcribe(a) {
        if (busy) return
        wbStore.set({ ...wbStore.get(), busy: { id: a.id, op: 't' }, note: '正在提取…' })
        ffJson('transcript', 'POST', { articleId: a.id, url: a.link, videoTitle: a.title }).then(function () { loadWb() }).catch(function () { wbStore.set({ ...wbStore.get(), note: '提取失败' }) }).then(function () { wbStore.set({ ...wbStore.get(), busy: null }) })
      }
      function autoTagOne(a) {
        if (busy) return
        wbStore.set({ ...wbStore.get(), busy: { id: a.id, op: 'a' }, note: '正在打标…' })
        ffJson('auto-tag', 'POST', { articleId: a.id }).then(function () { loadWb() }).catch(function () { wbStore.set({ ...wbStore.get(), note: '打标失败' }) }).then(function () { wbStore.set({ ...wbStore.get(), busy: null }) })
      }

      var FILTERS = [
        { id: 'all', name: '全部' },
        { id: 'pending', name: '待提取' },
        { id: 'transcribed', name: '已提取' },
        { id: 'tagged', name: '已打标' },
      ]
      var shown = items.filter(function (a) {
        if (filter === 'all') return true
        return procStatus(a) === filter
      })

      return h('div', { className: 'ffw-wbtable' },
        h('div', { className: 'ffw-toolbar ffw-subbar' },
          h('span', { className: 'ffw-cnt' }, '共 ' + items.length + ' 条'),
          h('span', { className: 'ffw-sp' }),
          h(Tooltip, { label: '刷新', delayMs: 400 }, h('button', { type: 'button', className: 'ffw-iconbtn', 'aria-label': '刷新', onClick: loadWb }, h(IconRefreshOutline16, { size: 14 })))),
        note ? h('div', { className: 'ffw-note' }, note) : null,
        h('div', { className: 'ffw-filters' },
          FILTERS.map(function (f) {
            return h('button', { key: f.id, type: 'button', className: cx('ffw-chip', filter === f.id && 'on'), onClick: function () { setFilter(f.id) } }, f.name + ' (' + items.filter(function (a) { return procStatus(a) === f.id || f.id === 'all' }).length + ')')
          })),
        status === 'error' ? h('div', { className: 'ffw-status err' }, '读取失败', h('button', { onClick: loadWb }, '重试')) : null,
        shown.length === 0 ? h('div', { className: 'ffw-empty' }, '该筛选下没有条目') : null,
        h('div', { className: 'ffw-table' },
          h('div', { className: 'ffw-table-hdr' },
            h('span', { className: 'ffw-th ffw-th-cover' }, ''),
            h('span', { className: 'ffw-th ffw-th-title' }, '标题 / 博主'),
            h('span', { className: 'ffw-th ffw-th-status' }, '状态'),
            h('span', { className: 'ffw-th ffw-th-dir' }, '方向'),
            h('span', { className: 'ffw-th ffw-th-score' }, '分'),
            h('span', { className: 'ffw-th ffw-th-actions' }, '操作')),
          shown.slice(0, 100).map(function (a) {
            var st = a.structured_tags
            return h('div', { key: a.id, className: 'ffw-table-row' },
              h('span', { className: 'ffw-td ffw-th-cover' },
                a.previewImage ? h('img', { className: 'ffw-art-cover sm', src: a.previewImage, alt: '', loading: 'lazy' }) : h('div', { className: 'ffw-art-cover sm ph' }, '🎬')),
              h('span', { className: 'ffw-td ffw-th-title' },
                h('div', { className: 'ffw-art-title' }, a.title),
                h('div', { className: 'ffw-meta' }, (a.author || '') + (a.publishedAt ? ' · ' + fmtTime(a.publishedAt) : ''))),
              h('span', { className: 'ffw-td ffw-th-status' },
                h('span', { className: 'ffw-status-tag ' + procStatus(a) },
                  procStatus(a) === 'tagged' ? '已打标' : procStatus(a) === 'transcribed' ? '已提取' : '待提取')),
              h('span', { className: 'ffw-td ffw-th-dir' }, st && st.direction ? h('span', { className: 'ffw-chip on' }, st.direction) : '—'),
              h('span', { className: 'ffw-td ffw-th-score' }, a.score != null ? h('span', { className: 'ffw-score' }, a.score) : '—'),
              h('span', { className: 'ffw-td ffw-th-actions' },
                h('button', { className: 'ffw-tbtn sm', disabled: !!busy, onClick: function () { transcribe(a) } }, '提取'),
                h('button', { className: 'ffw-tbtn sm', disabled: !!busy, onClick: function () { autoTagOne(a) } }, '打标')))
          })))
    }

    exports.apply = apply
    // slots：席位注册；layout / workspaces：侧边栏外壳的折叠开关与新建会话；
    // settingsScope：FeedFuse 配置卡片（宿主未挂载时下面按存在性判空）。
    exports.inject = ['slots', 'layout', 'workspaces', 'settingsScope']
    return module.exports
  },
})

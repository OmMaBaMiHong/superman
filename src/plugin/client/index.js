/**
 * superman client 半（浏览器 bundle，手写 window.__ModuleLoader__.load 协议，零构建）。
 *
 * 入口席位：sidebar.panellist —— 与「插件」「自动化任务」同属侧栏那一列。
 *   自动化任务（schedules）占 order 10，本入口占 order 11，正好落在它下面。
 *   自动化任务那个面板自己不对外开插槽（只 inject 上游席位、没有 define），
 *   所以「放进它内部」做不到，能做到的是同列相邻。
 *
 * 面板席位：main（key = 'superman'）—— 工作台页面本体，内嵌 /s/app。
 * 输入桥　：conversation.input.dock —— 快捷指令送文本进当前会话输入框。
 *
 * 入口不带图标，只出中文名（见 .sm-nav-label 与下面的去重规则）。
 */
window.__ModuleLoader__.load({
  id: 'superman',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement
    var useEffect = react.useEffect

    var PANEL_ID = 'superman'
    var PANEL_LABEL = '工作台'

    function injectCss(css) {
      var el = document.createElement('style')
      el.setAttribute('data-superman-client', '')
      el.textContent = css
      document.head.appendChild(el)
      return function () { if (el.parentNode) el.parentNode.removeChild(el) }
    }

    /**
     * 工作台字形（席位：sidebar.panellist 的字形位）。
     *
     * 与另外三个条目同族：16×16 视框、fill:none、stroke:currentColor、
     * stroke-width 1（宿主 Regular 档，插件与自动化任务用的就是这一档）、
     * 圆角连接。
     * 「控制台」轮廓——外框 + 顶栏 + 左侧栏——一眼是工作台，且不和
     * 插件（风车）、自动化任务（时钟）、技能中心（书）撞车。
     *
     * 内联 SVG，不用外部图片：跟随 currentColor 自动适配主题与 hover/active，
     * 任意 DPI 都不糊，也省掉一条静态资源服务路径。
     */
    function WorkbenchGlyph(props) {
      var size = props && props.size ? props.size : 18
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('rect', { x: 2.1, y: 2.6, width: 11.8, height: 10.8, rx: 1.6 }),
        h('path', { d: 'M2.1 5.9h11.8' }),
        h('path', { d: 'M6.3 5.9v7.5' }))
    }

    /** 会话输入桥（席位：conversation.input.dock）：拿到 setDraft 供快捷指令投递。 */
    var bridge = { setDraft: null }
    function sendCommand(text) {
      if (typeof bridge.setDraft === 'function') bridge.setDraft(text)
    }
    function InputBridge(p) {
      useEffect(function () {
        bridge.setDraft = (p.inputActions && typeof p.inputActions.setDraft === 'function') ? p.inputActions.setDraft : null
      }, [p.inputActions])
      return null
    }

    /** 快捷指令（点按把指令文本送进当前会话输入框）。 */
    var QUICK_COMMANDS = [
      { icon: '📊', label: '今日概况', text: '今日概况' },
      { icon: '✅', label: '审批代办', text: '看看今天待批队列，逐条给我审批建议' },
      { icon: '🔥', label: '热点选题', text: '今天热榜上有什么值得做的选题？挑 3 个转进审批台' },
    ]

    /**
     * 工作台的绝对地址（给「独立窗口」用）。
     *
     * 桌面客户端把整个界面装在 `dsh-app://app` 自定义协议下，主进程转发本地请求时
     * 会删掉请求里的 `cookie`、并用桌面端自己的 hostCookie 顶替，同时把响应里的
     * `set-cookie` 剥掉（见 Electron 主进程 forwardWebRequest / WITHHELD_RESPONSE_HEADERS）。
     * 内置 iframe 因此不能再依赖 cookie 会话 —— H5 已经改成把登录令牌存 localStorage、
     * 每个 /s/api 请求走 `Authorization: Bearer`（请求头是原样透传的）。
     * 想在外面的真浏览器里打开时，地址得是绝对 http 源：它由客户端启动时挂在
     * globalThis.__DSH_TRANSPORT__.streamBaseUrl 上；拿不到就退回相对路径（Web 场景够用）。
     */
    function workbenchUrl() {
      var t = globalThis.__DSH_TRANSPORT__
      var base = (t && typeof t.streamBaseUrl === 'string') ? t.streamBaseUrl.replace(/\/+$/, '') : ''
      return base + '/s/app'
    }

    /** 桌面端会把 http(s) 的 window.open 交给 shell.openExternal，落到系统浏览器。 */
    function openWorkbench() {
      window.open(workbenchUrl(), '_blank', 'noopener,noreferrer')
    }

    /** 工作台页面（席位：main，key = 'superman'）。 */
    function WorkbenchPage() {
      return h('div', { className: 'sm-page' },
        h('div', { className: 'sm-page-bar' },
          h('span', { className: 'sm-page-mark' }, WorkbenchGlyph({ size: 16 })),
          h('span', { className: 'sm-page-title' }, PANEL_LABEL),
          h('div', { className: 'sm-page-actions' },
            QUICK_COMMANDS.map(function (c) {
              return h('button', {
                key: c.label,
                className: 'sm-cmd-btn',
                title: c.text,
                onClick: function () { sendCommand(c.text) },
              }, c.icon + ' ' + c.label)
            }),
            h('button', { className: 'sm-cmd-btn sm-open-btn', onClick: openWorkbench }, '↗ 独立窗口'))),
        // ?host=dsh：DSH Web 客户端（http 源）里 iframe 无法自证宿主身份，
        // 显式标记后 H5 启用免登录通道与面板内导航（dsh-app:// 桌面壳靠协议名自证，无需参数）。
        // ?v=时间戳：每次打开面板都强制拉最新页面（dsh-app 转发层有缓存，不带参数会吃到旧构建）
        h('iframe', { className: 'sm-page-frame', src: '/s/app?host=dsh&v=' + Date.now(), title: PANEL_LABEL }))
    }

    function apply(ctx) {
      var removeCss = injectCss(CSS)

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 11,
          label: function () { return PANEL_LABEL },
        }, WorkbenchGlyph)
      })

      ctx.slots.inject('main', function () {
        return ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, WorkbenchPage)
      })

      ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({ name: 'conversation.input.dock', id: 'superman-bridge', order: 40 }, InputBridge)
      })

      ctx.effect(function () { return removeCss }, 'superman: css')
    }

    var CSS = [
      // 入口不写任何样式：字形 + 标题交给 sidebar.panellist 席位自己的行布局
      // （36px 行高、8px 间距、hover / active / focus-visible 全是宿主给的），
      // 这样它跟插件、自动化任务、技能中心三个条目完全一致。
      //
      // 工作台页面本体。
      '.sm-page{display:flex;flex-direction:column;height:100%;min-height:0}',
      '.sm-page-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.sm-page-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.sm-page-mark{display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.sm-page-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}',
      '.sm-cmd-btn{font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-label-primary);cursor:pointer;transition:.14s}',
      '.sm-cmd-btn:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent)}',
      '.sm-cmd-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.sm-open-btn{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}',
      '.sm-page-frame{flex:1;width:100%;min-height:0;border:none}',
    ].join('\n')

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

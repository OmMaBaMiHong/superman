/**
 * superman client 半（浏览器 bundle，手写 window.__ModuleLoader__.load 协议，零构建）。
 *
 * K1 最小 slot 注册：
 *   - sidebar.footer.action → 侧栏底部一个 🦸 按钮，点击开关 Superman 面板
 *   - shell.overlay         → 悬浮面板，内嵌 iframe 指向 /s/app（host 半伺服的 H5）
 *
 * 两个席位都是上游 ui-layout / ui-sidebar 原生声明的 list 席位，不需要禁用
 * 任何内置插件，也不需要改 DSH 源码。
 */
window.__ModuleLoader__.load({
  id: 'superman',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect

    // 面板开关状态：footer 按钮与 overlay 面板共享一个模块级 store。
    var listeners = []
    var open = false
    function isOpen() { return open }
    function setOpen(next) {
      open = next
      listeners.forEach(function (fn) { fn(open) })
    }
    function useOpen() {
      var pair = useState(isOpen)
      var v = pair[0]
      var setV = pair[1]
      useEffect(function () {
        function onChange(s) { setV(s) }
        listeners.push(onChange)
        return function () { listeners = listeners.filter(function (x) { return x !== onChange }) }
      }, [])
      return v
    }

    function injectCss(css) {
      var el = document.createElement('style')
      el.setAttribute('data-superman-client', '')
      el.textContent = css
      document.head.appendChild(el)
      return function () { if (el.parentNode) el.parentNode.removeChild(el) }
    }

    /** 侧栏底部触发按钮（席位：sidebar.footer.action）。 */
    function SupermanFooterAction() {
      var v = useOpen()
      return h('button', {
        className: 'sm-trigger' + (v ? ' on' : ''),
        title: 'Superman 面板',
        onClick: function () { setOpen(!v) },
      }, '🦸')
    }

    /** 悬浮面板（席位：shell.overlay）：iframe → /s/app。 */
    /**
     * 会话输入桥（席位：conversation.input.dock）：捕获 inputActions.setDraft，
     * 供指挥台快捷指令把指令文本送进聊天输入框（agent 会话由 DSH 主界面承担）。
     */
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

    /** 指挥台快捷指令（点按送入聊天输入框）。 */
    var QUICK_COMMANDS = [
      { icon: '📊', label: '今日概况', text: '今日概况' },
      { icon: '✅', label: '审批代办', text: '看看今天待批队列，逐条给我审批建议' },
      { icon: '🔥', label: '热点选题', text: '今天热榜上有什么值得做的选题？挑 3 个转进审批台' },
    ]

    function SupermanOverlay() {
      var v = useOpen()
      if (!v) return null
      return h('div', { className: 'sm-panel' },
        h('div', { className: 'sm-panel-bar' },
          h('span', { className: 'sm-panel-title' }, '🦸 Superman'),
          h('a', { className: 'sm-panel-open', href: '/s/app', target: '_blank', rel: 'noopener noreferrer' }, '↗ 新窗口'),
          h('button', { className: 'sm-panel-close', onClick: function () { setOpen(false) } }, '✕')),
        h('div', { className: 'sm-cmd' },
          h('div', { className: 'sm-cmd-title' }, '指挥台 · 快捷指令（送入当前会话）'),
          h('div', { className: 'sm-cmd-row' },
            QUICK_COMMANDS.map(function (c) {
              return h('button', {
                key: c.label,
                className: 'sm-cmd-btn',
                title: c.text,
                onClick: function () { sendCommand(c.text) },
              }, c.icon + ' ' + c.label)
            }))),
        h('iframe', { className: 'sm-panel-frame', src: '/s/app', title: 'Superman' }))
    }

    function apply(ctx) {
      var removeCss = injectCss(CSS)

      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({ name: 'sidebar.footer.action', id: 'superman-trigger', order: 40 }, SupermanFooterAction)
      })

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'superman-overlay', order: 80 }, SupermanOverlay)
      })

      ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({ name: 'conversation.input.dock', id: 'superman-bridge', order: 40 }, InputBridge)
      })

      ctx.effect(function () { return removeCss }, 'superman: css')
    }

    var CSS = [
      '.sm-trigger{width:32px;height:32px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:transparent;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;transition:.14s}',
      '.sm-trigger:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}',
      '.sm-trigger.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent)}',
      '.sm-panel{position:fixed;right:16px;bottom:16px;top:64px;width:min(480px,92vw);z-index:999;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-background-primary,#1e293b);box-shadow:0 24px 70px rgba(0,0,0,.45)}',
      '.sm-panel-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-shrink:0}',
      '.sm-panel-title{flex:1;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.sm-panel-open{font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:none}',
      '.sm-panel-open:hover{color:var(--dsw-alias-label-primary)}',
      '.sm-panel-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;padding:2px 6px}',
      '.sm-panel-close:hover{color:var(--dsw-alias-label-primary)}',
      '.sm-panel-frame{flex:1;border:none;width:100%;min-height:0}',
      '.sm-cmd{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-shrink:0}',
      '.sm-cmd-title{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}',
      '.sm-cmd-row{display:flex;gap:6px;flex-wrap:wrap}',
      '.sm-cmd-btn{font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-label-primary);cursor:pointer;transition:.14s}',
      '.sm-cmd-btn:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent)}',
    ].join('\n')

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

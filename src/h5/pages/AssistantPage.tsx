'use client';

/**
 * H5 指挥台页（/#/assistant）：不造聊天 UI——agent 会话由 DSH 主界面承担。
 * 这里提供说明卡 + 深链接 + 常用指令示例（点按复制），让手机端用户知道
 * 「AI 能帮我干什么、去哪儿聊」。
 */
const DSH_HOME = 'http://127.0.0.1:3080/';

const EXAMPLES = [
  { icon: '📊', text: '今日概况' },
  { icon: '✅', text: '看看今天待批队列，逐条给我审批建议' },
  { icon: '🔥', text: '今天热榜上有什么值得做的选题？挑 3 个转进审批台' },
  { icon: '✍️', text: '把选题 #<id> 洗成小红书风格' },
  { icon: '📥', text: '草稿箱里有没有 needs_review 的稿子？读给我听听' },
  { icon: '🔄', text: '手动抓一轮订阅源' },
];

export default function H5AssistantPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 bg-background px-4 pb-24 pt-6">
      <header>
        <h1 className="text-xl font-bold">🦸 AI 指挥台</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Superman 的全部业务已挂进 DSH agent：审批、热点选题、洗稿、抓取，用自然语言驱动。
        </p>
      </header>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">去哪儿聊</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          对话在桌面端 DSH 主界面进行（同一局域网用手机浏览器打开下面地址）。
          agent 已内置《Superman 操作手册》技能，懂得状态机、配额与原创度红线。
        </p>
        <a
          className="mt-3 block rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground"
          href={DSH_HOME}
          target="_blank"
          rel="noopener noreferrer"
        >
          打开 DSH 指挥台 ↗
        </a>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">常用指令（点按复制）</h2>
        <div className="mt-2 flex flex-col gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.text}
              type="button"
              className="rounded-xl border px-3 py-2.5 text-left text-xs leading-5 active:bg-accent"
              onClick={() => void navigator.clipboard?.writeText(ex.text).catch(() => {})}
            >
              {ex.icon} {ex.text}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
        <h2 className="text-sm font-semibold">安全边界</h2>
        <ul className="mt-1 list-disc pl-4 text-xs leading-5 text-muted-foreground">
          <li>agent 不会批量准奏；每条批准前会给你看摘要</li>
          <li>原创度 needs_review 的草稿必须人工终审</li>
          <li>驳回/重拟必须写明原因（影响去重记忆）</li>
        </ul>
      </section>
    </div>
  );
}

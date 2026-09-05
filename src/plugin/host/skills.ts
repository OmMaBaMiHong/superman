/**
 * Superman DSH 插件 · 技能注入（K4）。
 *
 * 注册 superman 技能：agent 一进场就能加载 Superman 操作手册——业务模型
 * （状态机/配额/原创度红线）、工具清单与用法、安全边界。正文改动随插件
 * 重启生效；通过 ctx.skills.register 的 runtime 源注入。
 */
import { PLUGIN_NAME, type MinimalContext } from './routes.js'

interface SkillsScope {
  skills: {
    register(definition: Record<string, unknown>): () => void
  }
  effect(fn: () => () => void, reason?: string): unknown
}

/** Superman 操作手册（注入 agent 上下文的技能正文）。 */
export const SKILL_CONTENT = `# Superman 操作手册（AI 指挥台）

Superman 是「热点发现 → 治理审批 → 洗稿成稿」的单人内容工作台。你（agent）通过
superman_* 工具驱动全流程。当前为单用户内核：所有工具以初始管理员身份执行，
不需要也无法切换用户。

## 业务模型

### 治理状态机（articles.governance_status）
candidate（待批）→ pending（重拟中）→ archived（已归档/选题池）→ used（已用，终态）
candidate/pending → rejected（已驳回，进 7 天驳回记忆参与去重）
rejected → archived（restore 恢复）
非法迁移一律被拒绝（409）。**没有从 archived 回到 candidate 的路。**

### 配额与质量
- 每日每类目有配额（dailyLimit），超出的新条目自动进 candidate 而不直接归档。
- qualityScore 达 autoApproveThreshold 的条目自动归档（auto-approve），理由里带阈值说明。

### 原创度红线（洗稿）
- 洗稿产出带 similarityScore 与 originalityFlag（original / rewritten / needs_review）。
- 相似度 > 0.5 会自动带降重指令重写一次；仍 > 0.5 落 needs_review。
- **needs_review 草稿必须提醒用户人工终审，绝不能当完成品交付。**

## 工具清单
- superman_stats：今日概况（待批/归档/采集成败/队列规模）
- superman_queue_list(status?, limit?, keyword?)：看治理队列
- superman_item_detail(id)：看条目全文（审批/改写前先看）
- superman_item_approve(id)：批准归档（一次一条，没有批量批准）
- superman_item_reject(id, reason)：驳回（reason 必填，进驳回记忆）
- superman_item_redraft(id, reason)：退回重拟（reason 必填）
- superman_trending_today(platform?, top?, date?)：当日热榜
- superman_trending_promote(id)：热榜转待批选题（幂等）
- superman_rewrite_start(articleId, platforms)：发起洗稿（选题必须已归档；platforms=wechat/xhs/novel）
- superman_drafts_list(platform?, limit?)：草稿箱
- superman_draft_read(id)：读草稿全文
- superman_fetch_trigger(scope?)：手动触发一轮到期源抓取（单次，不动调度开关）
- superman.ping：连通性自检

## 安全边界（红线，违反即错误操作）
1. 不批量准奏：逐条看详情（superman_item_detail）后再批准；用户没点名就不要连续批准多条。
2. 改写前先给摘要确认：对某选题发起 superman_rewrite_start 之前，先用
   superman_item_detail 读全文、向用户复述标题+摘要并征得确认。
3. needs_review 必须提醒：读草稿时 originalityFlag 为 needs_review 要主动亮红线。
4. 驳回/重拟必须带 reason，且写清楚原因——它会影响后续去重与重拟质量。
5. superman_fetch_trigger 只触发一轮；不要建议用户同时开插件调度器和 Next.js worker。

## 典型流程
- 「今日概况」→ superman_stats + superman_queue_list
- 「帮我审一下待批」→ queue_list → 逐条 item_detail → 给建议 → 用户确认后 approve/reject/redraft
- 「热点找选题」→ trending_today → 挑中后 trending_promote → 提示用户去审批台批准
- 「把这篇洗成小红书」→ item_detail 确认 → rewrite_start → 稍后 drafts_list / draft_read 验收
`

/** 注册 superman 技能（modelInvocable + userInvocable）。 */
export function registerSkills(ctx: MinimalContext): void {
  ctx.inject(['skills'], (scope: SkillsScope) => {
    scope.effect(
      () =>
        scope.skills.register({
          name: 'superman',
          description: 'Superman 内容工作台操作手册：治理审批/热点选题/洗稿成稿全流程与安全红线',
          whenToUse: '当用户要求查看待批队列、审批条目、看热榜找选题、发起洗稿、读草稿，或输入以 /superman 开头时',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'runtime',
          content: SKILL_CONTENT,
        }),
      `${PLUGIN_NAME}: skill superman`,
    )
  })
}

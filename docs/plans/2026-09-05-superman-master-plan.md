# Superman 超级工作台 · 总体设计与开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 FeedFuse 为主干仓库（OmMaBaMiHong/superman），融合三省六部的"治理工作流"，构建 OPC 个人超级工作台：采集 → 治理 → 分发（AI 洗稿 / 口播 / AI 漫剧视频）。

**Architecture:** 四层架构——采集层（FeedFuse 现有 RSS + embedded RSSHub）、治理层（移植三省六部的审批状态机与 AI 拟折）、编排层（pg-boss 上新建三条分发流水线）、发布层（扩展现有 publish-center / douyin-publish）。单一数据源：PostgreSQL。单一代码库：superman 主仓库。

**Tech Stack:** Next.js 16 + React 19 + TypeScript 5.9 + Tailwind 4 / PostgreSQL 16 + pg-boss / tsx Worker / embedded RSSHub / whisper（本地 ASR）/ LLM API（OpenAI 兼容、Anthropic、Gemini）/ MiniMax Hailuo 等视频生成 API。

**上游资产：**
- 主干：`https://github.com/OmMaBaMiHong/superman.git`（= FeedFuse v0.4.0 + 视频阅读 MVP，已推送）
- 治理蓝本：`/Users/wade/tian-xia-bang/sansheng-liubu`（三省六部 V3.0，~5,100 行 TS，只做概念移植，不做代码合并）
- 存量数据：17 个订阅源、2,563 篇文章（docker 卷 `feedfuse_feedfuse_pg`）

---

## 0. 核心决策（已定）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 以谁为主 | **FeedFuse 为主干** | pg-boss 队列 + 独立 Worker 是跑视频生成等长任务的前提；已有 publish-center、douyin-publish、whisper、video_materials，分发方向已起头 |
| 三省六部怎么办 | **只移植概念，不合并代码** | 其价值在流程（状态机/拟折/配额/重拟/探索），约 3 个核心机制可移植；两套库存活=同步地狱，不做 |
| 数据源 | **唯一，Postgres** | articles/feeds 已是全量资产所在 |
| 三省六部现有部署 | 保留作个人阅读复习工具（SM-2 复习 FeedFuse 没有），不进生产链路 | |
| TrendRadar | **原版保留、独立运行**，作为「热点雷达」采集引擎；通过 SQLite 同步 + 通用 Webhook 双轨接入，不 fork 不改码，保持跟随上游 v6.x 升级 | 它是热搜聚合+通知工具，不是社媒分发工具（无公众号/小红书发布能力） |
| maigret + Aliens_eye | 封装为独立 Python OSINT worker（FastAPI 包 HTTP），Aliens_eye 做发现层（842 站、变更监控）、maigret 做深挖层（3221 站、资料抽取） | 两者都是 Python 异步程序，不能直接 import 进 Node |
| 前端 | 保留三栏阅读器，新增「审批台」「选题卡」「提词器」「流水线」四个视图 | 见 §4 |

## 1. 目标架构

```
┌─ 采集层（现有 + 两个新引擎）─────────────────────────┐
│  feeds + embedded RSSHub + user_rsshub_cookies        │
│  + 【移植】探索卷宗：搜索发现 → AI 评分 → 反哺固定源   │
│  + 【TrendRadar】热榜雷达：11 平台热榜（头条/百度/微博/ │
│    知乎/B站/抖音/贴吧/澎湃/财联社/凤凰/华尔街见闻）+ RSS │
│    独立 Python 进程运行，SQLite 落库 + Webhook 双轨接入 │
│  + 【OSINT 达人搜索】Aliens_eye(发现/监控) + maigret(深挖)│
│    独立 FastAPI worker，供探索卷宗与博主调研调用        │
├─ 治理层（移植三省六部）──────────────────────────────┤
│  状态机: candidate → pending → archived → used        │
│           ↘ rejected（驳回记忆 7 天去重）              │
│  AI 拟折: 标题/摘要/收录理由/质量分 0-100              │
│  配额: 每类每日上限 + focusRatio 聚焦比               │
│  打回重拟: 驳回理由 → AI 重写                         │
├─ 编排层（新建, pg-boss jobs）────────────────────────┤
│  选题卡(archived) ─┬─ ① 洗稿: 公众号/小红书/小说      │
│                    ├─ ② 口播: 口播稿→提词器→whisper 对稿│
│                    └─ ③ 漫剧: 分镜→逐镜生成→素材库     │
├─ 发布层（现有雏形，扩展）────────────────────────────┤
│  抖音(已有 douyin-publish) + 公众号草稿箱 + 小红书导出  │
└──────────────────────────────────────────────────────┘
```

## 2. 数据模型变更

**修改 `articles` 表**（新增治理字段）：
- `governance_status` text，默认 `'candidate'`：`candidate/pending/archived/rejected/used`
- `quality_score` int（0-100，AI 拟折产出）
- `ai_reason` text（收录理由）
- `redraft_count` int 默认 0
- `governance_updated_at` timestamptz

**新表：**
- `reject_logs`（id, article_id, reason, title, source_url, created_at）——驳回记忆，7 天内参与去重
- `governance_preferences`（每分类一行：daily_limit, focus_ratio, auto_approve_threshold, schedule_cron, exclude_keywords）
- `exploration_directions` / `exploration_items`（探索卷宗）
- `pipeline_jobs`（id, article_id, kind: `rewrite|voiceover|video`, platform, status, input_json, output_json, error, created_at, updated_at）——pg-boss 跑执行，此表做业务视图
- `drafts`（洗稿产出：article_id, platform, title, body, similarity_score, status）
- `voiceover_scripts`（口播稿：article_id, hook, body, cta, duration_est, status）
- `storyboards` + `storyboard_shots`（漫剧分镜；素材落现有 `video_materials`）

**概念映射：** 三省六部的「六部 ministry」→ FeedFuse 的 `categories`（已存在，不重造）；「偏好卡」→ `governance_preferences`；「主题包 packs」→ 复用 `tags` + 关键词过滤（已有）。

## 3. 分阶段计划

> 每个 Phase 开工时按 writing-plans 规范单独出详细实施计划（bite-sized TDD 任务）。本文件锁定架构、边界与验收标准。Phase 1 已给出任务级分解作样板。

### Phase 0 · 基建收口（0.5 天）

- [ ] 本地仓库 `origin` 指向 superman（旧 BryanHoo/FeedFuse 改为 `upstream`，只读归档）
- [ ] `docker compose up` 跑通 db + web(9559) + worker，导入存量 docker 卷数据
- [ ] `.env` 从 `.env.example` 补齐（DATABASE_URL、FEEDFUSE_SECRET_KEY）
- [ ] README 更新为 Superman 定位

**验收：** 本机能打开阅读器，看到 17 个源与历史文章。

### Phase 1 · 治理层（3-4 天，核心）

**Files:**
- Create: `src/server/domains/governance/stateMachine.ts` — 状态迁移纯函数
- Create: `src/server/domains/governance/aiDraft.ts` — AI 拟折（标题/摘要/理由/质量分）
- Create: `src/server/domains/governance/quota.ts` — 配额与 focusRatio 分桶
- Create: `src/server/domains/governance/rejectMemory.ts` — 驳回记忆去重
- Create: `src/server/domains/governance/repository.ts` — SQL 落库
- Create: `src/server/infra/db/migrations/0050_governance.sql`
- Create: `src/app/api/governance/queue/route.ts`（GET 待批队列）
- Create: `src/app/api/governance/items/[id]/approve/route.ts`、`reject/route.ts`、`redraft/route.ts`
- Create: `src/features/governance/components/ApprovalBoard.tsx` — 审批台视图
- Modify: `src/server/domains/feeds/*` — 抓取落库时过治理管线（去重→拟折→配额→状态）
- Test: `src/test/server/domains/governance/*.test.ts`

- [ ] **Task 1: 状态机纯函数 + 迁移 SQL**

```ts
// stateMachine.ts
export type GovernanceStatus =
  | 'candidate' | 'pending' | 'archived' | 'rejected' | 'used';

const TRANSITIONS: Record<GovernanceStatus, GovernanceStatus[]> = {
  candidate: ['pending', 'archived', 'rejected'],
  pending:   ['archived', 'rejected'],
  archived:  ['used'],
  rejected:  ['archived'], // restore
  used:      [],
};

export function canTransition(from: GovernanceStatus, to: GovernanceStatus) {
  return TRANSITIONS[from].includes(to);
}
```

测试：合法迁移全通过、`used` 为终态、`archived→candidate` 非法。

- [ ] **Task 2: AI 拟折（含启发式回退）**

入参文章全文，出参 `{title ≤28字, summary ≤120字, aiReason, qualityScore 0-100}`；未配置 LLM 或调用失败时回退：原标题 + 正文前 200 字 + 固定 60 分。Prompt 带 `<<<UNTRUSTED_DATA>>>` 围栏防注入（抄三省六部 `ai.ts` 的做法）。

- [ ] **Task 3: 抓取接入治理管线**

feed 抓取 worker 落库前：URL 精确去重 + 标题 bigram 相似度 ≥0.78 去重（含 7 天内驳回记录）→ 排除关键词 → AI 拟折 → 配额截取（每类 daily_limit，默认 3，focusRatio 60% 聚焦）→ `autoApproveThreshold` 以上直接 `archived`，否则 `candidate`。

- [ ] **Task 4: 审批 API**（approve / reject[reason] / redraft[reason] / restore），reject 写 `reject_logs`，redraft 带驳回理由重新拟折且 `redraft_count+1`。

- [ ] **Task 5: 审批台前端视图**（见 §4.1）

**验收：** 新抓文章先进待批队列；批准进归档；驳回 7 天内同类不再出现；重拟后摘要变化且计数 +1；无 LLM 配置时全链路仍可用（回退模式）。

### Phase 1b · 采集扩展：热点雷达接入（1-2 天）

TrendRadar（sansan0/TrendRadar v6.10.0，原版克隆，位于 /Users/wade/work-space/pa-chong-cai-ji/TrendRadar）不 fork 不改码，独立运行：

- [ ] TrendRadar 侧：编辑其 config/config.yaml——`storage` 保持本地 SQLite（默认即有），`notification.channels.generic_webhook` 指向 Superman 的 `/api/ingest/trendradar`（带鉴权 token），timeline.yaml 设定推送时段；需要稳定商用时自部署 newsnow 并把 platforms.api_url 指向自有实例
- [ ] Superman 侧新增 `POST /api/ingest/trendradar`：鉴权（header token）→ 解析 payload → 写入 `trend_radar_items` 表（新迁移 0052：id, user_id, platform, title, url, rank, payload_json, received_at）
- [ ] pg-boss 定时 job `trendradar-sync`：读取 TrendRadar 的 `output/news/YYYY-MM-DD.db`（SQLite，结构化全量：标题/URL/排名轨迹/平台）upsert 进 `trend_radar_items`——这是主链路，webhook 只做实时触达
- [ ] 治理管线挂载点：热榜条目按关键词/AI 粗筛后可转 governance candidate（走审批台），或作为「今日热点」独立视图只读展示（默认只读，点「转为选题」才进治理）
- [ ] 前端：审批台/工作台加「热点雷达」区，按平台分组展示当日热榜条目

**验收：** TrendRadar 跑一轮后，Superman 里能看到 11 平台结构化热榜数据；webhook 实时推送可达；热榜条目可一键转为选题进入审批流。

### Phase 1c · 采集扩展：OSINT 达人搜索（1-2 天）

maigret（3221 站深挖）与 Aliens_eye（842 站快筛 + 变更监控 + MCP）均为 Python 异步程序，封装为独立 worker：

- [ ] 新建 `services/osint-worker/`（FastAPI）：`POST /scan {username, mode: quick|deep}` → quick 走 Aliens_eye `UsernameScanner().scan_all_sites()`，deep 走 maigret `maigret.checking.maigret()`；结果写 Postgres `osint_scans` / `osint_hits` 表（迁移 0053）
- [ ] Superman 侧 pg-boss job 调 osint-worker HTTP 接口；入口挂两个场景：① 探索卷宗发现新博主时自动快筛其跨平台账号（丰富源画像）；② 前端「达人搜索」页手动发起
- [ ] 前端「达人搜索」页：输入用户名 → 任务进度 → 命中平台列表（链接/置信度/资料摘要）
- [ ] 合规红线：结果仅本人可见，页面与 API 留审计日志（osint_scans 记录发起人与时间）

**验收：** 输入一个博主用户名，快筛 5 分钟内返回跨平台命中列表；深挖模式能拿到资料字段；审计记录完整。

### Phase 2 · 洗稿流水线（2-3 天，ROI 最高）

- [ ] 平台 profile：公众号深度文 / 小红书种草（emoji 密度、短段落）/ 小说，每 profile 一个 prompt 模板 + 风格样本
- [ ] pg-boss job `rewrite`：选题卡（archived article）→ 草稿入 `drafts`
- [ ] **原创度校验**（红线）：与原文 bigram 相似度 > 阈值自动重写一次，仍超则标记人工处理——法律与平台风控要求
- [ ] 导出：公众号草稿箱 API（需服务号 access_token）/ Markdown 复制导出先行
- [ ] 前端：选题卡列表 + 草稿对比视图（原文 ↔ 成稿 + 相似度分）

**验收：** 选一条归档文章，一键产出三平台草稿，相似度达标，可复制导出。

### Phase 3 · 口播流水线（2 天）

- [ ] job `voiceover`：选题 → 60-90s 口播稿（hook / 正文 / CTA 三段，字数≈语速×时长）
- [ ] 前端提词器页：大字号滚动稿 + 手动/自动滚速
- [ ] 录后回传 → 本地 whisper 转写 → 与稿子 diff 查漏（模型文件不入库，运行时下载）
- [ ] 选题队列视图：我从中挑题 → 生成 → 提词 → 录制完成标记

**验收：** 从选题到提词器可用全流程走通；whisper 对稿能标出漏读段落。

### Phase 4 · AI 漫剧/视频（3-5 天，最后做）

- [ ] 媒体 adapter 接口 `MediaProvider`：`submit(prompt, opts) → jobId` / `poll(jobId) → status|url`，首批实现 MiniMax Hailuo；预留可灵/即梦/本地 ComfyUI
- [ ] 分镜生成：LLM 把选题拆 4-8 镜（每镜 prompt + 时长 + 运镜）
- [ ] 逐镜 pg-boss job，素材落 `video_materials`，失败单镜重试
- [ ] 前端：分镜预览 + 单镜重生成 + 素材拼接导出（ffmpeg 或手动）

**验收：** 一条选题产出完整分镜，至少一个 provider 端到端生成成功，素材入库可下载。

## 4. 前端视图变更

### 4.1 新增「审批台」（核心新增）
待批队列卡片流：AI 拟折（新标题/摘要/质量分/收录理由）+ 原文预览 + 三键操作「准奏 / 驳回(填理由) / 打回重拟」。顶部统计：今日待批 / 已归档 / 已采用 / 采集成功失败数。

### 4.2 阅读器三栏（保留微调）
列表项加治理状态徽章与质量分；归档条目详情页加「送入流水线」按钮（洗稿/口播/漫剧三选）。

### 4.3 新增「选题卡」
归档文章的可选卡片池，支持多选批量进流水线。

### 4.4 新增「提词器」与「流水线任务」页
提词器见 Phase 3；任务页展示 `pipeline_jobs` 状态/错误/重试按钮。

## 5. 风险与红线

1. **原创度**：洗稿必须过相似度校验 + 人工终审后才允许发布，这是法律与平台风控红线。
2. **平台风控**：抖音/Twitter 路由需 Cookie（`user_rsshub_cookies` 已有加密存储机制）；公众号发布先用草稿箱，不自动群发。
3. **密钥**：`FEEDFUSE_SECRET_KEY` 生产必须环境变量注入；superman 仓库当前为 **PUBLIC**，任何 cookie/token 永不入库（gitignore 已收口，vendor/ 整体排除，后续若要纳入抖音发布服务需重新净化 vendored 代码）。
4. **LLM 成本**：拟折/评分设每日调用上限与回退模式，无 key 全链路降级可用。
5. **热点数据上游依赖**：TrendRadar 的热榜数据完全依赖第三方公共 API（newsnow.busiyi.world），稳定性与合规不在自己手里；高频/商用必须自部署 newsnow。
6. **OSINT 合规**：达人搜索涉及公开个人信息聚合，仅限本人调研使用；生产环境需住宅代理池防 WAF；结果不落公开页面、不留存超期数据。
7. **TrendRadar 不分叉**：任何「需要 TrendRadar 改代码才能接入」的方案都视为设计失败——它必须保持原版可升级。

## 6. 里程碑总览

| 里程碑 | 内容 | 量级 |
|---|---|---|
| M0 | 基建收口，仓库跑通 ✅ | 已完成 |
| M1 | 治理层上线（审批台可用） ✅ | 已完成 |
| M1b | 热点雷达接入（TrendRadar 双轨同步） | 1-2 天 |
| M1c | OSINT 达人搜索（Aliens_eye + maigret worker） | 1-2 天 |
| M2 | 洗稿三平台草稿 | 2-3 天 |
| M3 | 口播稿 + 提词器 | 2 天 |
| M4 | 漫剧 adapter 端到端 | 3-5 天 |

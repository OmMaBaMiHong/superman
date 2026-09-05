# Superman × DeepSeek Harness · AI 引擎架构设计

> 日期：2026-09-05 · 状态：已定稿（方向） · 关联：总计划 `2026-09-05-superman-master-plan.md`
>
> 背景：M0-M2 建的是"数据躯干"（采集→治理→洗稿），AI 只是点状调用（拟折打分、单次改写）。用户明确要求：**整体能力要以 Agent 工程调度编排为核心，利用 DSH 的插件生态，做成 AI 驱动的软件**。本文档回答"怎么装进去"。

---

## 1. 核心判断：AI 不是一个功能，是一层

> **2026-09-05 修订（用户拍板方向）**：AI 引擎升级为**产品的体验与编排内核**——用户通过"指挥台"会话驱动采集/治理/创作全链路，DSH 插件生态是即插即用的技能包。但**运行时内核保持确定性**（Postgres/pg-boss/cron），即"脑骨架构"：Agent 决定，服务执行。分两层的原因：
> 1. 采集是无人值守脏活，DSH schedule 不支持 cron、冷会话不触发
> 2. agent 是概率性执行器，领域数据必须确定性事务落库
> 3. 产品形态（服务器部署/手机 H5/公开订阅）DSH 单用户无认证模型给不了
> 4. DSH 是 alpha 版有破坏性变更，内核不能跟别人摇摆
> 5. AgentEngine 接口保持可替换——DSH 成熟后（cron/多用户/稳定 API）可再评估内核迁移，门没关死

目前 AI 在 Superman 里的形态是"函数调用"：`aiDraft(article) → json`。这适合确定性任务，但撑不起用户要的三样东西：

1. **编排**：漫剧"分镜→生成→审片→重拍"、深度调研"搜→读→评→写"这类多步、带工具、带自我校验的任务
2. **生态**：DSH 的插件/MCP 生态（浏览器自动化、视频工具、TTS、第三方技能）应该能即插即用，而不是每个能力都自己写
3. **进化**：AI 能力边界每月都在变，架构上要把"换引擎/换模型"变成改配置而不是改代码

结论：在 pg-boss（确定性管线）和 LLM 客户端（单次调用）之间，插一层 **Agent 引擎层**。DSH 是该层的第一个实现，但不是唯一实现。

## 2. 目标架构

```
┌─ 产品层（Superman Service，服务器部署）─────────────────┐
│  Next.js 全量 UI（桌面 Web 全功能）                      │
│  移动 H5/PWA = 薄客户端（调同一套 API，APP 后期包壳）     │
│  Postgres = 唯一事实源 · pg-boss = 确定性管线调度         │
└──────────────┬───────────────────────┬──────────────────┘
               │ ① 派生 agent 任务      │ ② 能力暴露（MCP）
               ▼                       ▼
┌─ AI 引擎层（DSH sidecar）───────────────────────────────┐
│  dsh sdk profile（JSON-RPC 常驻） / headless（一次性）   │
│  agent loop · 工具注册 · 技能 · 子代理 · workflow 引擎    │
│  └─ 生态位：DSH 插件 / MCP servers 按需安装              │
└──────────────┬──────────────────────────────────────────┘
               │ ③ 结果回写
               ▼
        Superman API / Postgres（canonical writes 只走这里）
```

### 三条连接通道

| 通道 | 方向 | 用途 | 实现 |
|---|---|---|---|
| ① 任务委派 | Superman → DSH | pg-boss job 里的多步任务委托给 agent | worker 调 `dsh sdk` JSON-RPC；任务、上下文、验收标准作输入，结构化结果作输出 |
| ② 能力暴露 | DSH → Superman | Superman 的能力变成 agent 可用的工具 | Superman 起 MCP server（`/api/mcp`）：采集查询、待批队列、草稿读写、发布状态——agent 干活时能自己取数、回写 |
| ③ 生态引入 | DSH 插件生态 → Superman | 浏览器自动化、TTS、视频处理等装插件获得，不自研 | DSH profile 里 `dsh plugin add`；通过 ② 的 MCP 间接服务 Superman |

### 关键纪律

- **canonical writes 只走 Superman API**：agent 不允许直连 Postgres 写库。DSH 侧的 `ctx.storage`/SQLite 只放中间产物。这是数据一致性的红线
- **DSH sidecar 不暴露公网**：它无认证无 TLS，只监听 127.0.0.1 / docker 内网，由 worker 同机调用
- **版本钉死**：DSH 是 0.1.3-alpha 且明示破坏性变更——`package.json`/docker 镜像钉版本，升级是显式动作
- **引擎可替换**：Superman 侧定义 `AgentEngine` 接口（见 §4），DSH 是第一个实现；直连 LLM 是兜底实现

## 3. 能力分诊：什么任务走哪条路

| 任务类型 | 判定规则 | 走哪条路 | 例子 |
|---|---|---|---|
| 确定性管线 | 无 LLM 或单次调用，结果结构固定 | **pg-boss + 直连 LLM**（现状） | 抓取、去重、配额、拟折、洗稿单稿 |
| 轻 agent | 2-4 步、需读数回写、需自我检查 | **pg-boss 发起 → DSH headless** | 口播稿"写→对照原文事实校验→改" |
| 重 agent | 多步循环、多工具组合、长时间 | **pg-boss 发起 → DSH sdk 常驻会话** | 漫剧分镜循环、竞品/达人深度调研、多平台分发改写+合规自检 |
| 交互 agent | 人在场，边聊边干 | **DSH web UI**（桌面端可选入口） | 临时研究任务、插件调试 |

经验法则：**单次调用能解决的不上 agent；agent 任务必须有结构化验收输出**（JSON schema），回到 pg-boss 才算闭环。

## 4. Superman 侧的接口设计

```ts
// src/server/domains/agent/engine.ts
export interface AgentTask {
  goal: string;                    // 自然语言目标
  context: Record<string, unknown>;// 结构化输入（文章、选题、约束）
  tools: string[];                 // 允许使用的 MCP 工具白名单
  outputSchema: object;            // JSON schema 验收
  timeoutSec: number;
}

export interface AgentEngine {
  name: string;
  run(task: AgentTask): Promise<AgentResult>;  // AgentResult = { ok, output, traceUrl?, error? }
}

// 实现1：DshEngine（dsh sdk JSON-RPC，生产）
// 实现2：DirectLlmEngine（单轮调用，兜底/无 DSH 环境）
```

pipeline_jobs 表加 `engine` 与 `engine_trace` 字段（迁移时补），job 执行时按任务类型选引擎。DSH 不可用时 DirectLlmEngine 降级——**没有 DSH，Superman 照样完整可用**。

## 5. 部署拓扑

```
服务器（docker-compose 生产版）
├─ web        Superman Next.js（公网 HTTPS，桌面全功能 + 移动 H5）
├─ worker     pg-boss 消费者（确定性管线 + agent 任务发起）
├─ db         Postgres 16
├─ rsshub     采集引擎（已有）
└─ dsh        DSH sdk profile 常驻容器（内网 only，钉版本）

手机 → HTTPS → web（PWA，薄客户端）
桌面 → HTTPS → web（全功能）
DSH web UI（可选）→ 仅部署者本机/内网，用于交互式 agent 任务
```

## 6. 里程碑调整

在总计划路线图中插入：

| 里程碑 | 内容 | 量级 | 位置 |
|---|---|---|---|
| **M3.5 AI 编排中枢** | `AgentEngine` 接口 + DirectLlm 兜底实现 + DSH sidecar 容器 + Superman MCP server（首批工具：读取归档/待批/草稿、写回草稿、触发抓取）+ **指挥台会话 UI**（工作台常驻 agent 入口，自然语言驱动采集/治理/创作，移动端可用）+ 口播稿自检作为首个 agent 化任务 | 3-4 天 | M3 之后、M4 之前 |
| M4 漫剧 | 更新：分镜循环跑在 DSH 上，为首个"重 agent"场景 | 3-5 天 | 不变 |

原则不变：**每一步没有 DSH 也能跑**（DirectLlm 降级），DSH 只负责把上限拉高。

## 7. 风险与对策

1. **DSH alpha 破坏性变更** → 钉版本 + AgentEngine 适配层隔离；升级 DSH 前跑契约测试（一组固定 AgentTask 冒烟集）
2. **生态插件质量参差** → 插件白名单制，只有评审过的插件进生产 profile；插件出事不污染 Superman 主库（通道 ③ 的写入都过 API 校验）
3. **sidecar 安全** → 无认证的 DSH 绝不绑公网；docker 内网 + 仅 worker 可达
4. **agent 成本失控** → AgentTask 带 timeoutSec + token 预算；engine_trace 记录每轮调用，月度汇总进消息中心
5. **双系统漂移** → DSH 仓库的 feedfuse-workbench 插件保留为"个人实验位"，其成熟能力（如抖音 CDP 抓取）以"收入 Superman 主库"为终点，不在插件里长第二个领域模型

## 8. 已执行的保全动作

- DSH 仓库插件代码已提交保护：`feedfuse-plugin` 分支 `25e3d59fc2`（含 lib/14 文件、5 个迁移、2 份方案文档）；`feedfuse-data/`（1.1G 运行数据）与 `_tmp_*` 已 gitignore
- 插件源码副本同步入 Superman 主仓 `integrations/dsh-plugin/feedfuse-workbench/`，双保险

# Superman × DSH 内核化 · 实施拓扑设计

> 日期：2026-09-05 · 状态：已定稿（方向） · 关联：`2026-09-05-ai-engine-design.md`（脑骨架构）、总计划
>
> 用户拍板：以 DeepSeek Harness（DSH）为内核长身体，业务围绕它做成插件，利用其插件生态，最终形态 = 超级个人工作台（桌面全功能 + 手机 H5 + 服务器部署 + 可分享订阅）。
>
> 本文档回答：**怎么实现**。

---

## 1. 可行性核实结论（2026-09-05，对 DSH 0.1.3-alpha.1 源码核实）

| 硬需求 | DSH 内核方案 | 证据 |
|---|---|---|
| 插件伺服自定义页面（移动 H5） | ✅ 插件可注册 exact/prefix HTTP 路由与 upgrade 路由，handler 是裸 node:http，可返回任意 HTML/JSON | packages/host/webserver/README.zh.md："功能插件拥有每条路由" |
| 公开分享页 | ✅ 公开路由由插件自己实现（webserver 无认证概念，公开面不需要认证） | 同上 |
| 应用层鉴权 | ✅ 插件在自己的路由 handler 里做会话校验（webserver 不管，也不拦） | 同上 |
| 定时采集 | ✅ 插件自起调度器（已有先例：feedfuse-workbench 的 scheduler.js） | deepseek-harness/plugins/feedfuse-workbench |
| 任务队列 | ✅ 插件自维护 job 表（DSH 内置 jobs 是会话级的，不用它） | packages/jobs/README.zh.md |
| 插件 UI（桌面） | ✅ 官方 slot 系统（侧边栏/对话节点/设置卡片），cordis.patch.yml 声明式接管 | packages/client/ui-slots/README.zh.md |
| 服务器部署 | ⚠️ 可绑 0.0.0.0，但无 TLS——前面必须挂 Caddy/nginx 反代 | webserver README 已知限制 |
| 内核稳定性 | ⚠️ 0.1.3-alpha 明示破坏性变更——钉版本 + 适配层隔离 | README.md 第 13 行 |

结论：**DSH 内核化可行**，但成败取决于实现形态（见 §2）。

## 2. 两种"内核化"做法

### 做法 A（错误）：业务写死在插件里

领域逻辑直接调 DSH 内部 API（ctx.storage、ctx.llm……）。代价已被 feedfuse-workbench v0.2（380KB）实证：DSH 每次 alpha 升级 = 业务跟着重写；领域逻辑离开 DSH 进程无法测试、无法部署；手机 H5 和公网门户被迫长在插件进程里，与桌面 UI 抢生命周期。

### 做法 B（采纳）：领域核心为库，DSH 为宿主之一

- `packages/core` = 领域核心：纯 TypeScript，只依赖 Postgres。不知道 DSH 的存在，也不知道 Next.js 的存在。采集、去重、治理状态机、配额、洗稿、草稿、通知、热点、达人搜索——全部业务逻辑住这里
- **"以 DSH 为内核"落在它真正强的地方**：AI 编排（agent loop/工具/技能/子代理）、插件生态、桌面工作台体验
- DSH 插件（apps/dsh-plugin）和 Next.js 服务（apps/web）都是把 core 插上去跑的**宿主**

判定标准：core 里的任何一行代码，`node --test` 脱离两个宿主都能跑。

## 3. Monorepo 拓扑

```
superman/（现有仓库改造为 pnpm workspace）
├─ packages/
│  └─ core/                 # 领域核心（骨架本体）
│       ├─ ingestion/       # 采集（feed/rsshub/trendradar/osint 客户端）
│       ├─ governance/      # 治理（状态机/去重/拟折/配额/驳回记忆）
│       ├─ pipelines/       # 分发流水线（rewrite/voiceover/video）
│       ├─ drafts/          # 草稿与原创度
│       ├─ notify/          # 消息中心
│       └─ store/           # Postgres 数据访问（迁移 + repository）
│
├─ apps/
│  ├─ dsh-plugin/           # DSH 宿主（脑 + 桌面工作台）
│  │    ├─ host/            #   host 半：工具/技能注册、调度器、/s/* 路由
│  │    ├─ client/          #   client 半：slot 面板（工作台/审批/创作）
│  │    └─ cordis.patch.yml
│  └─ web/                  # Next.js 宿主（现有代码，继续服役）
│
├─ integrations/
│  ├─ dsh-plugin/feedfuse-workbench/   # 用户早期插件（已保全，作参考实现）
│  └─ osint-worker/                    # Python OSINT 服务（M1c）
│
└─ docs/plans/              # 全部设计文档
```

## 4. DSH 插件解剖（apps/dsh-plugin）

**host 半**（Node 进程内）：
- `apply(ctx)` 里：初始化 core（读插件配置里的 databaseUrl）→ 注册 agent 工具（`ctx.tools.register`：查询列队/批准/驳回/发起流水线/查草稿/触发抓取）→ 注册技能（采集策略/洗稿规范/口播规范，注入 agent 上下文）→ 启调度器（cron 式定时：抓 feeds、同步热榜、跑配额）→ 注册 HTTP 路由：
  - `/s/api/*` — 应用 API（插件自做 session 鉴权，复用 core 的用户表）
  - `/s/app/*` — 移动 H5 静态页（Preact/htm 轻量构建产物，或复用 apps/web 的 H5 构建）
  - `/s/share/*`、`/s/channel/*` — 公开面（无鉴权，只读）
- 队列：core 的 job 表 + 插件内 worker loop（不依赖 DSH jobs）

**client 半**（DSH Web 内）：
- 官方 slot 注册工作台面板：侧边栏「工作台」（待批数徽章）、对话内节点（agent 产出卡片化展示）、设置卡片（AI 引擎配置）
- 重交互页面（审批信息流/热点轨道）直接用 iframe 桥接 `/s/app/*` 的 H5——**UI 只写一套**，slot 面板和移动端共享

**profile 组装**：`dsh plugin add <本地目录或 github>`，cordis.patch.yml 声明插件行；生产 profile 钉 DSH 版本。

## 5. 硬需求解法表

| 需求 | 解法 |
|---|---|
| 无人值守采集 | 插件内调度器（node-cron 语义），core.ingestion 执行，落 Postgres |
| 数据一致性 | 只有 core.store 写库；agent 工具全部走 core 的事务函数 |
| 手机操作 | `/s/app/*` H5（液态玻璃 v3 同一套 UI），PWA manifest 由插件路由吐出 |
| 公开分享/被订阅 | `/s/share/`、`/s/channel/` 公开路由 + RSS 输出；无鉴权但只读 |
| TLS/域名 | Caddy 反代到 DSH webserver（0.0.0.0 仅内网网卡或防火墙限制） |
| 桌面全功能 | DSH web UI + slot 面板（H5 iframe）+ agent 对话驱动 |
| alpha 风险 | core 不 import 任何 dsh 包；插件适配层单独目录；契约测试集（固定 agent 任务冒烟）随 CI 跑；DSH 钉版本，升级 = 显式 PR |

## 6. 与现有 Next.js 的关系和迁移路径

不推翻重来。四步走：

1. **抽 core**（M3.5 的第一步）：把现有 src/server/domains/* 的领域逻辑原样搬进 packages/core，Next.js 路由改成薄转发——功能零变化，测试全绿
2. **起插件**（M3.5 的第二步）：apps/dsh-plugin 包上 core，先交付三样：agent 工具集、调度器、`/s/app` H5 伺服（直接复用 apps/web 的移动端构建产物）
3. **双宿主并行**：桌面 agent 驾驶舱在 DSH 里长（指挥台会话/插件生态），公网与移动端继续在 Next.js 服役
4. **收敛评估点**（DSH 出 beta/稳定版时）：若插件 H5 已承载全部日常操作，评估把 apps/web 退役为纯公开面服务器，完成真正单内核

## 7. 生态玩法

- **装插件 = 装技能**：浏览器自动化、TTS、视频处理等第三方 DSH 插件/MCP server 直接装进 profile，通过 agent 工具间接服务 Superman 业务
- **我们的产出反向发布**：apps/dsh-plugin 本身就是可发布的 DSH 插件（`dsh plugin add github:OmMaBaMiHong/superman`），未来别人也能用
- **白名单制**：生产 profile 只装评审过的插件；插件写入必须经过 core 的事务函数

## 8. 里程碑更新

M3.5 更名为「**AI 编排中枢 + DSH 宿主**」，内容更新为：

- [ ] 抽离 packages/core（领域逻辑搬迁 + 测试平移，Next.js 路由变薄）
- [ ] apps/dsh-plugin 骨架：cordis.patch.yml + host/client 两半 + 调度器
- [ ] agent 工具首批：queue.read / item.approve / item.reject / pipeline.rewrite.start / drafts.read / fetch.trigger
- [ ] `/s/app` H5 伺服（复用移动端构建）+ 插件级 session 鉴权
- [ ] 指挥台会话入口（DSH 对话 + 工作台 slot 面板）
- [ ] DSH sidecar 进 docker-compose（钉版本）+ 契约冒烟测试集

量级 4-5 天，位置不变（M3 之后、M4 之前）。

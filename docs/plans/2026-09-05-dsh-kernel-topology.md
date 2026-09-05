# Superman = DSH 内核 · 单系统实施拓扑

> 日期：2026-09-05 · 状态：**用户拍板定稿，取代之前所有双宿主/引擎层方案**
>
> 决策：一套系统，DeepSeek Harness 为内核。没有 Plan B，不做双宿主。

---

## 1. 最终形态

```
superman/（pnpm monorepo，本仓库即 DSH 插件包）
│
├─ src/core/            # 领域逻辑（采集/治理/流水线/草稿/通知/热点/OSINT）
│                       # 纯 TS + Postgres，不 import dsh，单测可脱离宿主跑
│
├─ src/plugin/
│  ├─ host/             # DSH host 半（唯一运行时）
│  │   ├─ routes.ts     #   /s/api/* 应用 API · /s/app/* 移动 H5 · /s/share、/s/channel 公开面
│  │   ├─ auth.ts       #   自有 session 鉴权（webserver 不管，我们自己管）
│  │   ├─ scheduler.ts  #   cron 调度（插件内自起，采集/同步/配额）
│  │   ├─ queue.ts      #   job 表 + worker loop
│  │   ├─ tools.ts      #   agent 工具注册（审批/驳回/发起流水线/触发抓取…）
│  │   └─ skills.ts     #   技能注入（洗稿规范/口播规范/采集策略）
│  └─ client/           # DSH client 半：官方 slot 挂桌面面板（iframe 桥 /s/app）
│
├─ src/h5/              # 移动/桌面共用 UI（液态玻璃 v3，从现 Next.js 页面移植）
│                       # vite 构建静态产物，由 host 路由伺服
│
├─ cordis.patch.yml     # 插件声明
├─ integrations/        # OSINT worker / 抖音发布 / RSSHub docker
└─ docs/plans/
```

**运行时只有一个**：`dsh web` 进程。桌面 = DSH Web UI（slot 面板 + agent 对话指挥台）；手机 = 浏览器访问 `/s/app`（PWA）；公网分享 = `/s/share`、`/s/channel`；TLS/域名 = Caddy 反代；DSH 生态 = `dsh plugin add` 随便装。

## 2. 迁移路线（从现有 Next.js 版收敛过来）

现仓库的 Next.js 代码是移植素材库，不是第二宿主：

| 步骤 | 内容 | 验收 |
|---|---|---|
| **K1 骨架** | 仓库改造成 DSH 插件（package.json + cordis.patch.yml）；host 半起路由/auth/调度器；`/s/app` 伺服一个 Hello H5；本地 DSH profile 装上并跑起来 | DSH 启动后访问 /s/app 200；调度器每分钟写一条心跳进 Postgres；agent 里能调到 superman 工具 |
| **K2 领域迁移** | src/server/domains/*（governance/pipelines/trendradar/feeds/auth）搬进 src/core；Next.js API 路由逐条翻译成 host 路由 | 治理/热点/洗稿 API 在插件路由下全部可用，测试平移全绿 |
| **K3 UI 迁移** | 现有 React 页面（阅读/审批台/热点/创作）从 App Router 移植到 src/h5（vite）；client 半 slot 面板接 iframe | 手机和桌面全部现有功能可用，液态玻璃 v3 原样 |
| **K4 agent 化** | 指挥台会话 + 口播自检/漫剧循环跑在 DSH agent loop 上 | 自然语言驱动审批/创作全链路 |
| **K5 收尾** | Next.js 目录删除；docker-compose 改成 dsh + db + rsshub + osint | 服务器一键部署，Caddy 反代上线 |

## 3. 不变的红线

- canonical writes 只走 src/core 的事务函数，agent 和路由都不许绕过
- DSH 钉版本（0.1.3-alpha.1），升级是显式 PR + 契约冒烟
- 公开面只读；应用 API 全部过自有 session
- core 不 import 任何 dsh 包（这不是搞两套，是给 DSH 升级时留的保险丝）

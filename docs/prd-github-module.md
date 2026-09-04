# PRD: GitHub 模块 (FeedFuse)

> **版本**: v0.1 | **日期**: 2026-08-04 | **作者**: Product Manager
> **状态**: Draft

---

## 1. 项目信息

| 字段 | 值 |
|------|-----|
| 项目名 | `github-module` |
| 所属产品 | FeedFuse (v0.4.x+) |
| 技术栈 | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Radix UI + PostgreSQL |
| 原始需求 | 为 FeedFuse 新增 GitHub 内容源类型，让用户可以关注仓库/发布/动态，并融合 Goose AI Agent 的代码理解能力，将 GitHub 信息流纳入现有 RSS+AI 阅读工作台 |

## 2. 产品定义

### 2.1 Product Goals

1. **GitHub 作为一等内容源** — 用户能像订阅 RSS 一样订阅 GitHub 仓库（Release / Commit / Issue / PR），统一在 FeedFuse 三栏界面中消费
2. **AI 辅助理解代码变更** — 融合 Goose 的代码分析能力，对 Release Notes、Commit Diff、PR 变更提供 AI 摘要和解读，降低技术信息阅读门槛
3. **与现有架构无缝对齐** — 复用 FeedFuse 现有的 feed → article → AI pipeline 数据模型和 Worker 队列体系，最小化新增复杂度

### 2.2 User Stories

| # | 用户故事 | 优先级 |
|---|---------|--------|
| US-1 | 作为**开发者**，我想输入 GitHub 仓库 URL 或 owner/repo 名称来添加订阅，以便在 FeedFuse 中跟踪该仓库的 Release 和重要动态 | P0 |
| US-2 | 作为**技术管理者**，我想按仓库分组浏览 GitHub 内容条目（Release Notes、Commit 摘要），像阅读 RSS 文章一样阅读，保持统一的阅读体验 | P0 |
| US-3 | 作为**开发者**，我想对 Release Notes 和大 PR 获得 AI 生成的中文摘要，快速把握变更要点而不必逐行读 diff | P1 |
| US-4 | 作为**信息聚合用户**，我想在「发现」页看到推荐的优质 GitHub 仓库（按语言/领域分类），方便发现值得关注的源 | P1 |
| US-5 | 作为**高级用户**，我想配置每个仓库订阅的关注范围（只看 Release / 只看 Issue / 全部），避免信息过载 | P2 |

---

## 3. 技术规范

### 3.1 需求池 (Requirements Pool)

#### P0 — Must Have（MVP 核心闭环）

| ID | 需求 | 描述 | 验收标准 |
|----|------|------|----------|
| R01 | GitHub 仓库订阅 CRUD | 支持通过 owner/repo 添加 GitHub 仓库为订阅源；支持删除、暂停；支持设置刷新频率 | API: POST/GET/DELETE `/api/github/repos`；前端：设置页「GitHub 仓库」管理区 |
| R02 | Release 抓取与存储 | 定时轮询已订阅仓库的 GitHub Releases API，将每条 Release 存为 article-like 条目 | Worker job `github.fetch_releases`；数据写入 `github_articles` 表；含 tag_name, name, body, published_at, author |
| R03 | GitHub 内容融入三栏阅读器 | 左栏 Category 显示「GitHub」分组；中栏列表展示 Release 条目（标题+时间+仓库标签）；右栏渲染 Release Markdown 正文 | 复用现有 `(reader)` 布局；`github_articles` 通过 view 或 union 加入文章列表查询 |
| R04 | GitHub Token 认证配置 | 用户在设置页配置 GitHub Personal Access Token（用于提高 API 速率限制）；未配置时走匿名限速（60次/h） | 设置项存入 `user_settings.github_token`(加密)；API 调用携带 Authorization header |
| R05 | 刷新状态与错误处理 | 仓库级别的最后刷新时间、下次刷新时间、错误状态展示；API 限流时自动退避 | UI 展示状态 badge；Worker 实现指数退避 |

#### P1 — Should Have（增强体验）

| ID | 需求 | 描述 | 验收标准 |
|----|------|------|----------|
| R11 | Release AI 摘要 | 对 Release body 调用 OpenAI 接口生成中文摘要（复用现有 aiSummaryStreamWorker 模式） | 新增 `githubAiSummaryWorker`；摘要存入 `github_article_summaries` 表；右栏正文顶部展示摘要卡片 |
| R12 | 发现页 GitHub 推荐 Tab | 「发现」页新增「GitHub」Tab，展示热门/推荐仓库列表（可按语言筛选），支持一键订阅 | 前端 Tab 组件；后端缓存推荐列表（Trending API 或本地 curated） |
| R13 | 订阅范围配置 | 每个仓库可选择关注内容类型：Releases / Issues / PRs / Commits（多选） | `github_subscriptions` 表加 `content_types` JSONB 字段 |
| R14 | Issue & PR 条目抓取 | 扩展 Worker 支持 Issues 和 Pull Requests 抓取，存入 `github_articles`（type 区分） | Worker job `github.fetch_issues_prs`；article type enum: release, issue, pr, commit |

#### P2 — Nice to Have（远期）

| ID | 需求 | 描述 |
|----|------|------|
| R21 | Goose Agent 深度集成 | 对 PR Diff 调用 Goose MCP 接口做代码级 AI 分析（影响面评估、安全扫描建议） |
| R22 | 仓库 Star/Watch 通知 | Webhook 模式接收 GitHub 事件推送（替代纯轮询），实时性更高 |
| R23 | GitHub 组织/用户级订阅 | 订阅整个 org 或用户的全部仓库动态 |
| R24 | Release 附件下载 | 解析 Release assets，提供下载链接入口 |

### 3.2 模块划分

```
feedfuse/
├── src/
│   ├── app/(reader)/
│   │   └── github/                    [可选独立页面，初期融入三栏]
│   ├── app/api/github/
│   │   ├── repos/route.ts             # GET(列表) / POST(添加) / DELETE
│   │   ├── repos/[id]/route.ts        # PATCH(更新配置)
│   │   └── articles/route.ts          # GET(文章列表，供阅读器调用)
│   ├── server/domains/github/
│   │   ├── repositories/
│   │   │   ├── githubReposRepo.ts     # 仓库订阅 CRUD
│   │   │   └── githubArticlesRepo.ts  # GitHub 文章/条目 CRUD
│   │   ├── services/
│   │   │   └── githubFetchService.ts  # GitHub API 调用封装（token、限流、分页）
│   │   └── types.ts                   # GitHub 模块专用类型
│   ├── worker/
│   │   └── githubFetchWorker.ts       # PgBoss worker: releases/issues/prs 轮询
│   └── components/github/             [前端组件]
│       ├── GithubRepoCard.tsx         # 仓库卡片（发现页）
│       ├── GithubRepoForm.tsx         # 添加/编辑仓库表单
│       └── GithubArticleItem.tsx      # 阅读列表中的 GitHub 条目
└── migrations/
    └── xxx_add_github_tables.sql      # DDL
```

### 3.3 信息架构

```
FeedFuse 导航
├── 阅读（三栏）
│   ├── 分类列表（左）
│   │   ├── RSS 分类...
│   │   └── 📦 GitHub  ← 新增分组
│   │       ├── reactjs/react-release
│   │       ├── vercel/next.js
│   │       └── ...
│   ├── 文章列表（中）
│   │   ├── RSS 文章...
│   │   └── GitHub 条目（混合排序或分组显示）
│   │       ├── [Release] v19.0 - reactjs/react · 2h ago
│   │       ├── [PR] Fix hydration error - vercel/next.js · 5h ago
│   │       └── ...
│   └── 正文阅读（右）
│       ├── RSS 正文...
│       └── GitHub 正文
│           ├── [AI 摘要卡片]          ← R11
│           ├── Release 标题 + 元信息
│           └── Markdown Body 渲染
├── 发现
│   ├── Tabs: 全部 | 推荐 | 技术 | ... | GitHub  ← R12
│   └── GitHub 推荐仓库列表 + 一键订阅
└── 设置
    ├── 源管理
    │   ├── RSS 源
    │   └── GitHub 仓库               ← 新增 Tab/区块
    │       ├── 已订阅列表
    │       ├── ➕ 添加仓库
    │       └── GitHub Token 配置      ← R04
    └── AI 配置（复用现有）
```

### 3.4 UI/UX 设计方向

基于 `discover-page.png` 截图风格：

**设计原则**：
- **极简白底 + 充足留白** — 与现有发现页一致
- **蓝色主操作按钮** — "+" 订阅按钮沿用现有 `bg-blue-500` 圆角按钮风格
- **标签式分类** — 顶部 Tab 栏（全部/推荐/技术/GitHub...）复用现有模式
- **列表项结构** — 标题（粗体）+ 描述（灰色副文本）+ 标签（小圆角 badge）+ 操作按钮

**关键页面草图**：

| 页面 | 布局描述 |
|------|----------|
| 设置 > GitHub 管理 | 卡片式列表，每张卡显示：repo avatar + owner/repo + ⚙️ 配置 + 🗑️ 删除；顶部「➕ 添加仓库」按钮 + Token 配置入口 |
| 发现 > GitHub Tab | 同发现页现有布局：搜索框 → Tab 行 → 仓库列表（avatar + 名称 + 描述 + 语言标签 + stars 数 + ➕ 按钮） |
| 阅读器 > GitHub 条目 | 中栏条目前缀带类型 badge `[Release]` `[PR]` `[Issue]`（灰底小标签）；右栏正文顶部可选 AI 摘要卡片（淡蓝背景，与现有 AI digest 风格一致） |

**色彩与组件**：
- 类型 Badge: `bg-gray-100 text-gray-600` (Release) / `bg-green-50 text-green-700` (PR) / `bg-yellow-50 text-yellow-700` (Issue)
- AI 摘要卡片: `bg-blue-50 border-l-4 border-blue-400` （与现有 AI 解读区视觉语言一致）
- 复用 Radix UI: Dialog（添加仓库）、Select（内容类型选择）、Switch（启用/停用）

### 3.5 数据模型

```sql
-- 1. GitHub 仓库订阅（对应 feeds 表的角色）
CREATE TABLE github_subscriptions (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    owner           VARCHAR(100) NOT NULL,       -- 仓库所有者
    repo            VARCHAR(100) NOT NULL,       -- 仓库名称
    content_types   JSONB NOT NULL DEFAULT '["release"]', -- ["release","issue","pr","commit"]
    refresh_interval_minutes INTEGER NOT NULL DEFAULT 60,
    is_enabled      BOOLEAN NOT NULL DEFAULT true,
    last_fetched_at TIMESTAMPTZ,
    next_fetch_at   TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, owner, repo)
);

-- 2. GitHub 内容条目（对应 articles 表的角色）
CREATE TABLE github_articles (
    id              BIGSERIAL PRIMARY KEY,
    subscription_id INTEGER NOT NULL REFERENCES github_subscriptions(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    gh_type         VARCHAR(20) NOT NULL CHECK (gh_type IN ('release','issue','pr','commit')),
    gh_id           VARCHAR(50) NOT NULL,         -- GitHub 原始 ID（去重依据）
    title           TEXT NOT NULL,
    body            TEXT,                          -- Markdown 格式
    author          VARCHAR(200),
    url             VARCHAR(500) NOT NULL,         -- GitHub 原始链接
    tags            JSONB DEFAULT '[]',            -- ["v19.0", "bug-fix"]
    published_at    TIMESTAMPTZ,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_read         BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(subscription_id, gh_type, gh_id)
);

-- 3. GitHub AI 摘要（复用现有 AI pipeline 模式）
CREATE TABLE github_article_summaries (
    article_id      BIGINT PRIMARY KEY REFERENCES github_articles(id),
    summary_text    TEXT NOT NULL,
    model           VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX idx_github_articles_user_read ON github_articles(user_id, is_read);
CREATE INDEX idx_github_articles_sub_type ON github_articles(subscription_id, gh_type, published_at DESC);
CREATE INDEX idx_github_subs_user_enabled ON github_subscriptions(user_id, is_enabled);
```

**设计决策说明**：
- **不直接复用 `feeds`/`articles` 表** — GitHub 条目的字段语义差异较大（gh_type, gh_id, body 是 Markdown 而非 HTML），独立表更清晰；但通过 `user_id` 保持一致的权限隔离
- **`content_types` 用 JSONB** — 灵活且无需频繁 DDL 变更
- **`gh_id` 做 UNIQUE 去重** — 避免重复抓取同一条 Release/Issue

### 3.6 API 设计概要

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/github/repos` | 添加仓库订阅 `{ owner, repo, contentTypes? }` |
| GET | `/api/github/repos` | 列出当前用户的仓库订阅 |
| PATCH | `/api/github/repos/[id]` | 更新配置（contentTypes, isEnabled, interval） |
| DELETE | `/api/github/repos/[id]` | 删除订阅 |
| GET | `/api/github/articles` | 获取 GitHub 条目列表（支持 ?subscriptionId=, ?type=, ?unread= 分页） |
| PUT | `/api/github/articles/[id]/read` | 标记已读/未读 |
| POST | `/api/settings/github-token` | 存储加密 GitHub PAT |

---

## 4. 待确认问题 (Open Questions)

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| OQ-1 | MVP 是否仅覆盖 Release 类型？Issue/PR/Commit 放 P1？ | 决定 R02/R14 的拆分节奏 | 建议 MVP 只做 Release，验证价值后再扩展 |
| OQ-2 | GitHub 推荐数据来源：调用 GitHub Trending API vs 本地 curated 列表？ | 影响后端复杂度和依赖外部稳定性 | 建议 MVP 用本地 curated 列表（~50 个高质量仓库），后续接 Trending API |
| OQ-3 | AI 摘要用现有的 OpenAI key 还是单独配置？ | 影响用户体验和成本控制 | 建议 MVP 复用 user_settings.ai_api_key，后续可独立配置 |
| OQ-4 | Goose Agent 集成深度：MVP 是否需要？还是仅作为 P2 远期规划？ | 影响整体架构复杂度 | 建议 MVP 不集成 Goose，P2 再考虑 MCP 对接。MVP 的 AI 摘要用现有 OpenAI pipeline 即可 |
| OQ-5 | GitHub 条目是否与 RSS 文章混合在同一个列表中，还是分区展示？ | 影响前端阅读器改动范围 | 建议 MVP 在同一列表中混合展示，用类型 badge 区分；后续可加"仅 GitHub"过滤 |
| OQ-6 | 匿名 API 速率限制（60/h）是否够用？需不需要引导用户配 Token？ | 影响新手体验 | 建议：未配 Token 时提示"建议配置 Token 以提高频率限制"，但不阻塞使用 |

---

## 5. MVP 范围确认（建议）

**第一版（MVP）聚焦以下最小集合**：

- ✅ R01: 仓库订阅 CRUD
- ✅ R02: Release 抓取与存储（仅 Release 类型）
- ✅ R03: 融入三栏阅读器
- ✅ R04: Token 配置
- ✅ R05: 刷新状态与错误处理

**预估工作量**: 后端 ~3-4 天（DB + API + Worker + Service），前端 ~2-3 天（设置页 + 阅读器适配），联调测试 ~1-2 天

**排除项（明确不做）**:
- ❌ Issue/PR/Commit 抓取（R14 → P1）
- ❌ AI 摘要（R11 → P1）
- ❌ 发现页 GitHub Tab（R12 → P1）
- ❌ Goose Agent 集成（R21 → P2）
- ❌ Webhook 推送模式（R22 → P2）

---

*文档结束。下一步：交由架构师基于本 PRD 设计详细系统架构方案。*

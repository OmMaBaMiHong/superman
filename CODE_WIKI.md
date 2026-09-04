# FeedFuse Code Wiki

> 一个将 RSS 阅读、全文抓取和 AI 辅助理解放入同一工作台的信息阅读器。

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 整体架构](#2-整体架构)
- [3. 目录结构](#3-目录结构)
- [4. 前端模块](#4-前端模块)
  - [4.1 App Router 页面](#41-app-router-页面)
  - [4.2 状态管理 (Store)](#42-状态管理-store)
  - [4.3 组件体系 (Features)](#43-组件体系-features)
  - [4.4 Hooks](#44-hooks)
  - [4.5 公共库 (Lib)](#45-公共库-lib)
- [5. API 层](#5-api-层)
  - [5.1 API 路由表](#51-api-路由表)
  - [5.2 API Client](#52-api-client)
- [6. 服务端模块](#6-服务端模块)
  - [6.1 基础设施 (Infra)](#61-基础设施-infra)
  - [6.2 领域模块 (Domains)](#62-领域模块-domains)
  - [6.3 外部集成 (Integrations)](#63-外部集成-integrations)
- [7. 队列与 Worker 系统](#7-队列与-worker-系统)
  - [7.1 队列契约](#71-队列契约)
  - [7.2 Worker 入口](#72-worker-入口)
  - [7.3 定时任务调度](#73-定时任务调度)
- [8. 关键类与函数说明](#8-关键类与函数说明)
- [9. 依赖关系](#9-依赖关系)
- [10. 项目运行方式](#10-项目运行方式)
- [11. 配置说明](#11-配置说明)

---

## 1. 项目概览

| 属性 | 值 |
|------|-----|
| 名称 | FeedFuse |
| 版本 | 0.4.0 |
| 协议 | AGPL-3.0 |
| 运行时 | Node.js >= 20.19.0 |
| 包管理器 | pnpm@10 |
| 框架 | Next.js 16 + React 19 |
| 语言 | TypeScript 5.9 |
| 样式 | Tailwind CSS 4 |
| 数据库 | PostgreSQL 16 |
| 队列系统 | pg-boss |

### 核心能力

- **RSS 管理**：集中管理订阅源、分类组织、支持 OPML 导入/导出
- **阅读体验**：三栏界面（侧边栏 + 文章列表 + 正文阅读）
- **内容减噪**：关键词过滤、AI 过滤、重复/相似转载过滤
- **AI 辅助理解**：文章摘要、标题翻译、正文翻译、沉浸式双语阅读
- **AI解读**：多信息源汇总成重点归纳
- **多账号**：管理员创建用户、按用户隔离数据
- **Fever 兼容**：支持 Fever API 同步，可接入其他 RSS 阅读器
- **自托管**：Docker 一键部署

---

## 2. 整体架构

FeedFuse 采用 **Next.js App Router + 独立 Worker 进程** 的架构，分为 Web 服务进程和 Worker 后台进程两个独立运行单元。

```
┌─────────────────────────────────────────────────────┐
│                    Docker Compose                    │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │PostgreSQL│  │   Web    │  │     Worker       │  │
│  │    db    │  │ (Next.js)│  │  (tsx + pg-boss) │  │
│  │   :5432  │  │  :9559   │  │                  │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │             │                  │             │
│       └─────────────┴──────────────────┘             │
│                  PostgreSQL                          │
│          (数据存储 + 队列消息)                         │
└─────────────────────────────────────────────────────┘
```

### 架构分层

```
┌──────────────────────────────────────────┐
│           Frontend (React)               │
│  ┌────────────────────────────────────┐  │
│  │  Zustand Stores (状态管理)          │  │
│  │  ├── appStore      (阅读器核心)     │  │
│  │  ├── authStore     (用户认证)       │  │
│  │  └── settingsStore (用户设置)       │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  API Client (ky-based HTTP)        │  │
│  │  /src/lib/api/apiClient.ts         │  │
│  └────────────────────────────────────┘  │
├──────────────────────────────────────────┤
│      Next.js App Router (API Routes)     │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │ auth     │ │ feeds    │ │articles │  │
│  │ categories│ │ settings │ │users   │  │
│  │ ai-digests│ │ logs    │ │health   │  │
│  └──────────┘ └──────────┘ └─────────┘  │
├──────────────────────────────────────────┤
│         Server Domains (业务逻辑)         │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │ auth     │ │ feeds    │ │articles │  │
│  │ settings │ │ fever    │ │reader   │  │
│  │ ai-digests│ │ users   │ │         │  │
│  └──────────┘ └──────────┘ └─────────┘  │
├──────────────────────────────────────────┤
│         Integrations (外部集成)           │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌────────┐  │
│  │ RSS  │ │ AI   │ │Fever │ │Fulltext│  │
│  │RSSHub│ │OpenAI│ │Client│ │Mozilla │  │
│  │      │ │      │ │      │ │Readability│
│  └──────┘ └──────┘ └──────┘ └────────┘  │
├──────────────────────────────────────────┤
│       Infrastructure (基础设施)           │
│  ┌──────────┐ ┌──────────┐              │
│  │PostgreSQL│ │ pg-boss  │              │
│  │  (pg)    │ │ (队列)    │              │
│  └──────────┘ └──────────┘              │
└──────────────────────────────────────────┘
```

---

## 3. 目录结构

```
FeedFuse/
├── src/
│   ├── app/                      # Next.js App Router 页面与 API 路由
│   │   ├── (reader)/             # 主阅读器页面 (page.tsx + ReaderApp.tsx)
│   │   ├── login/                # 登录页面
│   │   ├── api/                  # REST API 路由
│   │   ├── globals.css           # 全局样式
│   │   └── layout.tsx            # 根布局
│   ├── components/ui/            # 通用 UI 组件 (shadcn/ui 风格)
│   ├── features/                 # 业务功能组件
│   │   ├── articles/             # 文章列表/详情/视频组件
│   │   ├── feeds/                # 订阅源管理对话框
│   │   ├── reader/               # 阅读器布局
│   │   ├── settings/             # 设置中心面板
│   │   ├── auth/                 # 登录组件
│   │   └── toast/                # 通知组件
│   ├── store/                    # Zustand 状态管理
│   │   ├── appStore.ts           # 阅读器核心状态
│   │   ├── authStore.ts          # 用户认证状态
│   │   └── settingsStore.ts      # 用户设置状态
│   ├── hooks/                    # 自定义 React Hooks
│   ├── lib/                      # 前端公共库
│   │   ├── api/                  # API 客户端 (apiClient.ts, polling.ts)
│   │   ├── feeds/               # 订阅源图标
│   │   ├── rsshub/               # RSSHub URL 工具
│   │   ├── reader/               # 阅读器视图工具
│   │   └── ui/                   # 设计系统
│   ├── mock/                     # Mock 数据
│   ├── server/                   # 服务端代码
│   │   ├── infra/                # 基础设施
│   │   │   ├── db/               # 数据库连接池 (pool.ts)
│   │   │   ├── http/             # HTTP 错误/响应工具
│   │   │   ├── queue/            # pg-boss 队列封装
│   │   │   └── env.ts            # 环境变量解析
│   │   ├── domains/              # 领域逻辑
│   │   │   ├── auth/             # 认证领域
│   │   │   ├── feeds/            # 订阅源领域
│   │   │   ├── articles/         # 文章领域
│   │   │   ├── settings/         # 设置领域
│   │   │   ├── fever/            # Fever 同步领域
│   │   │   ├── reader/           # 阅读器快照领域
│   │   │   ├── ai-digests/       # AI解读领域
│   │   │   └── users/            # 用户领域
│   │   └── integrations/         # 外部集成
│   │       ├── ai/               # OpenAI 集成
│   │       ├── rss/              # RSS 抓取/解析
│   │       ├── rsshub/           # 内嵌 RSSHub
│   │       ├── fever/            # Fever API 客户端
│   │       ├── fulltext/         # 全文抓取
│   │       ├── media/            # 媒体代理
│   │       └── opml/            # OPML 文档
│   ├── types/                    # 类型定义
│   │   └── index.ts              # 核心类型 (Feed, Article, Category...)
│   ├── utils/                    # 工具函数
│   └── worker/                   # Worker 进程
│       ├── index.ts              # Worker 主入口
│       ├── workerRegistry.ts     # Worker 注册
│       ├── refreshAll.ts         # 全量刷新
│       ├── rssScheduler.ts       # RSS 调度
│       ├── articleTaskStatus.ts  # 文章任务状态
│       ├── aiDigestTick.ts       # AI解读定时检查
│       ├── aiDigestGenerate.ts   # AI解读生成
│       ├── feverAutoSync.ts      # Fever 自动同步
│       ├── feverSync.ts          # Fever 同步
│       ├── feverRefreshAll.ts    # Fever 全量刷新
│       └── systemLogCleanup.ts   # 日志清理
├── config/                       # 构建配置
│   ├── eslint/                   # ESLint 配置
│   ├── typescript/               # TypeScript 配置
│   └── vitest/                   # Vitest 测试配置
├── deploy/                       # 部署文件
│   ├── compose.yaml              # 生产部署 compose
│   └── .env.example              # 部署环境变量模板
├── docs/                         # 文档
│   ├── deploy.md                 # 部署指南
│   ├── development.md            # 开发指南
│   └── user-guide.md             # 使用指南
├── public/                       # 静态资源
├── scripts/                      # 脚本
│   └── db/migrate.mjs            # 数据库迁移
├── vendor/                       # 第三方依赖
│   └── rsshub/                   # 内嵌 RSSHub (pnpm workspace)
├── docker-compose.yml            # 开发用 compose
├── Dockerfile                    # 多阶段构建 (web + worker)
├── package.json                  # 项目配置
├── pnpm-workspace.yaml           # pnpm workspace 配置
└── next.config.mjs               # Next.js 配置
```

---

## 4. 前端模块

### 4.1 App Router 页面

| 路由 | 文件 | 说明 |
|------|------|------|
| `/` | `src/app/(reader)/page.tsx` | 主阅读器页面，需认证 |
| `/login` | `src/app/login/page.tsx` | 登录页面 |

**主页面流程** ([page.tsx](file:///Users/wade/work-space/FeedFuse/src/app/(reader)/page.tsx))：
1. 检查用户认证状态，未登录则重定向到 `/login`
2. 渲染 `ReaderApp` 客户端组件

**ReaderApp** ([ReaderApp.tsx](file:///Users/wade/work-space/FeedFuse/src/app/(reader)/ReaderApp.tsx))：
- 初始化用户体验：主题设置、远端设置同步、用户状态获取
- 管理 URL 参数与阅读器状态的同步（view 和 article 参数）
- 自动快照刷新：页面可见性变化时，5 分钟间隔自动刷新
- 渲染 `ReaderLayout`（三栏布局）和 `ToastHost`（通知）

### 4.2 状态管理 (Store)

使用 Zustand 进行状态管理，三个核心 Store：

#### appStore ([appStore.ts](file:///Users/wade/work-space/FeedFuse/src/store/appStore.ts))

阅读器核心状态，管理：

| 状态字段 | 类型 | 说明 |
|---------|------|------|
| `feeds` | `Feed[]` | 订阅源列表 |
| `categories` | `Category[]` | 分类列表 |
| `articles` | `Article[]` | 当前视图文章列表 |
| `selectedView` | `ViewType` | 当前选中视图 |
| `selectedArticleId` | `string \| null` | 当前选中文章 |
| `sidebarCollapsed` | `boolean` | 侧边栏折叠状态 |
| `showUnreadOnly` | `boolean` | 仅显示未读 |
| `snapshotLoading` | `boolean` | 快照加载状态 |
| `articleListNextCursor` | `string \| null` | 分页游标 |
| `articleListHasMore` | `boolean` | 是否有更多文章 |

关键方法：
- `loadSnapshot({ view })` — 加载指定视图的文章快照，支持分页
- `loadMoreSnapshot()` — 加载更多文章（分页追加）
- `addFeed(payload)` / `removeFeed(feedId)` — 添加/删除订阅源
- `addAiDigest(payload)` / `updateAiDigest(feedId, payload)` — 创建/更新 AI解读
- `markAsRead(articleId)` / `markAllAsRead(feedId?)` — 标记已读
- `toggleStar(articleId)` — 切换收藏
- `refreshArticle(articleId)` — 刷新文章详情（全文/AI摘要/翻译）

#### authStore ([authStore.ts](file:///Users/wade/work-space/FeedFuse/src/store/authStore.ts))

管理当前用户认证状态，提供 `getCurrentStorageUserId()` 用于多用户 localStorage 命名空间隔离。

#### settingsStore ([settingsStore.ts](file:///Users/wade/work-space/FeedFuse/src/store/settingsStore.ts))

管理用户设置，使用 Zustand persist 中间件持久化到 localStorage：
- 外观设置（主题、字体、行高）
- AI 设置（模型、API Key、翻译配置）
- RSS 设置（抓取间隔、文章保留数、过滤规则）
- 分类设置
- 日志设置

### 4.3 组件体系 (Features)

```
features/
├── articles/           # 文章相关组件
│   ├── ArticleList.tsx          # 文章列表（支持卡片/列表两种模式）
│   ├── ArticleView.tsx          # 文章正文阅读视图
│   ├── ArticleTimelineNav.tsx   # 文章时间线导航
│   ├── ArticleScrollAssist.tsx  # 滚动辅助
│   ├── VideoArticleCard.tsx     # 视频文章卡片
│   ├── VideoArticleGrid.tsx     # 视频文章网格
│   ├── ArticleVideoHero.tsx     # 视频头图
│   └── ArticleImagePreview.tsx  # 图片预览
├── feeds/              # 订阅源管理组件
│   ├── FeedList.tsx             # 侧边栏订阅源列表
│   ├── AddFeedDialog.tsx        # 添加订阅源对话框
│   ├── EditFeedDialog.tsx       # 编辑订阅源对话框
│   ├── FeedDialog.tsx           # 订阅源对话框基类
│   ├── AddAiDigestDialog.tsx    # 添加 AI解读 对话框
│   ├── EditAiDigestDialog.tsx   # 编辑 AI解读 对话框
│   ├── FeedViewSelector.tsx     # 视图选择器
│   └── FeedViewTabs.tsx         # 视图标签页
├── reader/             # 阅读器布局
│   ├── ReaderLayout.tsx         # 三栏布局主组件
│   ├── ResizeHandle.tsx         # 面板拖拽调整大小
│   ├── ReaderToolbarIconButton.tsx # 工具栏按钮
│   └── GlobalSearchDialog.tsx   # 全局搜索
├── settings/           # 设置中心
│   ├── SettingsCenterModal.tsx  # 设置中心弹窗
│   ├── SettingsCenterDrawer.tsx # 设置中心抽屉
│   └── panels/                  # 各设置面板
│       ├── GeneralSettingsPanel.tsx    # 通用设置
│       ├── AISettingsPanel.tsx         # AI 设置
│       ├── RssSettingsPanel.tsx        # RSS 设置
│       ├── SecuritySettingsPanel.tsx   # 账号安全
│       ├── FeverAccountSettingsPanel.tsx # Fever 账户
│       ├── OpmlTransferSection.tsx     # OPML 导入导出
│       ├── LogsSettingsPanel.tsx       # 日志设置
│       └── logs/                       # 日志查看组件
├── auth/               # 认证
│   └── LoginPage.tsx           # 登录页面
└── toast/              # 通知
    └── ToastHost.tsx           # 全局 Toast 容器
```

### 4.4 Hooks

| Hook | 文件 | 说明 |
|------|------|------|
| `useTheme` | [useTheme.ts](file:///Users/wade/work-space/FeedFuse/src/hooks/useTheme.ts) | 响应设置中的主题切换，应用到 `<html>` |
| `useHydratedSelectedView` | useHydratedSelectedView.ts | 确保视图参数在客户端水合后可用 |
| `useRenderTimeSnapshot` | useRenderTimeSnapshot.ts | 渲染时间快照 |

### 4.5 公共库 (Lib)

| 模块 | 文件 | 说明 |
|------|------|------|
| API Client | [apiClient.ts](file:///Users/wade/work-space/FeedFuse/src/lib/api/apiClient.ts) | 基于 ky 的 HTTP 客户端，封装所有 API 调用 |
| API Error Notifier | [apiErrorNotifier.ts](file:///Users/wade/work-space/FeedFuse/src/lib/api/apiErrorNotifier.ts) | API 错误通知 |
| Polling | [polling.ts](file:///Users/wade/work-space/FeedFuse/src/lib/api/polling.ts) | 指数退避轮询工具 |
| Feed Icons | [feedIcons.ts](file:///Users/wade/work-space/FeedFuse/src/lib/feeds/feedIcons.ts) | 订阅源图标管理 |
| RSSHub URL | [url.ts](file:///Users/wade/work-space/FeedFuse/src/lib/rsshub/url.ts) | RSSHub URL 解析工具 |
| Reader View | [view.ts](file:///Users/wade/work-space/FeedFuse/src/lib/reader/view.ts) | 阅读器视图工具 |
| Design System | [designSystem.ts](file:///Users/wade/work-space/FeedFuse/src/lib/ui/designSystem.ts) | 设计系统常量 |

---

## 5. API 层

### 5.1 API 路由表

所有 API 路由位于 `src/app/api/`，基于 Next.js Route Handlers：

| 方法 | 路由 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | 用户登录 |
| `GET` | `/api/auth/me` | 获取当前用户信息 |
| `POST` | `/api/auth/logout` | 用户登出 |
| `GET` | `/api/feeds` | 获取订阅源列表 |
| `POST` | `/api/feeds` | 创建订阅源 |
| `PATCH` | `/api/feeds/[id]` | 更新订阅源 |
| `DELETE` | `/api/feeds/[id]` | 删除订阅源 |
| `POST` | `/api/feeds/[id]/refresh` | 刷新单个订阅源 |
| `POST` | `/api/feeds/refresh` | 全量刷新 |
| `GET` | `/api/articles/[id]` | 获取文章详情 |
| `PATCH` | `/api/articles/[id]` | 更新文章状态（已读/收藏） |
| `POST` | `/api/articles/[id]/fulltext` | 触发全文抓取 |
| `POST` | `/api/articles/[id]/ai-summary` | 触发 AI 摘要 |
| `GET` | `/api/articles/[id]/ai-summary/stream` | AI 摘要 SSE 流 |
| `POST` | `/api/articles/[id]/ai-translate` | 触发 AI 翻译 |
| `GET` | `/api/articles/[id]/ai-translate/stream` | AI 翻译 SSE 流 |
| `POST` | `/api/articles/mark-all-read` | 全部标为已读 |
| `GET` | `/api/articles/search` | 搜索文章 |
| `GET` | `/api/categories` | 获取分类列表 |
| `POST` | `/api/categories` | 创建分类 |
| `PATCH` | `/api/categories/[id]` | 更新分类 |
| `DELETE` | `/api/categories/[id]` | 删除分类 |
| `PATCH` | `/api/categories/reorder` | 重排分类 |
| `GET` | `/api/settings` | 获取用户设置 |
| `PUT` | `/api/settings` | 更新用户设置 |
| `GET/PUT/DELETE` | `/api/settings/ai/api-key` | AI API Key 管理 |
| `GET/PUT/DELETE` | `/api/settings/translation/api-key` | 翻译 API Key 管理 |
| `GET` | `/api/users` | 用户列表（管理员） |
| `POST` | `/api/users` | 创建用户 |
| `PATCH` | `/api/users/[id]` | 更新用户 |
| `DELETE` | `/api/users/[id]` | 删除用户 |
| `POST` | `/api/ai-digests` | 创建 AI解读 |
| `PATCH` | `/api/ai-digests/[id]` | 更新 AI解读 |
| `POST` | `/api/ai-digests/[id]/generate` | 手动生成 AI解读 |
| `GET` | `/api/ai-digests/runs/[runId]` | 查询 AI解读 运行状态 |
| `GET` | `/api/logs` | 查询系统日志 |
| `DELETE` | `/api/logs` | 清除系统日志 |
| `GET` | `/api/health` | 健康检查 |

### 5.2 API Client

[apiClient.ts](file:///Users/wade/work-space/FeedFuse/src/lib/api/apiClient.ts) 是前端 API 调用的统一入口，基于 `ky` 封装：

- **统一错误处理**：`ApiError` 类携带 `code`、`message`、`fields` 和 HTTP 状态码
- **自动通知**：默认通过 `notifyApiError` 显示错误 Toast
- **401 自动跳转**：未认证时自动重定向到 `/login`
- **超时处理**：默认 15 秒超时，区分网络错误和超时错误
- **DTO 映射**：`mapFeedDto`、`mapArticleDto`、`mapSnapshotArticleItem` 将服务端 DTO 转换为前端模型

---

## 6. 服务端模块

### 6.1 基础设施 (Infra)

#### 数据库连接池 ([pool.ts](file:///Users/wade/work-space/FeedFuse/src/server/infra/db/pool.ts))

```typescript
function getPool(): Pool
```

使用 `pg.Pool` 单例模式管理 PostgreSQL 连接，通过 `DATABASE_URL` 环境变量配置。

#### 环境变量 ([env.ts](file:///Users/wade/work-space/FeedFuse/src/server/infra/env.ts))

使用 Zod 进行环境变量校验和解析：

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `AUTH_INITIAL_PASSWORD` | 否 | 初始管理员密码 |
| `IMAGE_PROXY_SECRET` | 否 | 图片代理签名密钥 |
| `AUTH_COOKIE_SECURE` | 否 | Cookie Secure 标志 |
| `RSS_NETWORK_MODE` | 否 | RSS 网络访问模式（public/fake-ip/lan/custom） |
| `RSS_ALLOWED_CIDRS` | 否 | 自定义 CIDR 白名单 |

#### HTTP 错误 ([errors.ts](file:///Users/wade/work-space/FeedFuse/src/server/infra/http/errors.ts))

| 类 | 状态码 | 说明 |
|----|--------|------|
| `AppError` | 自定义 | 基础错误类 |
| `ValidationError` | 400 | 请求参数校验失败 |
| `NotFoundError` | 404 | 资源不存在 |
| `ConflictError` | 409 | 资源冲突 |
| `UnauthorizedError` | 401 | 未认证 |
| `ForbiddenError` | 403 | 无权限 |
| `ServiceUnavailableError` | 503 | 服务不可用 |

#### 队列系统 ([queue/](file:///Users/wade/work-space/FeedFuse/src/server/infra/queue/))

详见 [第 7 节](#7-队列与-worker-系统)。

### 6.2 领域模块 (Domains)

每个领域采用 **Repository + Service** 模式：

#### auth — 认证领域

| 文件 | 说明 |
|------|------|
| [services/session.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/auth/services/session.ts) | 会话管理：`requireApiSession()` 验证 API 会话 |
| [services/password.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/auth/services/password.ts) | 密码哈希与验证（bcrypt） |
| [services/userLifecycleService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/auth/services/userLifecycleService.ts) | 用户生命周期管理 |
| [repositories/usersRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/auth/repositories/usersRepo.ts) | 用户数据访问 |
| [userType.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/auth/userType.ts) | 用户类型定义（initial_admin/admin/member） |

#### feeds — 订阅源领域

| 文件 | 说明 |
|------|------|
| [repositories/feedsRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/feeds/repositories/feedsRepo.ts) | 订阅源 CRUD、抓取状态记录 |
| [repositories/categoriesRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/feeds/repositories/categoriesRepo.ts) | 分类 CRUD |
| [services/feedCategoryLifecycleService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/feeds/services/feedCategoryLifecycleService.ts) | 订阅源创建时分类解析 |
| [services/feedRefreshRunService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/feeds/services/feedRefreshRunService.ts) | 刷新运行追踪 |
| [services/feedFaviconService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/feeds/services/feedFaviconService.ts) | 订阅源图标服务 |

#### articles — 文章领域

| 文件 | 说明 |
|------|------|
| [repositories/articlesRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/articles/repositories/articlesRepo.ts) | 文章 CRUD、去重插入、全文/摘要/翻译存储 |
| [repositories/articleTasksRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/articles/repositories/articleTasksRepo.ts) | 文章任务状态管理（全文/摘要/翻译） |
| [repositories/articleAiSummaryRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/articles/repositories/articleAiSummaryRepo.ts) | AI 摘要会话管理 |
| [repositories/articleTranslationRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/articles/repositories/articleTranslationRepo.ts) | 翻译会话/分段管理 |
| [services/articleFilterService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/articles/services/articleFilterService.ts) | 文章过滤编排（关键词+AI） |
| [services/articleKeywordFilter.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/articles/services/articleKeywordFilter.ts) | 关键词过滤 |
| [services/articleDuplicateService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/articles/services/articleDuplicateService.ts) | 文章去重 |

#### settings — 设置领域

| 文件 | 说明 |
|------|------|
| [repositories/settingsRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/settings/repositories/settingsRepo.ts) | 用户设置读写、AI API Key 管理 |
| [repositories/systemLogsRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/settings/repositories/systemLogsRepo.ts) | 系统日志读写 |
| [services/opmlService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/settings/services/opmlService.ts) | OPML 导入导出 |
| [services/systemLogsService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/settings/services/systemLogsService.ts) | 系统日志服务 |

#### fever — Fever 同步领域

| 文件 | 说明 |
|------|------|
| [repositories/feverAccountsRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/fever/repositories/feverAccountsRepo.ts) | Fever 账户 CRUD |
| [repositories/feverMappingsRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/fever/repositories/feverMappingsRepo.ts) | Fever 源与本地源映射 |
| [repositories/feverSyncStatesRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/fever/repositories/feverSyncStatesRepo.ts) | 同步状态管理 |
| [services/feverSyncService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/fever/services/feverSyncService.ts) | Fever 同步逻辑 |
| [services/feverAccountLifecycleService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/fever/services/feverAccountLifecycleService.ts) | Fever 账户生命周期 |

#### reader — 阅读器领域

| 文件 | 说明 |
|------|------|
| [services/readerSnapshotService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/reader/services/readerSnapshotService.ts) | 阅读器快照：聚合分类/订阅源/文章数据 |

#### ai-digests — AI解读领域

| 文件 | 说明 |
|------|------|
| [repositories/aiDigestRepo.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/ai-digests/repositories/aiDigestRepo.ts) | AI解读 数据访问 |
| [services/aiDigestLifecycleService.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/ai-digests/services/aiDigestLifecycleService.ts) | AI解读 生命周期管理 |

#### users — 用户领域

| 文件 | 说明 |
|------|------|
| [userScope.ts](file:///Users/wade/work-space/FeedFuse/src/server/domains/users/userScope.ts) | 用户作用域工具函数 |

### 6.3 外部集成 (Integrations)

#### AI 集成 ([integrations/ai/](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/))

| 文件 | 说明 |
|------|------|
| [openaiClient.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/openaiClient.ts) | OpenAI 兼容客户端封装 |
| [summarizeText.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/summarizeText.ts) | 文本摘要 |
| [streamSummarizeText.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/streamSummarizeText.ts) | 流式文本摘要（SSE） |
| [translateHtml.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/translateHtml.ts) | HTML 翻译 |
| [translateTitle.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/translateTitle.ts) | 标题翻译 |
| [bilingualHtmlTranslator.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/bilingualHtmlTranslator.ts) | 双语 HTML 翻译（分段批量） |
| [immersiveTranslationSession.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/immersiveTranslationSession.ts) | 沉浸式翻译会话 |
| [articleFilterJudge.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/articleFilterJudge.ts) | AI 文章过滤判定 |
| [aiDigestCompose.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/aiDigestCompose.ts) | AI解读 内容合成 |
| [aiDigestRerank.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/aiDigestRerank.ts) | AI解读 重排序 |
| [configFingerprints.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/configFingerprints.ts) | 配置指纹（检测配置变更） |
| [translationConfig.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/translationConfig.ts) | 翻译配置解析 |
| [providerCompatibility.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/providerCompatibility.ts) | 兼容不同 AI 提供商 |
| [deepThinking.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/deepThinking.ts) | 深度思考模式 |
| [promptTemplates.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/promptTemplates.ts) | Prompt 模板 |
| [cleanupAiRuntimeState.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/ai/cleanupAiRuntimeState.ts) | AI 运行时状态清理 |

#### RSS 集成 ([integrations/rss/](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/))

| 文件 | 说明 |
|------|------|
| [fetchFeedXml.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/fetchFeedXml.ts) | 抓取 RSS/Atom XML |
| [parseFeed.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/parseFeed.ts) | 解析 RSS/Atom 为统一格式 |
| [sanitizeContent.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/sanitizeContent.ts) | HTML 内容清洗 |
| [ssrfGuard.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/ssrfGuard.ts) | SSRF 防护（URL 安全检查） |
| [feedFaviconUrl.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/feedFaviconUrl.ts) | 订阅源图标 URL 提取 |
| [discoverFeedFavicon.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/discoverFeedFavicon.ts) | 自动发现订阅源图标 |
| [fetchUrlCandidates.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rss/fetchUrlCandidates.ts) | URL 候选发现 |

#### 内嵌 RSSHub ([integrations/rsshub/](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rsshub/))

| 文件 | 说明 |
|------|------|
| [embeddedRssHubApp.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rsshub/embeddedRssHubApp.ts) | 内嵌 RSSHub 应用实例 |
| [internalRssHubService.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rsshub/internalRssHubService.ts) | 内部 RSSHub 服务 |
| [sourceResolver.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/rsshub/sourceResolver.ts) | RSSHub 源 URL 解析 |

#### Fulltext 集成 ([integrations/fulltext/](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fulltext/))

| 文件 | 说明 |
|------|------|
| [extractFulltext.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fulltext/extractFulltext.ts) | 基于 Mozilla Readability 提取全文 |
| [fetchFulltextAndStore.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fulltext/fetchFulltextAndStore.ts) | 抓取全文并存储 |
| [fulltextVerification.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fulltext/fulltextVerification.ts) | 全文质量验证 |

#### Fever 集成 ([integrations/fever/](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fever/))

| 文件 | 说明 |
|------|------|
| [feverClient.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fever/feverClient.ts) | Fever API 客户端 |
| [feverSchemas.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fever/feverSchemas.ts) | Fever API 数据校验 |
| [feverErrors.ts](file:///Users/wade/work-space/FeedFuse/src/server/integrations/fever/feverErrors.ts) | Fever 错误处理 |

---

## 7. 队列与 Worker 系统

FeedFuse 使用 **pg-boss** 作为任务队列，基于 PostgreSQL 实现，无需额外中间件。

### 7.1 队列契约

[contracts.ts](file:///Users/wade/work-space/FeedFuse/src/server/infra/queue/contracts.ts) 定义了所有队列的配置：

| 队列名称 | Worker 并发 | 重试次数 | 说明 |
|---------|------------|---------|------|
| `feed.fetch` | 3 | 4 | 单个订阅源抓取 |
| `feed.refresh_all` | 1 | - | 全量刷新调度 |
| `article.fetch_fulltext` | 4 | 3 | 文章全文抓取 |
| `article.filter` | 3 | 3 | 文章过滤判定 |
| `ai.summarize_article` | 2 | 0 | AI 摘要生成 |
| `ai.translate_article_zh` | 2 | 0 | AI 翻译 |
| `ai.translate_title_zh` | 2 | 0 | 标题翻译 |
| `ai.digest_tick` | 1 | - | AI解读 定时检查 |
| `ai.digest_generate` | 1 | 3 | AI解读 生成 |
| `fever.sync` | 1 | 3 | Fever 同步 |
| `fever.sync_due` | 1 | - | Fever 定时同步检查 |
| `system_logs.cleanup` | 1 | - | 系统日志清理 |

### 7.2 Worker 入口

[worker/index.ts](file:///Users/wade/work-space/FeedFuse/src/worker/index.ts) 是 Worker 进程的入口，通过 `tsx` 直接运行。

**Worker 主流程**：
1. 初始化数据库连接池和 pg-boss 实例
2. 启动所有队列（bootstrapQueues）
3. 注册所有 Worker 处理器（registerWorkers）
4. 启动定时任务调度

**Worker 处理器注册** ([workerRegistry.ts](file:///Users/wade/work-space/FeedFuse/src/worker/workerRegistry.ts))：

```typescript
registerWorkers(boss, {
  [JOB_REFRESH_ALL]: refreshAllHandler,
  [JOB_FEED_FETCH]: feedFetchHandler,
  [JOB_ARTICLE_FILTER]: articleFilterHandler,
  [JOB_ARTICLE_FULLTEXT_FETCH]: fulltextHandler,
  [JOB_AI_SUMMARIZE]: aiSummaryHandler,
  [JOB_AI_TRANSLATE]: aiTranslateHandler,
  [JOB_AI_TRANSLATE_TITLE]: aiTitleTranslateHandler,
  [JOB_AI_DIGEST_TICK]: aiDigestTickHandler,
  [JOB_AI_DIGEST_GENERATE]: aiDigestGenerateHandler,
  [JOB_FEVER_SYNC]: feverSyncHandler,
  [JOB_FEVER_SYNC_DUE]: feverAutoSyncHandler,
  [JOB_SYSTEM_LOG_CLEANUP]: systemLogCleanupHandler,
})
```

### 7.3 定时任务调度

Worker 启动后立即注册定时任务：

| 任务 | Cron 表达式 | 说明 |
|------|-----------|------|
| `JOB_REFRESH_ALL` | `* * * * *` | 每分钟检查并执行到期订阅源的全量刷新 |
| `JOB_AI_DIGEST_TICK` | `* * * * *` | 每分钟检查到期的 AI解读 任务 |
| `JOB_FEVER_SYNC_DUE` | `* * * * *` | 每分钟检查到期的 Fever 同步 |
| `JOB_SYSTEM_LOG_CLEANUP` | `0 * * * *` | 每小时清理过期日志 |

---

## 8. 关键类与函数说明

### 核心类型

[types/index.ts](file:///Users/wade/work-space/FeedFuse/src/types/index.ts) 定义了所有核心类型：

```typescript
// 订阅源类型
interface Feed {
  id: string;                    // 唯一标识
  kind: FeedKind;                // 'rss' | 'ai_digest'
  provider: FeedProvider;        // 'local_rss' | 'fever'
  title: string;                 // 标题
  url: string;                   // RSS URL
  unreadCount: number;           // 未读数量
  enabled: boolean;              // 是否启用
  fullTextOnOpenEnabled: boolean;     // 打开时抓取全文
  fullTextOnFetchEnabled: boolean;    // 抓取时抓取全文
  aiSummaryOnOpenEnabled: boolean;    // 打开时 AI 摘要
  aiSummaryOnFetchEnabled: boolean;   // 抓取时 AI 摘要
  bodyTranslateOnFetchEnabled: boolean; // 抓取时翻译正文
  bodyTranslateOnOpenEnabled: boolean;  // 打开时翻译正文
  titleTranslateEnabled: boolean;     // 标题翻译
  bodyTranslateEnabled: boolean;      // 正文翻译
  // ... 更多字段
}

// 文章类型
interface Article {
  id: string;
  feedId: string;
  title: string;
  content: string;               // 正文 HTML
  aiSummary?: string;            // AI 摘要
  aiTranslationZhHtml?: string;  // 中文翻译
  aiTranslationBilingualHtml?: string; // 双语对照
  isRead: boolean;
  isStarred: boolean;
  // ... 更多字段
}

// 视图类型
type ViewType = 'all' | 'unread' | 'starred' | string;
```

### 关键函数

#### API Client

| 函数 | 说明 |
|------|------|
| `requestApi<T>(path, init, options)` | 通用 API 请求，统一错误处理 |
| `getReaderSnapshot(input)` | 获取阅读器快照（分类/订阅源/文章） |
| `createFeed(input)` | 创建订阅源 |
| `patchFeed(feedId, input)` | 更新订阅源 |
| `deleteFeed(feedId)` | 删除订阅源 |
| `getArticle(articleId)` | 获取文章详情 |
| `patchArticle(articleId, input)` | 更新文章状态 |
| `getSettings()` / `putSettings(input)` | 读写设置 |
| `login(input)` / `logout()` | 认证操作 |
| `mapFeedDto(dto, categories)` | DTO → Feed 模型映射 |
| `mapArticleDto(dto)` | DTO → Article 模型映射 |
| `mapSnapshotArticleItem(dto)` | 快照项 → Article 模型映射 |

#### Worker 核心函数

| 函数 | 说明 |
|------|------|
| `fetchAndIngestFeed(boss, feedId, input)` | 抓取单个订阅源并入库 |
| `enqueueRefreshAll(boss, input)` | 全量刷新入队 |
| `runArticleTaskWithStatus({ pool, userId, articleId, type, fn })` | 带状态追踪的文章任务执行 |
| `runAiSummaryStreamWorker(...)` | AI 摘要流式 Worker |
| `runImmersiveTranslateSession(...)` | 沉浸式翻译会话 |
| `runAiDigestTick(...)` | AI解读 定时检查 |
| `runAiDigestGenerate(...)` | AI解读 生成 |
| `runFeverSyncWorker(...)` | Fever 同步 |
| `runFeverAutoSyncWorker(...)` | Fever 自动同步 |
| `runSystemLogCleanup(...)` | 系统日志清理 |

#### 队列系统

| 函数 | 说明 |
|------|------|
| `getPool()` | 获取数据库连接池单例 |
| `startBoss()` / `getBoss()` | 启动/获取 pg-boss 实例 |
| `bootstrapQueues(boss)` | 创建所有队列 |
| `enqueue(name, data, options)` | 入队任务 |
| `enqueueWithResult(name, data, options)` | 入队并返回结果（含限流检测） |
| `registerWorkers(boss, handlers)` | 注册 Worker 处理器 |
| `getQueueSendOptions(name, ctx)` | 获取队列发送选项（singleton key 等） |
| `getWorkerOptions(name)` | 获取 Worker 选项（并发数等） |

#### 认证与授权

| 函数 | 说明 |
|------|------|
| `requireApiSession()` | 验证 API 请求会话，返回用户信息 |
| `isAuthenticated()` | 检查当前请求是否已认证 |
| `hashPassword(password)` | 密码哈希 |
| `verifyPassword(password, hash)` | 密码验证 |

---

## 9. 依赖关系

### 核心依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `next` | 16.1.6 | Web 框架 |
| `react` / `react-dom` | ^19.2.0 | UI 框架 |
| `zustand` | ^5.0.11 | 状态管理 |
| `pg` | ^8.18.0 | PostgreSQL 客户端 |
| `pg-boss` | ^12.13.0 | 任务队列 |
| `@mozilla/readability` | ^0.6.0 | 全文提取 |
| `openai` | ^6.25.0 | OpenAI API 客户端 |
| `rss-parser` | ^3.13.0 | RSS 解析 |
| `rsshub` | workspace:* | 内嵌 RSSHub |
| `ky` | ^1.14.3 | HTTP 客户端 |
| `zod` | ^4.3.6 | 数据校验 |
| `sanitize-html` | ^2.17.1 | HTML 清洗 |
| `sharp` | ^0.34.5 | 图片处理 |
| `jsdom` | ^28.1.0 | DOM 模拟 |
| `@radix-ui/*` | 多个 | 无障碍 UI 组件 |
| `lucide-react` | ^0.575.0 | 图标库 |
| `tailwindcss` | ^4.2.0 | CSS 框架 |
| `class-variance-authority` | ^0.7.1 | 组件样式变体 |
| `clsx` | ^2.1.1 | 类名合并 |
| `tailwind-merge` | ^3.5.0 | Tailwind 类名合并 |
| `got` | ^14.6.6 | HTTP 请求库（服务端） |
| `ipaddr.js` | ^2.3.0 | IP 地址解析（SSRF 防护） |

### 开发依赖

| 包名 | 用途 |
|------|------|
| `typescript` ~5.9.3 | 类型检查 |
| `eslint` ^9.39.1 | 代码检查 |
| `vitest` ^4.0.18 | 单元测试 |
| `@testing-library/react` | React 组件测试 |
| `@tailwindcss/postcss` | Tailwind PostCSS 插件 |
| `@tailwindcss/typography` | 排版插件 |

### Workspace 结构

```
pnpm-workspace.yaml:
  packages:
    - 'vendor/rsshub'
```

RSSHub 作为 pnpm workspace 包引入，编译后作为 `rsshub` 依赖使用。

---

## 10. 项目运行方式

### 开发环境

**环境要求**：Node >= 20.19.0, pnpm@10, PostgreSQL 16

```bash
# 1. 准备环境变量
cp .env.example .env

# 2. 启动 PostgreSQL（使用 Docker）
docker compose up -d db

# 3. 安装依赖
pnpm install

# 4. 执行数据库迁移
node scripts/db/migrate.mjs

# 5. 启动 Web 开发服务（端口 9559）
pnpm dev

# 6. 另开终端启动 Worker
pnpm worker:dev
```

访问 `http://127.0.0.1:9559`，使用 `admin` / `.env` 中的 `AUTH_INITIAL_PASSWORD` 登录。

### 生产部署

使用 `deploy/` 目录下的预构建镜像：

```bash
mkdir -p feedfuse && cd feedfuse
curl -fsSL -o compose.yaml https://raw.githubusercontent.com/BryanHoo/FeedFuse/main/deploy/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/BryanHoo/FeedFuse/main/deploy/.env.example

# 编辑 .env，修改密钥和密码
vim .env

# 拉取镜像并启动
docker compose pull
docker compose up -d
```

### 从源码构建 Docker 镜像

```bash
cp .env.example .env
docker compose up --build
```

Dockerfile 使用多阶段构建，产出两个镜像：
- **web**：Next.js standalone 模式（`node server.js`）
- **worker**：tsx 运行 Worker（`tsx src/worker/index.ts`）

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Web 开发服务 |
| `pnpm dev:turbo` | 启动 Web 开发服务（Turbopack） |
| `pnpm worker:dev` | 启动 Worker 开发模式 |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务 |
| `pnpm lint` | 代码检查 |
| `pnpm type-check` | 类型检查 |
| `pnpm test` | 运行测试 |
| `pnpm test:unit:watch` | 监听模式测试 |

---

## 11. 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | (必填) | PostgreSQL 连接串 |
| `AUTH_INITIAL_PASSWORD` | (必填) | 初始管理员密码 |
| `AUTH_COOKIE_SECURE` | `false` | Cookie Secure 标志 |
| `IMAGE_PROXY_SECRET` | (必填) | 图片代理签名密钥 |
| `RSS_NETWORK_MODE` | `public` | RSS 网络模式：public/fake-ip/lan/custom |
| `RSS_ALLOWED_CIDRS` | (空) | 自定义 CIDR 白名单 |

### Next.js 配置

[next.config.mjs](file:///Users/wade/work-space/FeedFuse/next.config.mjs)：

- `output: 'standalone'` — 独立部署模式
- `serverExternalPackages: ['rsshub']` — RSSHub 作为外部包
- `poweredByHeader: false` — 隐藏 X-Powered-By 头
- `optimizePackageImports: ['lucide-react']` — 图标按需导入优化

### Docker 服务架构

`docker-compose.yml` 定义三个服务：

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| `db` | postgres:16 | 5432 | PostgreSQL 数据库 |
| `web` | ghcr.io/bryanhoo/feedfuse-web | 9559 | Next.js Web 应用 |
| `worker` | ghcr.io/bryanhoo/feedfuse-worker | - | 后台任务进程 |

---

> 文档生成时间：2026-07-29
> 项目版本：0.4.0
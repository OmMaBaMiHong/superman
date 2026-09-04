# FeedFuse 产品升级设计文档

> 创建日期: 2026-08-02
> 状态: Draft
> 升级路径: 方案 C — 混合模式（技术债修复 + 高价值功能交叉推进）

## 1. 项目定位

FeedFuse 定位为 **"开源版 Readwise Reader + Inoreader"**：
- 深度阅读 + 知识沉淀（对标 Readwise Reader）
- 规则引擎 + 信息过滤（对标 Inoreader）
- 完全自托管，数据自主

技术栈：Next.js 16 + TypeScript + PostgreSQL + pgvector + LlamaIndex TS

## 2. 现状审计

### 2.1 已实现功能（13 项）

| 功能 | 状态 | 关键文件 |
|------|------|---------|
| AI 摘要 | ✅ 流式生成 + AI Digest 多源聚合 | `src/worker/aiSummaryStreamWorker.ts`, `src/server/integrations/ai/aiDigestCompose.ts` |
| AI 翻译 | ✅ 标题/正文/双语/沉浸式 | `src/features/articles/hooks/useImmersiveTranslation.ts` |
| 全文搜索 | ✅ 关键词搜索 | `src/app/api/articles/search/route.ts` |
| 知识库问答 | ✅ pgvector + 全文 RRF 混合检索 | `src/server/integrations/knowledge/searchService.ts` |
| 收藏/星标 | ✅ isStarred + 收藏视图 | `src/features/articles/components/ArticleView.tsx` |
| OPML 导入导出 | ✅ 完整链路 | `src/server/domains/settings/services/opmlService.ts` |
| 键盘快捷键 | ✅ 14+ 快捷键 + 帮助弹窗 | `src/features/reader/components/ReaderLayout.tsx` |
| 订阅源发现 | ✅ Discover 页 + 推荐源 | `src/features/discover/components/DiscoverPage.tsx` |
| 多视图 | ✅ 文章/图片/视频/社交/AI报告 | `src/lib/reader/view.ts` |
| RSS 抓取配置 | ✅ 间隔 + 全文策略 | `src/features/settings/panels/RssSettingsPanel.tsx` |
| AI Digest | ✅ 多源聚合报告 | `src/app/api/ai-digests/route.ts` |
| Markdown 导出 | ✅ | `src/features/articles/components/ArticleView.tsx` |
| Toast 通知 | ✅ 站内通知 | `src/features/toast/components/ToastHost.tsx` |

### 2.2 未实现功能（10 项）

文章高亮标注、看板/自定义集合、文章标签、创作者追踪、间隔重复/每日回顾、TTS 语音朗读、社交分享、浏览器扩展、移动端/PWA、Web Push 推送、智能优先级排序、主题聚合、趋势检测、自动知识图谱、i18n 国际化。

### 2.3 P0 安全问题（需立即修复）

1. `src/app/api/rsshub/[...route]/route.ts` — 无认证，任何人可调用 RssHub 抓取任意路由（SSRF 风险）
2. `src/app/api/rsshub/resolve/route.ts` — 无认证
3. 缺少全局 `src/middleware.ts` — 认证依赖每个 route 手动调用 `requireApiSession`，易遗漏
4. 缺少 CI workflow — 无 PR 级 lint/type-check/test

### 2.4 P1 代码质量问题

| 问题 | 文件 | 行数/说明 |
|------|------|---------|
| 巨型文件 | `src/lib/api/apiClient.ts` | 1649 行 |
| 巨型文件 | `src/features/articles/components/ArticleView.tsx` | 1396 行 |
| 巨型文件 | `src/features/articles/components/ArticleList.tsx` | 1318 行 |
| 巨型文件 | `src/store/appStore.ts` | 1230 行（单一 Store，应按域拆分） |
| 巨型文件 | `src/features/feeds/components/FeedList.tsx` | 1146 行（14 个 useState，8 个 Dialog） |
| 巨型文件 | `src/worker/index.ts` | 1033 行 |
| migration 编号重复 | `0026_app_settings_auth.sql` 和 `0026_article_media_attachments.sql` | 破坏顺序约定 |
| 英文错误消息 | `src/features/settings/utils/validateSettingsDraft.ts` | 行 56-95，直接显示给中文用户 |
| 死代码 | `src/data/mock/mockProvider.ts`, `src/data/provider/readerDataProvider.ts` | 仅测试引用，位于 src/ 下会被打包 |
| 未使用依赖 | `sharp`（package.json:62） | 全项目无实际 import |
| 死类型 | `AppearanceSettings`（`src/types/index.ts:123`） | 无任何 import 引用 |
| 重复代码 | `zodIssuesToFields` / `isUniqueViolation` | 在多个 API route 中重复定义 |

### 2.5 竞品对标参考

| 对标产品 | 借鉴点 | 参考仓库 |
|---------|--------|---------|
| Readwise Reader | 高亮标注、看板(Boards)、Ghostreader 阅读AI助手、间隔重复 | 闭源 |
| Inoreader | AI规则引擎、趋势检测、自然语言过滤规则 | 闭源 |
| Folo | AI每日简报、多视图、RSSHub万物订阅 | [RSSNext/Folo](https://github.com/RSSNext/Folo) |
| Karakeep (原 Hoarder) | Monorepo + Worker 队列架构、tRPC 类型安全 | [karakeep-app/karakeep](https://github.com/karakeep-app/karakeep) |
| Omnivore | 全栈 TS + Readability + 高亮/笔记数据模型 | [omnivore-app/omnivore](https://github.com/omnivore-app/omnivore) |
| Feeds Fun | AI 自动打标签 + 评分规则排序 | [Tiendil/feeds.fun](https://github.com/Tiendil/feeds.fun) |
| ts-fsrs | TypeScript 间隔重复算法库（FSRS） | [open-spaced-repetition/fsrs.js](https://github.com/open-spaced-repetition/fsrs.js) |
| Obsidian Web Clipper | defuddle 正文提取 + 模板变量系统 | [obsidian/obsidian-clipper](https://github.com/obsidian/obsidian-clipper) |

## 3. 升级方案总览

### 方案选择：C — 混合模式

每期包含"还债"和"建新"两部分，技术债修复与高价值功能交叉推进。新功能开发时顺手重构相关模块。

### 四期规划

| 期 | 主题 | 还债部分 | 建新部分 |
|----|------|---------|---------|
| Phase 1 | 阅读体验增强 | 安全漏洞修复；拆分 ArticleView/FeedList；i18n 基础设施 | 文章高亮标注；文章标签系统；看板(Boards)；阅读页AI助手 |
| Phase 2 | 信息筛选自动化 | 拆分 appStore 按域分 Store；CI 流水线 | AI规则引擎；智能优先级排序；主题聚合；每日AI简报 |
| Phase 3 | 知识沉淀与记忆 | 拆分 apiClient.ts；知识库模块测试补齐 | 间隔重复每日回顾；语义搜索扩展；创作者追踪；概念知识图谱 |
| Phase 4 | 生态扩展 | PWA 基础设施；Dockerfile 优化 | PWA移动端；浏览器扩展；TTS语音朗读；开放API；社交订阅列表分享 |

---

## 4. Phase 1 详细设计：阅读体验增强

### 4.1 安全漏洞修复（P0）

#### 4.1.1 全局认证中间件

新增 `src/middleware.ts`，对所有 `/api/` 路由强制认证白名单：

```
认证白名单：
  /api/health          — 健康检查
  /api/auth/login      — 登录
  /api/auth/register   — 注册

其余 /api/* 路由：
  - 检查 feedfuse_session cookie
  - 无有效 session → 401 Unauthorized
  - 有效 session → 放行（route handler 内仍可按需做权限检查）
```

参考实现：`src/server/domains/auth/services/session.ts` 的 `requireApiSession` 逻辑提取为 middleware 版本。

#### 4.1.2 RssHub 路由认证

`src/app/api/rsshub/[...route]/route.ts` 和 `src/app/api/rsshub/resolve/route.ts` 添加 `requireApiSession` 调用，与全局 middleware 双重保障。

### 4.2 i18n 国际化基础设施

#### 技术选型：react-i18next

选择理由：
- React 生态最成熟的 i18n 方案
- 支持 SSR（Next.js App Router 兼容）
- 支持 lazy loading（按语言包动态加载）
- 支持插值、复数、嵌套 key

#### 架构设计

```
src/
  i18n/
    index.ts              — i18next 初始化配置
    locales/
      zh-CN.json          — 中文（默认语言）
      en.json             — 英文（预留）
    hooks/
      useTranslation.ts   — 封装 react-i18next 的 useTranslation
```

#### 迁移策略

1. 安装 `i18next` + `react-i18next` + `i18next-resources-to-backend`
2. 创建 `src/i18n/index.ts` 初始化配置，默认语言 `zh-CN`
3. 提取所有硬编码中文文案到 `zh-CN.json`，按模块组织 key：
   ```json
   {
     "settings": { "general": { "theme": "主题", "fontSize": "字体大小" } },
     "reader": { "shortcuts": { "nextArticle": "下一篇文章" } },
     "article": { "actions": { "summarize": "生成摘要", "translate": "翻译" } }
   }
   ```
4. 替换 `validateSettingsDraft.ts` 中的英文错误消息为 i18n key
5. 后续所有新功能开发直接使用 `t('key')` 模式

#### 配置

- 默认语言：`zh-CN`
- 回退语言：`en`
- 语言检测：cookie `feedfuse_locale`（用户可切换），浏览器导航语言作为初始默认
- 持久化：用户语言偏好存入 `users.settings` JSON 字段

### 4.3 文章高亮标注

#### 数据模型

```sql
-- migration: 0042_article_highlights.sql
CREATE TABLE article_highlights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- 高亮文本内容
  text        TEXT NOT NULL,
  -- 高亮在原文中的位置（CSS selector 范围 + offset）
  range_start_selector  TEXT NOT NULL,  -- 起始节点的 CSS selector
  range_start_offset    INT NOT NULL,   -- 起始偏移量
  range_end_selector    TEXT NOT NULL,  -- 结束节点的 CSS selector
  range_end_offset      INT NOT NULL,   -- 结束偏移量
  -- 高亮颜色
  color       TEXT NOT NULL DEFAULT 'yellow',
  -- 用户笔记（可选）
  note        TEXT,
  -- 时间戳
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 唯一约束：同一用户同一文章同一文本范围不重复
  UNIQUE(user_id, article_id, range_start_selector, range_start_offset)
);

CREATE INDEX idx_highlights_user_article ON article_highlights(user_id, article_id);
CREATE INDEX idx_highlights_created_at ON article_highlights(created_at DESC);
```

#### API 设计

```
GET    /api/articles/[id]/highlights          — 获取文章的所有高亮
POST   /api/articles/[id]/highlights          — 创建高亮
PATCH  /api/highlights/[highlightId]           — 更新高亮（颜色/笔记）
DELETE /api/highlights/[highlightId]           — 删除高亮
GET    /api/highlights                         — 获取用户所有高亮（分页，支持按文章/标签筛选）
```

#### 前端架构

```
src/features/articles/
  highlights/
    HighlightToolbar.tsx       — 选中文本时浮现的工具栏（颜色选择 + 添加笔记）
    HighlightLayer.tsx         — 高亮渲染层，负责在文章正文上恢复高亮
    hooks/
      useHighlightSelection.ts — 监听 Selection API，计算 range 位置
      useHighlightStore.ts     — 高亮状态管理（Zustand slice）
    utils/
      rangeSerializer.ts       — Range → CSS selector + offset 序列化
      rangeRestorer.ts         — CSS selector + offset → Range 恢复
```

#### 交互流程

1. 用户在 ArticleView 中选中文本
2. `HighlightToolbar` 在选区上方浮现，提供 5 种颜色（黄/绿/蓝/粉/紫）+ "添加笔记"按钮
3. 点击颜色 → 调用 `useHighlightSelection` 序列化 range → POST API → `HighlightLayer` 立即渲染高亮
4. 点击已有高亮 → 弹出小卡片显示文本 + 笔记 + 编辑/删除按钮
5. 文章加载时 `HighlightLayer` 从 API 获取高亮列表，用 `rangeRestorer` 恢复 DOM 高亮

#### 技术要点

- 使用原生 [Selection API](https://developer.mozilla.org/en-US/docs/Web/API/Selection) + [Range API](https://developer.mozilla.org/en-US/docs/Web/API/Range)
- CSS selector 生成：从 Range 的 startContainer/endContainer 向上遍历到带有 `data-paragraph-id` 的祖先元素
- 高亮渲染：用 `<mark>` 标签包裹高亮文本，`data-highlight-id` 属性关联数据
- 翻译/沉浸式翻译切换时：保存当前高亮 → 翻译完成后重新恢复（翻译后的 DOM 结构变化，高亮位置可能失效，此时降级为"纯文本高亮"显示在侧边栏）

### 4.4 文章标签系统

#### 数据模型

```sql
-- migration: 0043_article_tags.sql
CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT 'gray',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE TABLE article_tags (
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(article_id, tag_id)
);

CREATE INDEX idx_article_tags_tag ON article_tags(tag_id);
CREATE INDEX idx_tags_user ON tags(user_id);
```

#### API 设计

```
GET    /api/tags                                — 获取用户所有标签
POST   /api/tags                                — 创建标签
PATCH  /api/tags/[tagId]                        — 更新标签（名称/颜色）
DELETE /api/tags/[tagId]                        — 删除标签
POST   /api/articles/[id]/tags                  — 给文章添加标签（批量）
DELETE /api/articles/[id]/tags/[tagId]           — 移除文章标签
GET    /api/articles?tag=tagId                  — 按标签筛选文章
```

#### AI 自动标签

在 AI 摘要生成流程中（`aiSummaryStreamWorker.ts`），扩展 LLM prompt 让其同时输出推荐标签：

```json
{
  "summary": "...",
  "suggestedTags": ["AI", "创业", "硅谷"]
}
```

AI 推荐标签存入 `articles.ai_suggested_tags`（JSON 数组），用户可在阅读页一键采纳或修改。

#### 前端

- ArticleView 底部工具栏增加标签按钮，点击弹出标签选择器
- 标签选择器支持：已有标签列表（带颜色圆点）+ 新建标签输入框 + AI 推荐标签（带 ✨ 图标）
- 左侧栏 FeedList 增加"标签"分组，点击标签按标签筛选文章列表

### 4.5 看板（Boards）

#### 数据模型

```sql
-- migration: 0044_boards.sql
CREATE TABLE boards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  icon        TEXT DEFAULT '📋',
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE board_items (
  board_id    UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(board_id, article_id)
);

CREATE INDEX idx_boards_user ON boards(user_id);
CREATE INDEX idx_board_items_board ON board_items(board_id);
```

#### API 设计

```
GET    /api/boards                     — 获取用户所有看板
POST   /api/boards                     — 创建看板
PATCH  /api/boards/[boardId]           — 更新看板
DELETE /api/boards/[boardId]           — 删除看板
GET    /api/boards/[boardId]/items     — 获取看板内的文章列表
POST   /api/boards/[boardId]/items     — 添加文章到看板（article_id）
DELETE /api/boards/[boardId]/items/[articleId]  — 从看板移除文章
```

#### 前端

- 左侧栏 FeedList 底部增加"看板"分组（与"分类"平级），展示用户看板列表
- 点击看板 → 文章列表区展示该看板内的文章（复用 ArticleList 组件，传入 boardId 过滤）
- ArticleView 工具栏增加"加入看板"按钮，弹窗选择目标看板
- 新增 `/boards/[boardId]` 路由，看板详情页支持拖拽排序

### 4.6 阅读页 AI 助手

#### 架构

复用已有知识库 `ask` API（`src/app/api/knowledge/ask/route.ts`），扩展支持 `article_id` 参数：

```
POST /api/knowledge/ask
{
  "question": "这篇文章的核心观点是什么？",
  "articleId": "uuid",          — 新增：指定文章上下文
  "mode": "personal_assistant"   — 复用现有模式
}
```

后端逻辑：
- 如果传入 `articleId`：将文章全文（或摘要）作为 system prompt 上下文，AI 仅基于该文章回答
- 如果未传入 `articleId`：走现有知识库混合检索流程

#### 前端

```
src/features/articles/
  ai-assistant/
    AiAssistantPanel.tsx     — 右侧抽屉面板（Drawer），支持折叠/展开
    AiAssistantToggle.tsx    — 文章阅读页右侧的悬浮按钮（展开/收起 AI 助手）
    hooks/
      useArticleAiChat.ts    — 管理对话历史、流式接收
```

- ArticleView 右侧增加 AI 助手入口（悬浮按钮，点击展开右侧 Drawer）
- Drawer 内为 ChatGPT 风格对话界面，底部输入框
- 预设快捷问题按钮：「总结全文」「提取要点」「解释术语」「翻译关键段落」
- 对话历史存储在 localStorage（按 article_id 隔离）

### 4.7 巨型文件拆分

#### ArticleView.tsx 拆分（1396 行 → 目标 <400 行）

```
src/features/articles/components/
  ArticleView.tsx              — 主容器（<300 行）：布局编排 + 数据加载
  ArticleHeader.tsx            — 标题 + 元信息 + 工具栏
  ArticleBody.tsx              — 正文渲染（含 dangerouslySetInnerHTML 逻辑）
  ArticleAiSummary.tsx         — AI 摘要流式展示
  ArticleTranslation.tsx       — 翻译相关（双语/沉浸式切换）
  ArticleFulltextFetch.tsx     — 全文抓取状态展示
  ArticleExport.tsx            — Markdown 导出
  ArticleMedia.tsx             — 图片预览 + 视频播放
  ArticleTags.tsx              — 标签选择器
  ArticleHighlightLayer.tsx    — 高亮渲染层
```

#### FeedList.tsx 拆分（1146 行 → 目标 <400 行）

```
src/features/feeds/components/
  FeedList.tsx                 — 主容器（<300 行）：数据加载 + 布局
  FeedTree.tsx                 — 订阅源树形展示
  FeedContextMenu.tsx          — 右键菜单
  FeedDialogsHost.tsx          — 统一管理所有 Dialog 的挂载
  FeedListFooter.tsx           — 底部设置入口 + 知识库入口
  FeedListSection.tsx          — 分组/视图切换
```

拆分原则：
- 每个 Dialog（AddFeed、AddAiDigest、RecommendedFeeds、FeedFulltextPolicy 等）独立为子组件
- Dialog 的 open state 集中在 `FeedDialogsHost` 管理，通过 context 暴露 `openDialog(name, data)` 方法
- 拆分后 ArticleView/FeedList 只负责数据加载和子组件编排

---

## 5. Phase 2 详细设计：信息筛选自动化

### 5.1 appStore 按域拆分

将 `src/store/appStore.ts`（1230 行）拆分为：

```
src/store/
  feedStore.ts          — 订阅源相关状态（feeds, categories, addFeed, deleteFeed...）
  articleStore.ts       — 文章相关状态（articles, currentArticle, markAsRead, toggleStar...）
  readerStore.ts        — 阅读器 UI 状态（viewType, selectedFeedId, sidebarCollapsed...）
  settingsStore.ts      — 设置状态（aiSettings, rssSettings, appearance...）
  index.ts              — 统一导出 + 跨 store 依赖协调
```

每个 store 独立持久化到 localStorage，避免单一 store 过大。跨 store 访问通过组合 hooks 实现。

### 5.2 AI 规则引擎

#### 数据模型

```sql
-- migration: 0045_ai_rules.sql
CREATE TABLE ai_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- 自然语言规则描述
  condition   TEXT NOT NULL,     -- e.g. "当文章提到 GPU 和数据中心时"
  -- 执行动作
  action      TEXT NOT NULL,     -- 'highlight' | 'tag' | 'archive' | 'notify' | 'priority_high'
  action_params JSONB,           -- 动作参数，如 tag_id, priority_level
  -- 是否启用
  enabled     BOOLEAN NOT NULL DEFAULT true,
  -- 执行次数统计
  match_count INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 工作流程

1. 用户在设置页创建规则：用自然语言描述条件 + 选择动作
2. 文章入库时（`rssScheduler` → `articlesRepo.insert`），后台 worker 异步执行规则匹配：
   - 将文章标题 + 摘要 + 正文前 500 字 + 所有规则条件发送给 LLM
   - LLM 返回匹配的规则 ID 列表
   - 对匹配的规则执行对应动作（打标签/高亮/归档/通知/标记高优先级）
3. 设置页展示规则列表 + 匹配次数 + 启用/禁用开关

#### API

```
GET    /api/ai-rules              — 获取用户规则列表
POST   /api/ai-rules              — 创建规则
PATCH  /api/ai-rules/[ruleId]     — 更新规则
DELETE /api/ai-rules/[ruleId]     — 删除规则
POST   /api/ai-rules/test         — 测试规则（传入文章ID，返回是否匹配）
```

### 5.3 智能优先级排序

#### 机制

1. 记录用户阅读行为信号：
   - `article_read`：点击打开文章（+1 分）
   - `article_star`：收藏文章（+3 分）
   - `article_highlight`：高亮文章（+2 分）
   - `article dwell_time > 30s`：停留超 30 秒（+1 分）
   - `article_skip`：快速跳过（-1 分）

2. 每周构建用户兴趣画像：将过去 7 天得分最高的文章标题+摘要发送给 LLM，提取 Top 10 兴趣关键词

3. 新文章入库时 AI 打分：
   - 输入：文章标题 + 摘要 + 用户兴趣关键词列表
   - 输出：优先级分数（0-100）
   - 存入 `articles.ai_priority_score`（新增字段）

4. 文章列表支持按优先级排序（新增 `sort=priority` 选项）

#### 数据模型

```sql
-- migration: 0046_ai_priority.sql
ALTER TABLE articles ADD COLUMN ai_priority_score INT DEFAULT NULL;
ALTER TABLE articles ADD COLUMN ai_priority_reason TEXT DEFAULT NULL;

-- migration: 0047_user_reading_signals.sql
CREATE TABLE user_reading_signals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,       -- 'read' | 'star' | 'highlight' | 'dwell' | 'skip'
  value       INT NOT NULL,        -- 分数值
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_signals_user_date ON user_reading_signals(user_id, created_at DESC);
```

### 5.4 主题聚合

#### 机制

文章入库时，AI 提取文章的主题/事件标签（1-3 个关键词），相同主题的多篇文章自动聚类为"主题卡片"。

```sql
-- migration: 0048_article_topics.sql
ALTER TABLE articles ADD COLUMN ai_topic TEXT DEFAULT NULL;
ALTER TABLE articles ADD COLUMN ai_topic_cluster UUID DEFAULT NULL;
CREATE INDEX idx_articles_topic ON articles(ai_topic) WHERE ai_topic IS NOT NULL;
```

- `ai_topic`：AI 提取的主题关键词（如 "OpenAI GPT-5 发布"）
- `ai_topic_cluster`：相同主题的文章共享一个 UUID（聚类标识）

前端：文章列表顶部新增"主题"视图模式，显示主题卡片（每个卡片显示主题名 + 相关文章数 + 3 篇最新文章预览）。

### 5.5 每日 AI 简报

#### 机制

扩展现有 AI Digest 能力：
- 新增"每日简报"类型的 Digest，时间范围固定为 24 小时
- 每天定时触发（用户可配置时间，如早上 8:00）
- 聚合用户所有源的 Top N 文章（按 ai_priority_score 排序）
- LLM 生成 Markdown 简报：重要新闻摘要 + 趋势话题 + 推荐阅读

#### 前端

- 首页新增"今日简报"卡片入口
- 简报页展示：日期 + AI 生成的结构化简报 + 文章链接列表
- 支持历史简报查看（日历选择）

### 5.6 CI 流水线

新增 `.github/workflows/ci.yml`：

```yaml
name: CI
on: [pull_request, push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm type-check
      - run: pnpm test
```

---

## 6. Phase 3 详细设计：知识沉淀与记忆

### 6.1 间隔重复每日回顾

#### 技术选型：ts-fsrs

使用 [ts-fsrs](https://github.com/open-spaced-repetition/fsrs.js)（TypeScript 原生 FSRS 算法库）。

#### 数据模型

```sql
-- migration: 0049_spaced_repetition.sql
CREATE TABLE review_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 关联的高亮或摘要
  source_type     TEXT NOT NULL,     -- 'highlight' | 'article_summary'
  source_id       UUID NOT NULL,     -- highlight.id 或 article.id
  -- 卡片内容
  front           TEXT NOT NULL,     -- 正面（提示/问题）
  back            TEXT NOT NULL,     -- 背面（答案/原文）
  -- FSRS 参数
  stability       FLOAT NOT NULL DEFAULT 0,
  difficulty      FLOAT NOT NULL DEFAULT 0,
  last_review_at  TIMESTAMPTZ,
  next_review_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_count    INT NOT NULL DEFAULT 0,
  lapses          INT NOT NULL DEFAULT 0,
  state           INT NOT NULL DEFAULT 0,  -- 0:New, 1:Learning, 2:Review, 3:Relearning
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_review_cards_due ON review_cards(user_id, next_review_at) WHERE next_review_at <= NOW();
```

#### 工作流程

1. **卡片创建**：用户高亮文章时，可选"加入复习"→ 自动创建 review_card（front = 高亮上下文，back = 高亮文本）
2. **每日回顾**：侧栏新增"每日回顾"入口，展示今日待复习卡片
3. **复习界面**：先显示 front（提示），用户点击"显示答案"→ 显示 back（原文）→ 评分（Again / Hard / Good / Easy）
4. **调度更新**：调用 ts-fsrs 的 `fsrs.update_card` 更新 stability/difficulty/next_review_at

#### API

```
GET    /api/review/today            — 获取今日待复习卡片
POST   /api/review/[cardId]/rate    — 提交评分（rating: 1-4）
GET    /api/review/stats            — 复习统计（今日数量/连续天数/累计复习次数）
```

### 6.2 语义搜索扩展

将知识库的 hybridSearch（向量 + 全文 RRF）扩展到全站文章搜索：

- 当前：`/api/articles/search` 仅支持关键词匹配
- 扩展：新增 `/api/articles/semantic-search` 端点，使用 pgvector 向量检索
- 前端全局搜索对话框增加"语义搜索"切换开关

### 6.3 创作者追踪

#### 数据模型

```sql
-- migration: 0050_creator_tracking.sql
CREATE TABLE followed_creators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- 关联的 feed_ids（一个创作者可能有多个 RSS 源）
  feed_ids    UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);
```

#### 功能

- 文章列表支持按 `author` 字段筛选
- 创作者页面：`/creators/[name]`，展示该作者的所有文章 + 发文频率统计
- 订阅源设置增加"创作者名称"字段，用于聚合多个 feed 到同一创作者

### 6.4 概念知识图谱

#### 数据模型

```sql
-- migration: 0051_concept_graph.sql
CREATE TABLE article_concepts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  concept     TEXT NOT NULL,           -- 概念名称
  concept_type TEXT,                   -- 'person' | 'org' | 'tech' | 'topic'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(article_id, concept)
);

CREATE TABLE concept_relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_a   TEXT NOT NULL,
  concept_b   TEXT NOT NULL,
  relation    TEXT NOT NULL,           -- 'related' | 'contrast' | 'part_of'
  article_id  UUID REFERENCES articles(id) ON DELETE CASCADE,
  weight      FLOAT NOT NULL DEFAULT 1.0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(concept_a, concept_b, article_id)
);

CREATE INDEX idx_concepts_article ON article_concepts(article_id);
CREATE INDEX idx_concepts_name ON article_concepts(concept);
CREATE INDEX idx_relations_concepts ON concept_relations(concept_a, concept_b);
```

#### 机制

1. 文章入库时 AI 提取概念（复用 AI 摘要 prompt 扩展）
2. 相同概念出现在不同文章中 → 自动建立关联
3. 前端知识图谱页面：用 D3.js Force Graph 可视化概念网络
4. 点击概念节点 → 展开相关文章列表

### 6.5 apiClient.ts 拆分

将 1649 行的 `apiClient.ts` 按业务域拆分：

```
src/lib/api/
  index.ts              — 统一导出
  client.ts             — fetch 封装（baseUrl, headers, error handling）
  feedsApi.ts           — 订阅源相关 API
  articlesApi.ts        — 文章相关 API
  categoriesApi.ts      — 分类相关 API
  aiDigestsApi.ts       — AI 报告相关 API
  knowledgeApi.ts       — 知识库相关 API
  settingsApi.ts        — 设置相关 API
  opmlApi.ts            — OPML 导入导出
  highlightsApi.ts      — 高亮相关 API
  tagsApi.ts            — 标签相关 API
  boardsApi.ts          — 看板相关 API
  reviewApi.ts          — 复习相关 API
```

### 6.6 知识库模块测试补齐

为 `src/server/integrations/knowledge/` 下 4 个文件补写单元测试：
- `chunkingService.test.ts`
- `embeddingService.test.ts`
- `indexingService.test.ts`
- `searchService.test.ts`

---

## 7. Phase 4 详细设计：生态扩展

### 7.1 PWA 移动端

- 添加 `public/manifest.json`
- 注册 Service Worker（使用 `@ducanh2912/next-pwa`）
- 缓存策略：文章列表 + 已读文章离线可用
- 响应式布局优化：移动端底部 Tab Bar 导航

### 7.2 浏览器扩展

- Manifest V3 Chrome Extension
- 功能：一键保存当前网页到 FeedFuse（调用 POST /api/articles/clipping）
- 正文提取：使用 [defuddle](https://github.com/anthropics/defuddle) 库
- 与主应用共享 API 类型定义

### 7.3 TTS 语音朗读

- 使用 Web Speech API（零成本）作为默认方案
- ArticleView 工具栏增加"朗读"按钮
- 支持：播放/暂停/语速调节/跳转段落
- 中文使用 `zh-CN` 语音，英文使用 `en-US` 语音

### 7.4 开放 API

- API Key 认证（`Authorization: Bearer <api_key>`）
- 用户可在设置页生成/撤销 API Key
- 速率限制：每用户 100 次/分钟
- 暴露 REST API：文章 CRUD、订阅源 CRUD、搜索、知识库问答

### 7.5 社交订阅列表分享

- 用户可将自己的订阅列表公开分享
- 生成分享链接：`/shared-lists/[listId]`
- 其他用户访问后可一键导入（OPML 格式）

### 7.6 Dockerfile 优化

- 修复 Node 版本不一致问题（engines 要求 >=20.19.0，Dockerfile 用 node:24-alpine）
- Worker 阶段仅复制生产所需文件（排除 test/mock）
- 添加 `.dockerignore` 验证

---

## 8. 技术债清单（独立于功能分期）

以下问题在相关 Phase 中顺手修复，不单独排期：

| 问题 | 修复时机 | 文件 |
|------|---------|------|
| migration 0026 编号重复 | Phase 1 | `migrations/0026_*.sql` |
| 英文错误消息 | Phase 1 i18n | `validateSettingsDraft.ts` |
| sharp 未使用依赖 | Phase 1 | `package.json` |
| 死代码 mock 数据 | Phase 1 | `src/data/`, `src/mock/` |
| 死类型 AppearanceSettings | Phase 1 | `src/types/index.ts` |
| 重复代码 zodIssuesToFields | Phase 2 | 多个 API route |
| 重复 SQL 字段列表 | Phase 2 | `feedsRepo.ts` |
| 缺少 E2E 测试 | Phase 3 | 新增 playwright 配置 |
| docker-compose 重复 | Phase 4 | `docker-compose.yml` vs `deploy/compose.yaml` |

---

## 9. 不做的事情（YAGNI）

以下功能明确不在升级范围内，避免范围蔓延：

- **tRPC 迁移**：现有 REST API + apiClient 模式可工作，tRPC 迁移成本高收益低
- **Drizzle ORM 迁移**：现有原生 SQL + 参数化查询安全且灵活，不强制换 ORM
- **Redis/RabbitMQ 消息队列**：PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` + `pg_notify` 足够
- **图数据库**：PostgreSQL 关系表 + pgvector 足够覆盖知识图谱需求
- **GraphQL**：REST API 已满足需求，不增加复杂度
- **多租户 SaaS 化**：当前定位为自托管单实例，不做租户隔离
- **移动端原生 App**：PWA 优先，不做 React Native / Electron

---

## 10. 验收标准

### Phase 1 验收

- [ ] `src/middleware.ts` 全局认证生效，未认证请求返回 401
- [ ] i18n 基础设施就绪，`useTranslation` 可用，默认中文
- [ ] 文章阅读页可选中文本 → 弹出高亮工具栏 → 选择颜色 → 高亮持久化
- [ ] 文章可打标签，左侧栏可按标签筛选
- [ ] 可创建看板，可将文章加入看板，看板列表在左侧栏可见
- [ ] 阅读页右侧 AI 助手可展开，可对当前文章提问
- [ ] ArticleView.tsx < 400 行，FeedList.tsx < 400 行

### Phase 2 验收

- [ ] appStore 拆分为 4 个独立 store，功能无回归
- [ ] CI workflow 在 PR 时自动运行 lint + type-check + test
- [ ] 可创建 AI 规则，文章入库时自动匹配执行
- [ ] 文章列表可按优先级排序
- [ ] 相同主题文章自动聚合为主题卡片
- [ ] 每日定时生成 AI 简报，可在首页查看

### Phase 3 验收

- [ ] 高亮可"加入复习"，每日回顾页面展示待复习卡片
- [ ] 评分后卡片自动调度下次复习时间（ts-fsrs 算法）
- [ ] 全局搜索支持语义搜索模式
- [ ] 创作者页面展示作者所有文章
- [ ] 知识图谱页面可视化概念网络
- [ ] apiClient.ts 拆分为按域独立文件
- [ ] knowledge 模块 4 个文件有单元测试

### Phase 4 验收

- [ ] 可安装 PWA 到手机桌面，离线可阅读已缓存文章
- [ ] Chrome 扩展可一键保存网页到 FeedFuse
- [ ] 文章阅读页可语音朗读
- [ ] 设置页可生成 API Key，第三方可调用开放 API
- [ ] 可公开分享订阅列表，其他用户可一键导入

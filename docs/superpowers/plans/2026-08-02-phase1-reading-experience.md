# Phase 1: 阅读体验增强 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复安全漏洞，建立 i18n 基础设施，实现高亮标注/标签/看板/阅读页AI助手，拆分巨型文件。

**Architecture:** 在现有 Next.js 16 + TypeScript + PostgreSQL 架构上扩展。新增 3 张数据表（highlights, tags, boards），复用已有知识库 ask API 扩展阅读页AI助手，引入 react-i18next 做国际化基础设施。

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL, pgvector, Zustand, react-i18next, Radix UI, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-08-02-feedfuse-upgrade-design.md`

---

## 文件结构总览

### 新建文件

```
src/middleware.ts                                    — 全局认证中间件
src/i18n/index.ts                                    — i18next 初始化
src/i18n/locales/zh-CN.json                          — 中文语言包
src/i18n/locales/en.json                             — 英文语言包（预留）
src/i18n/hooks/useTranslation.ts                     — useTranslation 封装

src/server/infra/db/migrations/0042_article_highlights.sql
src/server/infra/db/migrations/0043_article_tags.sql
src/server/infra/db/migrations/0044_boards.sql

src/server/domains/highlights/repositories/highlightsRepo.ts
src/server/domains/highlights/highlightsRepo.test.ts
src/app/api/articles/[id]/highlights/route.ts
src/app/api/highlights/[highlightId]/route.ts

src/server/domains/tags/repositories/tagsRepo.ts
src/server/domains/tags/tagsRepo.test.ts
src/app/api/tags/route.ts
src/app/api/tags/[tagId]/route.ts
src/app/api/articles/[id]/tags/route.ts
src/app/api/articles/[id]/tags/[tagId]/route.ts

src/server/domains/boards/repositories/boardsRepo.ts
src/server/domains/boards/boardsRepo.test.ts
src/app/api/boards/route.ts
src/app/api/boards/[boardId]/route.ts
src/app/api/boards/[boardId]/items/route.ts
src/app/api/boards/[boardId]/items/[articleId]/route.ts

src/features/articles/highlights/HighlightToolbar.tsx
src/features/articles/highlights/HighlightLayer.tsx
src/features/articles/highlights/hooks/useHighlightSelection.ts
src/features/articles/highlights/hooks/useHighlightStore.ts
src/features/articles/highlights/utils/rangeSerializer.ts
src/features/articles/highlights/utils/rangeRestorer.ts

src/features/articles/tags/ArticleTagSelector.tsx
src/features/articles/tags/hooks/useTagStore.ts

src/features/boards/components/BoardList.tsx
src/features/boards/components/BoardDetail.tsx
src/features/boards/components/AddToBoardDialog.tsx
src/features/boards/hooks/useBoardStore.ts

src/features/articles/ai-assistant/AiAssistantPanel.tsx
src/features/articles/ai-assistant/AiAssistantToggle.tsx
src/features/articles/ai-assistant/hooks/useArticleAiChat.ts

src/lib/api/highlightsApi.ts
src/lib/api/tagsApi.ts
src/lib/api/boardsApi.ts

src/features/articles/components/ArticleHeader.tsx        — 从 ArticleView 拆出
src/features/articles/components/ArticleBody.tsx
src/features/articles/components/ArticleAiSummary.tsx
src/features/articles/components/ArticleTranslation.tsx
src/features/articles/components/ArticleFulltextFetch.tsx
src/features/articles/components/ArticleExport.tsx
src/features/articles/components/ArticleMedia.tsx

src/features/feeds/components/FeedTree.tsx                — 从 FeedList 拆出
src/features/feeds/components/FeedContextMenu.tsx
src/features/feeds/components/FeedDialogsHost.tsx
src/features/feeds/components/FeedListFooter.tsx

.github/workflows/ci.yml                                   — CI 流水线
```

### 修改文件

```
src/app/api/knowledge/ask/route.ts              — 扩展支持 articleId 参数
src/app/api/rsshub/[...route]/route.ts          — 添加 requireApiSession
src/app/api/rsshub/resolve/route.ts             — 添加 requireApiSession
src/features/articles/components/ArticleView.tsx — 拆分至 <400 行
src/features/feeds/components/FeedList.tsx       — 拆分至 <400 行
src/features/settings/utils/validateSettingsDraft.ts — 英文错误消息修复
src/types/index.ts                               — 新增 Highlight/Tag/Board 类型
src/lib/api/apiClient.ts                         — 新增 highlights/tags/boards API 方法
src/store/appStore.ts                            — 新增 highlight/tag/board 状态
src/app/layout.tsx                               — 引入 i18n 初始化
package.json                                     — 安装 i18next 依赖
```

---

## Task Group A: 安全修复（P0，无依赖，可并行）

### Task 1: 全局认证中间件

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: 创建 middleware.ts**

```typescript
// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';

const SESSION_COOKIE_NAME = 'feedfuse_session';
const PUBLIC_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/setup',
];

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function verifyToken(token: string, secret: string): boolean {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) return false;

  const expectedSignature = createHmac('sha256', secret).update(payloadPart).digest('base64url');
  if (expectedSignature !== signaturePart) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp > nowSeconds;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 仅保护 /api/ 路由
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 公开路由放行
  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  // 测试环境放行
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return NextResponse.json(
      { ok: false, error: { code: 'unauthorized', message: '请先登录后再继续' } },
      { status: 401 },
    );
  }

  // middleware 中无法访问数据库，仅做基础 token 格式校验
  // 完整的 session 验证仍由各 route handler 中的 requireApiSession 完成
  const [payloadPart, signaturePart] = sessionToken.split('.');
  if (!payloadPart || !signaturePart) {
    return NextResponse.json(
      { ok: false, error: { code: 'unauthorized', message: '请先登录后再继续' } },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
```

- [ ] **Step 2: 验证 middleware 生效**

Run: `pnpm dev` 然后用 curl 测试未认证请求
Expected: `GET /api/feeds` 返回 401

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(security): add global auth middleware for API routes"
```

### Task 2: RssHub 路由添加认证

**Files:**
- Modify: `src/app/api/rsshub/[...route]/route.ts`
- Modify: `src/app/api/rsshub/resolve/route.ts`

- [ ] **Step 1: 给 rsshub/[...route]/route.ts 添加 requireApiSession**

在文件顶部已有的 import 区域添加：
```typescript
import { requireApiSession } from '@/server/domains/auth/services/session';
```

在 GET/POST handler 函数体开头添加：
```typescript
const session = await requireApiSession();
if ('response' in session) return session.response;
```

- [ ] **Step 2: 给 rsshub/resolve/route.ts 添加同样的认证**

- [ ] **Step 3: 验证**

Run: `curl http://localhost:9559/api/rsshub/resolve?url=test` → 401

- [ ] **Step 4: Commit**

```bash
git add src/app/api/rsshub/
git commit -m "feat(security): require auth for RssHub API routes"
```

---

## Task Group B: i18n 基础设施（无依赖，可并行）

### Task 3: 安装 i18n 依赖并初始化

**Files:**
- Create: `src/i18n/index.ts`
- Create: `src/i18n/locales/zh-CN.json`
- Create: `src/i18n/locales/en.json`
- Create: `src/i18n/hooks/useTranslation.ts`
- Modify: `package.json`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 安装依赖**

Run: `pnpm add i18next react-i18next i18next-resources-to-backend`

- [ ] **Step 2: 创建中文语言包 zh-CN.json**

```json
{
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "edit": "编辑",
    "confirm": "确认",
    "close": "关闭",
    "search": "搜索",
    "loading": "加载中...",
    "noData": "暂无数据",
    "error": "操作失败，请重试",
    "success": "操作成功"
  },
  "settings": {
    "title": "设置",
    "general": {
      "title": "通用",
      "theme": "主题",
      "fontSize": "字体大小",
      "fontFamily": "字体风格",
      "lineHeight": "行高",
      "autoMarkAsRead": "自动标记已读",
      "compactMode": "紧凑模式"
    },
    "rss": {
      "title": "RSS",
      "fetchInterval": "抓取间隔",
      "maxStoredArticles": "每源最大存储条数",
      "keywordFilter": "关键词过滤"
    },
    "ai": {
      "title": "AI",
      "model": "AI 模型",
      "apiBaseUrl": "API 地址",
      "apiKey": "API 密钥",
      "deepThinking": "深度思考",
      "summaryPrompt": "摘要提示词"
    },
    "security": {
      "title": "账号与安全",
      "name": "姓名",
      "password": "密码",
      "role": "角色"
    },
    "validation": {
      "nameRequired": "请输入姓名",
      "urlRequired": "请输入 URL",
      "urlInvalid": "URL 必须以 http 或 https 开头",
      "apiBaseUrlInvalid": "API 地址格式不正确",
      "translationApiBaseUrlRequired": "使用独立翻译设置时，翻译 API 地址不能为空",
      "translationApiBaseUrlInvalid": "翻译 API 地址格式不正确"
    }
  },
  "reader": {
    "shortcuts": {
      "title": "快捷键",
      "nextArticle": "下一篇文章",
      "prevArticle": "上一篇文章",
      "markAsRead": "标记已读",
      "star": "收藏",
      "summarize": "生成摘要",
      "translate": "翻译",
      "refresh": "刷新",
      "search": "全局搜索",
      "toggleSidebar": "折叠侧栏"
    }
  },
  "article": {
    "actions": {
      "summarize": "生成摘要",
      "translate": "翻译",
      "star": "收藏",
      "unstar": "取消收藏",
      "export": "导出文章",
      "fulltextFetch": "抓取全文",
      "addToBoard": "加入看板",
      "tag": "标签",
      "highlight": "高亮",
      "aiAssistant": "AI 助手"
    },
    "highlight": {
      "colors": {
        "yellow": "黄色",
        "green": "绿色",
        "blue": "蓝色",
        "pink": "粉色",
        "purple": "紫色"
      },
      "addNote": "添加笔记",
      "deleteHighlight": "删除高亮",
      "addToReview": "加入复习"
    },
    "tag": {
      "title": "标签",
      "create": "新建标签",
      "suggested": "AI 推荐标签",
      "noTags": "暂无标签"
    },
    "aiAssistant": {
      "title": "AI 助手",
      "placeholder": "对这篇文章提问...",
      "summarize": "总结全文",
      "keyPoints": "提取要点",
      "explainTerms": "解释术语",
      "translateKey": "翻译关键段落"
    }
  },
  "board": {
    "title": "看板",
    "create": "新建看板",
    "empty": "暂无看板",
    "addArticle": "加入看板",
    "removeArticle": "移出看板"
  }
}
```

- [ ] **Step 3: 创建英文语言包 en.json（预留，仅 common 部分）**

```json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "confirm": "Confirm",
    "close": "Close",
    "search": "Search",
    "loading": "Loading...",
    "noData": "No data",
    "error": "Operation failed",
    "success": "Success"
  }
}
```

- [ ] **Step 4: 创建 i18n 初始化文件**

```typescript
// src/i18n/index.ts
import { notFound } from 'next/navigation';
import { getRequestConfig } from 'i18next/server';
import { initI18next } from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { z } from 'zod';

export const locales = ['zh-CN', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'zh-CN';

export async function initI18n(locale: Locale) {
  if (!locales.includes(locale)) {
    notFound();
  }

  await initI18next({
    lng: locale,
    fallbackLng: defaultLocale,
    resources: {
      'zh-CN': { translation: (await import('./locales/zh-CN.json')).default },
      en: { translation: (await import('./locales/en.json')).default },
    },
  });
}

export default initI18n;
```

- [ ] **Step 5: 创建 useTranslation hook**

```typescript
// src/i18n/hooks/useTranslation.ts
import { useTranslation as useTranslationOriginal } from 'react-i18next';

export function useTranslation(namespace?: string) {
  return useTranslationOriginal(namespace ?? 'translation');
}
```

- [ ] **Step 6: 在 layout.tsx 中初始化 i18n（客户端侧）**

在 `src/app/layout.tsx` 中添加 i18n 客户端初始化（如果是 App Router SSR，在 root layout 中设置 `<html lang="zh-CN">`）。

确保 `<html>` 标签有 `lang="zh-CN"` 属性。

- [ ] **Step 7: 修复 validateSettingsDraft.ts 英文错误消息**

将 `src/features/settings/utils/validateSettingsDraft.ts` 中所有英文错误消息替换为中文：
- `'Name is required.'` → `'请输入姓名'`
- `'URL is required.'` → `'请输入 URL'`
- `'URL must use http or https.'` → `'URL 必须以 http 或 https 开头'`
- `'API base URL must be a valid URL.'` → `'API 地址格式不正确'`
- `'Translation API base URL is required when using dedicated translation settings.'` → `'使用独立翻译设置时，翻译 API 地址不能为空'`
- `'Translation API base URL must be a valid URL.'` → `'翻译 API 地址格式不正确'`

- [ ] **Step 8: Commit**

```bash
git add src/i18n/ src/app/layout.tsx src/features/settings/utils/validateSettingsDraft.ts package.json
git commit -m "feat(i18n): add i18next infrastructure with zh-CN as default locale"
```

---

## Task Group C: 数据库迁移（无依赖，可并行）

### Task 4: 文章高亮迁移

**Files:**
- Create: `src/server/infra/db/migrations/0042_article_highlights.sql`

- [ ] **Step 1: 编写迁移文件**

```sql
-- 0042_article_highlights.sql
CREATE TABLE article_highlights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  range_start_selector  TEXT NOT NULL,
  range_start_offset    INT NOT NULL,
  range_end_selector    TEXT NOT NULL,
  range_end_offset      INT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'yellow',
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, article_id, range_start_selector, range_start_offset)
);

CREATE INDEX idx_highlights_user_article ON article_highlights(user_id, article_id);
CREATE INDEX idx_highlights_created_at ON article_highlights(created_at DESC);
```

注意：`article_id` 用 `BIGINT` 而非 `UUID`，因为 `articles` 表的 `id` 是 `BIGINT GENERATED`（见 0001_init.sql 和 0041_knowledge_embeddings.sql 中 `article_id bigint`）。

- [ ] **Step 2: 运行迁移**

Run: `DATABASE_URL=$(grep DATABASE_URL .env | cut -d= -f2-) node scripts/db/migrate.mjs`

- [ ] **Step 3: Commit**

```bash
git add src/server/infra/db/migrations/0042_article_highlights.sql
git commit -m "feat(highlights): add article_highlights migration"
```

### Task 5: 文章标签迁移

**Files:**
- Create: `src/server/infra/db/migrations/0043_article_tags.sql`

- [ ] **Step 1: 编写迁移文件**

```sql
-- 0043_article_tags.sql
CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT 'gray',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE TABLE article_tags (
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(article_id, tag_id)
);

CREATE INDEX idx_article_tags_tag ON article_tags(tag_id);
CREATE INDEX idx_tags_user ON tags(user_id);

-- AI 推荐标签字段
ALTER TABLE articles ADD COLUMN ai_suggested_tags JSONB DEFAULT NULL;
```

- [ ] **Step 2: 运行迁移并 Commit**

```bash
git add src/server/infra/db/migrations/0043_article_tags.sql
git commit -m "feat(tags): add tags and article_tags migration"
```

### Task 6: 看板迁移

**Files:**
- Create: `src/server/infra/db/migrations/0044_boards.sql`

- [ ] **Step 1: 编写迁移文件**

```sql
-- 0044_boards.sql
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
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(board_id, article_id)
);

CREATE INDEX idx_boards_user ON boards(user_id);
CREATE INDEX idx_board_items_board ON board_items(board_id);
```

- [ ] **Step 2: 运行迁移并 Commit**

```bash
git add src/server/infra/db/migrations/0044_boards.sql
git commit -m "feat(boards): add boards and board_items migration"
```

---

## Task Group D: 高亮标注后端（依赖 Task 4）

### Task 7: 高亮 Repository + API

**Files:**
- Create: `src/server/domains/highlights/repositories/highlightsRepo.ts`
- Create: `src/app/api/articles/[id]/highlights/route.ts`
- Create: `src/app/api/highlights/[highlightId]/route.ts`
- Modify: `src/types/index.ts` — 新增 Highlight 类型

- [ ] **Step 1: 在 src/types/index.ts 中新增类型**

```typescript
// 追加到 src/types/index.ts

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Highlight {
  id: string;
  articleId: number;
  userId: string;
  text: string;
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  color: HighlightColor;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: 创建 highlightsRepo.ts**

```typescript
// src/server/domains/highlights/repositories/highlightsRepo.ts
import type { Pool } from 'pg';
import type { Highlight, HighlightColor } from '@/types';

interface HighlightRow {
  id: string;
  article_id: number;
  user_id: string;
  text: string;
  range_start_selector: string;
  range_start_offset: number;
  range_end_selector: string;
  range_end_offset: number;
  color: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    articleId: row.article_id,
    userId: row.user_id,
    text: row.text,
    rangeStartSelector: row.range_start_selector,
    rangeStartOffset: row.range_start_offset,
    rangeEndSelector: row.range_end_selector,
    rangeEndOffset: row.range_end_offset,
    color: row.color as HighlightColor,
    note: row.note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listHighlights(
  pool: Pool,
  userId: string,
  articleId: number,
): Promise<Highlight[]> {
  const { rows } = await pool.query<HighlightRow>(
    `SELECT * FROM article_highlights WHERE user_id = $1 AND article_id = $2 ORDER BY created_at DESC`,
    [userId, articleId],
  );
  return rows.map(rowToHighlight);
}

export async function createHighlight(
  pool: Pool,
  params: {
    userId: string;
    articleId: number;
    text: string;
    rangeStartSelector: string;
    rangeStartOffset: number;
    rangeEndSelector: string;
    rangeEndOffset: number;
    color: HighlightColor;
    note?: string | null;
  },
): Promise<Highlight> {
  const { rows } = await pool.query<HighlightRow>(
    `INSERT INTO article_highlights
      (user_id, article_id, text, range_start_selector, range_start_offset, range_end_selector, range_end_offset, color, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      params.userId,
      params.articleId,
      params.text,
      params.rangeStartSelector,
      params.rangeStartOffset,
      params.rangeEndSelector,
      params.rangeEndOffset,
      params.color,
      params.note ?? null,
    ],
  );
  return rowToHighlight(rows[0]);
}

export async function updateHighlight(
  pool: Pool,
  highlightId: string,
  userId: string,
  updates: { color?: HighlightColor; note?: string | null },
): Promise<Highlight | null> {
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [highlightId, userId];
  let paramIdx = 3;

  if (updates.color !== undefined) {
    setClauses.push(`color = $${paramIdx++}`);
    values.push(updates.color);
  }
  if (updates.note !== undefined) {
    setClauses.push(`note = $${paramIdx++}`);
    values.push(updates.note);
  }
  if (setClauses.length === 0) return null;

  setClauses.push(`updated_at = NOW()`);

  const { rows } = await pool.query<HighlightRow>(
    `UPDATE article_highlights SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    values,
  );
  return rows.length > 0 ? rowToHighlight(rows[0]) : null;
}

export async function deleteHighlight(
  pool: Pool,
  highlightId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM article_highlights WHERE id = $1 AND user_id = $2`,
    [highlightId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 3: 创建 API route — GET/POST /api/articles/[id]/highlights**

```typescript
// src/app/api/articles/[id]/highlights/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { listHighlights, createHighlight } from '@/server/domains/highlights/repositories/highlightsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  text: z.string().min(1).max(10000),
  rangeStartSelector: z.string().min(1).max(500),
  rangeStartOffset: z.number().int().min(0),
  rangeEndSelector: z.string().min(1).max(500),
  rangeEndOffset: z.number().int().min(0),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).default('yellow'),
  note: z.string().max(5000).nullable().optional(),
}).strict();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  const { id } = await params;
  const articleId = parseInt(id, 10);
  if (isNaN(articleId)) {
    return fail(new ValidationError('无效的文章 ID', { id: '文章 ID 必须是数字' }));
  }

  const highlights = await listHighlights(getPool(), session.userId, articleId);
  return ok(highlights);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  const { id } = await params;
  const articleId = parseInt(id, 10);
  if (isNaN(articleId)) {
    return fail(new ValidationError('无效的文章 ID', { id: '文章 ID 必须是数字' }));
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'body';
      if (!fields[key]) fields[key] = issue.message;
    }
    return fail(new ValidationError('请求参数校验失败', fields));
  }

  try {
    const highlight = await createHighlight(getPool(), {
      userId: session.userId,
      articleId,
      ...parsed.data,
    });
    return ok(highlight);
  } catch (err: any) {
    if (err?.code === '23505') {
      return fail(new ValidationError('该文本范围已存在高亮', {}));
    }
    throw err;
  }
}
```

- [ ] **Step 4: 创建 API route — PATCH/DELETE /api/highlights/[highlightId]**

```typescript
// src/app/api/highlights/[highlightId]/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError, NotFoundError } from '@/server/infra/http/errors';
import { updateHighlight, deleteHighlight } from '@/server/domains/highlights/repositories/highlightsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).optional(),
  note: z.string().max(5000).nullable().optional(),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ highlightId: string }> },
) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  const { highlightId } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'body';
      if (!fields[key]) fields[key] = issue.message;
    }
    return fail(new ValidationError('请求参数校验失败', fields));
  }

  const highlight = await updateHighlight(getPool(), highlightId, session.userId, parsed.data);
  if (!highlight) return fail(new NotFoundError('高亮不存在'));
  return ok(highlight);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ highlightId: string }> },
) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  const { highlightId } = await params;
  const deleted = await deleteHighlight(getPool(), highlightId, session.userId);
  if (!deleted) return fail(new NotFoundError('高亮不存在'));
  return ok({ deleted: true });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/server/domains/highlights/ src/app/api/articles/[id]/highlights/ src/app/api/highlights/
git commit -m "feat(highlights): add highlight repository and API routes"
```

---

## Task Group E: 标签系统后端（依赖 Task 5）

### Task 8: 标签 Repository + API

**Files:**
- Create: `src/server/domains/tags/repositories/tagsRepo.ts`
- Create: `src/app/api/tags/route.ts`
- Create: `src/app/api/tags/[tagId]/route.ts`
- Create: `src/app/api/articles/[id]/tags/route.ts`
- Create: `src/app/api/articles/[id]/tags/[tagId]/route.ts`
- Modify: `src/types/index.ts` — 新增 Tag 类型

- [ ] **Step 1: 在 src/types/index.ts 中新增类型**

```typescript
export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
}
```

- [ ] **Step 2: 创建 tagsRepo.ts**

参考 highlightsRepo.ts 的模式，实现：
- `listTags(pool, userId): Promise<Tag[]>`
- `createTag(pool, userId, name, color): Promise<Tag>`
- `updateTag(pool, tagId, userId, name?, color?): Promise<Tag | null>`
- `deleteTag(pool, tagId, userId): Promise<boolean>`
- `addTagsToArticle(pool, articleId, tagIds[]): Promise<void>` — 批量插入 article_tags
- `removeTagFromArticle(pool, articleId, tagId): Promise<boolean>`
- `getArticleTags(pool, articleId): Promise<Tag[]>`

- [ ] **Step 3: 创建 API routes**

`src/app/api/tags/route.ts` — GET（列表）+ POST（创建）
`src/app/api/tags/[tagId]/route.ts` — PATCH（更新）+ DELETE（删除）
`src/app/api/articles/[id]/tags/route.ts` — GET（文章标签列表）+ POST（批量添加）
`src/app/api/articles/[id]/tags/[tagId]/route.ts` — DELETE（移除单个标签）

所有 route 均参考 highlights API 的模式：`requireApiSession` 认证 → Zod 校验 → repository 操作 → `ok()`/`fail()` 返回。

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/server/domains/tags/ src/app/api/tags/ src/app/api/articles/[id]/tags/
git commit -m "feat(tags): add tag repository and API routes"
```

---

## Task Group F: 看板系统后端（依赖 Task 6）

### Task 9: 看板 Repository + API

**Files:**
- Create: `src/server/domains/boards/repositories/boardsRepo.ts`
- Create: `src/app/api/boards/route.ts`
- Create: `src/app/api/boards/[boardId]/route.ts`
- Create: `src/app/api/boards/[boardId]/items/route.ts`
- Create: `src/app/api/boards/[boardId]/items/[articleId]/route.ts`
- Modify: `src/types/index.ts` — 新增 Board 类型

- [ ] **Step 1: 在 src/types/index.ts 中新增类型**

```typescript
export interface Board {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  icon: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: 创建 boardsRepo.ts**

实现：
- `listBoards(pool, userId): Promise<Board[]>`
- `createBoard(pool, userId, title, description?, icon?): Promise<Board>`
- `updateBoard(pool, boardId, userId, updates): Promise<Board | null>`
- `deleteBoard(pool, boardId, userId): Promise<boolean>`
- `listBoardItems(pool, boardId, userId): Promise<{articleId, sortOrder, addedAt}[]>` — JOIN articles 获取文章信息
- `addArticleToBoard(pool, boardId, articleId, sortOrder): Promise<void>`
- `removeArticleFromBoard(pool, boardId, articleId): Promise<boolean>`

- [ ] **Step 3: 创建 API routes**

`src/app/api/boards/route.ts` — GET + POST
`src/app/api/boards/[boardId]/route.ts` — PATCH + DELETE
`src/app/api/boards/[boardId]/items/route.ts` — GET + POST
`src/app/api/boards/[boardId]/items/[articleId]/route.ts` — DELETE

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/server/domains/boards/ src/app/api/boards/
git commit -m "feat(boards): add board repository and API routes"
```

---

## Task Group G: 阅读页 AI 助手后端（无依赖）

### Task 10: 扩展知识库 ask API 支持 articleId

**Files:**
- Modify: `src/app/api/knowledge/ask/route.ts`

- [ ] **Step 1: 修改 ask route，支持 articleId 参数**

在 `POST` handler 中，解析 `articleId`：
```typescript
const { question, mode = 'personal_assistant', articleId } = await request.json();
```

当 `articleId` 存在时，跳过 hybridSearch，直接从数据库获取文章全文作为上下文：

```typescript
import { getArticleById } from '@/server/domains/articles/repositories/articlesRepo';

// 在构建 context 之前
let context: string;
if (articleId && typeof articleId === 'number') {
  const article = await getArticleById(getPool(), articleId);
  if (!article) {
    return Response.json(
      { ok: false, error: { code: 'not_found', message: '文章不存在' } },
      { status: 404 },
    );
  }
  context = `[来源: ${article.title}]\n${article.content || article.description || ''}`;
} else {
  // 原有 hybridSearch 逻辑
  const searchResults = await hybridSearch(question, 8);
  context = searchResults
    .map((r) => `[来源: ${r.title}]\n${r.chunkText}`)
    .join('\n\n---\n\n');
}
```

注意：需要确认 `articlesRepo` 中是否有 `getArticleById` 函数，如果没有则新增。

- [ ] **Step 2: Commit**

```bash
git add src/app/api/knowledge/ask/route.ts
git commit -m "feat(ai-assistant): extend knowledge ask API to support articleId context"
```

---

## Task Group H: 前端 — API 客户端扩展（依赖 D/E/F）

### Task 11: 在 apiClient.ts 中新增 API 方法

**Files:**
- Modify: `src/lib/api/apiClient.ts`

- [ ] **Step 1: 新增高亮 API 方法**

```typescript
// 追加到 apiClient.ts

// === Highlights API ===
export async function getArticleHighlights(articleId: number): Promise<Highlight[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/articles/${articleId}/highlights`);
  const json = await res.json();
  return json.ok ? json.data : [];
}

export async function createHighlight(articleId: number, params: {
  text: string;
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  color: HighlightColor;
  note?: string | null;
}): Promise<Highlight> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/articles/${articleId}/highlights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? '创建高亮失败');
  return json.data;
}

export async function updateHighlight(highlightId: string, updates: {
  color?: HighlightColor;
  note?: string | null;
}): Promise<Highlight> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/highlights/${highlightId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? '更新高亮失败');
  return json.data;
}

export async function deleteHighlight(highlightId: string): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/highlights/${highlightId}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: 新增标签 API 方法**

```typescript
// === Tags API ===
export async function getTags(): Promise<Tag[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/tags`);
  const json = await res.json();
  return json.ok ? json.data : [];
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? '创建标签失败');
  return json.data;
}

export async function deleteTag(tagId: string): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/tags/${tagId}`, { method: 'DELETE' });
}

export async function addTagsToArticle(articleId: number, tagIds: string[]): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/articles/${articleId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagIds }),
  });
}

export async function removeTagFromArticle(articleId: number, tagId: string): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/articles/${articleId}/tags/${tagId}`, { method: 'DELETE' });
}

export async function getArticleTags(articleId: number): Promise<Tag[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/articles/${articleId}/tags`);
  const json = await res.json();
  return json.ok ? json.data : [];
}
```

- [ ] **Step 3: 新增看板 API 方法**

```typescript
// === Boards API ===
export async function getBoards(): Promise<Board[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/boards`);
  const json = await res.json();
  return json.ok ? json.data : [];
}

export async function createBoard(title: string, description?: string, icon?: string): Promise<Board> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, icon }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? '创建看板失败');
  return json.data;
}

export async function deleteBoard(boardId: string): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/boards/${boardId}`, { method: 'DELETE' });
}

export async function getBoardItems(boardId: string): Promise<any[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/api/boards/${boardId}/items`);
  const json = await res.json();
  return json.ok ? json.data : [];
}

export async function addArticleToBoard(boardId: string, articleId: number): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/boards/${boardId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleId }),
  });
}

export async function removeArticleFromBoard(boardId: string, articleId: number): Promise<void> {
  await fetchWithAuth(`${API_BASE_URL}/api/boards/${boardId}/items/${articleId}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/apiClient.ts src/types/index.ts
git commit -m "feat(api): add highlights, tags, and boards API client methods"
```

---

## Task Group I: 高亮标注前端（依赖 Task 7, 11）

### Task 12: 高亮前端组件

**Files:**
- Create: `src/features/articles/highlights/utils/rangeSerializer.ts`
- Create: `src/features/articles/highlights/utils/rangeRestorer.ts`
- Create: `src/features/articles/highlights/hooks/useHighlightSelection.ts`
- Create: `src/features/articles/highlights/hooks/useHighlightStore.ts`
- Create: `src/features/articles/highlights/HighlightToolbar.tsx`
- Create: `src/features/articles/highlights/HighlightLayer.tsx`

- [ ] **Step 1: 创建 rangeSerializer.ts**

```typescript
// src/features/articles/highlights/utils/rangeSerializer.ts

/**
 * 将 Selection Range 序列化为可持久化的位置信息。
 * 使用 CSS selector + offset 方案。
 */
export interface SerializedRange {
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  text: string;
}

/**
 * 为 DOM 节点生成唯一的 CSS selector。
 * 向上遍历到带有 data-paragraph-id 的祖先元素。
 */
function buildSelector(node: Node, root: HTMLElement): string {
  let current: Node | null = node;
  const parts: string[] = [];

  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) break;

    // 如果当前元素有 data-paragraph-id，用它作为锚点
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (el.dataset.paragraphId) {
        return `[data-paragraph-id="${el.dataset.paragraphId}"]${parts.length > 0 ? ' > ' + parts.join(' > ') : ''}`;
      }
    }

    const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
    parts.unshift(`:nth-child(${index + 1})`);
    current = parent;
  }

  return parts.join(' > ');
}

export function serializeRange(range: Range, root: HTMLElement): SerializedRange | null {
  try {
    const startSelector = buildSelector(range.startContainer, root);
    const endSelector = buildSelector(range.endContainer, root);
    return {
      rangeStartSelector: startSelector,
      rangeStartOffset: range.startOffset,
      rangeEndSelector: endSelector,
      rangeEndOffset: range.endOffset,
      text: range.toString(),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: 创建 rangeRestorer.ts**

```typescript
// src/features/articles/highlights/utils/rangeRestorer.ts
import type { SerializedRange } from './rangeSerializer';

/**
 * 从序列化数据恢复 Range。
 */
export function restoreRange(
  serialized: SerializedRange,
  root: HTMLElement,
): Range | null {
  try {
    const startNode = findNode(root, serialized.rangeStartSelector, serialized.rangeStartOffset);
    const endNode = findNode(root, serialized.rangeEndSelector, serialized.rangeEndOffset);
    if (!startNode || !endNode) return null;

    const range = document.createRange();
    range.setStart(startNode.node, startNode.offset);
    range.setEnd(endNode.node, endNode.offset);
    return range;
  } catch {
    return null;
  }
}

function findNode(
  root: HTMLElement,
  selector: string,
  offset: number,
): { node: Node; offset: number } | null {
  // 解析 selector 找到目标元素
  const element = root.querySelector(selector);
  if (!element) return null;

  // 遍历到文本节点
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let node = walker.nextNode();

  while (node) {
    const textLength = node.textContent?.length ?? 0;
    if (currentOffset + textLength >= offset) {
      return { node, offset: offset - currentOffset };
    }
    currentOffset += textLength;
    node = walker.nextNode();
  }

  return null;
}
```

- [ ] **Step 3: 创建 useHighlightStore.ts**

```typescript
// src/features/articles/highlights/hooks/useHighlightStore.ts
import { create } from 'zustand';
import type { Highlight, HighlightColor } from '@/types';
import {
  getArticleHighlights,
  createHighlight,
  updateHighlight,
  deleteHighlight,
} from '@/lib/api/apiClient';

interface HighlightStore {
  highlights: Highlight[];
  loading: boolean;
  loadHighlights: (articleId: number) => Promise<void>;
  addHighlight: (articleId: number, params: {
    text: string;
    rangeStartSelector: string;
    rangeStartOffset: number;
    rangeEndSelector: string;
    rangeEndOffset: number;
    color: HighlightColor;
    note?: string | null;
  }) => Promise<Highlight | null>;
  editHighlight: (highlightId: string, updates: { color?: HighlightColor; note?: string | null }) => Promise<void>;
  removeHighlight: (highlightId: string) => Promise<void>;
}

export const useHighlightStore = create<HighlightStore>((set, get) => ({
  highlights: [],
  loading: false,

  loadHighlights: async (articleId: number) => {
    set({ loading: true });
    try {
      const highlights = await getArticleHighlights(articleId);
      set({ highlights, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addHighlight: async (articleId, params) => {
    try {
      const highlight = await createHighlight(articleId, params);
      set((state) => ({ highlights: [highlight, ...state.highlights] }));
      return highlight;
    } catch {
      return null;
    }
  },

  editHighlight: async (highlightId, updates) => {
    try {
      const updated = await updateHighlight(highlightId, updates);
      set((state) => ({
        highlights: state.highlights.map((h) => (h.id === highlightId ? updated : h)),
      }));
    } catch { /* ignore */ }
  },

  removeHighlight: async (highlightId) => {
    try {
      await deleteHighlight(highlightId);
      set((state) => ({
        highlights: state.highlights.filter((h) => h.id !== highlightId),
      }));
    } catch { /* ignore */ }
  },
}));
```

- [ ] **Step 4: 创建 HighlightToolbar.tsx**

选中文本时浮现的工具栏组件，包含 5 种颜色按钮和"添加笔记"按钮。使用 Radix Popover 定位。

- [ ] **Step 5: 创建 HighlightLayer.tsx**

负责在文章正文 DOM 上恢复高亮。监听 `highlights` 变化，用 `rangeRestorer` 恢复 Range，然后用 `<mark>` 包裹文本节点。

- [ ] **Step 6: Commit**

```bash
git add src/features/articles/highlights/
git commit -m "feat(highlights): add highlight toolbar, layer, and range serializer/restorer"
```

---

## Task Group J: 标签系统前端（依赖 Task 8, 11）

### Task 13: 标签前端组件

**Files:**
- Create: `src/features/articles/tags/ArticleTagSelector.tsx`
- Create: `src/features/articles/tags/hooks/useTagStore.ts`

- [ ] **Step 1: 创建 useTagStore.ts**

```typescript
// src/features/articles/tags/hooks/useTagStore.ts
import { create } from 'zustand';
import type { Tag } from '@/types';
import { getTags, createTag, deleteTag, getArticleTags, addTagsToArticle, removeTagFromArticle } from '@/lib/api/apiClient';

interface TagStore {
  tags: Tag[];
  articleTags: Tag[];
  loading: boolean;
  loadTags: () => Promise<void>;
  loadArticleTags: (articleId: number) => Promise<void>;
  addTag: (name: string, color?: string) => Promise<Tag | null>;
  removeTag: (tagId: string) => Promise<void>;
  attachTags: (articleId: number, tagIds: string[]) => Promise<void>;
  detachTag: (articleId: number, tagId: string) => Promise<void>;
}

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],
  articleTags: [],
  loading: false,

  loadTags: async () => {
    set({ loading: true });
    try {
      const tags = await getTags();
      set({ tags, loading: false });
    } catch { set({ loading: false }); }
  },

  loadArticleTags: async (articleId: number) => {
    try {
      const articleTags = await getArticleTags(articleId);
      set({ articleTags });
    } catch { /* ignore */ }
  },

  addTag: async (name, color) => {
    try {
      const tag = await createTag(name, color);
      set((state) => ({ tags: [...state.tags, tag] }));
      return tag;
    } catch { return null; }
  },

  removeTag: async (tagId) => {
    try {
      await deleteTag(tagId);
      set((state) => ({ tags: state.tags.filter((t) => t.id !== tagId) }));
    } catch { /* ignore */ }
  },

  attachTags: async (articleId, tagIds) => {
    try {
      await addTagsToArticle(articleId, tagIds);
      await get().loadArticleTags(articleId);
    } catch { /* ignore */ }
  },

  detachTag: async (articleId, tagId) => {
    try {
      await removeTagFromArticle(articleId, tagId);
      set((state) => ({ articleTags: state.articleTags.filter((t) => t.id !== tagId) }));
    } catch { /* ignore */ }
  },
}));
```

- [ ] **Step 2: 创建 ArticleTagSelector.tsx**

标签选择器弹窗组件，包含：
- 已有标签列表（带颜色圆点，可勾选/取消）
- 新建标签输入框
- AI 推荐标签区域（如果有 `article.aiSuggestedTags`）

- [ ] **Step 3: Commit**

```bash
git add src/features/articles/tags/
git commit -m "feat(tags): add tag selector component and store"
```

---

## Task Group K: 看板前端（依赖 Task 9, 11）

### Task 14: 看板前端组件

**Files:**
- Create: `src/features/boards/hooks/useBoardStore.ts`
- Create: `src/features/boards/components/BoardList.tsx`
- Create: `src/features/boards/components/AddToBoardDialog.tsx`

- [ ] **Step 1: 创建 useBoardStore.ts**

参考 tagStore 模式，实现 boards 状态管理。

- [ ] **Step 2: 创建 AddToBoardDialog.tsx**

弹窗展示用户看板列表，可勾选将当前文章加入/移出看板。

- [ ] **Step 3: 创建 BoardList.tsx**

左侧栏看板列表组件，展示用户看板，点击切换到看板视图。

- [ ] **Step 4: Commit**

```bash
git add src/features/boards/
git commit -m "feat(boards): add board list, add-to-board dialog, and store"
```

---

## Task Group L: 阅读页 AI 助手前端（依赖 Task 10）

### Task 15: AI 助手前端组件

**Files:**
- Create: `src/features/articles/ai-assistant/hooks/useArticleAiChat.ts`
- Create: `src/features/articles/ai-assistant/AiAssistantPanel.tsx`
- Create: `src/features/articles/ai-assistant/AiAssistantToggle.tsx`

- [ ] **Step 1: 创建 useArticleAiChat.ts**

管理对话历史、流式接收 SSE 响应。参考现有 `src/features/knowledge/hooks/useKnowledgeChat.ts` 的实现模式（如果存在），或 `src/features/articles/hooks/useStreamingAiSummary.ts` 的流式处理模式。

核心逻辑：
- `messages: { role: 'user' | 'assistant', content: string }[]`
- `sendMessage(question: string)`: POST `/api/knowledge/ask` with `{ question, articleId, mode }`，流式接收响应
- 对话历史按 articleId 存储在 localStorage

- [ ] **Step 2: 创建 AiAssistantPanel.tsx**

右侧 Drawer 面板，ChatGPT 风格对话界面：
- 对话消息列表
- 底部输入框
- 预设快捷问题按钮

- [ ] **Step 3: 创建 AiAssistantToggle.tsx**

悬浮按钮，点击展开/收起 AiAssistantPanel。

- [ ] **Step 4: Commit**

```bash
git add src/features/articles/ai-assistant/
git commit -m "feat(ai-assistant): add reading page AI assistant panel and toggle"
```

---

## Task Group M: 巨型文件拆分（依赖 I/J/K/L）

### Task 16: 拆分 ArticleView.tsx

**Files:**
- Modify: `src/features/articles/components/ArticleView.tsx` (1396 行 → 目标 <400 行)
- Create: `src/features/articles/components/ArticleHeader.tsx`
- Create: `src/features/articles/components/ArticleBody.tsx`
- Create: `src/features/articles/components/ArticleAiSummary.tsx`
- Create: `src/features/articles/components/ArticleTranslation.tsx`
- Create: `src/features/articles/components/ArticleFulltextFetch.tsx`
- Create: `src/features/articles/components/ArticleExport.tsx`
- Create: `src/features/articles/components/ArticleMedia.tsx`

- [ ] **Step 1: 阅读现有 ArticleView.tsx 的完整结构**

读取 `src/features/articles/components/ArticleView.tsx` 全文，识别可独立的功能块。

- [ ] **Step 2: 提取 ArticleHeader**

标题 + 元信息 + 工具栏（收藏、摘要、翻译、导出、标签、看板、AI助手按钮）。

- [ ] **Step 3: 提取 ArticleBody**

正文渲染逻辑（dangerouslySetInnerHTML + 搜索高亮）。

- [ ] **Step 4: 提取 ArticleAiSummary**

AI 摘要流式展示 + 动画文本。

- [ ] **Step 5: 提取 ArticleTranslation**

双语/沉浸式翻译切换 UI。

- [ ] **Step 6: 提取 ArticleFulltextFetch / ArticleExport / ArticleMedia**

- [ ] **Step 7: 重构 ArticleView.tsx 主容器**

仅负责数据加载 + 子组件编排，引入高亮层、标签选择器、看板弹窗、AI 助手。

- [ ] **Step 8: 验证行数**

Run: `wc -l src/features/articles/components/ArticleView.tsx`
Expected: < 400 行

- [ ] **Step 9: Commit**

```bash
git add src/features/articles/components/
git commit -m "refactor(article): split ArticleView into focused sub-components"
```

### Task 17: 拆分 FeedList.tsx

**Files:**
- Modify: `src/features/feeds/components/FeedList.tsx` (1146 行 → 目标 <400 行)
- Create: `src/features/feeds/components/FeedTree.tsx`
- Create: `src/features/feeds/components/FeedContextMenu.tsx`
- Create: `src/features/feeds/components/FeedDialogsHost.tsx`
- Create: `src/features/feeds/components/FeedListFooter.tsx`

- [ ] **Step 1: 阅读现有 FeedList.tsx 完整结构**

- [ ] **Step 2: 提取 FeedDialogsHost**

将 8 个 Dialog 的 state 和渲染集中到 `FeedDialogsHost`，通过 context 暴露 `openDialog(name, data)` 方法。

- [ ] **Step 3: 提取 FeedTree / FeedContextMenu / FeedListFooter**

- [ ] **Step 4: 重构 FeedList.tsx 主容器**

- [ ] **Step 5: 验证行数并 Commit**

```bash
git add src/features/feeds/components/
git commit -m "refactor(feeds): split FeedList into focused sub-components"
```

---

## Task Group N: 技术债清理（无依赖，可并行）

### Task 18: 清理死代码和未使用依赖

**Files:**
- Modify: `package.json` — 移除 `sharp`
- Delete: `src/data/mock/mockProvider.ts`
- Delete: `src/data/provider/readerDataProvider.ts`
- Modify: `src/types/index.ts` — 移除 `AppearanceSettings` 死类型

- [ ] **Step 1: 移除 sharp 依赖**

Run: `pnpm remove sharp`

- [ ] **Step 2: 删除死代码文件**

确认 `src/data/mock/mockProvider.ts` 和 `src/data/provider/readerDataProvider.ts` 仅被测试引用后，将它们移到 `src/test/fixtures/` 或删除。

- [ ] **Step 3: 移除 AppearanceSettings 死类型**

在 `src/types/index.ts` 中删除 `AppearanceSettings` interface 定义。

- [ ] **Step 4: 运行 type-check 确保无引用断裂**

Run: `pnpm type-check`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove unused sharp dep, dead code, and AppearanceSettings type"
```

### Task 19: 添加 CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 创建 CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.30.3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm type-check
      - run: pnpm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint + type-check + test workflow for PRs"
```

---

## 并行执行策略

以下 Task Groups 之间无依赖关系，可并行派发：

```
并行批次 1（无依赖）:
  ├── Group A: 安全修复 (Task 1-2)
  ├── Group B: i18n 基础设施 (Task 3)
  ├── Group C: 数据库迁移 (Task 4-6)
  ├── Group G: 阅读页AI助手后端 (Task 10)
  ├── Group N: 技术债清理 (Task 18-19)

并行批次 2（依赖批次 1 的迁移和 API）:
  ├── Group D: 高亮后端 (Task 7) — 依赖 Task 4
  ├── Group E: 标签后端 (Task 8) — 依赖 Task 5
  ├── Group F: 看板后端 (Task 9) — 依赖 Task 6

并行批次 3（依赖批次 2 的 API）:
  ├── Group H: API 客户端扩展 (Task 11) — 依赖 D/E/F
  ├── Group I: 高亮前端 (Task 12) — 依赖 Task 7, 11
  ├── Group J: 标签前端 (Task 13) — 依赖 Task 8, 11
  ├── Group K: 看板前端 (Task 14) — 依赖 Task 9, 11
  ├── Group L: AI助手前端 (Task 15) — 依赖 Task 10

并行批次 4（依赖批次 3 的前端组件）:
  ├── Group M: 巨型文件拆分 (Task 16-17) — 依赖 I/J/K/L
```

---

## 验收 Checklist

- [ ] `src/middleware.ts` 全局认证生效，未认证请求返回 401
- [ ] i18n 基础设施就绪，`useTranslation` 可用，默认中文
- [ ] `validateSettingsDraft.ts` 中无英文错误消息
- [ ] 文章阅读页可选中文本 → 弹出高亮工具栏 → 选择颜色 → 高亮持久化
- [ ] 文章可打标签，左侧栏可按标签筛选
- [ ] 可创建看板，可将文章加入看板，看板列表在左侧栏可见
- [ ] 阅读页右侧 AI 助手可展开，可对当前文章提问
- [ ] ArticleView.tsx < 400 行
- [ ] FeedList.tsx < 400 行
- [ ] `sharp` 依赖已移除
- [ ] CI workflow 存在且可运行
- [ ] `pnpm type-check` 无错误
- [ ] `pnpm test` 无失败

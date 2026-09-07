# P2f-A · 知识库问答进内核（pgvector 修复 + core 抽取 + 插件路由 + 存量回填）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「只在 Next.js 且实际跑不通」的知识库问答修真并迁进宿主无关内核：开发库 pgvector 修好、knowledge 抽到 `src/core/knowledge/`、插件宿主开 `/s/api/knowledge/search|ask`、存量文章向量回填。

**Architecture:** 现有 `src/server/integrations/knowledge/`（分块/向量化/RRF 混合检索，291 行）绑死全局 pool，且开发库缺 pgvector 扩展导致索引静默失败。抽取为 core 纯逻辑（pool/config 注入），server 侧留薄适配壳（Next.js 路由与 articlesRepo 钩子零改动），插件宿主按 api.ts 镜像惯例开两条路由；回填走插件调度器 tick 批量补索引，无 AI 配置时检索降级为纯全文。

**Tech Stack:** pgvector（ivfflat + GIN）/ OpenAI 兼容 embeddings（text-embedding-3-small，1536 维）/ vitest TDD / 插件调度器。

**范围收缩（对用户已确认方案的偏差，须在交付时报告）:** 原方案「H5 知识页改走 /s/api」不成立——H5 没有知识页，问答 UI 只在 Next.js 工作台。本阶段不改前端（KnowledgePage 维持 /api，K5 时随宿主退役统一切换）。

---

## 0. 环境事实

- 现有代码：`src/server/integrations/knowledge/{chunkingService,embeddingService,indexingService,searchService}.ts`；Next.js 路由 `src/app/api/knowledge/{ask,search}/route.ts`（ask 为 SSE 流）；`articlesRepo.ts:323` 落库时 `void indexArticle(...)`。
- `hybridSearch(question, limit)`：向量（`<=>` cosine）+ 全文（tsvector simple）+ RRF 合并；embedding 生成失败会直接抛错（无降级）。
- embedding 模型硬编码 `text-embedding-3-small`（1536 维 = 迁移 0041 的 `vector(1536)`）；配置走 `getAppSettings` + `getAiApiKey` + `resolveSharedAiConfig`。
- 迁移 0041 无插件镜像（`knowledge_embeddings` 表只在主体系）。
- 开发库：docker `feedfuse-db-1`（compose 服务名 `db`，image `postgres:16`，卷保留数据）。
- 插件路由镜像惯例：`src/plugin/host/api.ts` 的 ROUTES 表「与 src/app/api/ 对应路由的行为保持一致」；调度器接线参考 P3a 的 `commentIntel.tick`。
- 门禁基线：vitest 38 failed（存量 UI）/ type-check 6 errors（存量），不得新增。

## 1. 文件结构

| 动作 | 文件 | 职责 |
|---|---|---|
| 修改 | `docker-compose.yml` | db image → `pgvector/pgvector:pg16` |
| 新建 | `src/core/knowledge/chunking.ts` | 纯函数分块（原样平移） |
| 新建 | `src/core/knowledge/embedding.ts` | 向量化（config 注入，可测） |
| 新建 | `src/core/knowledge/indexer.ts` | indexArticle/deleteArticleIndex（db 注入） |
| 新建 | `src/core/knowledge/search.ts` | 混合检索 + **FTS-only 降级**（db 注入） |
| 新建 | `src/core/knowledge/backfill.ts` | 存量无向量文章批量补索引 |
| 删除 | `src/server/integrations/knowledge/*.ts`（4 文件） | 被 core 取代；目录留 `index.ts` 薄壳适配旧签名 |
| 新建 | `src/server/integrations/knowledge/index.ts` | 旧签名适配层（Next.js 路由/articlesRepo 零改动） |
| 修改 | `src/plugin/host/api.ts` | + `GET /knowledge/search`、`POST /knowledge/ask`（SSE） |
| 修改 | `src/plugin/host/jobs/scheduler.ts` | + `knowledge.backfill` tick（30m，批 20） |
| 测试 | `src/test/server/domains/knowledge/*.test.ts`、`src/test/plugin/knowledge.test.ts` | |

**删除安全（硬规则）:** Task 2 删除旧 4 文件前，确认旧实现已 `git commit`（在当前 HEAD 已提交，满足「先提交后删除」）；适配壳上线且新旧测试全绿后才删。

---

### Task 1 · 环境修复：开发库装 pgvector

- [ ] `docker-compose.yml` 的 `db.image` 改为 `pgvector/pgvector:pg16`（pg16 官方替代镜像，数据卷兼容，drop-in）
- [ ] `docker compose -f docker-compose.yml up -d db`（仅重建 db 容器）
- [ ] 验证：`docker exec feedfuse-db-1 psql -U feedfuse -d feedfuse -c "create extension if not exists vector; select extname from pg_extension where extname='vector';"`；再验证 0041 的 ivfflat 索引存在：`\di knowledge_embeddings_embedding_idx`
- [ ] 提交：`chore(db): P2f-A1 开发库镜像换 pgvector/pgvector:pg16，修复向量扩展缺失`

### Task 2 · core 抽取（TDD：先写 core 测试，RED→GREEN，再删旧文件）

- [ ] RED：`src/test/server/domains/knowledge/core.test.ts`
  - chunking：长文按段落/句子切块、带标题前缀、相邻重叠（从旧实现语义抄断言）
  - indexer：`indexArticle(db, ...)` 断言 SQL 形状（delete 旧 + insert chunks，参数化 db）
  - search：mock db 返回向量/全文两组行 → RRF 排序正确；`embeddingFn` 抛错时**降级 FTS-only 不抛错**
  - embedding：`generateEmbeddings(texts, config)` 调 OpenAI 兼容 client（注入 fake client），按 index 排序返回
- [ ] GREEN：按上表实现 4 个 core 文件；`search.ts` 签名：
  ```ts
  hybridSearch(db, question, limit, opts?: { embeddingFn?: (q: string) => Promise<number[]> })
  // embeddingFn 缺省用 embedding.ts 默认实现；抛错/无配置 → FTS-only，结果带 via: 'fts'
  ```
- [ ] server 适配壳 `src/server/integrations/knowledge/index.ts`：导出与旧签名完全一致的 `indexArticle(articleId, title, content)`、`deleteArticleIndex(id)`、`hybridSearch(question, limit)`、`chunkArticle`、`generateEmbedding(s)`（内部 getPool + 解析 config 后调 core）；Next.js 两路由与 articlesRepo **零改动**
- [ ] 删除旧 4 文件（删除安全：旧实现已在 HEAD 提交）
- [ ] 全绿 + 提交：`refactor(knowledge): P2f-A2 抽取 core/knowledge——db/config 注入 + FTS-only 降级，server 留薄壳`

### Task 3 · 插件宿主路由（TDD）

- [ ] RED：`src/test/plugin/knowledge.test.ts`（mock `@/core/knowledge/search` 与 openai client）
  - `GET /s/api/knowledge/search?q=` → `{ok:true,data:{items}}` 信封；空 q → items: []
  - `POST /s/api/knowledge/ask` `{question, mode}` → SSE：`data: {"content"...}` 增量 → `data: {"done":true,"sources":[...]}` → `data: [DONE]`；无 AI 配置 → 400 `未配置 AI`；articleId 直读全文路径
- [ ] GREEN：api.ts ROUTES 加两条，语义照抄 `src/app/api/knowledge/*`（三种 mode 的 SYSTEM_PROMPTS 一并平移到 core/knowledge 或 api.ts 内常量，与 Next.js 保持字面一致）；SSE 用 `res.writeHead(200, {'Content-Type':'text/event-stream'})`
- [ ] 提交：`feat(knowledge): P2f-A3 插件宿主 /s/api/knowledge/search|ask（SSE 对齐 Next.js 语义）`

### Task 4 · 存量回填（TDD + 调度接线）

- [ ] RED：`backfillKnowledge(db, {limit, embeddingFn})` → `{scanned, indexed, failed}`；SQL：`select a.id, a.title, coalesce(a.content_full_html, a.content_html, a.summary, '') from articles a left join knowledge_embeddings ke on ke.article_id = a.id where ke.id is null order by a.id limit $1`（distinct 天然成立——有任一 chunk 即不再选中）；单篇失败计数不打断
- [ ] GREEN 实现 + scheduler 接线：`every('knowledge.backfill', config.knowledgeBackfillIntervalMs ?? 30*60_000)`，批 20；AI 配置不完整时静默跳过（无成本）；日志 `knowledge.backfill: indexed=N remaining≈M`
- [ ] 提交：`feat(knowledge): P2f-A4 存量向量回填 tick——无向量文章批量补索引，无 AI 配置自动跳过`

### Task 5 · 全量验证 + 冒烟 + 勾账

- [ ] 门禁：vitest（failed ≤ 38 基线、新测试全绿）；type-check（= 6 存量）
- [ ] 冒烟：开发库跑 `indexArticle`（真 embedding，验证 pgvector 生效）→ `hybridSearch` 真查 → 插件路由 curl 一发；AI 未配 key 时验证 FTS 降级路径
- [ ] 勾账计划文件 + 交付自查（含 H5 偏差说明）+ 提交

## 5. 明确不做（YAGNI）

- 不动 KnowledgePage/apiClient（前端宿主切换属 K5）
- 不加插件镜像迁移（0041 表只在主体系，插件宿主共用同一库；待 K5 收口时再理）
- 不做 Markdown/Obsidian 导出（阶段 B，另行确认后开工）
- 不换 embedding 模型、不做多租户

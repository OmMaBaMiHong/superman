# feedfuse-workbench 方案（对齐原 FeedFuse 实现）

> 状态：**已确认当前落地方向（内置 SQLite）**；整体长期愿景仍对齐原 FeedFuse 项目
> （`/Users/wade/work-space/pa-chong-cai-ji/FeedFuse`），不做二次发明。
> 存储最终决策见下方横幅，本期按内置 SQLite 开发。

---

## 0. 已确认的方向

> **存储最终决策（本期拍板）：内置 SQLite。** Deepseek Harness 自带
> `@deepseek-ai/dsh-storage-sqlite`，无需用户再下载安装数据库。本期直接用内置
> SQLite，库文件路径做成插件设置项；PostgreSQL/pgvector 仅作后续可选扩展，本期不做。

| 决策点 | 结论 |
|---|---|
| 存储（当前落地） | **内置 SQLite**（`@deepseek-ai/dsh-storage-sqlite`，经 `ctx.storage` KV 接口），不使用 JSON |
| 存储（后续可选） | PostgreSQL + pgvector + pg-boss + 内嵌 RSSHub（本期不做，仅保留） |
| 抖音 | **全量**，含 douyin-cli（评论/互动/他人分析/推广任务） |
| 订阅源 CRUD | 全量（增/删/改/查 + 未读 + 去重） |
| 连接方式 | SQLite 库文件路径（设置项 `dbFilePath`，缺省随插件数据目录）；连接串仅后续 Postgres 时用 |
| RSSHub | **全量内嵌** vendor（路由全量可用） |
| 知识库/图 | pgvector（仅后续 Postgres 下可用）；SQLite 落地期不做，预留扩展位 |
| 迁移 | **启动幂等建表**；现有 JSON 数据首次启动迁入 SQLite |
| 设置菜单 | 非黑盒：FeedFuse 命名空间卡片，含库文件路径/抓取参数/工具路径/抖音配置 |
| douyin-cli 路径 | 可配置 `config.douyinCliPath`，缺省 `/Users/wade/.openclaw/douyin-cli` |

## 1. 插件定位与对齐原则

插件 = 原 FeedFuse **后端能力内嵌进 DSH** 的独立 bundle：
- 数据层、调度、源解析、抖音、视频全部复用原项目代码路径，按需拷贝进插件，不删能力、不降级。
- client 半（DSH UI）维持现状，HTTP 契约与现插件一致，仅替换数据来源（JSON → SQLite）。
- 本期插件用 Harness 内置 SQLite（`ctx.storage`/`dsh-storage-sqlite`），启动时幂等建表。

## 2. 存储与表结构（本期：内置 SQLite）

存储后端：`@deepseek-ai/dsh-storage-sqlite`（见 `packages/storage/storage-sqlite`），通过
`ctx.storage.backend` KV 接口（单元/表/记录）暴露。`dbFilePath` 缺省为插件数据目录下的
`feedfuse.sqlite`。RSS 侧单元描述符（对应原 categories/feeds/articles/recommended_feeds）：

- **单元名** `feedfuse`，**格式版本** `1`，**表** `categories` / `feeds` / `articles` / `recommended_feeds`
- 每张表存一行一条记录，`key` 为该行主键（如 feed id），`value` 为整行 JSON 对象。
- 长内容（article 正文/HTML）亦整行存 value，不做列级拆分；查询由现有内存快照层完成。
- 附带原始 schema（后续 Postgres 用，本期不建表）。

- `categories` / `feeds` / `articles`（含 `is_read`、`read_at`、`is_starred`、`dedupe_key`、`(feed_id,dedupe_key)` 唯一、AI 摘要字段）
- `feeds` 抓取字段：`fetch_interval_minutes`、`etag`、`last_modified`、`last_fetch_at`、`last_fetch_status`、`last_fetch_error`
- `feed_refresh_runs` + `feed_refresh_run_items`（刷新运行汇总与明细）
- `user_rsshub_cookies`（provider 唯一，cookie 用 secretBox 加密，只存 masked 快照）
- `douyin.*` schema（events/users/videos/comments/reply_corpus/campaigns/campaign_tasks/llm_usage/drafts）
- `knowledge_embeddings`（**pgvector** `vector(1536)` + ivfflat + GIN 全文索引）
- 其它：tags / highlights / boards / github / oauth_hub / video_materials / workspace_materials

## 3. 订阅源（RSS 基础能力）

- **存储/CRUD**：`feedsRepo` + `categoriesRepo` 全量，列表未读 = `count(is_read=false)`。
- **去重**：`articles(dedupe_key)`，同门源 + 跨平台去重按原 `articleDuplicateService`。
- **新增源解析**：`sourceResolver` 判断普通 RSS / `rsshub://` / 抖音主页；抖音提取 secUid → `rsshub://douyin/user/<uid>`。校验走原 `fetchFeedXml` + `/validate` 逻辑。
- **抓取**：`fetchFeedXml` / `parseFeed` / `sanitizeContent` / `ssrfGuard`，支持 etag/304。
- **调度**：`pg-boss`，`feed.fetch` 队列，`(userId,runId,feedId)` singleton 去重、重试、死信；`feed_refresh_runs` 落明细。

## 4. RSSHub（源解析与抖音直连的核心）

- 复用原 `vendor/rsshub` + `embeddedRssHubApp`，插件内嵌 build lib。
- `internalRssHubService` + `rssHubCookieInjector`：匹配 `/douyin/user` 等路由，注入 `x-feedfuse-cookie` 头。
- 范围：RSSHub 路由几乎全量可用（RSS / douyin / bilibili / weibo / 其它站点）。

## 5. 抖音（全量）

两条并存通路：
1. **轻量**：读 `rsshub://douyin/user/%` 订阅 → 从 `content_html` 解析作品统计（原 `myWorksService`）。cookie 来自 `user_rsshub_cookies`。
2. **全量（douyin-cli）**：插件 spawn `config.douyinCliPath`（缺省 `/Users/wade/.openclaw/douyin-cli`）的 `cli.js`，注入 `DATABASE_URL` + `DOUYIN_SCHEMA`，走 `douyin.videos/comments/campaigns` 等表。
   - 前置（用户侧操作，插件只做引导与状态探测）：
     a. 启动 douyin-cli 的 Bridge Server（`node server.js`，端口 19422）；
     b. 浏览器装油猴脚本并打开抖音保持登录。
   - 命令：`my` 我的作品 / `user` 他人分析 / `get --new` 增量评论 / `post --reply-to` 在线回复 / `campaign *` 推广任务。

## 6. 视频下载与文案

对齐原 `video/` + `workspace/` 服务：
- 下载 `yt-dlp`，抖音场景按 userId 生成临时 Netscape cookies.txt 注入，下载后清理（`video/douyinCookies.ts`）。
- 完成后归一化 H.264/MP4；产物登记 `video_materials` / `workspace_materials`。
- 文案/字幕：优先字幕，否则语音识别用 **`@whisper-cpp-node`**（原项目内嵌推理，不再走 whisper-cli 外部二进制）。产物与素材路径绑定。

## 7. 知识库 / 向量（pgvector，非独立图库）

- 复用 `knowledge/*`：chunking → embedding(`vector(1536)`) → ivfflat 检索 + GIN 全文。
- 模型来源：DSH 已有 LLM 配置（openai 兼容 / DeepSeek），对齐原 `runtimeConfig` 注入。
- 图节点需求：原项目用 pgvector 向量化，**无独立图库**。如后续要图关系，建议在 Postgres 内做（如 `pg_apacheage` 或递归 CTE + 实体/边表），本方案先按 pgvector 落库，字段预留 `entity/edge` 扩展位。

## 8. 插件配置（cordis.yml 覆盖项，与设置菜单同源）

本期以设置菜单为可视化入口，`config` 与之对应（缩略示意）：

```yaml
config:
  dbFilePath: 'feedfuse-data/feedfuse.sqlite'  # 内置 SQLite 库文件路径
  rsshubEnabled: true        # 是否内嵌 RSSHub 源解析
  rssUserAgent: 'FeedFuse/1.0'
  rssTimeoutMs: 10000
  fetchIntervalMinutes: 30
  douyinUid: ''              # 抖音 secUid（RSSHub /douyin/user 用）
  rsshubBase: 'https://rsshub.app'   # 抖音订阅走 RSSHub
  douyinFeedUrl: ''          # 或直接给抖音订阅地址（二选一）
  douyinCliPath: ''          # 缺省 /Users/wade/.openclaw/douyin-cli（后续全量）
  ytDlpPath: ''              # 缺省自动探测
  audioModelPath: ''         # whisper 模型路径
  dataDir: 'feedfuse-data'   # 素材文件/临时产物 + SQLite 库所在目录
```

## 9. 已识别的外部依赖（本期 SQLite 少到几乎为零）

| 依赖 | 来源 | 是否随插件分发 |
|---|---|---|
| SQLite | Harness 内置 `@deepseek-ai/dsh-storage-sqlite` | **内置，无需分发** |
| RSSHub vendor | 原项目 `vendor/rsshub` 拷贝 | **随插件**（体积较大） |
| yt-dlp / ffmpeg | 系统可执行/自动安装 | 外部探测 |
| whisper（@whisper-cpp-node） | npm 包（含 darwin-arm64 运行时） | **随插件** |
| douyin-cli + Bridge + 油猴 | `/Users/wade/.openclaw/douyin-cli`，独立外部工具 | 否，外部路径引用 |
| PostgreSQL + pgvector | 后续可选扩展；本期**不引入**，不阻塞 | 否，仅后续方案 |

## 10. 已确认问题（以下已定，作为开发依据）

1. **DB 来源（本期）**：内置 SQLite，库文件路径可配置（`dbFilePath`），无需用户装库。✅
2. **迁移策略**：启动幂等建单元/表；现有 `rss.json` 首次启动迁入 SQLite。✅
3. **RSSHub**：全量内嵌 vendor lib（构建产物较大，接受）。✅
4. **douyin-cli 路径**：做成 `config.douyinCliPath` 配置项，缺省 `/Users/wade/.openclaw/douyin-cli`（后续全量才有意义）。✅
5. **图库形态**：pgvector 仅后续 Postgres 下可用；SQLite 落地期不做，字段预留扩展位。✅
6. **设置菜单**：非黑盒，FeedFuse 命名空间卡片（库文件路径/抓取参数/工具路径/抖音配置）。✅

## 11. 建议的实施顺序（确认后按此推进）

1. 数据层：open SQLite 单元（feedfuse，表 categories/feeds/articles/recommended_feeds）+ 幂等建表 + JSON 迁移
2. RSS 订阅 CRUD + 抓取 + 刷新（先 2~3 直连源验证）
3. RSSHub 内嵌 + 源解析 + cookie 表
4. 抖音轻量（我的作品统计）
5. 抖音全量（douyin-cli 接入，后续）
6. 视频下载/文案（whisper-cpp-node）
7. （后续可选）Postgres + pgvector 向量化

> 每一步都按此文档执行；如需偏离（如放弃某个表或换逆向方案），必须先经你确认。

---

# 本期实施单元：RSS 订阅源「新增 + 发现」+ 内置 SQLite 存储 + 设置菜单

> 状态：**已确认（内置 SQLite）**。由用户本人在会话中拍板：新增+发现两处都做、用 Harness 内置
> SQLite（库文件路径做成可配置项，不需用户装库，不透黑盒）、建 FeedFuse 设置菜单（数据库为
> 首项，其余可配置项一并抽出）。

## A. 本期范围

1. **存储换内置 SQLite**：用 `@deepseek-ai/dsh-storage-sqlite`，经 `ctx.storage` KV 接口。库文件
   路径设为插件可配置项 `config.dbFilePath`（缺省 `feedfuse-data/feedfuse.sqlite`）。对外方法/字段
   契约不变，client 侧无需改动。
2. **订阅源新增 + 校验**：对齐原 FeedFuse 的 `POST /api/feeds` + `createFeedWithCategoryResolution`
   + 前端 `FeedDialog` 三段式（URL 输入 → 校验/resolve → 分类 → 确定）。
3. **发现订阅源**：对齐原 `GET /api/feeds/recommended`，读 `recommended_feeds` 数据（含种子），
   前端「发现」视图一键订阅。
4. **设置菜单（非黑盒）**：对齐 DSH 官方 `adding-a-settings-card` cookbook，Host 半
   `installSettingsSection` 注册 namespace + schemastery schema，Client 半 `settings.plugin.item`
   卡片。配置项清单见 D 节。
5. HTTP 契约与 client 半既有结构保持对齐；仅把数据层从 JSON 换成 SQLite。

## B. 数据层（内置 SQLite）

- open 单元 `feedfuse`（`KvUnitDescriptor`）：`name='feedfuse'`、`version=1`、`tables=['categories','feeds','articles','recommended_feeds']`、`hasGlobal=false`。
- 每张表 one row one record：`key` 为该行主键（如 feed id），`value` 为整行 JSON 对象；整单元快照在内存中建立索引，CRUD 后立刻 `putRecord`/`deleteRecord` 落盘。
- `rss-store.js` / `media-store.js` 的 `createStore` 内部数据来源替换为 SQLite 单元，**对外方法与字段契约不变**（`snapshot`/`article`/`refreshAll` 等），client 侧无需改动即可继续读取。
- 启动幂等：open 单元并写回快照；现有 `rss.json`/`media.json` 首次启动迁入 SQLite。

## C. HTTP 契约（RSS 订阅源部分）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/feedfuse/feeds` | 新增订阅源 `{title,url,siteUrl?,categoryId?,categoryName?}` → 写 feeds；重复 URL 返回 409 |
| GET | `/feedfuse/feeds/validate?url=` | 校验/resolve：抓取解析 RSS，返回 `{ok,title,siteUrl}`；失败返回可读错误 |
| GET | `/feedfuse/categories` | 分类列表（弹窗下拉用） |
| GET | `/feedfuse/recommended` | 发现页推荐源列表（读 `recommended_feeds`） |
| POST | `/feedfuse/feeds/<id>` | 编辑源（名称/分类） |
| DELETE | `/feedfuse/feeds/<id>` | 取消订阅（删 feed，级联删其文章；空分类可选清理） |

现有 `snapshot`/`article`/`refresh`/`myworks` 等端点不变。

## D. 设置 namespace（Host 半 schema，Client 半卡片）

```ts
const NS = settingsNamespace('feedfuse')
Config = z.object({
  // 存储
  dbFilePath: z.string().default('feedfuse-data/feedfuse.sqlite'), // 首项：内置 SQLite 库文件路径
  // RSS 抓取参数
  rssUserAgent: z.string().default('FeedFuse/1.0'),
  rssTimeoutMs: z.number().min(1000).default(10000),
  fetchIntervalMinutes: z.number().int().min(1).default(30),
  // 数据目录 / 资产
  dataDir: z.string().default('feedfuse-data'),
  autoInstallAssets: z.boolean().default(true),
  // 自媒体（抖音）配置
  douyinUid: z.string().optional(),          // secUid，经 RSSHub /douyin/user
  rsshubBase: z.string().default('https://rsshub.app'),
  douyinFeedUrl: z.string().optional(),      // 或直接给订阅地址（二选一）
  // 工具路径（可覆盖探测结果）
  ytDlpPath: z.string().optional(), ffmpegPath: z.string().optional(),
  ffprobePath: z.string().optional(), whisperPath: z.string().optional(),
  whisperModelUrl: z.string().optional(),
})
```
`validate`：`dbFilePath` 目录可写、RSS/抖音源地址在写入时校验；`onChange` 触发重建存储单元/来源。

## E. 阶段拆分（确认后逐段推进）

1. 数据层：open SQLite 单元 + 幂等建表 + `rss-store.js`/`media-store.js` 改读 SQLite + JSON 迁移。
2. 订阅源 CRUD 路由：`POST /feeds`、`validate`、`categories`、`recommended`、`PUT/DELETE feeds/<id>`。
3. client 半：RSS tab 顶部「+ 新增订阅源」入口 + FeedDialog 三段式弹窗；「发现订阅源」视图一键订阅。
4. 设置菜单：Host `installSettingsSection` + Client `settings.plugin.item` 卡片。
5. 校验：重启 3080 实测新增/发现/编辑/删除闭环，旧 JSON 数据可迁入 SQLite。

> 每阶段完成跑通后再进下一阶段；如需偏离本节（例如改用其它库、删掉某个可配置项、改契约），必须先经你确认。
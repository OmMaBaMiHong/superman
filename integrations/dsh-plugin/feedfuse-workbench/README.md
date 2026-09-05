# feedfuse-workbench

自包含 DSH bundle 插件：RSS 订阅 + 视频下载 + 文案提取 + 自媒体工作台。

安装进 DeepSeek Harness 后即可直接使用，**不依赖任何本地常驻服务，也不需要数据库**——所有数据落在插件私有 data 目录的本地 JSON 文件里，运行时缺失的工具会尝试自动安装。

## 特性

- **RSS 订阅**：任意 RSS/Atom 订阅源抓取、解析、本地存储；内置分类（短视频/自媒体/技术）。**平台博主源**：粘贴 `rsshub://douyin/user/<secUid>` 或抖音主页地址即订阅该博主，作品作为视频类条目进入同一条阅读链路（列表 → 详情 → 播放 → 提取文案）。
- **视频抓取与播放**：抖音博主作品由插件内建浏览器抓取（Node 驱动本机 Chrome 的 DevTools 协议拦截主页作品接口，不依赖 RSSHub 与任何外部服务）；播放走插件代理 `/feedfuse/video?id=`，服务端补浏览器 UA 与 Referer 并透传 Range。首次需点一次「登录抖音」扫码，登录态存在 `dataDir/douyin-profile` 里长期复用（也可改填 `douyinCookie`）。抖音 web 已不再对外返回播放量，界面在有值时才显示 ▶。
- **文案提取**：优先 yt-dlp 字幕，无字幕自动回退 Whisper 语音识别。抖音的字幕轨与音频轨都需要浏览器 Cookie —— 插件从已登录 profile 导出 Netscape cookies.txt 喂给 `yt-dlp --cookies`；Whisper 模型按「本地文件 → hf-mirror 镜像 → huggingface」顺序取用。
- **加工台**（侧栏第三个标签）：汇总所有订阅来的视频条目，按「待提取文案 / 待分析 / 高分 ≥70」筛选，单条或批量做 AI 语义分析（内容类型、话题标签、情绪、参考价值优先级、爆款潜力评分、钩子手法、改编角度），结果写回条目，一键送入聊天做二创。
- **视频下载**：yt-dlp 下载 → ffmpeg 归一化为 H.264 MP4 → 登记为本地素材。
- **Agent 工具 + 技能**：内置 `feedfuse_download_video` / `feedfuse_extract_transcript` / `feedfuse_refresh_myworks` / `feedfuse_refresh_feeds` 工具和「视频工作流」技能。

## PostgreSQL 知识库（可选）

配置 `databaseUrl` 后启用高级能力，数据从 SQLite 迁移到 **PostgreSQL + pgvector**：

- **策略分析引擎**：内置「变现逻辑分析」和「内容分类聚合」两个策略模板，对视频文案做结构化 AI 分析（变现方式、变现路径、CTA 设计、变现评分、内容分类、可改编形式等）。支持用户自定义策略模板。
- **定时任务**：每天自动执行 `fetch → transcribe → analyze → embed` 任务链，无需手动操作。
- **pgvector 语义搜索**：对文案切片生成向量嵌入，支持语义相似度检索和全文检索。
- **数据关联**：分析结果通过 `articleId` 关联原视频，支持按分类/标签/评分聚合查询。

### 配置方式

在 `cordis.yml` 的 plugin config 中添加：

```yaml
plugins:
  'feedfuse-workbench':
    config:
      databaseUrl: 'postgresql://user:pass@host:5432/dbname'
```

数据库需要：
- PostgreSQL 16+
- `pgvector` 扩展（`CREATE EXTENSION vector`）
- 首次启动自动建表 + 注册内置策略种子数据

### 新增 API 端点

| 端点 | 说明 |
| --- | --- |
| `GET /feedfuse/scheduler/status` | 调度器状态 + 任务列表 |
| `POST /feedfuse/scheduler/start` | 启动调度器 |
| `POST /feedfuse/scheduler/stop` | 停止调度器 |
| `POST /feedfuse/scheduler/run` | 手动触发任务 `{ job: 'fetch' }` |
| `GET /feedfuse/scheduler/runs` | 执行历史 |
| `GET /feedfuse/strategies` | 策略列表 |
| `POST /feedfuse/strategies/create` | 创建策略 |
| `POST /feedfuse/strategies/run` | 对文章执行策略 |
| `POST /feedfuse/analyze-new` | 触发分析（支持策略） |
| `GET /feedfuse/knowledge/search` | 知识库搜索 |
| `GET /feedfuse/knowledge/stats` | 知识库统计 |
| `GET /feedfuse/knowledge/articles` | 文章列表（支持筛选） |
| `GET /feedfuse/knowledge/analysis` | 文章分析结果 |

> 未配置 `databaseUrl` 时，插件继续使用 SQLite，原有功能不受影响。

## 侧边栏接管（纯插件，不改项目源码）

左栏由本插件的 client 半注册进 ui-layout 声明的官方 `'sidebar'` 插槽整体接管：外壳自带**工作区 / RSS订阅 / 自媒体**三个操作标签，几何与折叠动效沿用内置外壳。标签体依旧走席位派发，内置注册方照常填入：

| 席位 | occupant | 内容 |
| --- | --- | --- |
| `sidebar.workspaces` | `ui-workspace` | 内置工作区 / 会话浏览器（原样保留） |
| `sidebar.rss` | 本插件 | RSS 订阅：源列表（含抖音博主源）→ 文章/作品列表 → 详情播放 |
| `sidebar.zmt` | 本插件 | 加工台：订阅来的视频条目 + 文案提取 + AI 标签评分 |
| `sidebar.settings` | `ui-settings-general` | 底部设置席位（原样保留） |
| `sidebar.footer.action` | `ui-cordis` 等 | 底部叠加动作（list 席位，原样保留） |
| `sidebar.brand.mark` / `.name` | `ui-brand-official` | 品牌图形与文字（本地构建回落到通用文案） |

席位声明是独占的（一个席位只有一个声明者），因此 `cordis.patch.yml` 里带一行 `- id: ui-sidebar / disabled: true`：内置侧边栏外壳让位后，插件才能声明上面这些席位。**项目源码保持上游原样**，`packages/client/ui-sidebar` 无任何改动。

回退到内置侧边栏：删掉 `cordis.patch.yml` 里的 `ui-sidebar` disable 行（或改成 `disabled: false`），同时停用本插件——两个 occupant 同时声明同一批席位会在加载期报错，不会静默覆盖。

### 对话框与数据更新

标签体里的「添加 RSS 源」「发现订阅源」使用 `ui-primitives` 的官方 `Modal`：遮罩、不透明卡面、头部关闭按钮、Esc 与点击遮罩关闭都由它负责，并传送到 `document.body`。插件自绘的 `position: fixed` 浮层挂在侧栏列内会被列的 `overflow` 裁切、被折叠淡出的祖先改写定位，且拿不到可用的不透明表面（页面文字会透出到表单上），因此不在这里重造遮罩。

数据更新走两条路：进入 RSS 列表时按 `fetchIntervalMinutes` 增量重抓过期的源（从未抓过的源一律视为过期），以及标签体右上角的刷新图标按钮立即抓取——RSS 刷新全部源、当前源的文章列表只刷该源、自媒体强制重抓抖音作品与统计。刷新结果与「上次抓取 · 多久前」显示在工具条下方，抓取失败的源把状态点画成错误色并挂上失败原因。

## 自包含部署（上架插件市场的前提）

- **无外部服务**：host 半全部能力在 DSH 进程内实现（Node 内置 `fetch` + 系统可执行文件），不再代理任何本地端口（原 v0.1.0 依赖本地 FeedFuse 9559，已移除）。
- **无外部数据库**：订阅、文章、作品、素材都落在插件私有目录里的内置 SQLite 库（`dataDir/dbFilePath`，默认 `feedfuse-data/feedfuse.sqlite`，走 Node 自带 `node:sqlite`，不需要任何数据库服务）。库为空时会从历史 `rss.json` / `media.json` 自动迁移。
- **依赖自动安装**：下载/提取前自动探测 yt-dlp / ffmpeg / ffprobe / whisper-cli，缺失时经 `brew` / `pip3` / `apt` / `dnf` 自动安装；Whisper GGML 模型直接 HTTPS 拉取。可用 `config.autoInstallAssets: false` 关闭。
- **无死链**：UI 不再跳转 `localhost:5199/9559`，剪辑（未发布）与素材跳转统一改为「送入聊天」交给 agent 处理。

## 安装 & 配置

通过 DSH bundle 安装在插件（`cordis.patch.yml` 已声明 host 半，client 半由 `package.json` 的 `dsh.client` 注入）。

在用户级 `cordis.yml` 的 plugin `config` 下配置：

```yaml
plugins:
  feedfuse-workbench:
    config:
      dataDir: feedfuse-data          # 数据目录（相对启动目录），可改绝对路径
      autoInstallAssets: true         # 缺依赖时自动安装（默认 true）
      # —— RSS ——
      feeds:                          # 内置订阅源（缺省为空，界面会提示）
        - { title: '示例博客', url: 'https://example.com/feed.xml', categoryId: 3 }
      # —— 自媒体（抖音作品，插件内建浏览器抓取）——
      douyinUid: MS4wLjABAAAA...      # 裸 secUid / rsshub://douyin/user/<secUid> / 抖音主页地址 都认
      douyinSource: auto              # auto=内建浏览器优先 / browser=只用浏览器 / rsshub=只用 RSSHub 订阅
      douyinMaxWorks: 100             # 单次抓取的作品数上限
      # douyinCookie: 'ttwid=...; sessionid=...'   # 可选：粘贴浏览器 Cookie，替代扫码登录
      # chromePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome  # 可选：覆盖浏览器探测
      # —— 备用来源（可选）：自建 RSSHub 的 /douyin/user 订阅 ——
      # rsshubBase: https://rsshub.app
      # douyinFeedUrl: https://rsshub.app/douyin/user/你的secUid
      # —— 可选工具路径覆盖 ——
      # ytDlpPath: /opt/homebrew/bin/yt-dlp
      # ffmpegPath: /opt/homebrew/bin/ffmpeg
      # ffprobePath: /opt/homebrew/bin/ffprobe
      # whisperPath: /opt/homebrew/bin/whisper-cli
      # whisperModelUrl: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

> 抖音作品抓取默认走插件内建浏览器（Node 驱动本机 Chrome 的 DevTools 协议拦截主页作品接口），无需 RSSHub。RSSHub 的 `/douyin/user` 路由自己标注了 `requirePuppeteer + antiCrawler`，公共实例普遍拿不到数据，因此这里只把它留作可选备用来源；要用它就自建实例并填 `rsshubBase`。登录态失效时「自媒体」标签会重新出现「登录抖音」引导。

## HTTP 端点（host 半，供 client 与调试）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/feedfuse/status` | 自包含状态 + 二进制/模型探测结果 |
| GET | `/feedfuse/snapshot?view=all\|<feedId>&limit=` | RSS 分类/源/文章快照（进入时按 `fetchIntervalMinutes` 增量重抓过期源） |
| GET | `/feedfuse/article?id=` | 文章详情 |
| GET | `/feedfuse/myworks?force=1` | 自媒体「我的作品」（含统计；`force=1` 强制重抓；失败时带回 `reason` / `needLogin`） |
| GET | `/feedfuse/douyin/status` | 抖音取数来源诊断（secUid / 来源类型 / 浏览器路径 / profile / RSSHub 地址 / 是否配 Cookie） |
| POST | `/feedfuse/douyin/login` | 打开可见浏览器窗口扫码登录抖音（请求阻塞到登录完成或超时，登录态落在插件 profile） |
| GET | `/feedfuse/douyin/login-status` | 查询插件 profile 是否已有抖音登录态 |
| GET | `/feedfuse/materials` | 已下载的视频素材清单 |
| GET | `/feedfuse/overview` | 自媒体概览 |
| POST | `/feedfuse/download` `{url}` | 下载视频（返回文件流） |
| POST | `/feedfuse/transcript` `{url, articleId?}` | 提取视频文案（字幕优先、Whisper 回退；带 `articleId` 时写回条目） |
| POST | `/feedfuse/analyze` `{articleId? \| ids? \| all, limit?}` | AI 语义分析：内容类型、标签、情绪、优先级、爆款评分 |
| GET | `/feedfuse/workbench?limit=` | 加工台队列（视频类条目 + 文案/分析完成度） |
| GET | `/feedfuse/video?id=` | 播放代理：按条目现取直链，补 UA/Referer 并透传 Range |
| POST | `/feedfuse/refresh` `{feedId?}` | 刷新订阅（缺省并发抓全部源；带 `feedId` 只抓该源） |

GitHub / 知识库等端点（`repos`/`accounts`/`material`/`media`/`knowledge`）暂按自包含空集占位，后续版本补齐。

## 开发

```sh
# 目录结构
lib/index.js         host 半入口：路由、工具、技能
lib/rss-store.js     RSS 抓取/解析/存储
lib/video.js         视频下载/归一化/字幕/Whisper + 资产自动安装
lib/media-store.js   自媒体作品解析 + 素材登记
lib/douyin-browser.js 抖音内建浏览器抓取（Node 驱动本机 Chrome 的 CDP，零外部依赖）
lib/sqlite-store.js  RSS / 自媒体共用的 SQLite 存储层
lib/client.js        UI 半：侧边栏外壳（'sidebar' 席位 occupant + 三个操作标签）+ RSS / 自媒体标签体 + 配置卡片
```

改动非平凡的 PR 需附带本仓库规约要求的 Agent Note；模型/用户可见行为变更需补 keyless snapshot。
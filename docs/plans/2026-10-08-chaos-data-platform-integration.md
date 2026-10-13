# Superman ↔ Chaos 数据中台对接与迁移清单（2026-10-08）

> 依据：chaos-java README（中台目标声明）、hotspot-tracking-system
> `docs/project/chaos-consumer-onboarding-template-2026-10-03.md`（C 端统一接入设计，
> OpenSkoob 为接入范例）。本文回答两件事：**Superman 哪些能力迁中台**、**怎么对接**。

## 一、对接方式（照 OpenSkoob 范式，已落地代码）

OpenSkoob 的消费模式（`apps/web/src/lib/chaos.ts`）四条铁律，Superman 端等价复刻：

1. **产品身份**：Chaos 后台注册 ConsumerApp（Superman 已注册，slug=`superman`），
   产 API Key；Superman 侧凭 `Bearer <key>` 调 `/open/v1/*`。
2. **服务端代理**：浏览器/H5 永不直连中台；本端服务持 Key 读中台、投影给前端。
   已建 `src/server/integrations/chaos/client.ts`（防御式读：2.5s 超时、redirect:error、
   形状降级）+ 插件路由 `GET /s/api/chaos/{status,materials,channels,rankings}`。
3. **配置双通道**：env（`SUPERMAN_CHAOS_API_URL/API_KEY/PRODUCT_SLUG/DEFAULT_CHANNEL`）
   优先，回退 `service_config` 表（设置页可改，无需重启）。
4. **降级纪律**：中台未配置/不可用 → 接口返回 `{configured:false}`/`{status:'unavailable'}`，
   前端显示降级态；**绝不阻塞 Superman 本地功能**（OpenSkoob 同款 status 分支渲染）。

### 对接三步（中台侧动作，待环境可用后执行）

| 步骤 | 动作 | 依据 |
|---|---|---|
| ① Key 与权限 | Chaos 后台 → C端产品矩阵 → superman：确认 scope 含 `materials/channels/feed/rankings`，生成/轮换 API Key | 文档 §3 产品注册链路 |
| ② 频道绑定 | 给 superman 绑定频道 + 已发布 revision（首批建议：热榜 `/`、AI `/ai`） | `PUT /api/v1/admin/consumer-apps/:id/channel-policies` |
| ③ 灌配置 | Superman 设置页（service_config）填 `platform_api_url`(http://127.0.0.1:4010) + `consumer_api_key`；或写 `~/.dsh/.env` 的 `PLATFORM_API_URL/CONSUMER_API_KEY`（榜天下同名规范） | 本文档 §一.3 |

验收（照 OpenSkoob §0.7 口径）：`/s/api/chaos/status` 返回 `ready:true` 且延迟记录；
`/chaos/materials` 返回真实素材；中台杀掉后 Superman 面板显示降级态但其余功能正常。

## 二、迁移清单：哪些迁中台、哪些留本地

**原则（chaos-java README + 接入文档 §1）**：入中台的数据是共享资产；
Superman 是消费方+来源归因，不是独占方。迁移判据——**多产品要用的迁，单产品用的留**。

### 迁中台（共享数据资产）

| 能力 | 现状（FeedFuse 本地） | 中台对应 | 迁移动作 |
|---|---|---|---|
| 热榜聚合（TrendRadar 11 平台） | 本地抓取+本地表 | Chaos collector + 热榜频道 | Chaos 建热榜采集源（RSS/JSON 读取器），Superman 热点页改读 `/open/v1/materials?tag=热榜`；本地抓取保留为降级 |
| 全文/素材正文 | 本地 articles/content | SourceMaterial（bodyStatus 管道） | 已采集文章按来源归因提交 `/open/v1/ingest/items`（批处理，不阻塞阅读） |
| 订阅博主/作品 | 本地 feeds | CollectorChannel + 产品频道策略 | 博主列表登记为中台采集源；Superman 订阅管理转配额与授权视图 |
| 治理选题池 | 本地 governance | Chaos 治理模板/实体 | 转为选题的条目入中台实体/指标；Superman 选题池读开放投影 |

### 留本地（单产品/私有状态，不迁）

| 能力 | 留守理由 |
|---|---|
| 用户/会话/宿主身份直通 | 产品私有；OAuth 关联走 ConsumerApp.oauthClientId（后续） |
| 洗稿流水线/草稿/发布 | 创作产物是产品私有；素材来源可引用中台 entityId |
| 平台账号授权（抖音/小红书 cookie） | 凭据私有，永不出产品边界 |
| 中转站会员/订阅 | 商业边界独立（对齐 OpenSkoob"商业资料归独立产品"） |
| 看板读模型缓存 | 本地性能层，消费中台数据后照常工作 |

### 分阶段

- **P0（本次已落）**：客户端 + 代理路由 + 配置通道 + 降级纪律。
- **P1（中台环境可用后）**：Key/权限/绑定三步 → `/chaos/status` ready →
  热点页读中台素材（本地 TrendRadar 转降级备用）。
- **P2**：已采文章回灌 ingest（共享资产沉淀）；订阅博主登记中台源。
- **P3**：选题池接实体/榜单投影；OAuth 用户授权接通（现两端都未验）。

## 三、边界与红线（沿接入文档，勿越）

- 不在 C 端（Superman）重算名次/评分——排榜与推荐在中台；
- 不复制采集器、不加产品专属采集端点；缺字段登记公共缺口；
- 用户交互（点赞/评论）不接受产品 Key 身份（文档 §3 明确）；
- 中台 `existing-facts` 通用映射未启用前，不宣称任意字段映射完成。

## 四、Superman 产品接入策略（2026-10-08 已写，待中台环境执行）

脚本：`hotspot-tracking-system/.runtime/consumer-superman-config.mts`（对标 consumer-openskoob-config.mts，按实际 API 契约校正过：scope 字段=dataScopes；频道绑定不带 overrides）。

内容：
- scope（dataScopes）：channels / feed / rankings / materials / sources:read / sources:write（显式列出，不全量放行）
- 域名：DSH 宿主 19387 + 网页端 3000
- 频道：绑定共享热榜 `/`（未订阅用户推荐列表，共享策略不动）+ `/ai`；新建专属频道
  `/c/superman-materials`（Superman 创作素材：keywords AI/大模型/DeepSeek/创作、materialTags
  热榜/AI/科技/创作素材、hotMode=keywords、autoRegisterSources=true——P2 订阅源上平台后自动采集）
- 逻辑分层：未登录/未订阅 → 中台推荐 feed；订阅（Superman 自有注册/宿主授权登录）→ 数据进
  本地 PGlite；chaos OAuth 用户授权属 P3（两端现均未验，oauthClientId 留空）
- 验证：channels/feed/materials 真实读 + 无 Key 401 + ingest 422 + 延迟采样 →
  `.runtime/consumer-superman-verification.json`

## 五、对齐榜天下规范（2026-10-08 第二轮）

用户要求按规范接（榜天下是第一个 C 端产品，OpenSkoob 是下游小说产品）。差异与修正：

- **客户端重写为榜天下 platform() 网关同构**：单一网关三身份轴（open=产品 Key 读 /open/v1；
  token=Chaos 用户会话走 /api/v1 用户交互；consumer=产品 Key+用户 token 并用深读）、
  401 用户 GET 降匿名重放、12s 超时、PlatformError 中文可读异常——原先 2.5s OpenSkoob 式
  客户端废弃。
- env 命名对齐榜天下 `.env.example`：`PLATFORM_API_URL` / `CONSUMER_API_KEY`
  （service_config 同名小写键回退）。
- OpenSkoob 评价：它的 lib/chaos.ts 在其自身范围（materials/rankings 只读，无用户交互）
  是正确的，但**不是完整规范**——用户会话轴、/api/v1 深读、401 降匿名这些都是榜天下
  才有的。Superman 采纳榜天下全量形状（用户轴先留参数位，P3 接线）。
- `.runtime` 说明：是中台仓的 gitignored 运行时暂存目录（一次性配置/联调脚本 + Key
  文件 0600），不是产品接入物——真正的接入=中台 DB 的 ConsumerApp 行 + 消费方自己的
  .env + 服务端客户端代码。榜天下没有 .runtime 脚本，它的 Key 直接在自己的 .env。

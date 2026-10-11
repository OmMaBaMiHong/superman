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
| ③ 灌配置 | Superman 设置页（service_config）填 `chaos_api_url`(http://127.0.0.1:4010) + Key；或写 `~/.dsh/.env` 的 `SUPERMAN_CHAOS_API_URL/API_KEY` | 本文档 §一.3 |

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

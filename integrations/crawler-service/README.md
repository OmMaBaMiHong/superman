# Superman 独立爬虫服务（crawler-service）

## 定位

对内服务 Superman 的爬虫微服务。把「各平台作品数据 / 评论抓取」从主应用剥离成独立部署单元：

- **对内**：Superman core 经 `core/crawlerClient.ts` 调用（`CRAWLER_SERVICE_URL`，默认 `http://127.0.0.1:5510`）
- **对外预留**：provider 注册表 + caller 鉴权 + 限流 + TTL 缓存 + 统一信封，架构上可对齐 TikHub 做成多租户数据平台（加 caller 配额/计费即可）

## 运行

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
TIKHUB_API_KEY=... CRAWLER_SERVICE_KEY=... \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 5510
```

环境变量：

| 变量 | 说明 |
|---|---|
| `TIKHUB_API_KEY` | TikHub Bearer（douyin/xhs 数据走它；只从 env 读，永不入日志/响应） |
| `TIKHUB_BASE` | 默认 `https://api.tikhub.io`（大陆服务器可改 `https://api.tikhub.dev`） |
| `CRAWLER_SERVICE_KEY` | 调用方鉴权（`X-Caller-Key` 头）；未配置则全放行（本机开发零配置） |

## 端点（v1）

| 端点 | 说明 |
|---|---|
| `GET /v1/health` | 探活（免鉴权）：版本/uptime/已接入 provider |
| `GET /v1/providers` | provider 清单（含未接入的注册位 mediacrawler/selfsign） |
| `GET /v1/comments?platform=&post_id=&max=` | 归一评论：`{cid, text, user, likes, time, reply_count, platform, post_id, ip_location?}` |
| `GET /v1/post-stats?platform=&post_id=` | 归一数据：`{views, likes, comments, shares, favorites, coins, platform, post_id}` |

统一信封：成功 `{code: 0, data, provider}`；失败 `{code: <http status>, error}`。

## Provider 机制

- `app/providers/base.py`：`BaseProvider` 协议（`platforms` + `fetch_comments` + `fetch_post_stats`）+ 注册表 + 全局限流（~7QPS，借鉴参考实现）+ 进程内 TTL 缓存
- 平台路由：`provider_for(platform)` 按 `platforms` 匹配首个启用的 provider
- 已接入：`tikhub`（douyin/xhs，经 api.tikhub.io）、`bilibili_direct`（B站公开 API 直连，自 Superman core 下沉）
- 注册位：`mediacrawler`、`selfsign`（`enabled=False`，架构口子）

## 加一个新 provider

1. `app/providers/<name>.py` 实现 `BaseProvider`（声明 `name`/`platforms`，实现两个 fetch 方法；限流用 `self._limiter.wait()`，缓存用 `self._cache`）
2. `app/providers/__init__.py` 里 `register_provider(...)` 一行
3. 完成。端点自动生效（平台路由按 `platforms` 匹配）

## 平台化路线（未来）

- caller 维度配额：中间件已有 caller 识别点（X-Caller-Key），加 per-caller 限流/计数即可多租户
- 缓存外移：进程内 TTL → Redis（接口不变）
- 新增数据源：mediacrawler（本地浏览器签名）/ 自研签名注册位已留

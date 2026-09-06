"""Superman 独立爬虫服务（P3a）· FastAPI 入口。

定位：对内服务 Superman 的爬虫微服务，provider 注册表模式，
架构上预留「对标 TikHub 做数据平台」的口子（caller 鉴权 / 限流 / 缓存 / 统一信封）。

端点（v1）：
  GET /v1/health      健康检查（含已接入 provider）
  GET /v1/providers   provider 清单（含未接入的注册位）
  GET /v1/comments    ?platform=&post_id=&max=  归一评论
  GET /v1/post-stats  ?platform=&post_id=       归一作品数据

鉴权：配置 CRAWLER_SERVICE_KEY 后，除 /v1/health 外全部要求 X-Caller-Key 头。
统一信封：{code: 0, data, provider}；错误 {code: <http status>, error}。
"""
import os
import time

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

from app.providers import list_providers, provider_for
from app.providers.base import ProviderError

SERVICE_VERSION = "0.1.0"

app = FastAPI(title="superman-crawler-service", version=SERVICE_VERSION, docs_url=None, redoc_url=None)
_STARTED_AT = time.time()


def _caller_key() -> str:
    return os.environ.get("CRAWLER_SERVICE_KEY", "").strip()


@app.middleware("http")
async def caller_key_guard(request: Request, call_next):
    """X-Caller-Key 校验（health 放行便于探活；未配置 key 时全放行——本机开发零配置）。"""
    expected = _caller_key()
    if expected and request.url.path != "/v1/health":
        provided = request.headers.get("x-caller-key", "")
        if provided != expected:
            return JSONResponse(status_code=401, content={"code": 401, "error": "missing or invalid X-Caller-Key"})
    return await call_next(request)


def _ok(data, provider: str | None = None):
    return {"code": 0, "data": data, "provider": provider}


def _err(status: int, message: str):
    return JSONResponse(status_code=status, content={"code": status, "error": message})


@app.get("/v1/health")
def health():
    return _ok({
        "status": "ok",
        "version": SERVICE_VERSION,
        "uptimeSeconds": int(time.time() - _STARTED_AT),
        "providers": [p["name"] for p in list_providers() if p["enabled"]],
        "callerKeyConfigured": bool(_caller_key()),
    })


@app.get("/v1/providers")
def providers():
    return _ok({"providers": list_providers()})


@app.get("/v1/comments")
def comments(
    platform: str = Query(..., min_length=1),
    post_id: str = Query(..., min_length=1),
    max: int = Query(20, ge=1, le=100),
):
    provider = provider_for(platform)
    if not provider:
        return _err(400, f"平台未接入: {platform}")
    try:
        result = provider.fetch_comments(platform, post_id, max)
    except ProviderError as e:
        return _err(502, str(e))
    except Exception:
        return _err(502, "评论抓取失败")
    return _ok(result, provider=provider.name)


@app.get("/v1/post-stats")
def post_stats(platform: str = Query(..., min_length=1), post_id: str = Query(..., min_length=1)):
    provider = provider_for(platform)
    if not provider:
        return _err(400, f"平台未接入: {platform}")
    try:
        result = provider.fetch_post_stats(platform, post_id)
    except ProviderError as e:
        return _err(502, str(e))
    except Exception:
        return _err(502, "作品数据抓取失败")
    return _ok(result, provider=provider.name)

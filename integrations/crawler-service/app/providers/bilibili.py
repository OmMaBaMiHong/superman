"""B站直连 provider：公开 API 下沉（原 Superman core 内的实现，统一进服务）。

  详情/统计  GET https://api.bilibili.com/x/web-interface/view?bvid=
  评论      GET https://api.bilibili.com/x/v2/reply?type=1&oid=<aid>&sort=2（热度排序）
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from app.normalize import normalize_comment, normalize_stats
from app.providers.base import BaseProvider, ProviderError

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

_BVID_PATTERN = re.compile(r"BV[0-9A-Za-z]{10}")


def extract_bvid(value: str) -> str | None:
    m = _BVID_PATTERN.search(value)
    return m.group(0) if m else None


class BilibiliDirectProvider(BaseProvider):
    name = "bilibili_direct"
    platforms = ("bilibili",)

    def _call(self, url: str, timeout: int = 15) -> dict:
        self._limiter.wait()
        req = urllib.request.Request(url, headers={"User-Agent": UA}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise ProviderError(f"B站 API HTTP {e.code}") from e
        except Exception as e:
            raise ProviderError("B站 API 请求失败") from e

    def fetch_post_stats(self, platform: str, post_id: str) -> dict:
        bvid = extract_bvid(post_id)
        if not bvid:
            raise ProviderError("无法从 URL 解析 BV 号")
        cache_key = f"stats:bilibili:{bvid}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached
        payload = self._call(
            f"https://api.bilibili.com/x/web-interface/view?bvid={urllib.parse.quote(bvid)}"
        )
        if payload.get("code") != 0 or not (payload.get("data") or {}).get("stat"):
            raise ProviderError(f"B站 API 返回错误：{payload.get('message', 'unknown')}")
        stat = payload["data"]["stat"]
        result = normalize_stats(
            views=stat.get("view"),
            likes=stat.get("like"),
            comments=stat.get("reply"),
            shares=stat.get("share"),
            favorites=stat.get("favorite"),
            coins=stat.get("coin"),
            platform="bilibili",
            post_id=bvid,
        )
        result["title"] = (payload.get("data") or {}).get("title") or None
        self._cache.set(cache_key, result, 3600)
        return result

    def fetch_comments(self, platform: str, post_id: str, max_count: int) -> dict:
        bvid = extract_bvid(post_id)
        if not bvid:
            raise ProviderError("无法从 URL 解析 BV 号")
        # reply 接口要 aid，先从 view 拿
        view = self._call(
            f"https://api.bilibili.com/x/web-interface/view?bvid={urllib.parse.quote(bvid)}"
        )
        aid = (view.get("data") or {}).get("aid")
        if not aid:
            raise ProviderError("B站作品详情为空")
        payload = self._call(
            "https://api.bilibili.com/x/v2/reply?"
            + urllib.parse.urlencode({"type": 1, "oid": aid, "sort": 2, "ps": min(20, max_count)})
        )
        if payload.get("code") != 0:
            raise ProviderError(f"B站评论接口错误：{payload.get('message', 'unknown')}")
        items = []
        for c in (((payload.get("data") or {}).get("replies")) or []):
            member = c.get("member") or {}
            items.append(normalize_comment(
                cid=c.get("rpid"),
                text=(c.get("content") or {}).get("message"),
                user=member.get("uname"),
                likes=c.get("like"),
                time_value=c.get("ctime"),
                reply_count=c.get("rcount"),
                platform="bilibili",
                post_id=bvid,
                ip_location=(c.get("reply_control") or {}).get("location"),
            ))
        return {"items": items[:max_count], "total": ((payload.get("data") or {}).get("page") or {}).get("count")}

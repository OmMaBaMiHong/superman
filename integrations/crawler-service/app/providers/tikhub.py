"""TikHub provider：douyin/xiaohongshu 经 api.tikhub.io（首个 provider）。

端点路径来自 huangque tikhub.py 的 2026-06 live 实测（用户自有项目）：
  抖音详情  GET /api/v1/douyin/web/fetch_one_video?aweme_id=
  抖音评论  GET /api/v1/douyin/web/fetch_video_comments?aweme_id=&cursor=&count=
  小红书评论 GET /api/v1/xiaohongshu/app_v2/get_note_comments?note_id=
  小红书详情 GET /api/v1/xiaohongshu/app_v2/get_video_note_detail?note_id=（视频笔记）
             GET /api/v1/xiaohongshu/app_v2/get_image_note_detail?note_id=（图文笔记）

key 纪律：TIKHUB_API_KEY 只从 env 读、只进 Authorization 头，
永不写日志/返回值/异常消息。
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from app.normalize import normalize_comment, normalize_stats
from app.providers.base import BaseProvider, ProviderError

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

DY = "/api/v1/douyin"
XHS = "/api/v1/xiaohongshu/app_v2"

# 评论/详情缓存 TTL（秒）：详情发布即固定缓存久一些，评论短存。
_DETAIL_TTL = 3600
_COMMENTS_TTL = 300


def _env_key() -> str:
    return os.environ.get("TIKHUB_API_KEY", "").strip()


def _env_base() -> str:
    return os.environ.get("TIKHUB_BASE", "https://api.tikhub.io").rstrip("/")


def extract_douyin_aweme_id(value: str) -> str | None:
    """从 aweme_id 或抖音链接提取作品 id。"""
    value = value.strip()
    if value.isdigit():
        return value
    m = re.search(r"/(?:video|note)/(\d{6,25})", value)
    return m.group(1) if m else None


def extract_xhs_note_id(value: str) -> str | None:
    """从 note_id 或小红书链接提取笔记 id（24 位 hex）。"""
    value = value.strip()
    if re.fullmatch(r"[0-9a-fA-F]{24}", value):
        return value
    m = re.search(r"/(?:explore|discovery/item)/([0-9a-fA-F]{24})", value)
    return m.group(1) if m else None


class TikhubProvider(BaseProvider):
    name = "tikhub"
    platforms = ("douyin", "xhs")

    def _call(self, path: str, query: dict | None = None, timeout: int = 30) -> dict:
        key = _env_key()
        if not key:
            raise ProviderError("TIKHUB_API_KEY 未配置")
        self._limiter.wait()
        url = _env_base() + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {key}", "User-Agent": UA},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise ProviderError(f"TikHub HTTP {e.code}: {path.rsplit('/', 1)[-1]}") from e
        except Exception as e:  # 网络层错误（不含 URL/key）
            raise ProviderError(f"TikHub 请求失败: {path.rsplit('/', 1)[-1]}") from e
        if not isinstance(payload, dict):
            raise ProviderError(f"TikHub 响应异常: {path.rsplit('/', 1)[-1]}")
        return payload.get("data") or {}

    # ---------- 评论 ----------

    def fetch_comments(self, platform: str, post_id: str, max_count: int) -> dict:
        if platform == "douyin":
            return self._dy_comments(post_id, max_count)
        if platform == "xhs":
            return self._xhs_comments(post_id, max_count)
        raise ProviderError(f"tikhub 不支持的平台: {platform}")

    def _dy_comments(self, value: str, max_count: int) -> dict:
        aweme_id = extract_douyin_aweme_id(value)
        if not aweme_id:
            raise ProviderError("无法解析抖音作品 id")
        cache_key = f"comments:douyin:{aweme_id}:{max_count}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        items: list[dict] = []
        cursor = 0
        total = None
        while len(items) < max_count:
            count = min(20, max_count - len(items))
            d = self._call(f"{DY}/web/fetch_video_comments",
                           {"aweme_id": aweme_id, "cursor": cursor, "count": count})
            for c in (d.get("comments") or []):
                u = c.get("user") or {}
                items.append(normalize_comment(
                    cid=c.get("cid"),
                    text=c.get("text"),
                    user=u.get("nickname"),
                    likes=c.get("digg_count"),
                    time_value=c.get("create_time"),
                    reply_count=c.get("reply_comment_total"),
                    platform="douyin",
                    post_id=aweme_id,
                    ip_location=c.get("ip_label"),
                ))
            total = d.get("total", total)
            if not d.get("has_more") or not (d.get("comments") or []):
                break
            cursor = d.get("cursor") or (cursor + count)

        result = {"items": items[:max_count], "total": total}
        self._cache.set(cache_key, result, _COMMENTS_TTL)
        return result

    def _xhs_comments(self, value: str, max_count: int) -> dict:
        note_id = extract_xhs_note_id(value)
        if not note_id:
            raise ProviderError("无法解析小红书笔记 id")
        cache_key = f"comments:xhs:{note_id}:{max_count}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        d = self._call(f"{XHS}/get_note_comments", {"note_id": note_id})
        data = d.get("data") or {}
        items = []
        for c in (data.get("comments") or []):
            u = c.get("user") or {}
            items.append(normalize_comment(
                cid=c.get("id"),
                text=c.get("content"),
                user=u.get("nickname"),
                likes=c.get("like_count"),
                time_value=c.get("time"),
                reply_count=c.get("sub_comment_count"),
                platform="xhs",
                post_id=note_id,
                ip_location=c.get("ip_location"),
            ))
        result = {"items": items[:max_count], "total": data.get("comment_count")}
        self._cache.set(cache_key, result, _COMMENTS_TTL)
        return result

    # ---------- 作品数据 ----------

    def fetch_post_stats(self, platform: str, post_id: str) -> dict:
        if platform == "douyin":
            return self._dy_stats(post_id)
        if platform == "xhs":
            return self._xhs_stats(post_id)
        raise ProviderError(f"tikhub 不支持的平台: {platform}")

    def _dy_stats(self, value: str) -> dict:
        aweme_id = extract_douyin_aweme_id(value)
        if not aweme_id:
            raise ProviderError("无法解析抖音作品 id")
        cache_key = f"stats:douyin:{aweme_id}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        detail = {}
        last_err: ProviderError | None = None
        for attempt in range(3):  # 偶发返回空/瞬时 400，带间隔重试（真调实测 400 重试即恢复）
            if attempt:
                import time as _time
                _time.sleep(0.5)
            try:
                detail = (self._call(f"{DY}/web/fetch_one_video", {"aweme_id": aweme_id}) or {}).get("aweme_detail") or {}
            except ProviderError as e:
                if any(f"HTTP {c}" in str(e) for c in (400, 408, 429)) or "HTTP 5" in str(e):
                    last_err = e
                    continue
                raise
            if detail:
                last_err = None
                break
        if not detail:
            raise last_err or ProviderError("抖音作品详情为空")
        stat = detail.get("statistics") or {}
        result = normalize_stats(
            views=stat.get("play_count"),
            likes=stat.get("digg_count"),
            comments=stat.get("comment_count"),
            shares=stat.get("share_count"),
            favorites=stat.get("collect_count"),
            coins=None,
            platform="douyin",
            post_id=aweme_id,
        )
        result["title"] = detail.get("title") or detail.get("desc") or None
        self._cache.set(cache_key, result, _DETAIL_TTL)
        return result

    def _xhs_stats(self, value: str) -> dict:
        note_id = extract_xhs_note_id(value)
        if not note_id:
            raise ProviderError("无法解析小红书笔记 id")
        cache_key = f"stats:xhs:{note_id}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        # 先试视频笔记，再试图文笔记
        note = {}
        root = (self._call(f"{XHS}/get_video_note_detail", {"note_id": note_id}) or {}).get("data") or []
        note = root[0] if root else {}
        if not note:
            root = (self._call(f"{XHS}/get_image_note_detail", {"note_id": note_id}) or {}).get("data") or []
            note = ((root[0] if root else {}).get("note_list") or [{}])[0]
        if not note:
            raise ProviderError("小红书笔记详情为空")
        interact = note.get("interact_info") or {}
        result = normalize_stats(
            views=None,  # 小红书不公开播放量
            likes=_safe_int(interact.get("liked_count")),
            comments=_safe_int(interact.get("comment_count")),
            shares=_safe_int(interact.get("share_count")),
            favorites=_safe_int(interact.get("collected_count")),
            coins=None,
            platform="xhs",
            post_id=note_id,
        )
        result["title"] = note.get("title") or note.get("desc") or None
        self._cache.set(cache_key, result, _DETAIL_TTL)
        return result


def _safe_int(value) -> int | None:
    try:
        if isinstance(value, str) and value.endswith("万"):
            return int(float(value[:-1]) * 10000)
        return int(value)
    except (TypeError, ValueError):
        return None

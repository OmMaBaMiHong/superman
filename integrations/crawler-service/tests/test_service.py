"""爬虫服务单测（pytest）：provider 注册/限流/信封/归一字段（TikHub HTTP 全部 mock）。"""
import json
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.providers.base import ProviderError
from app.providers.bilibili import BilibiliDirectProvider, extract_bvid
from app.providers.tikhub import (
    TikhubProvider,
    extract_douyin_aweme_id,
    extract_xhs_note_id,
)
from app.ratelimit import RateLimiter, TtlCache


def fake_urlopen(payload, status=200):
    class _Resp:
        def read(self):
            return json.dumps(payload).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    if status >= 400:
        import urllib.error
        raise urllib.error.HTTPError("http://x", status, "err", None, None)
    return _Resp()


class TestIdExtraction(unittest.TestCase):
    def test_aweme_id(self):
        assert extract_douyin_aweme_id("7123456789") == "7123456789"
        assert extract_douyin_aweme_id("https://www.douyin.com/video/7123456789") == "7123456789"
        assert extract_douyin_aweme_id("https://v.douyin.com/abc/") is None

    def test_xhs_note_id(self):
        nid = "65f0a1b2000000001a00bcde"
        assert extract_xhs_note_id(nid) == nid
        assert extract_xhs_note_id(f"https://www.xiaohongshu.com/explore/{nid}?xsec_token=xx") == nid
        assert extract_xhs_note_id("douyin-video://x") is None

    def test_bvid(self):
        assert extract_bvid("https://www.bilibili.com/video/BV1xx411c7mD?p=1") == "BV1xx411c7mD"
        assert extract_bvid("av170001") is None


class TestRateLimitAndCache(unittest.TestCase):
    def test_rate_limiter_gap(self):
        limiter = RateLimiter(min_gap=0.05)
        t0 = time.time()
        for _ in range(3):
            limiter.wait()
        assert time.time() - t0 >= 0.1

    def test_ttl_cache(self):
        cache = TtlCache()
        cache.set("k", {"v": 1}, ttl_seconds=60)
        assert cache.get("k") == {"v": 1}
        cache.set("k2", 1, ttl_seconds=-1)
        assert cache.get("k2") is None


def make_tikhub():
    return TikhubProvider(RateLimiter(0), TtlCache())


class TestTikhubProvider(unittest.TestCase):
    def test_dy_comments_normalize(self):
        provider = make_tikhub()
        payload = {
            "data": {
                "comments": [{
                    "cid": "c1", "text": "这个怎么做的？", "digg_count": 42,
                    "create_time": 1730000000, "reply_comment_total": 3,
                    "ip_label": "上海", "user": {"nickname": "观众甲"},
                }],
                "has_more": 0, "total": 1,
            }
        }
        with mock.patch("urllib.request.urlopen", return_value=fake_urlopen(payload)):
            os.environ["TIKHUB_API_KEY"] = "test-key"
            result = provider.fetch_comments("douyin", "7123456789", 20)
        item = result["items"][0]
        assert item["cid"] == "c1"
        assert item["text"] == "这个怎么做的？"
        assert item["user"] == "观众甲"
        assert item["likes"] == 42
        assert item["reply_count"] == 3
        assert item["platform"] == "douyin"
        assert item["post_id"] == "7123456789"
        assert item["ip_location"] == "上海"

    def test_dy_stats(self):
        provider = make_tikhub()
        payload = {"data": {"aweme_detail": {"statistics": {
            "play_count": 1000, "digg_count": 100, "comment_count": 20,
            "share_count": 10, "collect_count": 5,
        }}}}
        with mock.patch("urllib.request.urlopen", return_value=fake_urlopen(payload)):
            result = provider.fetch_post_stats("douyin", "https://www.douyin.com/video/7123456789")
        assert result == {
            "views": 1000, "likes": 100, "comments": 20, "shares": 10,
            "favorites": 5, "coins": None, "platform": "douyin", "post_id": "7123456789",
        }

    def test_xhs_stats_interact_info_and_wan_suffix(self):
        provider = make_tikhub()
        payload = {"data": {"data": [{"interact_info": {
            "liked_count": "1.2万", "comment_count": 30, "share_count": 2, "collected_count": 8,
        }}]}}
        with mock.patch("urllib.request.urlopen", return_value=fake_urlopen(payload)):
            os.environ["TIKHUB_API_KEY"] = "test-key"
            result = provider.fetch_post_stats("xhs", "65f0a1b2000000001a00bcde")
        assert result["likes"] == 12000
        assert result["views"] is None

    def test_missing_key_raises(self):
        provider = make_tikhub()
        os.environ.pop("TIKHUB_API_KEY", None)
        with self.assertRaises(ProviderError):
            provider.fetch_post_stats("douyin", "7123456789")

    def test_comments_cached_second_call_no_http(self):
        provider = make_tikhub()
        payload = {"data": {"comments": [], "has_more": 0, "total": 0}}
        with mock.patch("urllib.request.urlopen", return_value=fake_urlopen(payload)) as mocked:
            os.environ["TIKHUB_API_KEY"] = "test-key"
            provider.fetch_comments("douyin", "7123456789", 20)
            provider.fetch_comments("douyin", "7123456789", 20)
            assert mocked.call_count == 1


class TestBilibiliProvider(unittest.TestCase):
    def test_stats(self):
        provider = BilibiliDirectProvider(RateLimiter(0), TtlCache())
        payload = {"code": 0, "data": {"stat": {
            "view": 100, "like": 10, "reply": 5, "share": 3, "favorite": 2, "coin": 1,
        }}}
        with mock.patch("urllib.request.urlopen", return_value=fake_urlopen(payload)):
            result = provider.fetch_post_stats("bilibili", "BV1xx411c7mD")
        assert result["views"] == 100
        assert result["coins"] == 1

    def test_comments(self):
        provider = BilibiliDirectProvider(RateLimiter(0), TtlCache())
        view = {"code": 0, "data": {"aid": 80433022}}
        reply = {"code": 0, "data": {"replies": [{
            "rpid": 9, "content": {"message": "前排"}, "like": 7, "ctime": 1730000000,
            "rcount": 1, "member": {"uname": "乙"}, "reply_control": {"location": "北京"},
        }], "page": {"count": 1}}}
        seq = iter([fake_urlopen(view), fake_urlopen(reply)])
        with mock.patch("urllib.request.urlopen", side_effect=lambda *a, **k: next(seq)):
            result = provider.fetch_comments("bilibili", "BV1xx411c7mD", 20)
        assert result["items"][0]["text"] == "前排"
        assert result["items"][0]["ip_location"] == "北京"


class TestRegistryAndEnvelope(unittest.TestCase):
    def test_registry_routes_platform(self):
        from app.providers import list_providers, provider_for
        assert provider_for("douyin").name == "tikhub"
        assert provider_for("xhs").name == "tikhub"
        assert provider_for("bilibili").name == "bilibili_direct"
        assert provider_for("wechat") is None
        names = {p["name"]: p["enabled"] for p in list_providers()}
        assert names["tikhub"] is True
        assert names["mediacrawler"] is False  # 注册位未接入

    def test_envelope_and_caller_key(self):
        from fastapi.testclient import TestClient
        from app.main import app
        os.environ["CRAWLER_SERVICE_KEY"] = "internal-key"
        client = TestClient(app)
        # health 免鉴权
        r = client.get("/v1/health")
        assert r.status_code == 200
        assert r.json()["code"] == 0
        assert r.json()["data"]["callerKeyConfigured"] is True
        # 业务端点无 key → 401
        assert client.get("/v1/providers").status_code == 401
        # 带 key → 200 信封
        r = client.get("/v1/providers", headers={"X-Caller-Key": "internal-key"})
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert any(p["name"] == "tikhub" for p in body["data"]["providers"])
        # 未接入平台 → 400
        r = client.get("/v1/post-stats?platform=wechat&post_id=x", headers={"X-Caller-Key": "internal-key"})
        assert r.status_code == 400
        assert r.json()["code"] == 400
        os.environ.pop("CRAWLER_SERVICE_KEY", None)


if __name__ == "__main__":
    unittest.main()

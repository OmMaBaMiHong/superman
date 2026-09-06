"""Provider 协议与注册表（平台化预留：新 provider 注册即接入）。"""

from app.ratelimit import RateLimiter, TtlCache


class ProviderError(Exception):
    """Provider 调用失败（消息不含任何 key/凭据）。"""


class BaseProvider:
    """爬虫 provider 协议。

    - name: provider 标识（tikhub / bilibili_direct / mediacrawler / selfsign）
    - platforms: 覆盖的平台（douyin/xhs/bilibili/...）
    - enabled: 未接入的占位 provider 置 False（/v1/providers 里如实展示）
    """

    name = "base"
    platforms: tuple[str, ...] = ()
    enabled = True

    def __init__(self, limiter: RateLimiter, cache: TtlCache):
        self._limiter = limiter
        self._cache = cache

    def fetch_comments(self, platform: str, post_id: str, max_count: int) -> dict:
        """返回 {items: [normalize_comment(...)], total?}"""
        raise NotImplementedError

    def fetch_post_stats(self, platform: str, post_id: str) -> dict:
        """返回 normalize_stats(...)"""
        raise NotImplementedError


_REGISTRY: dict[str, BaseProvider] = {}
_LIMITER = RateLimiter(min_gap=0.14)  # ~7 QPS，与参考实现一致
_CACHE = TtlCache()


def register_provider(provider: BaseProvider) -> None:
    _REGISTRY[provider.name] = provider


def list_providers() -> list[dict]:
    return [
        {"name": p.name, "platforms": list(p.platforms), "enabled": p.enabled}
        for p in _REGISTRY.values()
    ]


def provider_for(platform: str) -> BaseProvider | None:
    for provider in _REGISTRY.values():
        if provider.enabled and platform in provider.platforms:
            return provider
    return None


def get_limiter() -> RateLimiter:
    return _LIMITER


def get_cache() -> TtlCache:
    return _CACHE


class _StubProvider(BaseProvider):
    """注册位预留：mediacrawler / 自研签名（架构口子，未接入）。"""

    def __init__(self, name: str, platforms: tuple[str, ...]):
        super().__init__(None, None)  # type: ignore[arg-type]
        self.name = name  # type: ignore[misc]
        self.platforms = platforms  # type: ignore[misc]
        self.enabled = False

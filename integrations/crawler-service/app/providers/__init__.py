"""Provider 注册表：启动时把已实现的 provider 挂进来（新 provider 在这里加一行即可）。"""
from app.providers.base import (
    BaseProvider,
    _StubProvider,
    get_cache,
    get_limiter,
    list_providers,
    provider_for,
    register_provider,
)
from app.providers.bilibili import BilibiliDirectProvider
from app.providers.tikhub import TikhubProvider

_limiter = get_limiter()
_cache = get_cache()

register_provider(TikhubProvider(_limiter, _cache))
register_provider(BilibiliDirectProvider(_limiter, _cache))
# 注册位预留（架构口子，未接入）
register_provider(_StubProvider("mediacrawler", ("douyin", "xhs", "bilibili")))
register_provider(_StubProvider("selfsign", ("douyin",)))

__all__ = [
    "BaseProvider",
    "list_providers",
    "provider_for",
    "register_provider",
]

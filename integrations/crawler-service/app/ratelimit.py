"""全局限流与 TTL 缓存（借鉴 huangque tikhub.py 的 ~7QPS + TTL 思路，独立实现）。"""
import threading
import time


class RateLimiter:
    """跨线程排队限流：保证任意两次调用间隔 >= min_gap 秒（默认 0.14s ≈ 7QPS）。"""

    def __init__(self, min_gap: float = 0.14):
        self._min_gap = min_gap
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            gap = self._min_gap - (time.time() - self._last)
            if gap > 0:
                time.sleep(gap)
            self._last = time.time()


class TtlCache:
    """进程内 TTL 缓存（单进程服务够用；多实例部署时换 Redis）。"""

    def __init__(self):
        self._lock = threading.Lock()
        self._store: dict[str, tuple[float, object]] = {}

    def get(self, key: str):
        with self._lock:
            entry = self._store.get(key)
            if entry and entry[0] > time.time():
                return entry[1]
            return None

    def set(self, key: str, value, ttl_seconds: int) -> None:
        with self._lock:
            self._store[key] = (time.time() + ttl_seconds, value)
            # 顺手清过期，防内存膨胀
            now = time.time()
            expired = [k for k, (exp, _) in self._store.items() if exp <= now]
            for k in expired:
                self._store.pop(k, None)

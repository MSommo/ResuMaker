"""Redis helpers. The cache is an optimisation, never a dependency: any Redis failure degrades to a cache miss."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

from redis.asyncio import Redis

log = logging.getLogger("resumaker.cache")


def digest(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()


class Cache:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def get(self, key: str) -> bytes | None:
        try:
            return await self.redis.get(key)
        except Exception as e:  # noqa: BLE001
            log.warning("cache get failed: %s", e)
            return None

    async def set(self, key: str, value: bytes | str, ttl: int) -> None:
        try:
            await self.redis.set(key, value, ex=ttl)
        except Exception as e:  # noqa: BLE001
            log.warning("cache set failed: %s", e)

    async def hit(self, key: str, ttl: int) -> int:
        """Fixed-window counter: returns how many times `key` was hit in the current window."""
        try:
            n = await self.redis.incr(key)
            if n == 1:
                await self.redis.expire(key, ttl)
            return int(n)
        except Exception as e:  # noqa: BLE001
            log.warning("rate limiter unavailable, allowing request: %s", e)
            return 0

    async def ping(self) -> bool:
        try:
            return bool(await self.redis.ping())
        except Exception:  # noqa: BLE001
            return False


def window_key(prefix: str, who: str, seconds: int = 60) -> str:
    return f"rl:{prefix}:{who}:{int(time.time() // seconds)}"
